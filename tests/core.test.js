import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema, ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { createServer } from '../dist/mcp/server.js';

import { parseFrontmatter, serializeFrontmatter } from '../dist/core/frontmatter.js';
import { resolveLang, fromLocale } from '../dist/core/i18n.js';
import { CORE_MESSAGES } from '../dist/core/messages.js';
import { CLI_MESSAGES } from '../dist/messages.js';
import { SERVER_MESSAGES } from '../dist/mcp/messages.js';
import { loadTree, writeBranch, writeRoot, deleteBranch, moveBranch, slugify, findTreeDir, localDirFor, fileForBranch, compareBranchPaths, initTree, detectInstructionFiles, ensureLocalIgnored } from '../dist/core/store.js';
import { withAncestors, allBranches } from '../dist/core/tree.js';
import { route, pickEngine, isCliEngine, parseIndices, timeoutFor, findBinIn, cmdLine } from '../dist/core/router.js';
import { evaluateRouting, parseEvalCases } from '../dist/core/eval.js';
import { renderContext, renderAgentsBlock, renderBootstrapPrompt, renderBootstrapInvite, renderCatalogueOnly } from '../dist/core/render.js';
import { syncAgentsFile, installCodexMcp, agentStatus, installAgent, selfCommand, AGENTS, NoCliError } from '../dist/install.js';
import { extractPack, applyPack, encodePack, decodePack } from '../dist/core/pack.js';
import { appendTurn, readJournal, journalFile, appendAiWrite, readAiWrites, turnLabelKey } from '../dist/core/journal.js';
import { readSelection, writeSelection, claimBootstrapInvite } from '../dist/core/session.js';
import {
  RemoteError, clearSession, createGroup, currentSession, me, myGroups,
  readSession, remoteConfig, setRemoteConfig, signIn, signOut,
} from '../dist/core/remote.js';
import {
  merge, outgoingDiff, snapshotOf, pull, push, readTracking, writeTracking, localSnapshot,
} from '../dist/core/sync.js';

// Les textes attendus par ces tests sont en français : la langue est posée
// explicitement, pour qu'une machine en anglais ne les fasse pas échouer. Les
// tests de l'anglais la posent eux-mêmes.
process.env.CONTEXTREE_LANG = 'fr';

process.env.CONTEXTREE_STATE_DIR = await fs.mkdtemp(
  path.join(os.tmpdir(), 'contextree-journal-'),
);

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-test-'));
  return path.join(dir, '.contextree');
}

test("i18n : la langue se résout dans l'ordre — explicite, variables de locale, macOS, Intl, anglais", () => {
  const jamais = () => { throw new Error('ne devait pas être consulté'); };
  // L'explicite gagne sur tout.
  assert.equal(resolveLang({ CONTEXTREE_LANG: 'en', LANG: 'fr_FR.UTF-8' }, { appleLanguage: jamais, intlLocale: jamais }), 'en');
  // Les variables de locale ensuite ; C et POSIX ne disent rien.
  assert.equal(resolveLang({ LANG: 'fr_FR.UTF-8' }, { platform: 'linux', intlLocale: jamais }), 'fr');
  assert.equal(resolveLang({ LC_ALL: 'fr_CA', LANG: 'en_US' }, { platform: 'linux', intlLocale: jamais }), 'fr');
  // Le Mac mesuré : LANG=C.UTF-8, Intl en-US, préférences en français.
  assert.equal(resolveLang({ LANG: 'C.UTF-8' }, { platform: 'darwin', appleLanguage: () => 'fr-FR', intlLocale: () => 'en-US' }), 'fr');
  // Hors macOS, les préférences Apple ne sont pas lues : Intl décide (Windows).
  assert.equal(resolveLang({}, { platform: 'win32', appleLanguage: jamais, intlLocale: () => 'fr-FR' }), 'fr');
  // Une locale qu'on ne parle pas vaut l'anglais, pas le français.
  assert.equal(resolveLang({}, { platform: 'win32', intlLocale: () => 'de-DE' }), 'en');
  assert.equal(resolveLang({ CONTEXTREE_LANG: 'fr-BE' }), 'fr');
  assert.equal(fromLocale('french'), 'en');
});

test('frontmatter : aller-retour, valeurs citées, corps intact', () => {
  const raw = serializeFrontmatter(
    { type: 'rule', title: 'Titre: avec deux-points', load_when: 'quand X' },
    '# Corps\n\n---\npas une clôture\n',
  );
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.type, 'rule');
  assert.equal(data.title, 'Titre: avec deux-points');
  assert.equal(data.load_when, 'quand X');
  assert.match(body, /pas une clôture/);
});

test('frontmatter : fichier sans frontmatter reste lisible', () => {
  const { data, body } = parseFrontmatter('juste du markdown');
  assert.deepEqual(data, {});
  assert.equal(body, 'juste du markdown');
});

test('store : le parent vient de l\'arborescence, le type du frontmatter', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, { path: 'archi', type: 'context', title: 'Archi', loadWhen: 'a', content: 'A' });
  await writeBranch(dir, { path: 'archi/cmds', type: 'reference', title: 'Cmds', loadWhen: 'b', content: 'B' });

  const tree = await loadTree(dir);
  assert.equal(tree.rootContent, 'racine');
  assert.equal(tree.branches.get('archi').parentPath, null);
  assert.equal(tree.branches.get('archi/cmds').parentPath, 'archi');
  assert.equal(tree.branches.get('archi/cmds').type, 'reference');
  assert.deepEqual(tree.branches.get('archi').childPaths, ['archi/cmds']);
});

test('store : un dossier sans .md frère devient un hub implicite', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'equipe/regle', type: 'rule', title: 'R', loadWhen: 'x', content: 'C' });
  await fs.rm(path.join(dir, 'equipe.md'), { force: true });

  const tree = await loadTree(dir);
  assert.ok(tree.branches.has('equipe'), 'le hub implicite existe');
  assert.equal(tree.branches.get('equipe').content, '');
  assert.equal(tree.branches.get('equipe/regle').parentPath, 'equipe');
});

test('store : delete emporte les enfants', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b', type: 'context', title: 'B', loadWhen: 'x', content: '' });
  await deleteBranch(dir, 'a');
  assert.equal((await loadTree(dir)).order.length, 0);
});

test("partage git : un dépôt dans l'arbre n'est pas une branche", async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, {
    path: 'vraie', type: 'context', title: 'Vraie', loadWhen: 'quand', content: 'du contenu',
  });

  // Le cas « l'arbre est lui-même un dépôt » : `.git` est un **dossier**.
  await fs.mkdir(path.join(dir, '.git', 'refs'), { recursive: true });
  await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  // Le cas submodule : `.git` est un **fichier** qui pointe ailleurs.
  const sub = await scratch();
  await writeRoot(sub, 'racine');
  await fs.writeFile(path.join(sub, '.git'), 'gitdir: ../.git/modules/.contextree\n', 'utf8');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['vraie']);
  assert.equal((await loadTree(sub)).order.length, 0);
});

test("partage git : le calque personnel est ignoré par git dès la création de l'arbre", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-ignore-'));

  // Hors dépôt git, rien à faire : un `.gitignore` dans un dossier non
  // versionné serait du bruit.
  assert.equal(await ensureLocalIgnored(projectDir), 'skipped');
  await assert.rejects(fs.stat(path.join(projectDir, '.gitignore')));

  // Dans un dépôt, la ligne arrive avec l'arbre. Sans elle, tout le choix du
  // calque en dossier frère ne tient plus : un `git add -A` pousserait les
  // notes personnelles au groupe.
  await fs.mkdir(path.join(projectDir, '.git'));
  await fs.writeFile(path.join(projectDir, '.gitignore'), 'node_modules/\n', 'utf8');
  await initTree(projectDir);
  const ignore = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.contextree\.local\/$/m);
  // Ce qui y était reste : le fichier appartient à l'utilisateur.
  assert.match(ignore, /node_modules\//);

  // Idempotent : on ajoute une ligne, on ne réécrit jamais.
  assert.equal(await ensureLocalIgnored(projectDir), 'present');
  assert.equal(await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8'), ignore);
});

test('store : findTreeDir remonte comme .git', async () => {
  const dir = await scratch();
  const deep = path.join(path.dirname(dir), 'src', 'nested');
  await fs.mkdir(deep, { recursive: true });
  await writeRoot(dir, 'r');
  assert.equal(await findTreeDir(deep), dir);
});

test('tree : sélectionner un enfant remonte tous ses parents', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b', type: 'context', title: 'B', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b/c', type: 'skill', title: 'C', loadWhen: 'x', content: '' });
  const tree = await loadTree(dir);
  assert.deepEqual([...withAncestors(tree, ['a/b/c'])].sort(), ['a', 'a/b', 'a/b/c']);
});

test("routeur : sans moteur, tout l'arbre — et aucun type privilégié", async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'zone', type: 'context', title: 'Zone', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'zone/r', type: 'rule', title: 'R', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'i', type: 'identity', title: 'I', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'doc', type: 'reference', title: 'D', loadWhen: 'x', content: '' });
  const tree = await loadTree(dir);

  const previous = process.env.CONTEXTREE_ROUTER;
  process.env.CONTEXTREE_ROUTER = 'off';
  try {
    assert.equal(pickEngine(), 'none');
    const { selected, reason, error } = await route(tree, 'peu importe', {
      previousSelection: ['i'],
    });
    // Pas de moteur : on injecte tout, et on le dit. Surtout pas une sélection
    // décidée par le type des branches.
    assert.deepEqual([...selected].sort(), ['doc', 'i', 'zone', 'zone/r']);
    assert.equal(reason, 'all');
    assert.match(error, /aucun moteur/);
  } finally {
    if (previous === undefined) delete process.env.CONTEXTREE_ROUTER;
    else process.env.CONTEXTREE_ROUTER = previous;
  }
});

test("routeur : le budget dépend de qui attend, pas du moteur seul", () => {
  const avant = process.env.CONTEXTREE_ROUTER_TIMEOUT_MS;
  delete process.env.CONTEXTREE_ROUTER_TIMEOUT_MS;
  try {
    // Un CLI démarre un process et passe par la file d'un abonnement — mesuré
    // entre 5 et 60 s. Un prompt ne peut pas attendre autant qu'une mesure que
    // personne ne regarde.
    assert.equal(timeoutFor('cli', 'prompt'), 45_000);
    // Un agent qui appelle `get_context` attend déjà — mais son client, lui,
    // abandonne à 60 s. Le budget reste dessous pour que le repli arrive :
    // mieux vaut un contexte trop large qu'aucun contexte.
    assert.equal(timeoutFor('cli', 'tool'), 45_000);
    assert.ok(timeoutFor('cli', 'tool') < 60_000);
    assert.equal(timeoutFor('cli', 'batch'), 120_000);
    // Une API répond en centaines de ms ; si elle met des secondes, elle est
    // cassée, pas lente.
    assert.equal(timeoutFor('api', 'prompt'), 2500);
    assert.equal(timeoutFor('api', 'tool'), 2500);
    assert.equal(timeoutFor('api', 'batch'), 10_000);

    // L'échappatoire de l'utilisateur écrase tout le reste.
    process.env.CONTEXTREE_ROUTER_TIMEOUT_MS = '7000';
    assert.equal(timeoutFor('cli', 'prompt'), 7000);
    assert.equal(timeoutFor('api', 'batch'), 7000);
    // Une valeur absurde n'a pas le droit de ramener le budget à zéro.
    process.env.CONTEXTREE_ROUTER_TIMEOUT_MS = 'beaucoup';
    assert.equal(timeoutFor('cli', 'tool'), 45_000);
  } finally {
    if (avant === undefined) delete process.env.CONTEXTREE_ROUTER_TIMEOUT_MS;
    else process.env.CONTEXTREE_ROUTER_TIMEOUT_MS = avant;
  }
});

