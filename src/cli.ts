#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { DIR_NAME, findTreeDir, findStrayHomeTree, rescueStrayTree, loadTree, slugify, writeBranch, deleteBranch, moveBranch, initTree, detectInstructionFiles } from './core/store.js';
import { coreText } from './core/messages.js';
import { lintTree, renderShapeWarnings } from './core/lint.js';
import { allBranches, formatTree } from './core/tree.js';
import { renderContext, renderTrace, renderAgentsBlock, renderBootstrapPrompt, renderBootstrapInvite } from './core/render.js';
import { route, pickEngine, isCliEngine, engineBin, withoutRouting, routeInBackground } from './core/router.js';
import { encodePack, extractPack, applyPack } from './core/pack.js';
import { readSelection, writeSelection, claimBootstrapInvite, claimStrayWarning } from './core/session.js';
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
import { AGENTS, agentStatus, installAgent, instructionsBlock, instructionsState, selfCommand, syncInstructionFiles, wantsInstructions, type InstallReport } from './install.js';
import { resolvePack, runStdio } from './mcp/server.js';
import { cliText } from './messages.js';

/** L'aide vit dans le dictionnaire (`messages.ts`) : elle est la première chose
 *  qu'on lit, dans sa langue. */

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  // `--lang` vaut pour toute commande — c'est ce qu'`install` inscrit dans la
  // commande du hook et du serveur MCP. Un `CONTEXTREE_LANG` déjà posé gagne :
  // qui l'a mis dans son environnement l'a voulu.
  const lang = str(flags.lang);
  if (lang && !process.env['CONTEXTREE_LANG']) process.env['CONTEXTREE_LANG'] = lang;
  const t = cliText();

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(t.help);
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
    case 'bootstrap':
      return cmdBootstrap(flags);
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
      return cmdHook(str(flags.agent) ?? 'claude');
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
    case 'rescue':
      return cmdRescue(str(flags.to));
    default:
      process.stderr.write(`${t.unknownCommand(String(command))}\n\n${t.help}`);
      return 1;
  }
}

// ── commandes ────────────────────────────────────────────────────────────────

