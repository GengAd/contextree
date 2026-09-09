#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { DIR_NAME, findTreeDir, loadTree, slugify, writeBranch, deleteBranch, moveBranch, initTree } from './core/store.js';
import { allBranches, formatTree } from './core/tree.js';
import { renderContext, renderTrace, renderAgentsBlock } from './core/render.js';
import { route, pickEngine, isCliEngine, engineBin, withoutRouting } from './core/router.js';
import { encodePack, extractPack, applyPack } from './core/pack.js';
import { readSelection, writeSelection } from './core/session.js';
import { appendTurn } from './core/journal.js';
import { evaluateRouting, parseEvalCases, type EvalReport } from './core/eval.js';
import {
  RemoteError,
  createGroup,
  me,
  myGroups,
  setRemoteConfig,
  signIn,
  signOut,
} from './core/remote.js';
import { link, pull, push, readTracking } from './core/sync.js';
import { isBranchType, type BranchType } from './core/types.js';
import { AGENTS, agentStatus, installAgent, selfCommand, type InstallReport } from './install.js';
import { resolvePack, runStdio } from './mcp/server.js';

const HELP = `contextree — un arbre de contexte partageable, routé, injecté à chaque appel IA.

  contextree init                    crée .contextree/ avec un arbre de démarrage
  contextree install [--agent a]     câble l'injection (--status pour voir l'état)
  contextree list                    affiche l'arbre
  contextree add                     crée une branche (--title --type --load-when [--parent])
  contextree rm <chemin>             supprime une branche et ses enfants
  contextree mv <de> <vers>          déplace ou renomme une branche (ses enfants suivent)
  contextree route "<prompt>"        montre ce que le routeur chargerait
  contextree route --eval [fichier]  mesure le routage sur un jeu de prompts
  contextree render [--agents]       affiche tout l'arbre assemblé (sans routage)
                                     --agents : le bloc court pour un AGENTS.md
                                     --copy   : dans le presse-papier (render, route)
  contextree export [--token] [-o f] exporte l'arbre pour le partager
  contextree import <source>         greffe un pack (jeton, JSON, ou fichier) [--prefix p]
  contextree mcp                     lance le serveur MCP (stdio)
  contextree hook                    point d'entrée du hook UserPromptSubmit

Contexte partagé (phase 2) :
  contextree remote <url> <clé>      pointe le backend Supabase
  contextree login <email>           se connecte (mot de passe sur stdin ou --password)
  contextree logout                  ferme la session
  contextree whoami                  qui est connecté, et sur quels groupes
  contextree group new <slug> <nom>  crée un groupe (on en devient propriétaire)
  contextree link <grp>/<arbre>      rattache cette copie de travail [--create]
  contextree pull [--mine|--theirs]  récupère l'arbre de groupe (fusion, jamais d'écrasement)
  contextree push -m "<message>"     pousse ses changements locaux
  contextree status                  ce que cette copie de travail suit

Routage : aucune clé requise si un CLI d'agent (\`claude\`, \`codex\`, \`gemini\`) est
          installé — c'est ton abonnement qui route. Une clé (ANTHROPIC_API_KEY,
          OPENAI_API_KEY) est utilisée si elle est là.

Variables : CONTEXTREE_ROUTER (auto | anthropic | openai | claude | codex | gemini | off),
            CONTEXTREE_ROUTER_MODEL, CONTEXTREE_ROUTER_TIMEOUT_MS,
            OPENAI_API_KEY / OPENAI_BASE_URL, CONTEXTREE_CLAUDE_BIN,
            CONTEXTREE_STATE_DIR (où vit le journal des tours)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    case 'init':
      return cmdInit(Boolean(flags.force));
    case 'install':
      return cmdInstall(flags);
    case 'list':
      return cmdList();
    case 'add':
      return cmdAdd(flags);
    case 'rm':
      return cmdRemove(flags._[0]);
    case 'mv':
      return cmdMove(flags._[0], flags._[1]);
    case 'route':
      return cmdRoute(flags._.join(' '), flags);
    case 'render':
      return cmdRender(flags);
    case 'export':
      return cmdExport(flags);
    case 'import':
      return cmdImport(flags);
    case 'mcp':
      await runStdio();
      // Le transport stdio vit tant que stdin est ouvert : on ne rend jamais la
      // main, sinon le `process.exit` en bas de fichier tuerait le serveur.
      await new Promise<never>(() => {});
      return 0;
    case 'hook':
      return cmdHook();
    case 'remote':
      return cmdRemote(flags._[0], flags._[1]);
    case 'login':
      return cmdLogin(flags._[0], str(flags.password));
    case 'logout':
      return cmdLogout();
    case 'whoami':
      return cmdWhoami();
    case 'group':
      return cmdGroup(flags._);
    case 'link':
      return cmdLink(flags._[0], Boolean(flags.create));
    case 'pull':
      return cmdPull(flags.mine ? 'mine' : flags.theirs ? 'theirs' : undefined);
    case 'push':
      return cmdPush(str(flags.m) ?? str(flags.message));
    case 'status':
      return cmdStatus();
    case 'route-bg':
      return cmdRouteBackground(flags);
    default:
      process.stderr.write(`Commande inconnue : ${command}\n\n${HELP}`);
      return 1;
  }
}

// ── commandes ────────────────────────────────────────────────────────────────

async function cmdInit(force: boolean): Promise<number> {
  try {
    const { dir, branches } = await initTree(process.cwd(), { force });
    process.stdout.write(
      `${path.relative(process.cwd(), dir)}/ créé avec ${branches} branches de départ.\n` +
        `Prochaine étape : édite les fichiers, puis \`contextree install\`.\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)} --force pour réécrire les fichiers de départ.\n`,
    );
    return 1;
  }
}