test('routeur : le moteur forcé est respecté, anciens noms compris', () => {
  const saved = { ...process.env };
  const only = keys => {
    for (const k of ['CONTEXTREE_ROUTER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY']) {
      delete process.env[k];
    }
    Object.assign(process.env, keys);
  };
  try {
    // Un moteur forcé n'est pas vérifié : s'il manque, c'est le fallback qui
    // rattrape — jamais un repli silencieux sur un moteur non demandé.
    only({ CONTEXTREE_ROUTER: 'openai' });
    assert.equal(pickEngine(), 'openai');
    only({ CONTEXTREE_ROUTER: 'codex' });
    assert.equal(pickEngine(), 'codex');
    only({ CONTEXTREE_ROUTER: 'gemini' });
    assert.equal(pickEngine(), 'gemini');
    // Les noms d'avant l'ouverture aux autres IA restent compris.
    only({ CONTEXTREE_ROUTER: 'sdk' });
    assert.equal(pickEngine(), 'anthropic');
    only({ CONTEXTREE_ROUTER: 'cli' });
    assert.equal(pickEngine(), 'claude');

    // Sans rien de forcé : une clé gagne, Anthropic avant OpenAI.
    only({ OPENAI_API_KEY: 'x' });
    assert.equal(pickEngine(), 'openai');
    only({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' });
    assert.equal(pickEngine(), 'anthropic');
    // Une clé passée en argument gagne aussi.
    only({});
    assert.equal(pickEngine('z'), 'anthropic');

    // Le sampling d'un client MCP passe après une clé, et avant tout CLI : il
    // n'est candidat que si l'appelant a un client qui le propose.
    only({});
    assert.equal(pickEngine(undefined, { sampling: true }), 'sampling');
    assert.notEqual(pickEngine(), 'sampling');
    only({ OPENAI_API_KEY: 'x' });
    assert.equal(pickEngine(undefined, { sampling: true }), 'openai');
    only({ CONTEXTREE_ROUTER: 'sampling' });
    assert.equal(pickEngine(), 'sampling');

    // Seuls les moteurs CLI sont lents : c'est ce qui décide du différé.
    assert.ok(isCliEngine('claude') && isCliEngine('codex') && isCliEngine('gemini'));
    assert.ok(!isCliEngine('anthropic') && !isCliEngine('openai') && !isCliEngine('sampling') && !isCliEngine('none'));
  } finally {
    for (const k of ['CONTEXTREE_ROUTER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("routeur : sous Windows, le binaire se cherche par PATHEXT — claude.exe comme claude.cmd", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-bin-'));
  const poser = async nom => {
    await fs.writeFile(path.join(dir, nom), '', 'utf8');
    await fs.chmod(path.join(dir, nom), 0o755);
  };
  const win = pathext => ({ platform: 'win32', pathext });

  // L'installation native de Claude Code : un .exe, que l'ancien code ne voyait pas.
  await poser('claude.exe');
  assert.match(findBinIn('claude', [dir], win('.COM;.EXE;.BAT;.CMD')) ?? '', /claude\.exe$/);

  // Un shim npm à côté : l'ordre de PATHEXT décide, comme dans le shell.
  await poser('claude.cmd');
  assert.match(findBinIn('claude', [dir], win('.CMD;.EXE')) ?? '', /claude\.cmd$/);
  // Une extension qu'on ne sait pas lancer n'est pas candidate.
  assert.equal(findBinIn('claude', [dir], win('.PS1;.VBS')), null);

  // Hors Windows, rien ne change : le nom nu, et lui seul.
  assert.equal(findBinIn('claude', [dir], { platform: 'darwin' }), null);
  await poser('claude');
  assert.equal(findBinIn('claude', [dir], { platform: 'linux' }), path.join(dir, 'claude'));
});

test("routeur : la ligne cmd.exe échappe les métacaractères et garde les arguments vides", () => {
  const ligne = cmdLine('C:\\npm\\claude.cmd', ['--tools', '', '--mcp-config', '{"mcpServers":{}}', 'a&b|c']);
  // Aucun métacaractère de cmd.exe ne reste nu : & | " sont tous précédés d'un ^.
  assert.ok(!/(^|[^^])[&|"]/.test(ligne), ligne);
  // L'argument vide survit comme argument : une paire de guillemets échappée.
  assert.match(ligne, /--tools\^\^\^" \^\^\^"\^\^\^"/);
});

test("routeur : un faux CLI claude est lancé et sa réponse donne un tour routé", async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  for (const p of ['a', 'b', 'c', 'd']) {
    await writeBranch(dir, { path: p, type: 'context', title: p, loadWhen: `quand ${p}`, content: p });
  }
  const bins = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-fauxcli-'));
  // Sous Windows, un .cmd — la forme de tout CLI installé par npm, et celle qui
  // levait EINVAL. Ailleurs, un script shell. Les deux lisent stdin et répondent [1].
  const bin = process.platform === 'win32' ? path.join(bins, 'claude.cmd') : path.join(bins, 'claude');
  await fs.writeFile(
    bin,
    process.platform === 'win32' ? '@echo off\r\nmore > nul\r\necho [1]\r\n' : '#!/bin/sh\ncat > /dev/null\necho "[1]"\n',
    'utf8',
  );
  await fs.chmod(bin, 0o755);

  const saved = { router: process.env.CONTEXTREE_ROUTER, bin: process.env.CONTEXTREE_CLAUDE_BIN };
  process.env.CONTEXTREE_ROUTER = 'claude';
  process.env.CONTEXTREE_CLAUDE_BIN = bin;
  try {
    const tree = await loadTree(dir);
    const res = await route(tree, 'quelque chose sur b', { waiter: 'batch' });
    assert.equal(res.reason, 'routed', res.error);
    assert.equal(res.engine, 'claude');
    assert.deepEqual([...res.selected], ['b']);
  } finally {
    for (const [k, v] of [['CONTEXTREE_ROUTER', saved.router], ['CONTEXTREE_CLAUDE_BIN', saved.bin]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("AGENTS.md : la racine et le catalogue, jamais l'arbre entier", async () => {
  const dir = await scratch();
  await writeRoot(dir, 'RACINE');
  await writeBranch(dir, {
    path: 'r',
    type: 'rule',
    title: 'Une règle',
    loadWhen: 'quand on touche au code',
    content: 'LE CONTENU DE LA REGLE',
  });
  const block = renderAgentsBlock(await loadTree(dir));

  assert.match(block, /RACINE/);
  // Le catalogue, celui que lit le routeur — titre et condition.
  assert.match(block, /Une règle.*charger quand : quand on touche au code/);
  assert.match(block, /get_context/);
  // Surtout pas le contenu des branches : ce serait le gros fichier de
  // consignes que contextree existe pour remplacer.
  assert.ok(!block.includes('LE CONTENU DE LA REGLE'));
});

test('AGENTS.md : le bloc est borné, resynchronisé, et ne duplique rien', async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-agents-'));
  const file = path.join(projectDir, 'AGENTS.md');
  await fs.writeFile(file, '# Mes consignes\n\nÀ moi.\n', 'utf8');

  const report = [];
  await syncAgentsFile(projectDir, 'PREMIER', report);
  let body = await fs.readFile(file, 'utf8');
  assert.match(body, /# Mes consignes/);
  assert.match(body, /PREMIER/);
  assert.equal(report[0].action, 'updated');

  // Resynchronisation : le bloc est remplacé, pas ajouté à la suite.
  await syncAgentsFile(projectDir, 'SECOND', report);
  body = await fs.readFile(file, 'utf8');
  assert.equal(body.match(/contextree:start/g).length, 1);
  assert.ok(!body.includes('PREMIER'));
  assert.match(body, /SECOND/);
  assert.match(body, /# Mes consignes/);

  // Rien à faire : un install répété ne salit pas un diff.
  await syncAgentsFile(projectDir, 'SECOND', report);
  assert.equal(report[2].action, 'unchanged');
});

test("install : on inscrit la commande qui tourne, pas npx en dur", async () => {
  const saved = process.argv[1];
  try {
    // Lancé depuis un cache npx : la forme npx est la bonne pour cet
    // utilisateur — le paquet est là où npx sait le retrouver.
    process.argv[1] = path.join(os.homedir(), '.npm', '_npx', 'abc123', 'node_modules', '@gengad', 'contextree', 'dist', 'cli.js');
    const viaNpx = selfCommand('hook');
    assert.equal(viaNpx.command, 'npx');
    assert.deepEqual(viaNpx.args, ['-y', '@gengad/contextree', 'hook', '--lang', 'fr']);
    assert.equal(viaNpx.shell, 'npx -y @gengad/contextree hook --lang fr');

    // Sinon : node + le script, en absolu et entre guillemets. Sans ça, un
    // paquet non publié échoue en silence sur tout autre projet que celui-ci.
    process.argv[1] = path.join('dist', 'cli.js');
    const local = selfCommand('mcp');
    assert.equal(local.command, process.execPath);
    assert.deepEqual(local.args, [path.resolve('dist', 'cli.js'), 'mcp', '--lang', 'fr']);
    assert.ok(path.isAbsolute(local.args[0]));
    assert.equal(local.shell, `"${process.execPath}" "${path.resolve('dist', 'cli.js')}" mcp --lang fr`);

    // La détection « déjà câblé » cherche `contextree` dans la commande : elle
    // doit rester vraie sur les deux formes.
    process.argv[1] = path.join(path.sep, 'opt', 'node_modules', '@gengad', 'contextree', 'dist', 'cli.js');
    assert.ok(selfCommand('hook').shell.includes('contextree'));
    assert.ok(viaNpx.shell.includes('contextree'));
  } finally {
    process.argv[1] = saved;
  }
});

test("vscode : la forme est `servers`, pas `mcpServers` — et le bloc va dans les deux fichiers", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-vscode-'));
  const report = await installAgent('vscode', projectDir, '## bloc');

  const mcp = JSON.parse(await fs.readFile(path.join(projectDir, '.vscode', 'mcp.json'), 'utf8'));
  // Le piège du palier : un JSON valide à la mauvaise forme est ignoré en
  // silence par VS Code — ça ressemble à une réussite.
  assert.ok(mcp.servers?.contextree, 'la clé racine est `servers`');
  assert.equal(mcp.mcpServers, undefined);
  assert.equal(mcp.servers.contextree.type, 'stdio');

  // Copilot lit toujours `copilot-instructions.md` ; `AGENTS.md` sert à tout ce
  // qui ouvre le dépôt ensuite. Le même bloc dans les deux, une seule source.
  assert.match(
    await fs.readFile(path.join(projectDir, '.github', 'copilot-instructions.md'), 'utf8'),
    /## bloc/,
  );
  assert.match(await fs.readFile(path.join(projectDir, 'AGENTS.md'), 'utf8'), /## bloc/);
  assert.equal(report.length, 3);

  // Câblé, et idempotent : un `install` répété ne salit pas un diff.
  const [statut] = (await agentStatus(projectDir)).filter(a => a.id === 'vscode');
  assert.equal(statut.wired, true);
  const encore = await installAgent('vscode', projectDir, '## bloc');
  assert.ok(encore.every(r => r.action === 'unchanged'));
});

test("gemini : les deux surfaces dans un seul fichier, et « câblé » exige les deux", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-gemini-'));
  await installAgent('gemini', projectDir, '## bloc');

  const file = path.join(projectDir, '.gemini', 'settings.json');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.ok(config.mcpServers?.contextree);
  // `BeforeAgent` est le seul équivalent de `UserPromptSubmit` hors Claude Code,
  // et sa structure est imbriquée — une liste de matchers, chacun ses commandes.
  const cmd = config.hooks.BeforeAgent[0].hooks[0].command;
  assert.match(cmd, /contextree/);
  assert.match(cmd, /--agent gemini/);
  assert.match(await fs.readFile(path.join(projectDir, 'GEMINI.md'), 'utf8'), /## bloc/);

  const wired = async () => (await agentStatus(projectDir)).find(a => a.id === 'gemini').wired;
  assert.equal(await wired(), true);

  // Le serveur sans le hook n'est pas un câblage terminé : l'annoncer comme tel
  // serait mentir sur la surface qui donne l'avance.
  delete config.hooks;
  await fs.writeFile(file, JSON.stringify(config), 'utf8');
  assert.equal(await wired(), false);
});

test("install : un fichier de consignes ne se reconnaît pas à son nom", async () => {
  // Deux agents rangent leur config dans un `settings.json`, et deux formats de
  // MCP cohabitent. Le registre doit rester lisible sans que `isWired` devine.
  const parNom = new Map();
  for (const spec of AGENTS) {
    for (const f of spec.files('/projet')) {
      const nom = path.basename(f);
      parNom.set(nom, (parNom.get(nom) ?? new Set()).add(spec.id));
    }
  }
  // Le cas qui a cassé : `settings.json` appartient à deux agents distincts.
  assert.ok(parNom.get('settings.json').size >= 2);

  // Et chaque agent déclare au moins un fichier — sans quoi `isWired` le dirait
  // câblé par défaut (`every` sur une liste vide).
  for (const spec of AGENTS) assert.ok(spec.files('/projet').length > 0, spec.id);
});

test('codex : la table MCP est ajoutée à la fin, jamais réécrite', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-codex-'));
  const saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    await fs.writeFile(path.join(home, 'config.toml'), '[projects."/x"]\ntrust_level = "trusted"\n', 'utf8');
    const report = [];
    await installCodexMcp(report);
    const body = await fs.readFile(path.join(home, 'config.toml'), 'utf8');
    // Ce qui était là est intact, et la nouvelle table est bien à la fin :
    // aucune table précédente ne peut l'avaler.
    assert.match(body, /\[projects\."\/x"\]\ntrust_level = "trusted"/);
    assert.ok(body.includes(`[mcp_servers.contextree]\ncommand = ${JSON.stringify(selfCommand('mcp').command)}`));
    assert.ok(body.indexOf('[mcp_servers.contextree]') > body.indexOf('[projects."/x"]'));

    await installCodexMcp(report);
    assert.equal(report[1].action, 'unchanged');
    assert.equal((await fs.readFile(path.join(home, 'config.toml'), 'utf8')), body);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
  }
});

test("install : l'état d'un agent se lit sans rien écrire, et le câblage est idempotent", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-wire-'));

  const before = await agentStatus(projectDir);
  const cursor = () => before.find(a => a.id === 'cursor');
  assert.equal(cursor().wired, false);
  // Regarder n'écrit rien : c'est ce qui permet à un bouton de montrer l'état
  // plutôt que de tenter et d'échouer en silence.
  assert.deepEqual(await fs.readdir(projectDir), []);

  // Sans arbre, pas de bloc de consignes à écrire : le serveur MCP est posé,
  // mais le câblage n'est **pas** terminé — et `--status` doit le dire plutôt
  // que d'annoncer une surface qui n'existe pas encore.
  const sansArbre = await installAgent('cursor', projectDir);
  assert.equal(sansArbre[0].action, 'created');
  const written = JSON.parse(await fs.readFile(path.join(projectDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(written.mcpServers.contextree.command, selfCommand('mcp').command);
  assert.deepEqual(written.mcpServers.contextree.args, selfCommand('mcp').args);
  assert.equal((await agentStatus(projectDir)).find(a => a.id === 'cursor').wired, false);

  // Avec l'arbre, le fichier de consignes arrive et le câblage est complet.
  const report = await installAgent('cursor', projectDir, '## bloc');
  assert.ok(report.some(r => r.file.endsWith('AGENTS.md') && r.action === 'created'));

  const after = await agentStatus(projectDir);
  assert.equal(after.find(a => a.id === 'cursor').wired, true);

  const again = await installAgent('cursor', projectDir, '## bloc');
  assert.ok(again.every(r => r.action === 'unchanged'));
});

test("install : VS Code lance le serveur dans le workspace, et une config d'une autre machine se répare", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-vscode-'));
  const file = path.join(projectDir, '.vscode', 'mcp.json');
  const read = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const mcpWired = async () => {
    const r = await agentStatus(projectDir);
    // Le câblage VS Code exige aussi les consignes : on ne regarde que le serveur.
    return r.find(a => a.id === 'vscode');
  };

  const neuf = await installAgent('vscode', projectDir);
  assert.equal((await read()).servers.contextree.cwd, '${workspaceFolder}');
  // Écrit en chemins absolus (pas depuis npx) : le fichier le dit.
  assert.match(neuf[0].note ?? '', /ne le commite pas/);

  // Le fichier d'un collègue, commité depuis sa machine : la commande n'existe pas ici.
  await fs.writeFile(file, JSON.stringify({
    servers: {
      contextree: { type: 'stdio', command: '/Users/quelquun/node', args: ['/Users/quelquun/contextree/dist/cli.js', 'mcp'] },
      autre: { type: 'stdio', command: 'autre-serveur' },
    },
  }), 'utf8');
  await syncAgentsFile(projectDir, '## bloc', []);
  await syncAgentsFile(projectDir, '## bloc', [], path.join('.github', 'copilot-instructions.md'));
  assert.equal((await mcpWired()).wired, false, "une commande absente n'est pas un câblage");

  const repare = await installAgent('vscode', projectDir, '## bloc');
  assert.equal(repare.find(r => r.file === file).action, 'repaired');
  const apres = await read();
  assert.equal(apres.servers.contextree.command, selfCommand('mcp').command);
  assert.equal(apres.servers.contextree.cwd, '${workspaceFolder}');
  // Ce qui n'est pas à nous ne bouge pas.
  assert.deepEqual(apres.servers.autre, { type: 'stdio', command: 'autre-serveur' });
  assert.equal((await mcpWired()).wired, true);

  // Une entrée d'avant le `cwd`, mais lançable : on ajoute le champ, rien d'autre.
  const { command, args } = selfCommand('mcp');
  await fs.writeFile(file, JSON.stringify({ servers: { contextree: { type: 'stdio', command, args } } }), 'utf8');
  const complete = await installAgent('vscode', projectDir, '## bloc');
  assert.equal(complete.find(r => r.file === file).action, 'updated');
  assert.equal((await read()).servers.contextree.cwd, '${workspaceFolder}');
});

test("install : une entrée .mcp.json venue d'une autre machine est réécrite, pas déclarée câblée", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-mcpjson-'));
  const file = path.join(projectDir, '.cursor', 'mcp.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    mcpServers: { contextree: { command: path.join(projectDir, 'absent', 'node'), args: ['mcp'] } },
  }), 'utf8');
  const report = await installAgent('cursor', projectDir);
  assert.equal(report[0].action, 'repaired');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).mcpServers.contextree.command, selfCommand('mcp').command);
  // Réparé une fois : la suivante ne touche plus à rien.
  assert.equal((await installAgent('cursor', projectDir))[0].action, 'unchanged');
});

test("install : sous l'hôte d'extensions, la commande inscrite lance contextree — jamais le binaire Electron", async () => {
  // Le bouton de l'extension : execPath est le binaire Electron, argv[1] son amorce.
  const electron = { execPath: '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin)', argv1: '/tmp/bootstrap-fork', electron: '37.2.0' };

  // Un contextree installé par `npm i -g` : un lien vers dist/cli.js — ou, sous
  // Windows, un shim `.cmd` à côté de `node_modules/@gengad/contextree` (une
  // jonction ici : un lien symbolique y demanderait des droits d'administration).
  const bins = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-global-'));
  let lien;
  if (process.platform === 'win32') {
    await fs.mkdir(path.join(bins, 'node_modules', '@gengad'), { recursive: true });
    await fs.symlink(path.resolve('.'), path.join(bins, 'node_modules', '@gengad', 'contextree'), 'junction');
    lien = path.join(bins, 'contextree.cmd');
    await fs.writeFile(lien, '@echo off\r\n', 'utf8');
  } else {
    lien = path.join(bins, 'contextree');
    await fs.symlink(path.resolve('dist/cli.js'), lien);
  }
  const find = name => (name === 'contextree' ? lien : name === 'node' ? process.execPath : null);

  const mcp = selfCommand('mcp', { ...electron, find });
  assert.notEqual(mcp.command, electron.execPath);
  assert.ok(!mcp.shell.includes('Cursor Helper'));
  assert.match(mcp.args[0], /cli\.js$/);
  assert.equal(await fs.realpath(mcp.args[0]), await fs.realpath(path.resolve('dist/cli.js')));

  // Exécutée telle quelle : le serveur répond à `initialize`…
  const projet = path.dirname(await scratch());
  await writeRoot(path.join(projet, '.contextree'), 'racine du projet');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: mcp.command, args: mcp.args, cwd: projet, stderr: 'ignore',
    env: { ...process.env, CONTEXTREE_ROUTER: 'off' },
  }));
  try {
    assert.equal(client.getServerVersion().name, 'contextree');
  } finally {
    await client.close();
  }

  // … et le hook rend un bloc.
  const hook = selfCommand('hook', { ...electron, find });
  const sortie = await new Promise((resolve, reject) => {
    const child = spawn(hook.command, hook.args, { env: { ...process.env, CONTEXTREE_ROUTER: 'off' } });
    let out = '';
    child.stdout.on('data', c => (out += c));
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify({ prompt: 'bonjour', cwd: projet, session_id: 'electron' }));
  });
  assert.match(sortie, /<contextree>[\s\S]*racine du projet/);

  // Sans contextree installé : rien d'inscriptible, et le message dit quoi faire.
  assert.throws(() => selfCommand('mcp', { ...electron, find: () => null }), err =>
    err instanceof NoCliError && /npm install -g/.test(err.message));

  // Le terminal ne change pas : ce qui tourne est contextree.
  const terminal = selfCommand('mcp', { execPath: process.execPath, argv1: path.resolve('dist/cli.js') });
  assert.deepEqual(terminal.args, [path.resolve('dist/cli.js'), 'mcp', '--lang', 'fr']);
  assert.equal(terminal.command, process.execPath);
});

test('install : Claude Code est câblé quand le hook ET le serveur MCP y sont', async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-wire-cc-'));
  const wired = async () => (await agentStatus(projectDir)).find(a => a.id === 'claude-code').wired;

  // Un serveur MCP seul n'est pas un câblage : le hook est la moitié qui rend
  // l'injection déterministe. L'annoncer comme fait serait mentir.
  await fs.mkdir(path.join(projectDir, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, '.mcp.json'),
    JSON.stringify({ mcpServers: { contextree: {} } }),
    'utf8',
  );
  assert.equal(await wired(), false);

  await installAgent('claude-code', projectDir);
  assert.equal(await wired(), true);

  // Ce qui était déjà là n'est pas réécrit.
  const report = await installAgent('claude-code', projectDir);
  assert.ok(report.every(r => r.action === 'unchanged'));
});