async function cmdInit(force: boolean): Promise<number> {
  try {
    const { dir, branches } = await initTree(process.cwd(), { force });
    process.stdout.write(`${cliText().initDone(path.relative(process.cwd(), dir), branches)}\n`);
    await syncAfterWrite(dir);
    return 0;
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)} ${cliText().initForceHint}\n`,
    );
    return 1;
  }
}

/**
 * Après une écriture dans l'arbre, le bloc des fichiers de consignes suit —
 * voir `syncInstructionFiles`. Chaque fichier touché est dit.
 */
async function syncAfterWrite(dir: string): Promise<void> {
  const touched = (await syncInstructionFiles(dir)).filter(r => r.action !== 'unchanged');
  for (const r of touched) process.stdout.write(`${cliText().instructionsSynced(shorten(r.file))}\n`);
}

/**
 * Rend à son projet un arbre écrit dans `~/.contextree`, du temps où le dossier
 * d'état portait ce nom. Fichier par fichier, sans rien écraser.
 */
async function cmdRescue(to: string | undefined): Promise<number> {
  const t = cliText();
  if (!to) {
    process.stderr.write(`${t.usageRescue}\n`);
    return 1;
  }
  try {
    const { dir, moved, skipped } = await rescueStrayTree(path.resolve(to));
    if (!moved.length && !skipped.length) {
      process.stdout.write(`${t.rescueNothing(shorten(path.join(os.homedir(), DIR_NAME)))}\n`);
      return 0;
    }
    for (const f of moved) process.stdout.write(`${t.rescueMoved.padEnd(10)} ${f}\n`);
    for (const f of skipped) process.stdout.write(`${t.rescueSkipped.padEnd(10)} ${f}\n`);
    process.stdout.write(`\n${t.rescueDone(moved.length, shorten(dir), skipped.length)}\n`);
    return skipped.length ? 1 : 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
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
  const label = cliText().wiredCommand;
  return (
    `${label}${selfCommand('hook').shell}\n` +
    `${' '.repeat(label.length)}${[mcp.command, ...mcp.args].join(' ')}\n`
  );
}

async function cmdInstall(flags: Flags): Promise<number> {
  const t = cliText();
  const asked = str(flags.agent);
  const statuses = await agentStatus(process.cwd());

  if (flags.status) {
    // Un bloc absent ou périmé se dit fichier par fichier : « câblé » sur un
    // `copilot-instructions.md` dont le catalogue date d'avant l'arbre, c'est
    // un Copilot qui ne lit rien.
    const block = await instructionsBlock(process.cwd());
    for (const a of statuses) {
      const state = a.wired ? t.stateWired : a.detected ? t.stateToWire : t.stateNotDetected;
      process.stdout.write(`${state.padEnd(13)} ${a.label}\n`);
      for (const f of a.files) {
        // Un agent absent de la machine n'a pas de bloc à réclamer.
        const doc = block && (a.detected || a.wired) && f.endsWith('.md') ? await instructionsState(f, block) : 'fresh';
        const note = doc === 'absent' ? t.blockAbsent : doc === 'stale' ? t.blockStale : '';
        process.stdout.write(`              ${shorten(f)}${note ? ` — ${note}` : ''}\n`);
      }
    }
    // Les agents sans surface à câbler existent aussi, et l'outil les sert :
    // le dire ici évite de chercher une ligne « non détecté » qui ne viendra pas.
    process.stdout.write(`\n${t.noSurfaceAgents}\n`);
    const treeDir = await findTreeDir();
    const warnings = treeDir ? renderShapeWarnings(lintTree(await loadTree(treeDir))) : '';
    if (warnings) process.stdout.write(`\n${warnings}\n`);
    const stray = await findStrayHomeTree();
    if (stray.length) process.stdout.write(`\n${coreText().strayTree(shorten(path.join(os.homedir(), DIR_NAME)), stray.length)}\n`);
    process.stdout.write(`\n${wiredCommands()}`);
    process.stdout.write(`${t.routing(describeEngine())}\n`);
    return 0;
  }

  if (asked && asked !== 'all' && !AGENTS.some(a => a.id === asked)) {
    process.stderr.write(`${t.unknownAgent(asked, AGENTS.map(a => a.id).join(', '))}\n`);
    return 1;
  }

  const targets = statuses.filter(a =>
    asked ? asked === 'all' || asked === a.id : a.detected || a.id === 'claude-code',
  );

  // Le bloc de consignes n'est calculé que si un agent en veut un : sans arbre,
  // `install` doit rester possible pour câbler d'abord et créer ensuite.
  //
  // Ils sont quatre à en vouloir un depuis le 11 septembre 2026 — la liste se
  // lit dans le registre plutôt que d'être recopiée ici, sinon un agent ajouté
  // demain recevrait un `AGENTS.md` vide sans que personne ne le remarque.
  const wantBlock = targets.some(a => wantsInstructions(AGENTS.find(x => x.id === a.id)!));
  const block = wantBlock ? await instructionsBlock(process.cwd()) : undefined;

  const report: InstallReport = [];
  for (const a of targets) report.push(...(await installAgent(a.id, process.cwd(), block)));

  for (const r of report) {
    const action = { created: t.actionCreated, updated: t.actionUpdated, repaired: t.actionRepaired, unchanged: t.actionUnchanged }[r.action];
    process.stdout.write(`${action.padEnd(10)} ${shorten(r.file)}${r.note ? ` — ${r.note}` : ''}\n`);
  }

  // Sans arbre, le fichier de consignes ne peut pas être écrit : le dire ici,
  // sinon `--status` répondra « à câbler » sans qu'on comprenne ce qui manque.
  if (!block && wantBlock) {
    process.stdout.write(`\n${t.noInstructionsYet}\n`);
  }

  // Seulement quand on n'a rien demandé de précis : sur `--agent cursor`, les
  // autres ne sont pas « non détectés », ils ne sont pas le sujet.
  const skipped = asked ? [] : statuses.filter(s => !targets.includes(s));
  if (skipped.length) {
    process.stdout.write(`\n${t.skippedAgents(skipped.map(s => s.id).join(', '))}\n`);
  }
  process.stdout.write(`\n${wiredCommands()}`);
  process.stdout.write(`${t.relaunch}\n${t.routing(describeEngine())}\n`);
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
  const t = cliText();
  process.stdout.write(branches.length ? `${formatTree(tree)}\n\n${t.branchCount(branches.length)}\n` : `${t.emptyTree}\n`);
  const warnings = renderShapeWarnings(lintTree(tree));
  if (warnings) process.stdout.write(`\n${warnings}\n`);
  return 0;
}

async function cmdAdd(flags: Flags): Promise<number> {
  const { dir, tree } = await open();
  const title = str(flags.title) ?? flags._[0];
  const type = str(flags.type);
  const loadWhen = str(flags['load-when']);
  if (!title || !type || !loadWhen) {
    process.stderr.write(`${cliText().usageAdd}\n`);
    return 1;
  }
  if (!isBranchType(type)) {
    process.stderr.write(`${cliText().unknownType(type)}\n`);
    return 1;
  }
  const parent = str(flags.parent);
  if (parent && !tree.branches.has(parent)) {
    process.stderr.write(`${cliText().unknownParent(parent)}\n`);
    return 1;
  }
  const content = str(flags.content) ?? (await readStdin()) ?? '';
  const slug = str(flags.path) ?? slugify(title);
  const branchPath = parent ? `${parent}/${slug}` : slug;
  const file = await writeBranch(dir, { path: branchPath, type: type as BranchType, title, loadWhen, content });
  process.stdout.write(`${branchPath}\n${path.relative(process.cwd(), file)}\n`);
  await syncAfterWrite(dir);
  return 0;
}

async function cmdRemove(branchPath: string | undefined): Promise<number> {
  if (!branchPath) {
    process.stderr.write(`${cliText().usageRm}\n`);
    return 1;
  }
  const { dir, tree } = await open();
  if (!tree.branches.has(branchPath)) {
    process.stderr.write(`${cliText().unknownBranch(branchPath)}\n`);
    return 1;
  }
  await deleteBranch(dir, branchPath);
  process.stdout.write(`${cliText().removed(branchPath)}\n`);
  await syncAfterWrite(dir);
  return 0;
}

async function cmdMove(from: string | undefined, to: string | undefined): Promise<number> {
  if (!from || !to) {
    process.stderr.write(`${cliText().usageMv}\n`);
    return 1;
  }
  const { dir, tree } = await open();
  if (!tree.branches.has(from)) {
    process.stderr.write(`${cliText().unknownBranch(from)}\n`);
    return 1;
  }
  // Même garde que `add` : un parent inconnu se crée à la main. Sinon on
  // fabrique un hub implicite dont le `load_when` ne veut rien dire, et le
  // routeur route dessus.
  const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
  if (parent && !tree.branches.has(parent)) {
    process.stderr.write(`${cliText().unknownParent(parent)}\n`);
    return 1;
  }
  const kids = tree.branches.get(from)!.childPaths.length;
  try {
    const file = await moveBranch(dir, from, to);
    process.stdout.write(
      `${from} → ${to}${kids ? cliText().children(kids) : ''}\n${path.relative(process.cwd(), file)}\n`,
    );
    await syncAfterWrite(dir);
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function cmdRoute(prompt: string, flags: Flags): Promise<number> {
  if (flags.eval) return cmdEval(typeof flags.eval === 'string' ? flags.eval : str(flags._[0]));
  if (!prompt.trim()) {
    process.stderr.write(`${cliText().usageRoute}\n`);
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
  const { dir, tree } = await open();
  const target = path.resolve(path.dirname(dir), file ?? EVAL_FILE);

  let cases;
  try {
    cases = parseEvalCases(JSON.parse(await fs.readFile(target, 'utf8')));
  } catch {
    process.stderr.write(`${cliText().evalUnreadable(shorten(target))}\n`);
    return 1;
  }
  if (!cases.length) {
    process.stderr.write(`${cliText().evalEmpty(shorten(target))}\n`);
    return 1;
  }

  process.stderr.write(`${cliText().evalHeader(cases.length, tree.order.length, describeEngine())}\n\n`);

  // Personne n'attend une mesure : `batch` laisse au moteur le temps de
  // répondre. Sans ça, on mesure le timeout au lieu du routeur — 9 cas sur 20
  // tombés dans le repli « arbre entier » à la première mesure, le 9 septembre
  // 2026.
  const report = await evaluateRouting(tree, cases, p => route(tree, p, { waiter: 'batch' }));
  process.stdout.write(formatEval(report));
  return 0;
}

/** Une ligne par cas — `●` attendu et obtenu, `+` en trop, `−` manquant — puis
 *  le total. Les titres, pas les chemins : c'est ce que montrent les vues. */
function formatEval(report: EvalReport): string {
  const t = cliText();
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
    if (c.unknown.length) out.push(`   ? ${c.unknown.join(', ')} — ${t.evalNotInTree}`);
    if (c.error) out.push(`   ! ${c.error}`);
  }
  const pct = (n: number): string => `${Math.round(n * 100)} %`;
  out.push('');
  out.push(t.evalTotals(pct(report.precision), pct(report.recall), report.avgMs));
  out.push(t.evalLegend);
  return `${out.join('\n')}\n`;
}

/**
 * La consigne pour construire l'arbre, à donner à son IA.
 *
 * Pour les agents qui n'exposent pas les prompts MCP : on colle. Même texte que
 * le prompt `bootstrap` du serveur — `renderBootstrapPrompt` est la seule
 * copie. Ne demande pas d'arbre : c'est précisément la commande d'avant.
 */
async function cmdBootstrap(flags: Flags): Promise<number> {
  const found = await detectInstructionFiles(process.cwd());
  process.stderr.write(
    `${found.length ? cliText().bootstrapFound(found.join(', ')) : cliText().bootstrapNone}\n`,
  );
  return emit(renderBootstrapPrompt(found), Boolean(flags.copy));
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
    process.stderr.write(`${cliText().copied(text.length)}\n`);
    return 0;
  }
  if (copy) process.stderr.write(`${cliText().clipboardUnavailable}\n`);
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
      const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
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
    process.stdout.write(`${cliText().exported(pack.branches.length, out)}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
  return 0;
}