/**
 * Câble l'injection pour les agents présents.
 *
 * Par défaut : tout ce qui est **détecté**, plus Claude Code, dont les deux
 * fichiers sont dans le projet et ne gênent personne. Les agents dont la
 * configuration vit dans le home ne sont câblés que s'ils sont là, ou nommés
 * par `--agent` : écrire dans le `~` de quelqu'un qui n'utilise pas l'outil
 * serait une surprise, pas un service.
 *
 * `--status` ne fait que regarder : c'est la question qu'on se pose quand rien
 * ne s'injecte.
 */
/**
 * Les deux commandes que `install` inscrirait — hook et serveur MCP.
 *
 * Affichées avant comme après l'écriture : c'est le seul endroit d'où l'on
 * apprend, sans ouvrir un JSON, si l'agent a été câblé sur `npx` (paquet
 * publié) ou sur le binaire local. Voir `selfCommand`.
 */
function wiredCommands(): string {
  const mcp = selfCommand('mcp');
  return (
    `Commande écrite : ${selfCommand('hook').shell}\n` +
    `                  ${[mcp.command, ...mcp.args].join(' ')}\n`
  );
}

async function cmdInstall(flags: Flags): Promise<number> {
  const asked = str(flags.agent);
  const statuses = await agentStatus(process.cwd());

  if (flags.status) {
    for (const a of statuses) {
      const state = a.wired ? 'câblé' : a.detected ? 'à câbler' : 'non détecté';
      process.stdout.write(`${state.padEnd(12)} ${a.label}\n`);
      for (const f of a.files) process.stdout.write(`             ${shorten(f)}\n`);
    }
    process.stdout.write(`\n${wiredCommands()}`);
    process.stdout.write(`Routage : ${describeEngine()}\n`);
    return 0;
  }

  if (asked && asked !== 'all' && !AGENTS.some(a => a.id === asked)) {
    process.stderr.write(
      `Agent inconnu : ${asked} (${AGENTS.map(a => a.id).join(', ')}, all)\n`,
    );
    return 1;
  }

  const targets = statuses.filter(a =>
    asked ? asked === 'all' || asked === a.id : a.detected || a.id === 'claude-code',
  );

  // Le bloc `AGENTS.md` n'est calculé que si un agent en veut un : sans arbre,
  // `install` doit rester possible pour câbler d'abord et créer ensuite.
  let block: string | undefined;
  if (targets.some(a => a.id === 'codex')) {
    const dir = await findTreeDir();
    if (dir) block = renderAgentsBlock(await loadTree(dir));
  }

  const report: InstallReport = [];
  for (const a of targets) report.push(...(await installAgent(a.id, process.cwd(), block)));

  for (const r of report) process.stdout.write(`${r.action.padEnd(9)} ${shorten(r.file)}\n`);

  // Seulement quand on n'a rien demandé de précis : sur `--agent cursor`, les
  // autres ne sont pas « non détectés », ils ne sont pas le sujet.
  const skipped = asked ? [] : statuses.filter(s => !targets.includes(s));
  if (skipped.length) {
    process.stdout.write(
      `\nNon câblé (non détecté) : ${skipped.map(s => s.id).join(', ')}` +
        ` — \`--agent <id>\` pour forcer.\n`,
    );
  }
  process.stdout.write(`\n${wiredCommands()}`);
  process.stdout.write(
    "Relance ton agent pour prendre en compte le hook et le serveur MCP.\n" +
      "Aucune de ces surfaces (Claude sur le web, ChatGPT…) : `contextree render --copy`,\n" +
      "ou `contextree route \"<ta demande>\" --copy`, et tu colles.\n" +
      `Routage : ${describeEngine()}\n`,
  );
  return 0;
}