test("init : le tronc de départ est le même pour la CLI et pour la vue", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-init-'));

  const { dir, branches } = await initTree(projectDir);
  assert.equal(branches, 4);
  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['architecture', 'architecture/commandes', 'identite', 'regles']);
  assert.match(tree.rootContent, /Contexte/);
  // Le `load_when` est écrit comme une condition : c'est la forme qu'on veut
  // voir imitée, et c'est de lui que dépend tout le routage.
  assert.match(tree.branches.get('architecture/commandes').loadWhen, /^quand /);

  // Un arbre existant n'est pas écrasé sans qu'on le demande.
  await assert.rejects(() => initTree(projectDir), /existe déjà/);
  await initTree(projectDir, { force: true });
  assert.equal((await loadTree(dir)).order.length, 4);
});

test('render : racine toujours là, Rules avant Context, non sélectionné exclu', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'RACINE');
  await writeBranch(dir, { path: 'r', type: 'rule', title: 'R', loadWhen: 'x', content: 'REGLE' });
  await writeBranch(dir, { path: 'd', type: 'reference', title: 'D', loadWhen: 'x', content: 'DOC' });
  await writeBranch(dir, { path: 'z', type: 'context', title: 'Z', loadWhen: 'x', content: 'EXCLU' });
  const tree = await loadTree(dir);
  const out = renderContext(tree, new Set(['r', 'd']));
  assert.ok(out.indexOf('RACINE') < out.indexOf('## Rules'));
  assert.ok(out.indexOf('## Rules') < out.indexOf('## Context'));
  assert.ok(!out.includes('EXCLU'));
});

test('render : le catalogue liste ce qui n\'a pas été chargé, sans son contenu', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'RACINE');
  await writeBranch(dir, { path: 'r', type: 'rule', title: 'R', loadWhen: 'x', content: 'REGLE' });
  await writeBranch(dir, {
    path: 'z',
    type: 'context',
    title: 'Z',
    loadWhen: 'quand on touche à Z',
    content: 'CONTENU DE Z',
  });
  const tree = await loadTree(dir);
  const out = renderContext(tree, new Set(['r']));

  // Une branche écartée reste visible en une ligne : titre, type, condition.
  // Sans ça, on ne peut pas tirer ce dont on ignore l'existence.
  assert.match(out, /\*\*Z\*\* \(context\) — charger quand : quand on touche à Z/);
  // Mais surtout pas son contenu : ce serait le gros fichier de consignes.
  assert.ok(!out.includes('CONTENU DE Z'));
  // Et l'invitation à tirer, sinon le catalogue n'est qu'une liste.
  assert.match(out, /get_context/);
  // Le catalogue passe en dernier : on le lit une fois qu'on sait ce qu'on a reçu.
  assert.ok(out.indexOf('## Context') < out.indexOf('## Catalogue') || !out.includes('## Context'));
  assert.ok(out.indexOf('## Rules') < out.indexOf('## Catalogue'));

  // Tout chargé : plus rien à annoncer, pas de section vide.
  const full = renderContext(tree, new Set(['r', 'z']));
  assert.ok(!full.includes('## Catalogue'));
});

test("render : le rappel d'écrire arrive avec la tâche, et à un seul endroit", async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, {
    path: 'a', type: 'context', title: 'A', loadWhen: 'quand a', content: 'contenu a',
  });
  const tree = await loadTree(dir);

  // Il est là même quand tout est chargé : il ne dépend pas du catalogue, qui
  // n'apparaît que s'il reste quelque chose à tirer.
  const tout = renderContext(tree, new Set(tree.order));
  assert.match(tout, /upsert_branch/);
  // Et il demande de dire quand on n'écrit pas : un silence ne se corrige pas.
  assert.match(tout, /rien à retenir/);
  // Rattaché à un moment précis — la fin de la réponse. Une consigne sans
  // moment est une consigne qu'on remet à plus tard (mesuré le 10 sept. 2026).
  assert.match(tout, /Avant de terminer ta réponse/);
  // En tout dernier : c'est une consigne pour la suite du tour, pas une
  // information sur ce qu'on vient de recevoir.
  assert.ok(tout.indexOf('upsert_branch') > tout.indexOf('contenu a'));

  // Une seule copie : le bloc AGENTS.md ne le redit pas. Trois surfaces qui
  // répètent la même consigne deviennent un bruit qu'on cesse de lire.
  assert.ok(!/rien à retenir/.test(renderAgentsBlock(tree)));

  // Un arbre vide n'injecte toujours rien — pas même le rappel.
  const vide = await scratch();
  await fs.mkdir(vide, { recursive: true });
  assert.equal(renderContext(await loadTree(vide), new Set()), '');
});

test('render : arbre vide → chaîne vide (rien à injecter)', async () => {
  const dir = await scratch();
  const tree = await loadTree(dir);
  assert.equal(renderContext(tree, new Set()), '');
});

test('pack : aller-retour jeton, hiérarchie préservée', async () => {
  const src = await scratch();
  await writeRoot(src, 'RACINE');
  await writeBranch(src, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: 'CA' });
  await writeBranch(src, { path: 'a/b', type: 'skill', title: 'B', loadWhen: 'y', content: 'CB' });

  const token = encodePack(extractPack(await loadTree(src), 'demo'));
  const dst = await scratch();
  await applyPack(dst, decodePack(`contextree:${token}`));

  const tree = await loadTree(dst);
  assert.equal(tree.rootContent, 'RACINE');
  assert.equal(tree.branches.get('a/b').parentPath, 'a');
  assert.equal(tree.branches.get('a/b').type, 'skill');
  assert.equal(tree.branches.get('a/b').content, 'CB');
});

test('pack : --prefix isole les branches importées sous un hub', async () => {
  const src = await scratch();
  await writeBranch(src, { path: 'r', type: 'rule', title: 'R', loadWhen: 'x', content: 'C' });
  const dst = await scratch();
  await applyPack(dst, extractPack(await loadTree(src)), { prefix: 'equipe', mergeRoot: true });
  const tree = await loadTree(dst);
  assert.equal(tree.branches.get('equipe/r').parentPath, 'equipe');
  assert.deepEqual([...withAncestors(tree, ['equipe/r'])].sort(), ['equipe', 'equipe/r']);
});

test('pack : un chemin qui remonte hors du dossier est refusé', async () => {
  const dst = await scratch();
  await assert.rejects(
    () => applyPack(dst, { v: 1, rootContent: '', branches: [{ path: '../evade', parent: null, type: 'rule', title: 'X', loadWhen: 'x', content: '' }] }),
    /refusé/,
  );
});

test('slugify : accents, ponctuation, cas vide', () => {
  assert.equal(slugify('Règles du Projet !'), 'regles-du-projet');
  assert.equal(slugify('!!!'), 'branche');
});

const turn = (over = {}) => ({
  at: Date.now(),
  prompt: 'un prompt',
  selected: ['identite'],
  reason: 'routed',
  source: 'hook',
  ...over,
});