async function cmdImport(flags: Flags): Promise<number> {
  const source = flags._[0];
  if (!source) {
    process.stderr.write(`${cliText().usageImport}\n`);
    return 1;
  }
  const dir = (await findTreeDir()) ?? path.join(process.cwd(), DIR_NAME);
  const pack = await resolvePack(source);
  const written = await applyPack(dir, pack, { prefix: str(flags.prefix), mergeRoot: true });
  process.stdout.write(`${cliText().imported(written.length, path.relative(process.cwd(), dir))}\n`);
  await syncAfterWrite(dir);
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
    process.stderr.write(`${cliText().usageRemote}\n`);
    return 1;
  }
  const stored = await setRemoteConfig({ url, anonKey });
  process.stdout.write(`${cliText().backend(stored.config.url)}\n${stored.file}\n`);
  return 0;
}

async function cmdLogin(email: string | undefined, password: string | undefined): Promise<number> {
  if (!email) {
    process.stderr.write(`${cliText().usageLogin}\n`);
    return 1;
  }
  // Un mot de passe sur la ligne de commande finit dans l'historique du shell :
  // stdin est le chemin par défaut, `--password` reste possible pour un script.
  const secret = password ?? (await readStdin())?.trim();
  if (!secret) {
    process.stderr.write(`${cliText().passwordExpected}\n`);
    return 1;
  }
  return remote(async () => {
    const session = await signIn(email, secret);
    process.stdout.write(`${cliText().loggedIn(session.email ?? session.userId)}\n`);
  });
}

