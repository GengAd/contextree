import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from '../dist/core/frontmatter.js';
import { loadTree, writeBranch, writeRoot, deleteBranch, moveBranch, slugify, findTreeDir, localDirFor, fileForBranch, compareBranchPaths, initTree } from '../dist/core/store.js';
import { withAncestors, allBranches } from '../dist/core/tree.js';
import { route, pickEngine, isCliEngine } from '../dist/core/router.js';
import { renderContext, renderAgentsBlock } from '../dist/core/render.js';
import { syncAgentsFile, installCodexMcp, agentStatus, installAgent, selfCommand } from '../dist/install.js';
import { extractPack, applyPack, encodePack, decodePack } from '../dist/core/pack.js';
import { appendTurn, readJournal, journalFile, appendAiWrite, readAiWrites } from '../dist/core/journal.js';
import {
  RemoteError, clearSession, createGroup, currentSession, me, myGroups,
  readSession, remoteConfig, setRemoteConfig, signIn, signOut,
} from '../dist/core/remote.js';
import {
  merge, outgoingDiff, snapshotOf, pull, push, readTracking, writeTracking, localSnapshot,
} from '../dist/core/sync.js';

process.env.CONTEXTREE_STATE_DIR = await fs.mkdtemp(
  path.join(os.tmpdir(), 'contextree-journal-'),
);

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-test-'));
  return path.join(dir, '.contextree');
}

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

    // Seuls les moteurs CLI sont lents : c'est ce qui décide du différé.
    assert.ok(isCliEngine('claude') && isCliEngine('codex') && isCliEngine('gemini'));
    assert.ok(!isCliEngine('anthropic') && !isCliEngine('openai') && !isCliEngine('none'));
  } finally {
    for (const k of ['CONTEXTREE_ROUTER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
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
    assert.deepEqual(viaNpx.args, ['-y', '@gengad/contextree', 'hook']);
    assert.equal(viaNpx.shell, 'npx -y @gengad/contextree hook');

    // Sinon : node + le script, en absolu et entre guillemets. Sans ça, un
    // paquet non publié échoue en silence sur tout autre projet que celui-ci.
    process.argv[1] = path.join('dist', 'cli.js');
    const local = selfCommand('mcp');
    assert.equal(local.command, process.execPath);
    assert.deepEqual(local.args, [path.resolve('dist', 'cli.js'), 'mcp']);
    assert.ok(path.isAbsolute(local.args[0]));
    assert.equal(local.shell, `"${process.execPath}" "${path.resolve('dist', 'cli.js')}" mcp`);

    // La détection « déjà câblé » cherche `contextree` dans la commande : elle
    // doit rester vraie sur les deux formes.
    process.argv[1] = path.join(path.sep, 'opt', 'node_modules', '@gengad', 'contextree', 'dist', 'cli.js');
    assert.ok(selfCommand('hook').shell.includes('contextree'));
    assert.ok(viaNpx.shell.includes('contextree'));
  } finally {
    process.argv[1] = saved;
  }
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

  const report = await installAgent('cursor', projectDir);
  assert.equal(report[0].action, 'created');
  const written = JSON.parse(await fs.readFile(path.join(projectDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(written.mcpServers.contextree.command, selfCommand('mcp').command);
  assert.deepEqual(written.mcpServers.contextree.args, selfCommand('mcp').args);

  const after = await agentStatus(projectDir);
  assert.equal(after.find(a => a.id === 'cursor').wired, true);

  const again = await installAgent('cursor', projectDir);
  assert.equal(again[0].action, 'unchanged');
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