test("session : une session neuve hérite de la dernière sélection routée", async () => {
  const dir = await scratch();
  // Sous un moteur CLI, le premier tour d'une session n'est jamais routé : sans
  // second niveau, chaque nouvelle conversation repartait de l'arbre entier
  // (12/12 mesuré) alors que le routeur avait déjà répondu la veille.
  await writeSelection(dir, 'session-a', ['identite', 'regles'], { at: 1000, routed: true });
  assert.deepEqual(await readSelection(dir, 'session-b'), ['identite', 'regles']);

  // La session qui a la sienne garde la sienne : le niveau arbre est un repli,
  // pas une autorité.
  await writeSelection(dir, 'session-b', ['architecture'], { at: 2000 });
  assert.deepEqual(await readSelection(dir, 'session-b'), ['architecture']);
  assert.deepEqual(await readSelection(dir, 'session-a'), ['identite', 'regles']);

  // Un repli n'alimente pas le niveau arbre : il y recopierait ce qui s'y
  // trouve déjà, ou y figerait l'arbre entier.
  await writeSelection(dir, 'session-c', ['tout', 'l', 'arbre'], { at: 3000 });
  assert.deepEqual(await readSelection(dir, 'session-neuve'), ['identite', 'regles']);
});

test("session : une sélection plus ancienne n'écrase pas une plus récente", async () => {
  const dir = await scratch();
  // Le routage de fond finit après le tour suivant : sans horodatage du prompt,
  // c'est le dernier à *finir* qui gagnait, pas le dernier *lancé*.
  await writeSelection(dir, 's', ['recente'], { at: 2000, routed: true });
  await writeSelection(dir, 's', ['ancienne'], { at: 1000, routed: true });
  assert.deepEqual(await readSelection(dir, 's'), ['recente']);
  assert.deepEqual(await readSelection(dir, 'autre'), ['recente']);

  // À `at` égal, la dernière écriture passe : deux tours du même prompt.
  await writeSelection(dir, 's', ['egalite'], { at: 2000 });
  assert.deepEqual(await readSelection(dir, 's'), ['egalite']);
});

test('session : un cache illisible vaut un cache vide, jamais une exception', async () => {
  // Un état à soi : les noms de fichiers sont des empreintes, et on veut
  // pouvoir désigner *celui de cette session* sans le deviner.
  const saved = process.env.CONTEXTREE_STATE_DIR;
  process.env.CONTEXTREE_STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-sel-'));
  try {
    const dir = await scratch();
    await writeSelection(dir, 's', ['identite'], { at: 1000, routed: true });
    const cache = path.join(process.env.CONTEXTREE_STATE_DIR, 'selection');
    const own = (await fs.readdir(cache)).find(f => !f.endsWith('-last.json'));

    // Un JSON tronqué (deux écritures concurrentes, avant le rename atomique)
    // ne doit pas faire échouer un prompt — il fait retomber d'un niveau.
    await fs.writeFile(path.join(cache, own), '{"selected": [', 'utf8');
    assert.deepEqual(await readSelection(dir, 's'), ['identite']);

    // Les deux niveaux perdus : vide, et l'appelant injectera tout l'arbre.
    for (const f of await fs.readdir(cache)) {
      await fs.writeFile(path.join(cache, f), 'pas du JSON', 'utf8');
    }
    assert.deepEqual(await readSelection(dir, 's'), []);

    // Et l'ancien format — un tableau nu — reste lu : une mise à jour ne doit
    // pas coûter un tour à l'arbre entier à chaque session ouverte.
    await fs.writeFile(path.join(cache, own), JSON.stringify(['ancien', 'format']), 'utf8');
    assert.deepEqual(await readSelection(dir, 's'), ['ancien', 'format']);
  } finally {
    process.env.CONTEXTREE_STATE_DIR = saved;
  }
});

test('routeur : la réponse est le dernier tableau d\'entiers, quel que soit le bruit devant', () => {
  // Les trois formes qu'on voit vraiment sortir d'un moteur.
  assert.deepEqual(parseIndices('[0,3]'), [0, 3]);
  assert.deepEqual(parseIndices('{"indices":[1]}'), [1]);
  assert.deepEqual(parseIndices('```json\n[2]\n```'), [2]);

  // Un CLI d'agent préfixe sa réponse : bannière, version, horodatage. La
  // réponse est à la fin, le bruit est devant.
  assert.deepEqual(parseIndices('Bannière v1.2\n2026-09-09T10:00\n[0, 4]'), [0, 4]);
  assert.deepEqual(parseIndices('je réfléchis…\n[1]\nvoilà\n[2, 3]'), [2, 3]);

  // Sélection vide et repli se ressemblent et n'ont rien à voir : `[]` est une
  // réponse (rien à charger), `null` dit « ce n'est pas une réponse de routeur ».
  assert.deepEqual(parseIndices('[]'), []);
  assert.equal(parseIndices('["a","b"]'), null);
  assert.equal(parseIndices('aucune branche pertinente'), null);
  assert.equal(parseIndices(''), null);

  // Limite connue et assumée : un tableau cité gagne s'il est le dernier. Le
  // cas reste théorique — le catalogue n'est jamais recopié dans la réponse.
  assert.deepEqual(parseIndices('voir [1] et [2] plus haut'), [2]);
});

test("éval : le score compte les ancêtres du bon côté, et dit ce qui manque", async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'architecture', title: 'Architecture', type: 'context', loadWhen: 'q', content: 'a' });
  await writeBranch(dir, { path: 'architecture/routage', title: 'Routage', type: 'reference', loadWhen: 'q', content: 'r' });
  await writeBranch(dir, { path: 'regles', title: 'Règles', type: 'rule', loadWhen: 'q', content: 'g' });
  const tree = await loadTree(dir);

  // Un moteur factice : la mesure de la comparaison n'a pas à dépendre d'un
  // modèle, sinon elle ne serait pas dans `npm test`.
  const answers = {
    'un': { selected: new Set(['architecture', 'architecture/routage']), reason: 'routed' },
    'deux': { selected: new Set(['regles']), reason: 'routed' },
  };
  const report = await evaluateRouting(
    tree,
    [
      // `expect` ne cite que la branche qui compte : son parent est chargé
      // d'office, le compter « en trop » ferait mentir le score.
      { prompt: 'un', expect: ['architecture/routage'] },
      { prompt: 'deux', expect: ['architecture/routage', 'branche-disparue'] },
    ],
    async p => answers[p],
  );

  assert.deepEqual(report.cases[0].extra, []);
  assert.deepEqual(report.cases[0].missing, []);
  assert.equal(report.cases[0].hit.length, 2);

  // Le second cas rate tout : 1 chargé pour rien, 2 attendus manquants.
  assert.deepEqual(report.cases[1].extra, ['regles']);
  assert.deepEqual(report.cases[1].missing.sort(), ['architecture', 'architecture/routage']);
  // Un `expect` qui ne correspond à aucune branche : le jeu d'éval a vieilli,
  // on le dit au lieu de le compter comme un échec du routeur.
  assert.deepEqual(report.cases[1].unknown, ['branche-disparue']);

  // Micro-moyenne : 2 justes sur 3 chargés, 2 sur 4 attendus.
  assert.equal(report.precision, 2 / 3);
  assert.equal(report.recall, 2 / 4);
});

test("éval : un moteur qui échoue est un cas raté, pas une mesure interrompue", async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'regles', title: 'Règles', type: 'rule', loadWhen: 'q', content: 'g' });
  const tree = await loadTree(dir);

  const report = await evaluateRouting(tree, [{ prompt: 'x', expect: ['regles'] }], async () => {
    throw new Error('CLI introuvable');
  });
  assert.equal(report.cases[0].error, 'CLI introuvable');
  assert.deepEqual(report.cases[0].missing, ['regles']);
  assert.equal(report.recall, 0);
});

test("éval : un cas mal écrit se saute, il n'emporte pas le fichier", () => {
  const cases = parseEvalCases([
    { prompt: 'bon', expect: ['regles'] },
    { prompt: '   ', expect: ['regles'] },
    { expect: ['regles'] },
    { prompt: 'sans expect' },
    { prompt: 'expect sale', expect: ['regles', 42, null] },
    'pas un objet',
  ]);
  assert.deepEqual(cases.map(c => c.prompt), ['bon', 'sans expect', 'expect sale']);
  assert.deepEqual(cases[2].expect, ['regles']);
  assert.deepEqual(parseEvalCases({ pas: 'un tableau' }), []);
});

test("journal : la racine se trace comme une branche, sous `:root`", async () => {
  const dir = await scratch();
  await writeRoot(dir, '# Projet\n\nCe que fait ce repo.');

  // `write_root` écrit la racine et la trace sous le chemin que les vues
  // emploient déjà. Sans ça, la seule écriture que l'IA fait sur un arbre neuf
  // serait la seule qu'aucune vue ne montre.
  await appendAiWrite(dir, {
    at: Date.now(),
    op: 'upsert',
    path: ':root',
    title: 'Racine',
    why: "poser qui, quoi, dans quel repo",
  });

  const writes = await readAiWrites(dir);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, ':root');
  assert.equal(writes[0].title, 'Racine');
  assert.match(writes[0].why, /poser qui/);

  // Et la racine est bien sur le disque, relisible par loadTree.
  const tree = await loadTree(dir);
  assert.match(tree.rootContent, /Ce que fait ce repo\./);
  // `:root` n'est pas une branche : il ne doit pas apparaître dans l'ordre.
  assert.ok(!tree.order.includes(':root'));
});

test("bootstrap : on détecte ce qui existe, du plus intentionnel au plus général", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-boot-'));
  assert.deepEqual(await detectInstructionFiles(dir), []);

  await fs.writeFile(path.join(dir, 'README.md'), '# projet', 'utf8');
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# consignes', 'utf8');
  await fs.mkdir(path.join(dir, '.cursor', 'rules'), { recursive: true });

  // L'ordre compte : un fichier écrit *pour une IA* passe avant un README.
  assert.deepEqual(await detectInstructionFiles(dir), ['CLAUDE.md', '.cursor/rules', 'README.md']);
});

test("bootstrap : la consigne borne l'arbre et interdit de toucher aux sources", () => {
  const prompt = renderBootstrapPrompt(['CLAUDE.md', 'README.md']);

  // Elle cite les fichiers trouvés : sans ça, l'IA cherche au hasard.
  assert.match(prompt, /`CLAUDE\.md`/);
  assert.match(prompt, /`README\.md`/);
  // Les trois garde-fous qui font la différence entre un arbre et un dépotoir.
  assert.match(prompt, /6 à 12 branches/);
  assert.match(prompt, /Ne modifie ni ne supprime aucun fichier source/);
  assert.match(prompt, /write_root/);
  // Le `load_when` doit être montré comme une condition, avec un contre-exemple.
  assert.match(prompt, /load_when/);
  assert.match(prompt, /toujours pertinent/);
  // Et elle ne finit pas sur « c'est fait » : elle renvoie à la relecture.
  assert.match(prompt, /toile/);
  // Deux défauts constatés en la lançant sur un vrai projet, le 9 septembre 2026 :
  // le tronc de départ survivait à côté des branches écrites, et l'identité
  // recevait « toujours » malgré le contre-exemple.
  assert.match(prompt, /branches de départ génériques/);
  assert.match(prompt, /identité/);

  // Sans fichier trouvé, elle fait quand même lire le dépôt.
  const nu = renderBootstrapPrompt([]);
  assert.match(nu, /n'a pas de fichier de consignes/);
  assert.match(nu, /6 à 12 branches/);
});

test("bootstrap : sans arbre, l'invitation propose et n'autorise pas à créer", () => {
  const invite = renderBootstrapInvite(['CLAUDE.md', 'README.md']);

  // Elle dit ce qui manque, et avec quoi partir.
  assert.match(invite, /`\.contextree\/`/);
  assert.match(invite, /`CLAUDE\.md`/);
  assert.match(invite, /`README\.md`/);
  // Rattachée à un moment précis. « Au bon moment, sans insister » se lisait
  // comme une permission de se taire : deux passages sur six sans un mot,
  // l'invitation pourtant injectée (mesuré le 11 septembre 2026).
  assert.match(invite, /Avant de terminer ta réponse/);
  assert.ok(!/au bon moment/.test(invite));
  // Le garde-fou qui, lui, n'a jamais raté : proposer, jamais créer.
  assert.match(invite, /Ne crée rien tant qu'il n'a pas dit oui/);
  // Et elle renvoie à la consigne longue plutôt que de la recopier : cette
  // invitation arrive sans qu'on l'ait demandée, elle doit rester courte.
  assert.match(invite, /`bootstrap_prompt`/);
  // Elle nomme un **outil**, pas une commande à taper : `npx` renvoyait à un
  // paquet non publié, et demandait un terminal — le geste qu'on supprime.
  assert.ok(!/npx/.test(invite));
  assert.ok(!/6 à 12 branches/.test(invite));
  assert.ok(invite.length < renderBootstrapPrompt(['CLAUDE.md']).length);

  // Sans fichier trouvé, il reste le dépôt.
  assert.match(renderBootstrapInvite([]), /le dépôt lui-même/);
});

test("bootstrap : l'invitation se pose une fois par session et par dossier", async () => {
  const previous = process.env.CONTEXTREE_STATE_DIR;
  process.env.CONTEXTREE_STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-invite-'));
  try {
    const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-projet-'));
    const autre = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-projet-'));

    // Première fois : oui. Ensuite : non, tant qu'on est dans la même session.
    assert.equal(await claimBootstrapInvite(projet, 's1'), true);
    assert.equal(await claimBootstrapInvite(projet, 's1'), false);
    assert.equal(await claimBootstrapInvite(projet, 's1'), false);

    // Une autre session, ou un autre dossier : l'invitation revient.
    assert.equal(await claimBootstrapInvite(projet, 's2'), true);
    assert.equal(await claimBootstrapInvite(autre, 's1'), true);

    // Un identifiant de session vient d'un payload JSON : il ne choisit pas où
    // on écrit.
    assert.equal(await claimBootstrapInvite(projet, '../../evade'), true);
    const poses = await fs.readdir(path.join(process.env.CONTEXTREE_STATE_DIR, 'session'));
    assert.equal(poses.length, 4);
    assert.ok(poses.every(f => !f.includes('/') && !f.includes('..')));
  } finally {
    process.env.CONTEXTREE_STATE_DIR = previous;
  }
});

/** Le hook tel qu'un agent le lance : un payload JSON sur stdin, le contexte sur
 *  stdout. Le seul test qui passe par le vrai binaire — c'est le contrat que
 *  Claude Code exécute, et il ne se vérifie pas en appelant les fonctions. */
function runHook(payload, env = {}, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', 'hook', ...args], {
      env: { ...process.env, ...env },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(JSON.stringify(payload));
  });
}