async function cmdLogout(): Promise<number> {
  await signOut();
  process.stdout.write(`${cliText().loggedOut}\n`);
  return 0;
}

async function cmdWhoami(): Promise<number> {
  return remote(async () => {
    const account = await me();
    if (!account) {
      process.stdout.write(`${cliText().nobodyLoggedIn}\n`);
      return;
    }
    process.stdout.write(`${account.email ?? account.id}\n`);
    const groups = await myGroups();
    if (!groups.length) {
      process.stdout.write(`${cliText().noGroups}\n`);
      return;
    }
    for (const g of groups) process.stdout.write(`  ${g.slug} — ${g.name} (${g.role})\n`);
  });
}

async function cmdGroup(args: string[]): Promise<number> {
  const [sub, slug, ...rest] = args;
  if (sub !== 'new' || !slug) {
    process.stderr.write(`${cliText().usageGroup}\n`);
    return 1;
  }
  const name = rest.join(' ') || slug;
  return remote(async () => {
    const group = await createGroup(slug, name);
    process.stdout.write(`${cliText().groupCreated(group.slug, group.name, group.role)}\n`);
  });
}

async function cmdLink(target: string | undefined, create: boolean): Promise<number> {
  const [groupSlug, treeSlug] = (target ?? '').split('/');
  if (!groupSlug || !treeSlug) {
    process.stderr.write(`${cliText().usageLink}\n`);
    return 1;
  }
  const { dir } = await open();
  return remote(async () => {
    const tracking = await link(dir, groupSlug, treeSlug, { create });
    process.stdout.write(`${cliText().linked(`${tracking.groupSlug}/${tracking.treeSlug}`)}\n`);
  });
}