/** Un chemin lisible : relatif au projet quand il en vient, `~` sinon. */
function shorten(file: string): string {
  if (file.startsWith(process.cwd())) return path.relative(process.cwd(), file);
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

async function cmdList(): Promise<number> {
  const { tree } = await open();
  const branches = allBranches(tree);
  process.stdout.write(branches.length ? `${formatTree(tree)}\n\n${branches.length} branche(s).\n` : 'Arbre vide.\n');
  return 0;
}

async function cmdAdd(flags: Flags): Promise<number> {
  const { dir, tree } = await open();
  const title = str(flags.title) ?? flags._[0];
  const type = str(flags.type);
  const loadWhen = str(flags['load-when']);
  if (!title || !type || !loadWhen) {
    process.stderr.write('Usage : contextree add --title "…" --type rule --load-when "…" [--parent p] [--content "…"]\n');
    return 1;
  }
  if (!isBranchType(type)) {
    process.stderr.write(`Type inconnu : ${type} (identity, rule, context, reference, skill)\n`);
    return 1;
  }
  const parent = str(flags.parent);
  if (parent && !tree.branches.has(parent)) {
    process.stderr.write(`Parent inconnu : ${parent}\n`);
    return 1;
  }
  const content = str(flags.content) ?? (await readStdin()) ?? '';
  const slug = str(flags.path) ?? slugify(title);
  const branchPath = parent ? `${parent}/${slug}` : slug;
  const file = await writeBranch(dir, { path: branchPath, type: type as BranchType, title, loadWhen, content });
  process.stdout.write(`${branchPath}\n${path.relative(process.cwd(), file)}\n`);
  return 0;
}

async function cmdRemove(branchPath: string | undefined): Promise<number> {
  if (!branchPath) {
    process.stderr.write('Usage : contextree rm <chemin>\n');
    return 1;
  }
  const { dir, tree } = await open();
  if (!tree.branches.has(branchPath)) {
    process.stderr.write(`Branche inconnue : ${branchPath}\n`);
    return 1;
  }
  await deleteBranch(dir, branchPath);
  process.stdout.write(`Supprimé : ${branchPath}\n`);
  return 0;
}

async function cmdMove(from: string | undefined, to: string | undefined): Promise<number> {
  if (!from || !to) {
    process.stderr.write('Usage : contextree mv <de> <vers>\n');
    return 1;
  }
  const { dir, tree } = await open();
  if (!tree.branches.has(from)) {
    process.stderr.write(`Branche inconnue : ${from}\n`);
    return 1;
  }
  // Même garde que `add` : un parent inconnu se crée à la main. Sinon on
  // fabrique un hub implicite dont le `load_when` ne veut rien dire, et le
  // routeur route dessus.
  const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
  if (parent && !tree.branches.has(parent)) {
    process.stderr.write(`Parent inconnu : ${parent}\n`);
    return 1;
  }
  const kids = tree.branches.get(from)!.childPaths.length;
  try {
    const file = await moveBranch(dir, from, to);
    process.stdout.write(
      `${from} → ${to}${kids ? ` (+ ${kids} enfant(s))` : ''}\n${path.relative(process.cwd(), file)}\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function cmdRoute(prompt: string, flags: Flags): Promise<number> {
  if (flags.eval) return cmdEval(typeof flags.eval === 'string' ? flags.eval : str(flags._[0]));
  if (!prompt.trim()) {
    process.stderr.write('Usage : contextree route "<prompt>"\n');
    return 1;
  }
  const { tree } = await open();
  const started = Date.now();
  process.stderr.write(`${describeEngine()}\n`);
  const { selected, reason, error } = await route(tree, prompt);
  process.stderr.write(
    `${renderTrace(tree, selected, reason)} — ${Date.now() - started} ms${error ? ` — ${error}` : ''}\n\n` +
      `${formatTree(tree, selected)}\n\n`,
  );
  return emit(renderContext(tree, selected), Boolean(flags.copy));
}

/** Le jeu de prompts par défaut : dans le dépôt, à côté des tests — c'est du
 *  code de mise au point, pas du contexte, donc il n'a rien à faire dans
 *  l'arbre. Résolu depuis le dossier qui contient `.contextree/`. */
const EVAL_FILE = path.join('tests', 'routing.eval.json');

/**
 * Mesurer le routage sur de vrais prompts.
 *
 * Opt-in, jamais dans `npm test` : il faut un moteur, la réponse d'un modèle
 * varie d'un appel à l'autre, et un mauvais score dit « le routage s'est
 * dégradé », pas « le code est cassé ». D'où le **code de sortie 0 même quand
 * c'est mauvais** : c'est une mesure qu'on lit, pas une porte qui claque.
 */
async function cmdEval(file: string | undefined): Promise<number> {
  // Personne n'attend une mesure : on laisse au moteur le temps de répondre,
  // comme le routage de fond. Sans ça, un CLI d'agent expire à 20 s, la moitié
  // des cas tombent dans le repli « arbre entier », et on mesure le timeout au
  // lieu du routeur — 9 cas sur 20 à la première mesure, le 9 septembre 2026.
  process.env['CONTEXTREE_ROUTER_TIMEOUT_MS'] ??= '120000';
  const { dir, tree } = await open();
  const target = path.resolve(path.dirname(dir), file ?? EVAL_FILE);

  let cases;
  try {
    cases = parseEvalCases(JSON.parse(await fs.readFile(target, 'utf8')));
  } catch {
    process.stderr.write(`Jeu d'éval illisible : ${shorten(target)}\n`);
    return 1;
  }
  if (!cases.length) {
    process.stderr.write(`Aucun cas dans ${shorten(target)}\n`);
    return 1;
  }

  process.stderr.write(
    `${cases.length} cas · ${tree.order.length} branches · ${describeEngine()}\n\n`,
  );

  const report = await evaluateRouting(tree, cases, p => route(tree, p));
  process.stdout.write(formatEval(report));
  return 0;
}

/** Une ligne par cas — `●` attendu et obtenu, `+` en trop, `−` manquant — puis
 *  le total. Les titres, pas les chemins : c'est ce que montrent les vues. */
function formatEval(report: EvalReport): string {
  const out: string[] = [];
  for (const c of report.cases) {
    const bits = [
      `${c.hit.length}/${c.hit.length + c.missing.length}`,
      `${String(c.ms).padStart(5)} ms`,
      c.reason === 'routed' ? '' : c.reason,
    ].filter(Boolean);
    out.push(`${bits.join(' · ')}  ${c.prompt}`);
    if (c.missing.length) out.push(`   − ${c.missing.join(', ')}`);
    if (c.extra.length) out.push(`   + ${c.extra.join(', ')}`);
    if (c.unknown.length) out.push(`   ? ${c.unknown.join(', ')} — absent de l'arbre`);
    if (c.error) out.push(`   ! ${c.error}`);
  }
  const pct = (n: number): string => `${Math.round(n * 100)} %`;
  out.push('');
  out.push(
    `précision ${pct(report.precision)} · rappel ${pct(report.recall)} · ${report.avgMs} ms en moyenne`,
  );
  out.push(
    'précision = ce qui a été chargé et servait ; rappel = ce qui servait et a été chargé.',
  );
  return `${out.join('\n')}\n`;
}

async function cmdRender(flags: Flags): Promise<number> {
  const { tree } = await open();
  if (flags.agents) return emit(renderAgentsBlock(tree), Boolean(flags.copy));
  return emit(renderContext(tree, new Set(tree.order)), Boolean(flags.copy));
}

/**
 * La sortie, sur stdout ou dans le presse-papier.
 *
 * Le presse-papier est la surface d'injection des agents qui n'en ont aucune —
 * Claude sur le web, ChatGPT, un chat quelconque : on ne peut rien y installer,
 * mais on peut coller. C'est le même bloc que partout ailleurs, pas un format
 * de plus. Échec de la copie ⇒ on écrit quand même sur stdout : mieux vaut du
 * texte à sélectionner que rien.
 */
async function emit(text: string, copy: boolean): Promise<number> {
  if (copy && (await toClipboard(text))) {
    process.stderr.write(`${text.length} caractères copiés dans le presse-papier.\n`);
    return 0;
  }
  if (copy) process.stderr.write('Presse-papier indisponible — sortie sur stdout.\n');
  process.stdout.write(`${text}\n`);
  return 0;
}

/** Le presse-papier du système, sans dépendance : l'outil natif de la plateforme. */
function toClipboard(text: string): Promise<boolean> {
  const [bin, args] =
    process.platform === 'darwin'
      ? ['pbcopy', [] as string[]]
      : process.platform === 'win32'
        ? ['clip', []]
        : ['xclip', ['-selection', 'clipboard']];
  return new Promise(resolve => {
    try {
      const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
      child.stdin.on('error', () => resolve(false));
      child.stdin.end(text, 'utf8');
    } catch {
      resolve(false);
    }
  });
}

async function cmdExport(flags: Flags): Promise<number> {
  const { tree } = await open();
  const pack = extractPack(tree, str(flags.title));
  const payload = flags.token ? `contextree:${encodePack(pack)}` : JSON.stringify(pack, null, 2);
  const out = str(flags.o) ?? str(flags.out);
  if (out) {
    await fs.writeFile(out, `${payload}\n`, 'utf8');
    process.stdout.write(`${pack.branches.length} branche(s) → ${out}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
  return 0;
}

async function cmdImport(flags: Flags): Promise<number> {
  const source = flags._[0];
  if (!source) {
    process.stderr.write('Usage : contextree import <jeton|fichier.json> [--prefix equipe]\n');
    return 1;
  }
  const dir = (await findTreeDir()) ?? path.join(process.cwd(), DIR_NAME);
  const pack = await resolvePack(source);
  const written = await applyPack(dir, pack, { prefix: str(flags.prefix), mergeRoot: true });
  process.stdout.write(`${written.length} branche(s) importée(s) dans ${path.relative(process.cwd(), dir)}/\n`);
  return 0;
}

/**
 * Hook `UserPromptSubmit` : ce qu'on écrit sur stdout est ajouté au contexte du
 * tour. C'est le seul chemin *déterministe* — il ne dépend pas de la décision
 * de l'agent d'appeler un outil.
 *
 * Contrat non négociable : ne jamais bloquer un prompt. Toute erreur sort en
 * code 0 et silence.
 */
// ── contexte partagé (phase 2) ───────────────────────────────────────────────
//
// Ces commandes-là sont les seules à toucher le réseau. Le routage, lui, n'en
// dépend jamais : un backend injoignable ne doit pas coûter une milliseconde à
// un prompt.

async function cmdRemote(url: string | undefined, anonKey: string | undefined): Promise<number> {
  if (!url || !anonKey) {
    process.stderr.write('Usage : contextree remote <url> <clé anon>\n');
    return 1;
  }
  const stored = await setRemoteConfig({ url, anonKey });
  process.stdout.write(`Backend : ${stored.config.url}\n${stored.file}\n`);
  return 0;
}

async function cmdLogin(email: string | undefined, password: string | undefined): Promise<number> {
  if (!email) {
    process.stderr.write('Usage : contextree login <email> [--password <mdp>]\n');
    return 1;
  }
  // Un mot de passe sur la ligne de commande finit dans l'historique du shell :
  // stdin est le chemin par défaut, `--password` reste possible pour un script.
  const secret = password ?? (await readStdin())?.trim();
  if (!secret) {
    process.stderr.write('Mot de passe attendu sur stdin, ou via --password.\n');
    return 1;
  }
  return remote(async () => {
    const session = await signIn(email, secret);
    process.stdout.write(`Connecté : ${session.email ?? session.userId}\n`);
  });
}

async function cmdLogout(): Promise<number> {
  await signOut();
  process.stdout.write('Session fermée.\n');
  return 0;
}

async function cmdWhoami(): Promise<number> {
  return remote(async () => {
    const account = await me();
    if (!account) {
      process.stdout.write('Personne n\'est connecté. Lance : contextree login <email>\n');
      return;
    }
    process.stdout.write(`${account.email ?? account.id}\n`);
    const groups = await myGroups();
    if (!groups.length) {
      process.stdout.write('Aucun groupe. Lance : contextree group new <slug> <nom>\n');
      return;
    }
    for (const g of groups) process.stdout.write(`  ${g.slug} — ${g.name} (${g.role})\n`);
  });
}

async function cmdGroup(args: string[]): Promise<number> {
  const [sub, slug, ...rest] = args;
  if (sub !== 'new' || !slug) {
    process.stderr.write('Usage : contextree group new <slug> <nom>\n');
    return 1;
  }
  const name = rest.join(' ') || slug;
  return remote(async () => {
    const group = await createGroup(slug, name);
    process.stdout.write(`Groupe créé : ${group.slug} — ${group.name} (${group.role})\n`);
  });
}

async function cmdLink(target: string | undefined, create: boolean): Promise<number> {
  const [groupSlug, treeSlug] = (target ?? '').split('/');
  if (!groupSlug || !treeSlug) {
    process.stderr.write('Usage : contextree link <groupe>/<arbre> [--create]\n');
    return 1;
  }
  const { dir } = await open();
  return remote(async () => {
    const tracking = await link(dir, groupSlug, treeSlug, { create });
    process.stdout.write(
      `Rattaché à ${tracking.groupSlug}/${tracking.treeSlug}\nLance : contextree pull\n`,
    );
  });
}

async function cmdStatus(): Promise<number> {
  const { dir } = await open();
  const tracking = await readTracking(dir);
  if (!tracking) {
    process.stdout.write(
      "Copie de travail non rattachée.\nLance : contextree link <groupe>/<arbre> [--create]\n",
    );
    return 0;
  }
  process.stdout.write(
    `${tracking.groupSlug}/${tracking.treeSlug}\n` +
      `base : ${tracking.baseVersionId ?? '(aucune — rien n\'a encore été poussé ni récupéré)'}\n`,
  );
  return 0;
}

async function cmdPull(resolve?: 'mine' | 'theirs'): Promise<number> {
  const { dir } = await open();
  let code = 0;
  const result = await remote(async () => {
    const report = await pull(dir, resolve ? { resolve } : {});
    if (report.status === 'vierge') {
      process.stdout.write("L'arbre distant est vierge. Lance : contextree push -m \"…\"\n");
      return;
    }
    if (report.status === 'à jour') {
      process.stdout.write('Déjà à jour.\n');
      return;
    }
    // Un conflit se montre, il ne se tranche pas à ta place. Rien n'a été écrit.
    if (report.status === 'conflit') {
      process.stderr.write(
        `${report.conflicts.length} branche(s) modifiée(s) des deux côtés — rien n'a été écrit :\n` +
          report.conflicts.map(p => `  ✗ ${p}\n`).join('') +
          '\nRègle chacune à la main en éditant son .md, puis tranche en une fois :\n' +
          '  contextree pull --mine     garde ta version des branches en conflit\n' +
          '  contextree pull --theirs   prend celle du groupe\n',
      );
      code = 1;
      return;
    }
    for (const d of report.incoming) process.stdout.write(`  ↓ ${d.kind.padEnd(9)} ${d.path}\n`);
    for (const p of report.kept) process.stdout.write(`  = gardée    ${p}\n`);
    process.stdout.write(
      `${report.incoming.length} branche(s) récupérée(s), ${report.kept.length} gardée(s).\n`,
    );
  });
  return result || code;
}