/** La CLI lancée pour de vrai : ce qu'un humain lit, stdout et stderr confondus. */
function runCli(args, { cwd, env = {}, stdin = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('dist/cli.js'), ...args], {
      cwd, env: { ...process.env, ...env },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(stdin);
  });
}

/** Des mots qui trahissent l'autre langue. Des mots, pas des lettres : un chemin
 *  ou un nom propre n'a pas à faire échouer le test. */
const FRENCH = /[éèàùêçœ]|\b(branche|arbre|charger quand|câblé|aucun|introuvable|inconnue?|trouvé|Routage|Lance|consignes?)\b/i;
const ENGLISH = /\b(branch(es)?|tree|load when|wired|not found|unknown|Routing|Run:|written)\b/i;

test("i18n : les deux dictionnaires ont exactement les mêmes clés", () => {
  for (const dicts of [CORE_MESSAGES, CLI_MESSAGES, SERVER_MESSAGES]) {
    assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.fr).sort());
    for (const key of Object.keys(dicts.fr)) {
      assert.equal(typeof dicts.en[key], typeof dicts.fr[key], key);
    }
  }
});

test("i18n : la CLI parle anglais ou français, jamais un mélange — aide, install, list, erreur", async () => {
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-cli-lang-'));
  const dir = path.join(projet, '.contextree');
  await writeRoot(dir, 'root');
  for (const p of ['alpha', 'beta']) {
    await writeBranch(dir, { path: p, type: 'context', title: p, loadWhen: p, content: p });
  }
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-cli-state-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-cli-home-'));
  const commands = [['--help'], ['install', '--status'], ['list'], ['route', 'alpha'], ['rm', 'nope'], ['frobnicate']];

  for (const [lang, other] of [['en', FRENCH], ['fr', ENGLISH]]) {
    const env = { CONTEXTREE_LANG: lang, CONTEXTREE_STATE_DIR: stateDir, CONTEXTREE_ROUTER: 'off', HOME: home };
    for (const args of commands) {
      const { out } = await runCli(args, { cwd: projet, env });
      // L'aide cite la variable et le drapeau de langue, et `fr|en` : on les retire.
      const seen = out.replace(/contextree/g, '').replace(/--lang fr\|en/g, '');
      assert.ok(!other.test(seen), `${lang} · ${args.join(' ')} :\n${out.match(other)?.[0]}\n${out}`);
    }
  }

  // `--lang` sur la ligne de commande vaut CONTEXTREE_LANG.
  const env = { CONTEXTREE_STATE_DIR: stateDir, HOME: home };
  delete process.env.CONTEXTREE_LANG;
  try {
    assert.match((await runCli(['list', '--lang', 'en'], { cwd: projet, env })).out, /branch\(es\)/);
  } finally {
    process.env.CONTEXTREE_LANG = 'fr';
  }
});

test("i18n : en anglais, ce que lit le modèle est en anglais — hook, get_context, instructions, outils — et les branches restent telles quelles", async () => {
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-model-en-'));
  const dir = path.join(projet, '.contextree');
  await writeRoot(dir, 'root of the project');
  // Du contenu français dans un arbre, sous un outil en anglais : rendu tel quel.
  for (const p of ['alpha', 'beta', 'gamma', 'delta']) {
    await writeBranch(dir, { path: p, type: p === 'alpha' ? 'rule' : 'context', title: p, loadWhen: `when ${p}`, content: `contenu éphémère ${p}` });
  }
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-model-state-'));
  const env = { ...process.env, CONTEXTREE_LANG: 'en', CONTEXTREE_ROUTER: 'off', CONTEXTREE_STATE_DIR: stateDir, CONTEXTREE_MCP_FALLBACK: 'full' };
  const strip = text => text.replace(/contenu éphémère \w+/g, '').replace(/contextree/g, '');

  // Le hook.
  const hook = await runHook({ prompt: 'alpha', cwd: projet, session_id: 'en' }, env);
  assert.match(hook.out, /## Rules/);
  assert.match(hook.out, /contenu éphémère alpha/, 'le contenu des branches est rendu tel quel');
  assert.ok(!FRENCH.test(strip(hook.out)), strip(hook.out).match(FRENCH)?.[0]);
  assert.match(hook.out, /\*\*Before you finish your answer\*\*/);

  // Le vrai serveur stdio : instructions, descriptions, get_context, et le catalogue seul.
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.resolve('dist/cli.js'), 'mcp'], cwd: projet, env, stderr: 'ignore',
  }));
  try {
    const instructions = client.getInstructions() ?? '';
    assert.match(instructions, /Before working on a non-trivial task/);
    const tools = JSON.stringify((await client.listTools()).tools);
    const got = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'alpha' } }));
    for (const [label, text] of [['instructions', instructions], ['tools', tools], ['get_context', got]]) {
      assert.ok(!FRENCH.test(strip(text)), `${label}: ${strip(text).match(FRENCH)?.[0]}`);
    }
  } finally {
    await client.close();
  }

  // Le catalogue seul et l'invitation gardent leur moment en anglais.
  process.env.CONTEXTREE_LANG = 'en';
  try {
    const tree = await loadTree(dir);
    assert.match(renderCatalogueOnly(tree, 'no engine'), /\*\*Before answering\*\*/);
    const invite = renderBootstrapInvite(['CLAUDE.md']);
    assert.match(invite, /\*\*Before you finish your answer\*\*/);
    assert.match(invite, /Do not create anything until they have said yes/);
    assert.ok(!FRENCH.test(strip(invite)));
    const prompt = renderBootstrapPrompt(['CLAUDE.md']);
    assert.match(prompt, /in the user's language/);
    assert.ok(!FRENCH.test(strip(prompt)), strip(prompt).match(FRENCH)?.[0]);
  } finally {
    process.env.CONTEXTREE_LANG = 'fr';
  }
  // Et en français, la consigne demande la langue de l'utilisateur aussi.
  assert.match(renderBootstrapPrompt([]), /dans la langue de l'utilisateur/);
});

test("i18n : init pose un arbre de départ dans la langue de l'utilisateur", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-init-state-'));
  for (const [lang, root, first] of [['en', /^# Context —/, 'identity.md'], ['fr', /^# Contexte —/, 'identite.md']]) {
    const projet = await fs.mkdtemp(path.join(os.tmpdir(), `contextree-init-${lang}-`));
    const { code, out } = await runCli(['init'], { cwd: projet, env: { CONTEXTREE_LANG: lang, CONTEXTREE_STATE_DIR: stateDir } });
    assert.equal(code, 0, out);
    assert.match(await fs.readFile(path.join(projet, '.contextree', 'root.md'), 'utf8'), root);
    const files = await fs.readdir(path.join(projet, '.contextree'));
    assert.ok(files.includes(first), files.join(', '));
    if (lang === 'en') {
      const tree = await loadTree(path.join(projet, '.contextree'));
      const text = allBranches(tree).map(b => `${b.title} ${b.loadWhen} ${b.content}`).join('\n') + tree.rootContent + out;
      assert.ok(!FRENCH.test(text.replace(/contextree/g, '')), text.match(FRENCH)?.[0]);
    }
  }
});

test('hook : trois dialectes, une seule enveloppe qui change', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-dial-state-'));
  const dir = await scratch();
  await writeRoot(dir, 'la racine');
  for (const p of ['a', 'b', 'c', 'd']) {
    await writeBranch(dir, {
      path: p, type: 'context', title: p.toUpperCase(),
      loadWhen: `quand ${p}`, content: `contenu ${p}`,
    });
  }
  const projet = path.dirname(dir);
  // Le payload est le **même** pour Claude Code et Gemini : prompt, cwd,
  // session_id. Seule la sortie diffère — c'est tout l'intérêt d'une table.
  const payload = { prompt: 'une demande', cwd: projet, session_id: 'd1' };
  const env = { CONTEXTREE_STATE_DIR: stateDir, CONTEXTREE_ROUTER: 'off' };

  // Claude Code, et Codex : le bloc brut.
  for (const agent of ['claude', 'codex']) {
    const r = await runHook(payload, env, agent === 'claude' ? [] : ['--agent', agent]);
    assert.equal(r.code, 0);
    assert.match(r.out, /^<contextree>/);
  }

  // Gemini : du JSON, et **rien d'autre** sur stdout.
  const gem = await runHook(payload, env, ['--agent', 'gemini']);
  assert.equal(gem.code, 0);
  const parsed = JSON.parse(gem.out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'BeforeAgent');
  assert.match(parsed.hookSpecificOutput.additionalContext, /^<contextree>/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /la racine/);

  // Un drapeau mal tapé retombe sur le texte : le hook ne bloque jamais un
  // prompt, pas même pour ça.
  const inconnu = await runHook(payload, env, ['--agent', 'nimportequoi']);
  assert.equal(inconnu.code, 0);
  assert.match(inconnu.out, /^<contextree>/);
});

test('hook : un payload cassé sort en 0 et neutre, dans les trois dialectes', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-dial-err-'));
  const env = { CONTEXTREE_STATE_DIR: stateDir };
  // Sous Gemini, un code 2 **bloque le tour et efface le prompt** : l'invariant
  // du code 0 n'y est plus une politesse, il sépare un contexte manquant d'un
  // prompt perdu.
  for (const args of [[], ['--agent', 'gemini'], ['--agent', 'codex']]) {
    const r = await runHook('pas du json', env, args);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
  }
});

test("hook : sans arbre, l'invitation sort une fois par session — et jamais un code non nul", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-hook-state-'));
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-hook-'));
  const env = { CONTEXTREE_STATE_DIR: stateDir };
  const payload = { prompt: 'bonjour, on fait quoi ?', cwd: projet, session_id: 'abc' };

  const premier = await runHook(payload, env);
  assert.equal(premier.code, 0);
  assert.match(premier.out, /arbre de contexte contextree/);

  // Deuxième prompt de la même session : plus rien. L'invitation vaut pour la
  // session, pas pour le tour.
  const second = await runHook(payload, env);
  assert.equal(second.code, 0);
  assert.equal(second.out, '');

  // Nouvelle session : elle revient.
  const autreSession = await runHook({ ...payload, session_id: 'def' }, env);
  assert.equal(autreSession.code, 0);
  assert.match(autreSession.out, /arbre de contexte contextree/);

  // L'invariant qui prime sur tout le reste : un payload cassé ne bloque pas le
  // prompt, et n'injecte rien.
  const casse = await runHook('pas du json', env);
  assert.equal(casse.code, 0);
  assert.equal(casse.out, '');
});

/** Un vrai client MCP branché sur le serveur, en mémoire. On passe par le
 *  protocole et pas par les internes du SDK : c'est ce que voit l'agent, et
 *  c'est ce qui doit rester vrai d'une version du SDK à l'autre. */
async function mcpClient(cwd, { sampling } = {}) {
  const server = await createServer(cwd);
  const client = new Client({ name: 'test', version: '0' }, sampling ? { capabilities: { sampling: {} } } : {});
  if (sampling) client.setRequestHandler(CreateMessageRequestSchema, sampling);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const textOf = res => res.content.map(c => c.text ?? '').join('\n');

test("mcp : write_root crée l'arbre s'il n'existe pas — l'IA n'a pas besoin d'un terminal", async () => {
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-wr-'));
  const client = await mcpClient(projet);

  const res = await client.callTool({
    name: 'write_root',
    arguments: { content: '# Projet\n\nCe que fait ce dépôt.', why: 'poser la racine' },
  });
  assert.equal(res.isError, undefined);
  // Le dossier ET la racine, sans qu'aucune commande n'ait été tapée.
  assert.equal(await fs.readFile(path.join(projet, '.contextree', 'root.md'), 'utf8'),
    '# Projet\n\nCe que fait ce dépôt.\n');
  // L'utilisateur doit apprendre qu'un dossier vient d'apparaître dans son projet.
  assert.match(textOf(res), /Arbre créé/);

  // Deuxième écriture : l'arbre existe déjà, on ne l'annonce plus.
  const encore = await client.callTool({
    name: 'write_root',
    arguments: { content: '# Projet\n\nCorrigé.', why: 'préciser' },
  });
  assert.ok(!/Arbre créé/.test(textOf(encore)));
});

test("mcp : la consigne bootstrap est un outil, atteignable sans terminal ni slash-command", async () => {
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-bp-'));
  await fs.writeFile(path.join(projet, 'CLAUDE.md'), '# consignes', 'utf8');
  const client = await mcpClient(projet);

  // Le modèle voit l'outil dans sa liste : un prompt MCP, lui, ne lui est
  // jamais exposé.
  const outils = (await client.listTools()).tools.map(t => t.name);
  assert.ok(outils.includes('bootstrap_prompt'));

  const res = await client.callTool({ name: 'bootstrap_prompt', arguments: {} });
  // Exactement le texte du prompt MCP et de `contextree bootstrap` : une seule
  // copie, quatre surfaces.
  assert.equal(textOf(res), renderBootstrapPrompt(['CLAUDE.md']));

  // Le prompt reste, pour l'utilisateur qui le lance à la main.
  const prompts = (await client.listPrompts()).prompts.map(p => p.name);
  assert.ok(prompts.includes('bootstrap'));
});

test("mcp : sous moteur CLI, get_context diffère au lieu de faire attendre le client", async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  for (const p of ['a', 'b', 'c', 'd']) {
    await writeBranch(dir, {
      path: p, type: 'context', title: p.toUpperCase(),
      loadWhen: `quand ${p}`, content: `contenu ${p}`,
    });
  }
  const projet = path.dirname(dir);

  // Une session précédente a routé sur cet arbre : c'est ce dont une session
  // MCP neuve doit hériter, plutôt que de faire attendre le client.
  await writeSelection(dir, 'session-precedente', ['b'], { routed: true });

  const saved = process.env.CONTEXTREE_ROUTER;
  const savedBin = process.env.CONTEXTREE_CLAUDE_BIN;
  process.env.CONTEXTREE_ROUTER = 'claude';
  // Le routage de fond part pour de vrai : sans ça, chaque `npm test` lancerait
  // un `claude -p` sur l'abonnement de celui qui teste.
  process.env.CONTEXTREE_CLAUDE_BIN = path.join(projet, 'pas-de-claude');
  try {
    const client = await mcpClient(projet);
    const t0 = Date.now();
    const res = await client.callTool({
      name: 'get_context', arguments: { query: 'une demande quelconque' },
    });
    const txt = textOf(res);

    // Rendu tout de suite : c'est tout l'intérêt. Un routage CLI met entre 5 et
    // 60 s, et le client abandonne à 60 — on ne se met pas sur ce chemin.
    assert.ok(Date.now() - t0 < 2000);
    // Et il le dit : jamais de boîte noire.
    assert.match(txt, /différé/);
    // La sélection héritée, pas l'arbre entier.
    assert.match(txt, /contenu b/);
    assert.ok(!/contenu a/.test(txt));
  } finally {
    if (saved === undefined) delete process.env.CONTEXTREE_ROUTER;
    else process.env.CONTEXTREE_ROUTER = saved;
    if (savedBin === undefined) delete process.env.CONTEXTREE_CLAUDE_BIN;
    else process.env.CONTEXTREE_CLAUDE_BIN = savedBin;
  }
});