async function cmdStatus(): Promise<number> {
  const { dir } = await open();
  const tracking = await readTracking(dir);
  if (!tracking) {
    process.stdout.write(`${cliText().notLinked}\n`);
    return 0;
  }
  process.stdout.write(
    `${tracking.groupSlug}/${tracking.treeSlug}\n` +
      `${cliText().base(tracking.baseVersionId ?? null)}\n`,
  );
  return 0;
}

async function cmdPull(resolve?: 'mine' | 'theirs'): Promise<number> {
  const { dir } = await open();
  let code = 0;
  const result = await remote(async () => {
    const report = await pull(dir, resolve ? { resolve } : {});
    if (report.status === 'vierge') {
      process.stdout.write(`${cliText().remoteBlank}\n`);
      return;
    }
    if (report.status === 'à jour') {
      process.stdout.write(`${cliText().upToDate}\n`);
      return;
    }
    // Un conflit se montre, il ne se tranche pas à ta place. Rien n'a été écrit.
    if (report.status === 'conflit') {
      process.stderr.write(`${cliText().conflicts(report.conflicts)}\n`);
      code = 1;
      return;
    }
    for (const d of report.incoming) process.stdout.write(`  ↓ ${d.kind.padEnd(9)} ${d.path}\n`);
    for (const p of report.kept) process.stdout.write(`  = ${cliText().kept} ${p}\n`);
    process.stdout.write(`${cliText().pulled(report.incoming.length, report.kept.length)}\n`);
  });
  return result || code;
}