async function cmdPush(message: string | undefined): Promise<number> {
  if (!message) {
    process.stderr.write('Usage : contextree push -m "<message>"\n');
    return 1;
  }
  const { dir } = await open();
  let code = 0;
  const result = await remote(async () => {
    const report = await push(dir, message);
    if (report.status === 'rien à pousser') {
      process.stdout.write('Rien à pousser.\n');
      return;
    }
    if (report.status === 'en retard') {
      process.stderr.write(
        "Le distant a avancé depuis ta dernière synchronisation.\n" +
          'Lance `contextree pull` d\'abord — pousser écraserait le travail de quelqu\'un d\'autre.\n',
      );
      code = 1;
      return;
    }
    for (const d of report.outgoing) process.stdout.write(`  ↑ ${d.kind.padEnd(9)} ${d.path}\n`);
    process.stdout.write(`Poussé : ${report.outgoing.length} changement(s).\n`);
  });
  return result || code;
}

/** Une erreur réseau est une erreur d'utilisation, pas un plantage : on affiche
 *  le message et on sort en 1, sans pile d'appels. */
async function remote(run: () => Promise<void>): Promise<number> {
  try {
    await run();
    return 0;
  } catch (err) {
    if (err instanceof RemoteError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function cmdHook(): Promise<number> {
  try {
    // Le routeur peut lancer `claude -p` : si ce process relançait le hook, on
    // partirait en boucle. Il se tait.
    if (process.env['CONTEXTREE_ROUTING']) return 0;
    const raw = (await readStdin()) ?? '';
    const payload = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const prompt = typeof payload['prompt'] === 'string' ? payload['prompt'] : '';
    const cwd = typeof payload['cwd'] === 'string' ? payload['cwd'] : process.cwd();
    const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : 'default';
    if (!prompt) return 0;

    const dir = await findTreeDir(cwd);
    if (!dir) return 0;
    const tree = await loadTree(dir);
    if (!tree.order.length && !tree.rootContent.trim()) return 0;

    const previous = await readSelection(dir, sessionId);
    // Un seul horodatage pour ce prompt : le tour du hook et celui que le
    // routage de fond écrira portent le même `at`, sinon on ne peut plus les
    // lire ensemble.
    const at = Date.now();

    // Le routage par le CLI coûte entre 5 et 60 s : hors de question de le
    // mettre devant le prompt. Ce tour part avec la sélection du tour précédent
    // (l'arbre entier au premier tour), et le routage de *ce* prompt tourne
    // derrière — il servira au tour suivant. `CONTEXTREE_ROUTER_BLOCKING=1`
    // rend la main à l'attente si on préfère payer la latence.
    const deferred =
      isCliEngine(pickEngine()) && process.env['CONTEXTREE_ROUTER_BLOCKING'] !== '1';

    const { selected, reason, error } = deferred
      ? { selected: withoutRouting(tree, previous), reason: 'deferred' as const, error: undefined }
      : await route(tree, prompt, { previousSelection: previous });

    // En différé, c'est le process de fond qui écrira la sélection : l'écraser
    // ici reviendrait à effacer le routage avant qu'il n'arrive.
    if (deferred) routeInBackground(dir, sessionId, prompt, at);
    else await writeSelection(dir, sessionId, selected, { at, routed: reason === 'routed' });

    await appendTurn(dir, {
      at,
      prompt,
      selected: [...selected],
      reason,
      source: 'hook',
      ...(error ? { error } : {}),
    });

    const block = renderContext(tree, selected);
    if (block) process.stdout.write(`${block}\n`);
    process.stderr.write(`${renderTrace(tree, selected, reason)}\n`);
  } catch {
    // Silence délibéré : un contexte manquant est un désagrément, un prompt
    // bloqué est une panne.
  }
  return 0;
}

/**
 * Le routage de ce prompt, lancé derrière et laissé seul.
 *
 * Détaché et sans stdio : il survit à la sortie du hook — c'est tout l'intérêt.
 * Le prompt passe en base64, un `argv` n'a pas à deviner ce qu'un utilisateur
 * peut écrire. Toute panne ici est un routage en moins, jamais un prompt bloqué.
 */
function routeInBackground(dir: string, sessionId: string, prompt: string, at: number): void {
  try {
    const entry = process.argv[1];
    if (!entry) return;
    const child = spawn(
      process.execPath,
      [
        entry,
        'route-bg',
        '--dir', dir,
        '--session', sessionId,
        '--prompt64', Buffer.from(prompt.slice(0, 4000), 'utf8').toString('base64'),
        '--at', String(at),
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
  } catch {
    // Pas de routage de fond : le tour suivant repartira du tour précédent.
  }
}

/**
 * Le routage de fond lui-même. Personne ne l'attend, donc il a le droit d'être
 * lent — et il n'écrit que s'il a vraiment routé : un repli n'a rien à mettre
 * dans le cache, il en sort.
 *
 * Il **ajoute aussi son tour au journal** (9 septembre 2026). Sans ça, sous un
 * moteur CLI le journal ne contenait que des `deferred` : la vue affichait
 * « différé » à vie et le seul routage réel de la session n'était visible nulle
 * part. Deux entrées pour un prompt, donc, et le même `at` que celle du hook.
 */
async function cmdRouteBackground(flags: Flags): Promise<number> {
  try {
    const dir = str(flags.dir);
    const encoded = str(flags.prompt64);
    if (!dir || !encoded) return 0;
    const sessionId = str(flags.session) ?? 'default';
    process.env['CONTEXTREE_ROUTER_TIMEOUT_MS'] ??= '120000';

    const tree = await loadTree(dir);
    const previous = await readSelection(dir, sessionId);
    const prompt = Buffer.from(encoded, 'base64').toString('utf8');
    const { selected, reason } = await route(tree, prompt, { previousSelection: previous });
    if (reason !== 'routed') return 0;
    const at = Number(str(flags.at)) || Date.now();
    await writeSelection(dir, sessionId, selected, { at, routed: true });
    await appendTurn(dir, {
      at,
      prompt,
      selected: [...selected],
      reason,
      source: 'bg',
    });
  } catch {
    // Même contrat que le hook : silencieux, code 0.
  }
  return 0;
}

/** D'où vient le routage sur cette machine — dit une fois, en clair : c'est la
 *  question qu'on se pose quand rien ne se charge. */
function describeEngine(): string {
  const engine = pickEngine();
  switch (engine) {
    case 'anthropic':
      return 'clé API Anthropic';
    case 'openai':
      return `endpoint compatible OpenAI — ${process.env['OPENAI_BASE_URL'] ?? 'api.openai.com'}`;
    case 'none':
      return 'aucun moteur — arbre entier injecté (installe un CLI `claude`/`codex`/`gemini`, ou pose ANTHROPIC_API_KEY / OPENAI_API_KEY)';
    default:
      return `CLI \`${engine}\` (ton abonnement) — ${engineBin(engine) ?? 'introuvable'}`;
  }
}

// ── plomberie ────────────────────────────────────────────────────────────────

async function open() {
  const dir = await findTreeDir();
  if (!dir) {
    process.stderr.write(`Aucun ${DIR_NAME}/ trouvé. Lance : contextree init\n`);
    process.exit(1);
  }
  return { dir, tree: await loadTree(dir) };
}

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[] | undefined;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const [key, inline] = splitOnce(arg.slice(2), '=');
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags[key] = argv[++i]!;
      else flags[key] = true;
    } else if (/^-[a-zA-Z]$/.test(arg) && argv[i + 1] !== undefined) {
      // Formes courtes : `-o fichier`, `-m "message"`. La valeur est prise telle
      // quelle — `--nom` reste là pour un texte qui commencerait par un tiret.
      flags[arg.slice(1)] = argv[++i]!;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

const str = (v: string | boolean | string[] | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const out = Buffer.concat(chunks).toString('utf8');
  return out.length ? out : null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