/** Un arbre de cinq branches — au-dessus du seuil où le routeur court-circuite —
 *  et un environnement sans clé ni routage forcé, restauré après coup. */
async function samplingSetup(env = {}) {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  for (const p of ['a', 'b', 'c', 'd', 'e']) {
    await writeBranch(dir, {
      path: p, type: 'context', title: p.toUpperCase(),
      loadWhen: `quand ${p}`, content: `contenu ${p}`,
    });
  }
  const keys = ['CONTEXTREE_ROUTER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY',
    'CONTEXTREE_ROUTER_BLOCKING', 'CONTEXTREE_ROUTER_TIMEOUT_MS'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const restore = () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return { dir, projet: path.dirname(dir), restore };
}

const reply = text => ({ model: 'test', role: 'assistant', content: { type: 'text', text } });

test("mcp : un client qui propose le sampling trie l'arbre avec son propre modèle — sans clé ni CLI", async () => {
  const { dir, projet, restore } = await samplingSetup();
  try {
    const demandes = [];
    const client = await mcpClient(projet, {
      sampling: async req => {
        demandes.push(req.params);
        return reply('[1,3]');
      },
    });
    const res = await client.callTool({ name: 'get_context', arguments: { query: 'toucher à b et d' } });
    const txt = textOf(res);

    // Les branches choisies par le modèle du client, et elles seules.
    assert.match(txt, /contenu b/);
    assert.match(txt, /contenu d/);
    assert.ok(!/contenu a/.test(txt) && !/contenu c/.test(txt));
    // Synchrone, pas différé : le client répond comme une API.
    assert.match(txt, /routé/);

    // La demande est celle d'un routeur : le prompt de routage, peu de tokens,
    // un modèle rapide demandé.
    assert.equal(demandes.length, 1);
    assert.match(demandes[0].systemPrompt, /routeur de contexte/);
    assert.ok(demandes[0].maxTokens <= 512);
    assert.ok(demandes[0].modelPreferences.speedPriority >= 0.8);

    const [tour] = (await readJournal(dir)).slice(-1);
    assert.equal(tour.reason, 'routed');
    assert.equal(tour.engine, 'sampling');
    assert.equal(tour.source, 'mcp');
  } finally {
    restore();
  }
});

test("mcp : sans capacité sampling, rien ne change — le serveur ne le demande jamais", async () => {
  // Bloquant et budget minuscule : sur une machine qui a un CLI, on ne lance ni
  // routage de fond ni attente de 45 s — seul compte ce qui n'est pas demandé.
  const { dir, projet, restore } = await samplingSetup({
    CONTEXTREE_ROUTER_BLOCKING: '1', CONTEXTREE_ROUTER_TIMEOUT_MS: '1',
  });
  try {
    const client = await mcpClient(projet);
    await client.callTool({ name: 'get_context', arguments: { query: 'toucher à b' } });
    const [tour] = (await readJournal(dir)).slice(-1);
    assert.notEqual(tour.engine, 'sampling');
    assert.notEqual(tour.reason, 'routed');
  } finally {
    restore();
  }
});

test("mcp : un client qui refuse le sampling — repli lisible, et une seule demande par session", async () => {
  const { dir, projet, restore } = await samplingSetup({
    CONTEXTREE_ROUTER_BLOCKING: '1', CONTEXTREE_ROUTER_TIMEOUT_MS: '200',
  });
  try {
    let demandes = 0;
    const client = await mcpClient(projet, {
      sampling: async () => {
        demandes++;
        throw new Error("l'utilisateur a refusé");
      },
    });

    const premier = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'b' } }));
    // Jamais vide : le repli rend la racine et le catalogue, et il dit pourquoi.
    assert.match(premier, /racine/);
    assert.match(premier, /`b`/);
    assert.match(premier, /sampling refusé/);
    const [tour] = (await readJournal(dir)).slice(-1);
    assert.equal(tour.reason, 'catalogue');
    assert.equal(tour.engine, 'sampling');
    assert.match(tour.error, /refusé/);

    // Deuxième appel de la même session : on ne rouvre pas l'invite.
    await client.callTool({ name: 'get_context', arguments: { query: 'd' } });
    assert.equal(demandes, 1);
    const [second] = (await readJournal(dir)).slice(-1);
    assert.notEqual(second.engine, 'sampling');
  } finally {
    restore();
  }
});

test("render : le catalogue seul donne la racine, les chemins et la consigne — aucun corps de branche", async () => {
  const { dir, restore } = await samplingSetup();
  restore();
  const tree = await loadTree(dir);
  const bloc = renderCatalogueOnly(tree, 'aucun moteur');
  assert.match(bloc, /racine/);
  // Le chemin exact, pour `read_branch`, et la condition que lirait le routeur.
  assert.match(bloc, /\*\*B\*\* \(context\) `b` — charger quand : quand b/);
  // Une consigne avec un moment, qui nomme l'outil.
  assert.match(bloc, /Avant de répondre/);
  assert.match(bloc, /read_branch/);
  assert.match(bloc, /aucun moteur/);
  assert.ok(!/contenu [a-e]/.test(bloc));
});

test("mcp : sans moteur, get_context sur le vrai serveur stdio rend le catalogue — jamais l'arbre entier", async () => {
  const { dir, projet, restore } = await samplingSetup();
  restore();
  const env = { ...process.env, CONTEXTREE_ROUTER: 'off' };
  delete env.CONTEXTREE_MCP_FALLBACK;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/cli.js'), 'mcp'],
    cwd: projet,
    env,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    const txt = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'toucher à b' } }));
    assert.ok(!/contenu [a-e]/.test(txt), 'aucun corps de branche');
    assert.match(txt, /racine/);
    assert.match(txt, /`b`/);
    assert.match(txt, /catalogue seul/);
    assert.match(txt, /aucun moteur/);

    // Et l'agent peut suivre la consigne : le chemin du catalogue se lit tel quel.
    const lu = textOf(await client.callTool({ name: 'read_branch', arguments: { path: 'b' } }));
    assert.match(lu, /contenu b/);

    const [tour] = (await readJournal(dir)).slice(-1);
    assert.equal(tour.reason, 'catalogue');
    assert.deepEqual(tour.selected, []);
    assert.equal(turnLabelKey(tour), 'catalogue');
  } finally {
    await client.close();
  }
});

test("mcp : à froid sous moteur CLI, le catalogue au premier appel — la sélection routée ensuite", async () => {
  const { dir, projet, restore } = await samplingSetup({ CONTEXTREE_ROUTER: 'claude' });
  const savedBin = process.env.CONTEXTREE_CLAUDE_BIN;
  process.env.CONTEXTREE_CLAUDE_BIN = path.join(projet, 'pas-de-claude');
  try {
    const client = await mcpClient(projet);
    const premier = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'b' } }));
    assert.ok(!/contenu [a-e]/.test(premier));
    assert.match(premier, /à froid/);

    // Le routage de fond a rendu son verdict entre-temps.
    await writeSelection(dir, 'fond', ['b'], { routed: true });
    const second = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'b' } }));
    assert.match(second, /contenu b/);
    assert.ok(!/contenu a/.test(second));
  } finally {
    restore();
    if (savedBin === undefined) delete process.env.CONTEXTREE_CLAUDE_BIN;
    else process.env.CONTEXTREE_CLAUDE_BIN = savedBin;
  }
});

test("mcp : CONTEXTREE_MCP_FALLBACK=full rend l'ancien repli, l'arbre entier", async () => {
  const { projet, restore } = await samplingSetup({ CONTEXTREE_ROUTER: 'off' });
  process.env.CONTEXTREE_MCP_FALLBACK = 'full';
  try {
    const client = await mcpClient(projet);
    const txt = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'b' } }));
    for (const p of ['a', 'b', 'c', 'd', 'e']) assert.match(txt, new RegExp(`contenu ${p}`));
  } finally {
    delete process.env.CONTEXTREE_MCP_FALLBACK;
    restore();
  }
});

test("mcp : lancé hors du projet, le serveur trouve l'arbre par les roots du client", async () => {
  const { projet, restore } = await samplingSetup({ CONTEXTREE_ROUTER: 'off', CONTEXTREE_MCP_FALLBACK: 'full' });
  try {
    const ailleurs = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-ailleurs-'));
    const server = await createServer(ailleurs);
    const client = new Client({ name: 'test', version: '0' }, { capabilities: { roots: {} } });
    let demandes = 0;
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      demandes++;
      return { roots: [{ uri: pathToFileURL(projet).href, name: 'projet' }] };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const txt = textOf(await client.callTool({ name: 'get_context', arguments: { query: 'b' } }));
    assert.match(txt, /contenu b/);
    await client.callTool({ name: 'list_branches', arguments: {} });
    // Demandé une fois par session, pas à chaque outil.
    assert.equal(demandes, 1);
  } finally {
    delete process.env.CONTEXTREE_MCP_FALLBACK;
    restore();
  }
});

test("mcp : upsert_branch sans arbre refuse, et nomme write_root", async () => {
  const projet = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-ub-'));
  const client = await mcpClient(projet);

  const res = await client.callTool({
    name: 'upsert_branch',
    arguments: {
      title: 'Une branche', type: 'context', load_when: 'quand on teste',
      content: 'du contenu', why: 'pour le test',
    },
  });

  // Écrire une branche avant la racine est l'ordre inverse de la consigne :
  // l'outil refuse, mais il dit par où commencer.
  assert.equal(res.isError, true);
  assert.match(textOf(res), /write_root/);
  await assert.rejects(fs.stat(path.join(projet, '.contextree')));
});

test('journal : les tours s\'empilent, du plus ancien au plus récent', async () => {
  const dir = await scratch();
  assert.deepEqual(await readJournal(dir), []);
  await appendTurn(dir, turn({ prompt: 'premier' }));
  await appendTurn(dir, turn({ prompt: 'second', reason: 'fallback', source: 'mcp', error: 'timeout' }));
  const turns = await readJournal(dir);
  assert.deepEqual(turns.map(t => t.prompt), ['premier', 'second']);
  assert.equal(turns[1].reason, 'fallback');
  assert.equal(turns[1].source, 'mcp');
  assert.equal(turns[1].error, 'timeout');
});

test("journal : le routage de fond est un tour à part, et il se lit comme tel", async () => {
  const dir = await scratch();
  // Sous un moteur CLI, un prompt produit deux entrées : le `deferred` du hook,
  // puis le verdict du routage de fond. On ne les fusionne pas — c'est ce qui
  // s'est passé, et sans la seconde la vue affichait « différé » à vie.
  const at = Date.now();
  await appendTurn(dir, turn({ at, prompt: 'un prompt', reason: 'deferred', selected: ['a', 'b'] }));
  await appendTurn(dir, turn({ at, prompt: 'un prompt', source: 'bg', selected: ['a'] }));
  const turns = await readJournal(dir);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].source, 'bg');
  // Le même `at` : les deux entrées d'un prompt se lisent ensemble.
  assert.equal(turns[0].at, turns[1].at);

  // Une source inconnue reste écartée : le journal ne gagne pas un champ libre.
  await fs.writeFile(journalFile(dir), JSON.stringify([turn({ source: 'ailleurs' })]), 'utf8');
  assert.deepEqual(await readJournal(dir), []);
});

test("journal : un routage de fond ne se dit pas « routé » tout court", () => {
  // La barre latérale et la toile lisent la même clé : un tour du fond a bien
  // routé, mais ses branches partiront au prochain prompt, pas à celui-ci.
  assert.equal(turnLabelKey({ reason: 'routed', source: 'bg' }), 'routed-bg');
  assert.equal(turnLabelKey({ reason: 'routed', source: 'hook' }), 'routed');
  assert.equal(turnLabelKey({ reason: 'routed', source: 'mcp' }), 'routed');
  // Un repli venu du fond reste un repli : la source ne renomme que `routed`.
  assert.equal(turnLabelKey({ reason: 'fallback', source: 'bg' }), 'fallback');
});

test('journal : borné aux 50 derniers tours', async () => {
  const dir = await scratch();
  for (let i = 0; i < 55; i++) await appendTurn(dir, turn({ prompt: `tour ${i}` }));
  const turns = await readJournal(dir);
  assert.equal(turns.length, 50);
  assert.equal(turns[0].prompt, 'tour 5');
  assert.equal(turns.at(-1).prompt, 'tour 54');
});