async function cmdPush(message: string | undefined): Promise<number> {
  if (!message) {
    process.stderr.write(`${cliText().usagePush}\n`);
    return 1;
  }
  const { dir } = await open();
  let code = 0;
  const result = await remote(async () => {
    const report = await push(dir, message);
    if (report.status === 'rien à pousser') {
      process.stdout.write(`${cliText().nothingToPush}\n`);
      return;
    }
    if (report.status === 'en retard') {
      process.stderr.write(`${cliText().behind}\n`);
      code = 1;
      return;
    }
    for (const d of report.outgoing) process.stdout.write(`  ↑ ${d.kind.padEnd(9)} ${d.path}\n`);
    process.stdout.write(`${cliText().pushed(report.outgoing.length)}\n`);
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

/**
 * Les dialectes de hook — **même cœur, trois enveloppes**.
 *
 * Vérifié le 11 septembre 2026 : Gemini CLI (`BeforeAgent`) lit le *même*
 * payload que Claude Code — `prompt`, `cwd`, `session_id` — et c'est seulement
 * la **sortie** qui diffère. Claude Code et Codex prennent le texte brut ;
 * Gemini veut du JSON, et **rien d'autre** sur stdout.
 *
 * D'où une table de deux enveloppes plutôt qu'un `cmdHook` par agent : ce qui
 * varie tient en une fonction d'une ligne, et tout le reste — routage différé,
 * journal, cache de session, invitation sans arbre — doit rester rigoureusement
 * identique. Trois copies auraient divergé au premier correctif, et la divergence
 * se serait vue sur l'agent qu'on teste le moins.
 *
 * **L'invariant compte double ici** : sous Gemini, un code de sortie 2 *bloque*
 * le tour et efface le prompt. Sortir en 0 quoi qu'il arrive n'est plus
 * seulement une politesse, c'est ce qui sépare un contexte manquant d'un prompt
 * perdu.
 *
 * `codex` partage l'enveloppe texte de Claude Code. Sa config n'est pas écrite
 * par `install` — la doc ne confirme pas l'événement — mais le dialecte existe :
 * qui active le hook à la main ne tombe pas sur un agent inconnu.
 */
const HOOK_DIALECTS: Record<string, (block: string) => string> = {
  claude: block => `${block}\n`,
  codex: block => `${block}\n`,
  // `additionalContext` est ajouté au prompt du tour, et rien d'autre ne doit
  // sortir sur stdout : la trace continue de partir sur stderr.
  gemini: block =>
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: block },
    })}\n`,
};

async function cmdHook(agent: string): Promise<number> {
  // Un agent inconnu retombe sur le texte brut plutôt que de lever : le hook ne
  // bloque jamais un prompt, pas même pour un drapeau mal tapé.
  const envelope = HOOK_DIALECTS[agent] ?? HOOK_DIALECTS['claude']!;
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

    // Un arbre égaré dans `~/.contextree` : dit une fois par session, en tête
    // de ce que le hook écrit — c'est le seul canal que le modèle lit. Dans la
    // même enveloppe que le reste : Gemini n'accepte qu'un objet JSON.
    const stray = await findStrayHomeTree();
    const warning =
      stray.length && (await claimStrayWarning(cwd, sessionId))
        ? coreText().strayTree(path.join(os.homedir(), DIR_NAME), stray.length)
        : '';
    const write = (...parts: string[]): void => {
      const body = [warning, ...parts].filter(Boolean).join('\n\n');
      if (body) process.stdout.write(envelope(body));
    };

    const dir = await findTreeDir(cwd);
    // Pas d'arbre : on ne se tait plus, on invite — une fois par session.
    //
    // Le hook sortait en silence, et l'utilisateur qui n'a jamais lancé `init`
    // ne pouvait pas apprendre que l'arbre existe : l'outil restait invisible
    // depuis l'endroit même où il sert. On propose, on ne crée pas. Et le hook
    // n'est installé que par projet, donc rien ne fuit vers un dépôt qui n'a
    // rien demandé.
    if (!dir) {
      if (await claimBootstrapInvite(cwd, sessionId)) {
        // L'invitation passe par l'enveloppe comme le reste : sous Gemini, du
        // texte nu sur stdout casserait le JSON qu'il attend.
        write(renderBootstrapInvite(await detectInstructionFiles(cwd)));
      } else write();
      return 0;
    }
    const tree = await loadTree(dir);
    if (!tree.order.length && !tree.rootContent.trim()) {
      write();
      return 0;
    }

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

    const { selected, reason, error, engine } = deferred
      ? { selected: withoutRouting(tree, previous), reason: 'deferred' as const, error: undefined, engine: undefined }
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
      ...(engine ? { engine } : {}),
    });

    write(renderContext(tree, selected));
    // La trace part sur stderr, pour les trois : l'inverser polluerait le
    // contexte du modèle, et casserait le JSON de Gemini.
    process.stderr.write(`${renderTrace(tree, selected, reason)}\n`);
  } catch {
    // Silence délibéré : un contexte manquant est un désagrément, un prompt
    // bloqué est une panne.
  }
  return 0;
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

    const tree = await loadTree(dir);
    const previous = await readSelection(dir, sessionId);
    const prompt = Buffer.from(encoded, 'base64').toString('utf8');
    const { selected, reason, engine } = await route(tree, prompt, { previousSelection: previous, waiter: 'batch' });
    if (reason !== 'routed') return 0;
    const at = Number(str(flags.at)) || Date.now();
    await writeSelection(dir, sessionId, selected, { at, routed: true });
    await appendTurn(dir, {
      at,
      prompt,
      selected: [...selected],
      reason,
      source: 'bg',
      ...(engine ? { engine } : {}),
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
  const t = cliText();
  switch (engine) {
    case 'anthropic':
      return t.engineAnthropic;
    case 'openai':
      return t.engineOpenai(process.env['OPENAI_BASE_URL'] ?? 'api.openai.com');
    case 'sampling':
      // Seulement forcé : hors du serveur MCP, il n'y a pas de client à qui le demander.
      return t.engineSampling;
    case 'none':
      return t.engineNone;
    default:
      return t.engineCli(engine, engineBin(engine));
  }
}

// ── plomberie ────────────────────────────────────────────────────────────────

async function open() {
  const dir = await findTreeDir();
  if (!dir) {
    process.stderr.write(`${cliText().noTree(DIR_NAME)}\n`);
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
