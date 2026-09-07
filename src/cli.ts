#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { DIR_NAME, findTreeDir, loadTree, slugify, writeBranch, writeRoot, deleteBranch, moveBranch } from './core/store.js';
import { allBranches, formatTree } from './core/tree.js';
import { renderContext, renderTrace } from './core/render.js';
import { route } from './core/router.js';
import { encodePack, extractPack, applyPack } from './core/pack.js';
import { readSelection, writeSelection } from './core/session.js';
import { appendTurn } from './core/journal.js';
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
import { installHook, installMcp, type InstallReport } from './install.js';
import { resolvePack, runStdio } from './mcp/server.js';

const HELP = `contextree — un arbre de contexte partageable, routé, injecté à chaque appel IA.

  contextree init                    crée .contextree/ avec un arbre de démarrage
  contextree install                 câble le serveur MCP + le hook Claude Code
  contextree list                    affiche l'arbre
  contextree add                     crée une branche (--title --type --load-when [--parent])
  contextree rm <chemin>             supprime une branche et ses enfants
  contextree mv <de> <vers>          déplace ou renomme une branche (ses enfants suivent)
  contextree route "<prompt>"        montre ce que le routeur chargerait
  contextree render                  affiche tout l'arbre assemblé (sans routage)
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

Variables : ANTHROPIC_API_KEY (routage), CONTEXTREE_ROUTER_MODEL, CONTEXTREE_ROUTER_TIMEOUT_MS,
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
      return cmdRoute(flags._.join(' '));
    case 'render':
      return cmdRender();
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
    default:
      process.stderr.write(`Commande inconnue : ${command}\n\n${HELP}`);
      return 1;
  }
}

// ── commandes ────────────────────────────────────────────────────────────────

async function cmdInit(force: boolean): Promise<number> {
  const dir = path.join(process.cwd(), DIR_NAME);
  if (!force && (await exists(dir))) {
    process.stderr.write(`${DIR_NAME}/ existe déjà. --force pour réécrire les fichiers de départ.\n`);
    return 1;
  }
  const project = path.basename(process.cwd());
  await writeRoot(dir, `# Contexte — ${project}\n\nCe bloc est injecté à chaque appel. Garde-le court : qui, quoi, dans quel repo.`);
  await writeBranch(dir, {
    path: 'identite',
    type: 'identity',
    title: 'Identité',
    loadWhen: "toujours pertinent — qui est l'assistant sur ce projet",
    content: "Tu assistes sur le projet **" + project + "**.\n\nDécris ici l'expertise attendue et le style de travail.",
  });
  await writeBranch(dir, {
    path: 'regles',
    type: 'rule',
    title: 'Règles du projet',
    loadWhen: 'quand la demande touche au code, aux fichiers ou aux features',
    content: '- Une contrainte dure par ligne.\n- Ce qui est interdit, ce qui est obligatoire.',
  });
  await writeBranch(dir, {
    path: 'architecture',
    type: 'context',
    title: 'Architecture',
    loadWhen: "quand la demande porte sur la structure du projet ou l'endroit où vit un bout de code",
    content: "Vue d'ensemble : les zones du repo et ce qu'elles portent.",
  });
  await writeBranch(dir, {
    path: 'architecture/commandes',
    type: 'reference',
    title: 'Commandes',
    loadWhen: 'quand il faut lancer, tester ou builder le projet',
    content: '```bash\n# à compléter\n```',
  });

  process.stdout.write(
    `${DIR_NAME}/ créé avec 4 branches de départ.\n` +
      `Prochaine étape : édite les fichiers, puis \`contextree install\`.\n`,
  );
  return 0;
}

async function cmdInstall(flags: Flags): Promise<number> {
  const report: InstallReport = [];
  const only = flags.mcp || flags.hook;
  if (!only || flags.mcp) await installMcp(process.cwd(), report);
  if (!only || flags.hook) await installHook(process.cwd(), report);
  for (const r of report) {
    process.stdout.write(`${r.action.padEnd(9)} ${path.relative(process.cwd(), r.file)}\n`);
  }
  process.stdout.write(
    "\nRelance Claude Code pour prendre en compte le hook et le serveur MCP.\n" +
      "Le routage a besoin d'ANTHROPIC_API_KEY dans l'environnement.\n",
  );
  return 0;
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

async function cmdRoute(prompt: string): Promise<number> {
  if (!prompt.trim()) {
    process.stderr.write('Usage : contextree route "<prompt>"\n');
    return 1;
  }
  const { tree } = await open();
  const started = Date.now();
  const { selected, reason, error } = await route(tree, prompt);
  process.stderr.write(
    `${renderTrace(tree, selected, reason)} — ${Date.now() - started} ms${error ? ` — ${error}` : ''}\n\n` +
      `${formatTree(tree, selected)}\n\n`,
  );
  process.stdout.write(`${renderContext(tree, selected)}\n`);
  return 0;
}

async function cmdRender(): Promise<number> {
  const { tree } = await open();
  process.stdout.write(`${renderContext(tree, new Set(tree.order))}\n`);
  return 0;
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
    const { selected, reason, error } = await route(tree, prompt, { previousSelection: previous });
    await writeSelection(dir, sessionId, selected);
    await appendTurn(dir, {
      at: Date.now(),
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