test('journal : le prompt est tronqué et mis à plat', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: `  deux\n\nlignes  ` }));
  await appendTurn(dir, turn({ prompt: 'x'.repeat(500) }));
  const turns = await readJournal(dir);
  assert.equal(turns[0].prompt, 'deux lignes');
  assert.equal(turns[1].prompt.length, 200);
  assert.match(turns[1].prompt, /…$/);
});

test('journal : un journal illisible est un journal vide, jamais une erreur', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn());
  await fs.writeFile(journalFile(dir), '{ pas du JSON', 'utf8');
  assert.deepEqual(await readJournal(dir), []);
  // et on repart proprement : écrire par-dessus ne rejette pas
  await appendTurn(dir, turn({ prompt: 'après' }));
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['après']);
});

test('journal : les entrées mal formées sont écartées à la lecture', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: 'bon' }));
  const file = journalFile(dir);
  const kept = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify([...kept, { at: 'hier' }, null, { source: 'ailleurs' }]), 'utf8');
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['bon']);
});

test('journal : un arbre, un journal — deux arbres ne se mélangent pas', async () => {
  const a = await scratch();
  const b = await scratch();
  await appendTurn(a, turn({ prompt: 'chez A' }));
  await appendTurn(b, turn({ prompt: 'chez B' }));
  assert.deepEqual((await readJournal(a)).map(t => t.prompt), ['chez A']);
  assert.deepEqual((await readJournal(b)).map(t => t.prompt), ['chez B']);
});

const branch = (p, over = {}) => ({
  path: p, type: 'context', title: p, loadWhen: `quand ${p}`, content: `corps de ${p}`, ...over,
});

test('store : déplacer une branche emporte ses enfants', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, branch('archi', { type: 'reference', title: 'Archi' }));
  await writeBranch(dir, branch('archi/store'));
  await writeBranch(dir, branch('archi/store/format'));
  await writeBranch(dir, branch('vues'));

  await moveBranch(dir, 'archi/store', 'vues/store');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['archi', 'vues', 'vues/store', 'vues/store/format']);
  const moved = tree.branches.get('vues/store');
  assert.equal(moved.parentPath, 'vues');
  assert.equal(moved.content.trim(), 'corps de archi/store');
  assert.equal(tree.branches.get('vues/store/format').parentPath, 'vues/store');
});

test('store : renommer, c\'est déplacer — le frontmatter suit', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('regles', { type: 'rule', title: 'Règles', loadWhen: 'toujours' }));
  await moveBranch(dir, 'regles', 'regles-du-projet');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['regles-du-projet']);
  const b = tree.branches.get('regles-du-projet');
  assert.equal(b.type, 'rule');
  assert.equal(b.title, 'Règles');
  assert.equal(b.loadWhen, 'toujours');
});

test('store : pas de dossier fantôme laissé derrière', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('archi'));
  await writeBranch(dir, branch('archi/store'));
  await moveBranch(dir, 'archi/store', 'store');

  // `archi/` vidé deviendrait un hub implicite : il doit avoir disparu.
  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['archi', 'store']);
  assert.deepEqual(tree.branches.get('archi').childPaths, []);
  await assert.rejects(fs.stat(path.join(dir, 'archi')));
});

test('store : une arrivée occupée est refusée, rien ne bouge', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await writeBranch(dir, branch('b'));
  await assert.rejects(moveBranch(dir, 'a', 'b'), /occupe déjà/);

  const tree = await loadTree(dir);
  assert.equal(tree.branches.get('a').content.trim(), 'corps de a');
  assert.equal(tree.branches.get('b').content.trim(), 'corps de b');
});

test('store : déplacer une branche sous son propre descendant est refusé', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('archi'));
  await writeBranch(dir, branch('archi/store'));
  await assert.rejects(moveBranch(dir, 'archi', 'archi/store/archi'), /est sous archi/);
  assert.deepEqual((await loadTree(dir)).order.sort(), ['archi', 'archi/store']);
});

test('store : branche introuvable, et chemin qui sort du dossier', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await assert.rejects(moveBranch(dir, 'absente', 'b'), /introuvable/);
  await assert.rejects(moveBranch(dir, 'a', '../dehors'), /refusé/);
  await assert.rejects(moveBranch(dir, 'a', '/etc/passwd'), /refusé/);
  await assert.rejects(moveBranch(dir, 'a', '  '), /refusé/);
});

test('store : déplacer un hub implicite (dossier sans .md frère)', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('groupe/enfant'));
  // `groupe` n'a pas de `.md` : c'est un hub implicite, il doit se déplacer quand même.
  await moveBranch(dir, 'groupe', 'rangé');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['rangé', 'rangé/enfant']);
  assert.equal(tree.branches.get('rangé/enfant').content.trim(), 'corps de groupe/enfant');
});

test('store : un chemin périmé disparaît du fallback sticky, il ne casse rien', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a', { type: 'context' }));
  await writeBranch(dir, branch('b', { type: 'context' }));
  await moveBranch(dir, 'a', 'c');

  const tree = await loadTree(dir);
  // C'est le filtre que fait le routeur sur la sélection précédente.
  const previous = ['a', 'b'].filter(p => tree.branches.has(p));
  assert.deepEqual(previous, ['b']);
  assert.deepEqual([...withAncestors(tree, previous)], ['b']);
});

test('journal : les écritures de l\'IA vivent dans leur propre fichier', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: 'un tour' }));
  await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: 'archi', title: 'Archi', why: 'convention découverte' });
  await appendAiWrite(dir, { at: Date.now(), op: 'move', path: 'x/archi', from: 'archi' });

  const writes = await readAiWrites(dir);
  assert.deepEqual(writes.map(w => w.op), ['upsert', 'move']);
  assert.equal(writes[0].why, 'convention découverte');
  assert.equal(writes[1].from, 'archi');
  // Le journal de routage n'a pas bougé : deux histoires, deux fichiers.
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['un tour']);
});

test('journal : une écriture mal formée est écartée, le fichier reste lisible', async () => {
  const dir = await scratch();
  await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: 'bon' });
  const file = journalFile(dir).replace(/\.json$/, '-writes.json');
  const kept = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify([...kept, { op: 'upsert' }, { at: 1, op: 'inconnu', path: 'x' }]), 'utf8');
  assert.deepEqual((await readAiWrites(dir)).map(w => w.path), ['bon']);
});

// ── Backend partagé ─────────────────────────────────────────────────────────
//
// Aucun projet Supabase n'est joignable d'ici : on bouchonne `fetch` et on
// vérifie ce que le client envoie, et ce qu'il fait de ce qu'il reçoit.

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = String(url);
    calls.push({
      url: route,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const match = Object.keys(routes).find(k => route.includes(k));
    if (!match) return new Response('{"message":"route inconnue"}', { status: 404 });
    const r = routes[match];
    const { status = 200, json = null } = typeof r === 'function' ? r(calls.at(-1)) : r;
    return new Response(json === null ? '' : JSON.stringify(json), { status });
  };
  return calls;
}

const token = (over = {}) => ({
  access_token: 'jeton-acces', refresh_token: 'jeton-refresh', expires_in: 3600,
  user: { id: 'u-1', email: 'adrien@example.com' }, ...over,
});

test('remote : sans configuration, le message dit quoi faire', async () => {
  delete process.env.CONTEXTREE_SUPABASE_URL;
  delete process.env.CONTEXTREE_SUPABASE_ANON_KEY;
  await clearSession();
  await assert.rejects(remoteConfig(), e => e instanceof RemoteError && /contextree remote/.test(e.message));
});

test('remote : l\'environnement l\'emporte sur le fichier, et la barre finale saute', async () => {
  const stored = await setRemoteConfig({ url: 'https://du-fichier.supabase.co/', anonKey: 'cle-fichier' });
  assert.equal(stored.config.url, 'https://du-fichier.supabase.co');
  assert.deepEqual(await remoteConfig(), { url: 'https://du-fichier.supabase.co', anonKey: 'cle-fichier' });

  process.env.CONTEXTREE_SUPABASE_URL = 'https://de-lenv.supabase.co/';
  process.env.CONTEXTREE_SUPABASE_ANON_KEY = 'cle-env';
  assert.deepEqual(await remoteConfig(), { url: 'https://de-lenv.supabase.co', anonKey: 'cle-env' });
});

test('remote : login stocke la session, et le jeton part en Bearer', async () => {
  process.env.CONTEXTREE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.CONTEXTREE_SUPABASE_ANON_KEY = 'anon';
  await clearSession();
  const calls = stubFetch({ '/auth/v1/token': { json: token() } });

  const session = await signIn('adrien@example.com', 'motdepasse');
  assert.equal(session.userId, 'u-1');
  assert.equal(session.email, 'adrien@example.com');
  assert.ok(session.expiresAt > Math.floor(Date.now() / 1000));

  assert.match(calls[0].url, /grant_type=password$/);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.apikey, 'anon');
  assert.deepEqual(calls[0].body, { email: 'adrien@example.com', password: 'motdepasse' });
  // et la session survit au processus
  assert.equal((await readSession()).refreshToken, 'jeton-refresh');
});

test('remote : une session expirée est rafraîchie sans qu\'on le demande', async () => {
  const calls = stubFetch({
    '/auth/v1/token': c => ({
      json: c.body.refresh_token ? token({ access_token: 'jeton-neuf' }) : token({ expires_in: -10 }),
    }),
  });
  await signIn('a@b.c', 'x');           // renvoie un jeton déjà expiré
  const fresh = await currentSession();
  assert.equal(fresh.accessToken, 'jeton-neuf');
  assert.match(calls.at(-1).url, /grant_type=refresh_token$/);
});

test('remote : un refresh refusé efface la session au lieu de la laisser fantôme', async () => {
  stubFetch({
    '/auth/v1/token': c => (c.body.refresh_token
      ? { status: 400, json: { error_description: 'Invalid Refresh Token' } }
      : { json: token({ expires_in: -10 }) }),
  });
  await signIn('a@b.c', 'x');
  assert.equal(await currentSession(), null);
  assert.equal(await readSession(), null);
});

test('remote : les groupes viennent de memberships, avec le rôle', async () => {
  stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/memberships': { json: [
      { role: 'owner', groups: { id: 'g-1', slug: 'gengad', name: 'GengAd' } },
      { role: 'reader', groups: { id: 'g-2', slug: 'client', name: 'Client' } },
      { role: 'reader', groups: null },
    ] },
  });
  await signIn('a@b.c', 'x');
  const groups = await myGroups();
  assert.deepEqual(groups.map(g => `${g.slug}:${g.role}`), ['gengad:owner', 'client:reader']);
});

test('remote : créer un groupe rend propriétaire, et demande la ligne en retour', async () => {
  const calls = stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/groups': { json: [{ id: 'g-9', slug: 'neuf', name: 'Neuf' }] },
  });
  await signIn('a@b.c', 'x');
  const group = await createGroup('neuf', 'Neuf');
  assert.equal(group.role, 'owner');
  assert.equal(calls.at(-1).headers.Prefer, 'return=representation');
  assert.deepEqual(calls.at(-1).body, { slug: 'neuf', name: 'Neuf' });
});

test('remote : une erreur du serveur devient un message lisible', async () => {
  await clearSession();
  stubFetch({ '/auth/v1/token': { status: 400, json: { error_description: 'Invalid login credentials' } } });
  await assert.rejects(
    signIn('a@b.c', 'faux'),
    e => e instanceof RemoteError && e.status === 400 && /Invalid login credentials \(HTTP 400\)/.test(e.message),
  );
});

test('remote : sans session, on le dit — on n\'échoue pas bizarrement', async () => {
  await clearSession();
  assert.equal(await me(), null);
  await assert.rejects(myGroups(), e => /contextree login/.test(e.message));
});

test('remote : logout efface la session même si le serveur refuse', async () => {
  stubFetch({ '/auth/v1/token': { json: token() }, '/auth/v1/logout': { status: 500, json: {} } });
  await signIn('a@b.c', 'x');
  await signOut();
  assert.equal(await readSession(), null);
});

// ── Superposition : arbre de groupe + calque local ──────────────────────────

/** Écrit un fichier de branche brut, pour contrôler exactement quels champs il
 *  porte — c'est tout l'enjeu de la superposition. */
async function rawBranch(dir, branchPath, frontmatter, body = '') {
  const file = path.join(dir, `${branchPath}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const head = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  await fs.writeFile(file, head ? `---\n${head}\n---\n\n${body}\n` : `${body}\n`, 'utf8');
}

test('superposition : une branche locale s\'ajoute, une autre surcharge', async () => {
  const dir = await scratch();
  const local = localDirFor(dir);
  await writeRoot(dir, 'racine du groupe');
  await writeBranch(dir, branch('archi', { type: 'context', title: 'Archi', loadWhen: 'du groupe' }));
  await writeBranch(dir, branch('regles', { type: 'rule', title: 'Règles', loadWhen: 'toujours' }));

  await rawBranch(local, 'archi', { load_when: 'quand JE touche à l\'archi' });
  await rawBranch(local, 'mes-raccourcis', { type: 'skill', title: 'Mes raccourcis', load_when: 'quand je bricole' }, 'zsh…');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['archi', 'mes-raccourcis', 'regles']);

  const archi = tree.branches.get('archi');
  assert.equal(archi.layer, 'local');
  assert.equal(archi.loadWhen, 'quand JE touche à l\'archi');  // surchargé
  assert.equal(archi.title, 'Archi');                            // hérité du groupe
  assert.equal(archi.type, 'context');                           // hérité
  assert.equal(archi.content.trim(), 'corps de archi');          // hérité : pas de corps local

  assert.equal(tree.branches.get('mes-raccourcis').layer, 'local');
  assert.equal(tree.branches.get('regles').layer, 'group');
});

test('superposition : la règle des ancêtres tient à cheval sur les deux calques', async () => {
  const dir = await scratch();
  const local = localDirFor(dir);
  // Le parent vient du groupe, l'enfant du calque local.
  await writeBranch(dir, branch('archi', { type: 'context', title: 'Archi' }));
  await rawBranch(local, 'archi/mes-notes', { title: 'Mes notes', load_when: 'quand je debug' }, 'notes…');

  const tree = await loadTree(dir);
  assert.equal(tree.branches.get('archi/mes-notes').parentPath, 'archi');
  assert.deepEqual(tree.branches.get('archi').childPaths, ['archi/mes-notes']);

  // Sélectionner l'enfant local remonte bien le parent du groupe.
  assert.deepEqual([...withAncestors(tree, ['archi/mes-notes'])].sort(), ['archi', 'archi/mes-notes']);

  // Et le bloc injecté contient les deux, dans l'ordre.
  const bloc = renderContext(tree, withAncestors(tree, ['archi/mes-notes']));
  assert.match(bloc, /### Archi[\s\S]*### Mes notes/);
});

test('superposition : un dossier local porteur d\'enfants n\'efface pas la branche du groupe', async () => {
  const dir = await scratch();
  const local = localDirFor(dir);
  await writeBranch(dir, branch('archi', { type: 'reference', title: 'Archi', loadWhen: 'structure' }));
  // `archi/` existe en local sans `archi.md` frère : hub implicite, tout vide.
  await rawBranch(local, 'archi/perso', { title: 'Perso', load_when: 'quand je bricole' }, 'à moi');

  const tree = await loadTree(dir);
  const archi = tree.branches.get('archi');
  assert.equal(archi.type, 'reference');
  assert.equal(archi.title, 'Archi');
  assert.equal(archi.loadWhen, 'structure');
  assert.equal(archi.content.trim(), 'corps de archi');
});

test('superposition : le fichier ouvert est celui du bon calque', async () => {
  const dir = await scratch();
  const local = localDirFor(dir);
  await writeBranch(dir, branch('archi'));
  await rawBranch(local, 'archi', { load_when: 'à moi' });
  await rawBranch(local, 'perso', { title: 'Perso', load_when: 'à moi' });

  const tree = await loadTree(dir);
  assert.equal(fileForBranch(tree, 'archi'), path.join(local, 'archi.md'));
  assert.equal(fileForBranch(tree, 'perso'), path.join(local, 'perso.md'));
  await writeBranch(dir, branch('groupe-seul'));
  const tree2 = await loadTree(dir);
  assert.equal(fileForBranch(tree2, 'groupe-seul'), path.join(dir, 'groupe-seul.md'));
});

test('superposition : le root.md local l\'emporte, sinon celui du groupe', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine du groupe');
  assert.equal((await loadTree(dir)).rootContent.trim(), 'racine du groupe');
  await writeRoot(localDirFor(dir), 'ma racine');
  assert.equal((await loadTree(dir)).rootContent.trim(), 'ma racine');
});

test('superposition : sans calque local, rien ne change', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, branch('archi'));
  await writeBranch(dir, branch('archi/store'));
  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['archi', 'archi/store']);
  assert.ok(tree.order.every(p => tree.branches.get(p).layer === 'group'));
});

test('superposition : l\'ordre reste un parcours en profondeur, pas un tri de chaînes', async () => {
  // `-` (0x2D) passe avant `/` (0x2F) : un tri lexicographique nu donnerait
  // a, a-b, a/b — l'ordre est contractuel, les indices du routeur en dépendent.
  assert.deepEqual(['a-b', 'a/b', 'a'].sort(compareBranchPaths), ['a', 'a/b', 'a-b']);

  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await writeBranch(dir, branch('a/b'));
  await writeBranch(dir, branch('a-b'));
  await rawBranch(localDirFor(dir), 'a/c', { title: 'C', load_when: 'x' });
  assert.deepEqual((await loadTree(dir)).order, ['a', 'a/b', 'a/c', 'a-b']);
});

// ── Sync : fusion à trois voies ─────────────────────────────────────────────

const rb = (p, over = {}) => ({
  path: p, parentPath: null, type: 'context', title: p, loadWhen: `quand ${p}`,
  content: `corps de ${p}`, ...over,
});

test('sync : seul le distant a bougé → on prend le distant', () => {
  const base = snapshotOf([rb('a'), rb('b')]);
  const remote = snapshotOf([rb('a', { content: 'nouveau' }), rb('b')]);
  const local = snapshotOf([rb('a'), rb('b')]);
  const r = merge(base, remote, local);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.incoming.map(d => `${d.kind}:${d.path}`), ['modifiée:a']);
  assert.equal(r.merged.get('a').content, 'nouveau');
});

test('sync : seul le local a bougé → on le garde, le distant ne l\'écrase pas', () => {
  const base = snapshotOf([rb('a')]);
  const remote = snapshotOf([rb('a')]);
  const local = snapshotOf([rb('a', { loadWhen: 'à moi' })]);
  const r = merge(base, remote, local);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.kept, ['a']);
  assert.equal(r.merged.get('a').loadWhen, 'à moi');
});

test('sync : les deux ont bougé pareil → pas un conflit', () => {
  const base = snapshotOf([rb('a')]);
  const même = rb('a', { title: 'Même titre' });
  const r = merge(base, snapshotOf([même]), snapshotOf([{ ...même }]));
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.merged.get('a').title, 'Même titre');
});

test('sync : les deux ont bougé différemment → conflit, et le local survit', () => {
  const base = snapshotOf([rb('a'), rb('b')]);
  const remote = snapshotOf([rb('a', { content: 'du groupe' }), rb('b')]);
  const local = snapshotOf([rb('a', { content: 'à moi' }), rb('b')]);
  const r = merge(base, remote, local);
  assert.deepEqual(r.conflicts, ['a']);
  // rien n'est détruit : le local reste dans le résultat
  assert.equal(r.merged.get('a').content, 'à moi');
});

test('sync : ajouts et suppressions des deux côtés', () => {
  const base = snapshotOf([rb('commune'), rb('partie-au-loin'), rb('partie-ici')]);
  const remote = snapshotOf([rb('commune'), rb('partie-ici'), rb('neuve-au-loin')]);
  const local = snapshotOf([rb('commune'), rb('partie-au-loin'), rb('neuve-ici')]);
  const r = merge(base, remote, local);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual([...r.merged.keys()].sort(), ['commune', 'neuve-au-loin', 'neuve-ici']);
  assert.deepEqual(r.incoming.map(d => `${d.kind}:${d.path}`), ['ajoutée:neuve-au-loin', 'supprimée:partie-au-loin']);
  assert.deepEqual(r.kept, ['neuve-ici', 'partie-ici']);
});

test('sync : sans base, tout le distant entre — première récupération', () => {
  const r = merge(new Map(), snapshotOf([rb('a'), rb('b')]), new Map());
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.incoming.map(d => d.path), ['a', 'b']);
});

test('sync : outgoingDiff dit ce qu\'un push enverrait', () => {
  const base = snapshotOf([rb('a'), rb('partie')]);
  const local = snapshotOf([rb('a', { title: 'Changé' }), rb('neuve')]);
  assert.deepEqual(
    outgoingDiff(base, local).map(d => `${d.kind}:${d.path}`),
    ['modifiée:a', 'ajoutée:neuve', 'supprimée:partie'],
  );
});

test('sync : le calque local ne part jamais dans un instantané', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine du groupe');
  await writeBranch(dir, branch('archi'));
  await rawBranch(localDirFor(dir), 'archi', { load_when: 'à moi' });
  await rawBranch(localDirFor(dir), 'perso', { title: 'Perso', load_when: 'à moi' });

  const snap = await localSnapshot(dir);
  assert.deepEqual(snap.branches.map(b => b.path), ['archi']);
  assert.equal(snap.branches[0].loadWhen, 'quand archi');   // pas la surcharge locale
  assert.equal(snap.rootContent.trim(), 'racine du groupe');
});

test('sync : sans rattachement, pull et push disent quoi faire', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  assert.equal(await readTracking(dir), null);
  await assert.rejects(pull(dir), e => /contextree link/.test(e.message));
  await assert.rejects(push(dir, 'm'), e => /contextree link/.test(e.message));
});

test('sync : push refuse si le distant a avancé sans nous', async () => {
  process.env.CONTEXTREE_SUPABASE_URL = 'https://x.supabase.co';
  process.env.CONTEXTREE_SUPABASE_ANON_KEY = 'anon';
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await writeTracking(dir, { treeId: 't-1', groupSlug: 'g', treeSlug: 'a', baseVersionId: 'v-1' });

  stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/versions': { json: [{ id: 'v-2', parent_id: 'v-1', message: 'ailleurs', root_content: '', created_at: '2026-09-07' }] },
  });
  await signIn('a@b.c', 'x');
  const report = await push(dir, 'mon message');
  assert.equal(report.status, 'en retard');
  assert.equal(report.head.id, 'v-2');
});

test('sync : un pull en conflit n\'écrit rien sur le disque', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a', { content: 'à moi' }));
  await writeTracking(dir, { treeId: 't-1', groupSlug: 'g', treeSlug: 'a', baseVersionId: 'v-1' });

  let n = 0;
  stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/versions': { json: [{ id: 'v-2', parent_id: 'v-1', message: '', root_content: '', created_at: '2026-09-07' }] },
    '/rest/v1/branches': c => ({
      json: /version_id=eq\.v-1/.test(c.url)
        ? [{ path: 'a', parent_path: null, type: 'context', title: 'a', load_when: 'quand a', content: 'la base' }]
        : [{ path: 'a', parent_path: null, type: 'context', title: 'a', load_when: 'quand a', content: 'du groupe' }],
    }),
  });
  await signIn('a@b.c', 'x');
  const report = await pull(dir);
  assert.equal(report.status, 'conflit');
  assert.deepEqual(report.conflicts, ['a']);
  // le disque n'a pas bougé, et la base suivie non plus
  assert.equal((await loadTree(dir)).branches.get('a').content.trim(), 'à moi');
  assert.equal((await readTracking(dir)).baseVersionId, 'v-1');
  void n;
});

test('sync : un pull propre écrit, supprime, et avance la base suivie', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('garde', { content: 'à moi' }));   // modifiée en local
  await writeBranch(dir, branch('vieille'));                        // supprimée au loin
  await writeTracking(dir, { treeId: 't-1', groupSlug: 'g', treeSlug: 'a', baseVersionId: 'v-1' });

  const base = [
    { path: 'garde', parent_path: null, type: 'context', title: 'garde', load_when: 'quand garde', content: 'corps de garde' },
    { path: 'vieille', parent_path: null, type: 'context', title: 'vieille', load_when: 'quand vieille', content: 'corps de vieille' },
  ];
  stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/versions': { json: [{ id: 'v-2', parent_id: 'v-1', message: '', root_content: '# racine distante', created_at: '2026-09-07' }] },
    '/rest/v1/branches': c => ({
      json: /version_id=eq\.v-1/.test(c.url)
        ? base
        : [base[0], { path: 'neuve', parent_path: null, type: 'skill', title: 'Neuve', load_when: 'quand neuve', content: 'du groupe' }],
    }),
  });
  await signIn('a@b.c', 'x');
  const report = await pull(dir);
  assert.equal(report.status, 'fusionné');
  assert.deepEqual(report.incoming.map(d => `${d.kind}:${d.path}`), ['ajoutée:neuve', 'supprimée:vieille']);
  assert.deepEqual(report.kept, ['garde']);

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['garde', 'neuve']);
  assert.equal(tree.branches.get('garde').content.trim(), 'à moi');       // le local a survécu
  assert.equal(tree.branches.get('neuve').type, 'skill');
  assert.equal(tree.rootContent.trim(), '# racine distante');
  assert.equal((await readTracking(dir)).baseVersionId, 'v-2');
});

test('sync : un push envoie l\'arbre du groupe et avance la base', async () => {
  const dir = await scratch();
  await writeRoot(dir, '# ma racine');
  await writeBranch(dir, branch('a'));
  await rawBranch(localDirFor(dir), 'perso', { title: 'Perso', load_when: 'à moi' });
  await writeTracking(dir, { treeId: 't-1', groupSlug: 'g', treeSlug: 'a', baseVersionId: null });

  const calls = stubFetch({
    '/auth/v1/token': { json: token() },
    '/rest/v1/versions': c => (c.method === 'POST'
      ? { json: [{ id: 'v-9', parent_id: null, message: c.body.message, root_content: c.body.root_content, created_at: '2026-09-07' }] }
      : { json: [] }),
    '/rest/v1/branches': { status: 201, json: null },
  });
  await signIn('a@b.c', 'x');
  const report = await push(dir, 'premier envoi');
  assert.equal(report.status, 'poussé');
  assert.deepEqual(report.outgoing.map(d => d.path), ['a']);

  const posted = calls.find(c => c.url.includes('/rest/v1/branches') && c.method === 'POST');
  assert.deepEqual(posted.body.map(b => b.path), ['a']);   // « perso » n'est pas parti
  assert.equal(posted.body[0].load_when, 'quand a');
  assert.equal((await readTracking(dir)).baseVersionId, 'v-9');
});

test('sync : un conflit se tranche, et ne revient pas', () => {
  const base = snapshotOf([rb('a')]);
  const remote = snapshotOf([rb('a', { content: 'du groupe' })]);
  // La version réglée à la main : différente du distant ET de la base. Sans
  // résolution explicite, `pull` la redétecterait indéfiniment.
  const local = snapshotOf([rb('a', { content: 'le compromis' })]);

  assert.deepEqual(merge(base, remote, local).conflicts, ['a']);

  const mine = merge(base, remote, local, 'mine');
  assert.deepEqual(mine.conflicts, []);
  assert.deepEqual(mine.kept, ['a']);
  assert.equal(mine.merged.get('a').content, 'le compromis');

  const theirs = merge(base, remote, local, 'theirs');
  assert.deepEqual(theirs.conflicts, []);
  assert.deepEqual(theirs.incoming.map(d => d.path), ['a']);
  assert.equal(theirs.merged.get('a').content, 'du groupe');
});
