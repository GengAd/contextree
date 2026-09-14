import { pick, type Dictionary } from './core/i18n.js';

/**
 * Les textes de la CLI et d'`install`, en français et en anglais.
 *
 * Même règle que `core/messages.ts` : le français donne la forme, l'anglais la
 * remplit clé pour clé, et une clé oubliée casse le typecheck. Les identifiants
 * restent tels quels dans les deux langues — noms de commandes, drapeaux, types
 * de branche, variables d'environnement : ce sont eux qu'on tape.
 *
 * Hors de ce dictionnaire, et **volontairement** : les messages d'erreur du
 * backend (`core/remote.ts`, `core/sync.ts`) restent en français tant que le
 * serveur (P7) n'est pas en service — personne ne les voit encore.
 */
const fr = {
  help: `contextree — un arbre de contexte partageable, routé, injecté à chaque appel IA.

  contextree init                    crée .contextree/ avec un arbre de démarrage
  contextree install [--agent a]     câble l'injection (--status pour voir l'état)
  contextree list                    affiche l'arbre
  contextree add                     crée une branche (--title --type --load-when [--parent])
  contextree rm <chemin>             supprime une branche et ses enfants
  contextree mv <de> <vers>          déplace ou renomme une branche (ses enfants suivent)
  contextree route "<prompt>"        montre ce que le routeur chargerait
  contextree route --eval [fichier]  mesure le routage sur un jeu de prompts
  contextree bootstrap [--copy]      la consigne pour que ton IA construise l'arbre
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

Langue :  --lang fr|en sur toute commande, ou CONTEXTREE_LANG. Par défaut, celle du système.

Routage : aucune clé requise si un CLI d'agent (\`claude\`, \`codex\`, \`gemini\`) est
          installé — c'est ton abonnement qui route. Une clé (ANTHROPIC_API_KEY,
          OPENAI_API_KEY) est utilisée si elle est là.

Variables : CONTEXTREE_ROUTER (auto | anthropic | openai | claude | codex | gemini | off),
            CONTEXTREE_ROUTER_MODEL, CONTEXTREE_ROUTER_TIMEOUT_MS,
            OPENAI_API_KEY / OPENAI_BASE_URL, CONTEXTREE_CLAUDE_BIN,
            CONTEXTREE_LANG, CONTEXTREE_STATE_DIR (où vit le journal des tours)
`,
  unknownCommand: (cmd: string) => `Commande inconnue : ${cmd}`,
  noTree: (dir: string) => `Aucun ${dir}/ trouvé. Lance : contextree init`,

  initDone: (dir: string, n: number) =>
    `${dir}/ créé avec ${n} branches de départ.\nProchaine étape : édite les fichiers, puis \`contextree install\`.`,
  initForceHint: '--force pour réécrire les fichiers de départ.',

  wiredCommand: 'Commande écrite : ',
  stateWired: 'câblé',
  stateToWire: 'à câbler',
  stateNotDetected: 'non détecté',
  noSurfaceAgents:
    'ChatGPT / Claude web : rien à câbler — `contextree render --copy`,\n' +
    '                      ou `contextree route "<ta demande>" --copy`.',
  routing: (engine: string) => `Routage : ${engine}`,
  unknownAgent: (id: string, known: string) => `Agent inconnu : ${id} (${known}, all)`,
  actionCreated: 'créé',
  actionUpdated: 'mis à jour',
  actionRepaired: 'réparé',
  actionUnchanged: 'inchangé',
  noInstructionsYet:
    "Pas encore de fichier de consignes : il se remplit depuis l'arbre, qui n'existe pas ici.\n" +
    'Crée-le (ou laisse ton IA te le proposer), puis relance `install` — ces agents\n' +
    "resteront « à câbler » d'ici là, et c'est exact : la moitié de leur surface manque.",
  skippedAgents: (ids: string) => `Non câblé (non détecté) : ${ids} — \`--agent <id>\` pour forcer.`,
  relaunch:
    'Relance ton agent pour prendre en compte le hook et le serveur MCP.\n' +
    'Aucune de ces surfaces (Claude sur le web, ChatGPT…) : `contextree render --copy`,\n' +
    'ou `contextree route "<ta demande>" --copy`, et tu colles.',
  machinePathsNote: 'contient des chemins de cette machine — ne le commite pas',
  noCli: (nodeMissing: boolean) =>
    "contextree n'est pas installé en ligne de commande sur cette machine" +
    (nodeMissing ? ' (node introuvable)' : '') +
    ' : le bouton écrirait une commande qui ne lance rien. Installe-le — ' +
    '`npm install -g <le .tgz de contextree>` — puis recommence.',
  unknownAgentId: (id: string) => `Agent inconnu : ${id}`,

  branchCount: (n: number) => `${n} branche(s).`,
  emptyTree: 'Arbre vide.',
  usageAdd: 'Usage : contextree add --title "…" --type rule --load-when "…" [--parent p] [--content "…"]',
  unknownType: (type: string) => `Type inconnu : ${type} (identity, rule, context, reference, skill)`,
  unknownParent: (p: string) => `Parent inconnu : ${p}`,
  usageRm: 'Usage : contextree rm <chemin>',
  unknownBranch: (p: string) => `Branche inconnue : ${p}`,
  removed: (p: string) => `Supprimé : ${p}`,
  usageMv: 'Usage : contextree mv <de> <vers>',
  children: (n: number) => ` (+ ${n} enfant(s))`,
  usageRoute: 'Usage : contextree route "<prompt>"',

  evalUnreadable: (file: string) => `Jeu d'éval illisible : ${file}`,
  evalEmpty: (file: string) => `Aucun cas dans ${file}`,
  evalHeader: (cases: number, branches: number, engine: string) => `${cases} cas · ${branches} branches · ${engine}`,
  evalNotInTree: "absent de l'arbre",
  evalTotals: (precision: string, recall: string, ms: number) =>
    `précision ${precision} · rappel ${recall} · ${ms} ms en moyenne`,
  evalLegend: 'précision = ce qui a été chargé et servait ; rappel = ce qui servait et a été chargé.',

  bootstrapFound: (files: string) => `Fichiers de consignes trouvés : ${files}`,
  bootstrapNone: 'Aucun fichier de consignes trouvé — la consigne fera lire le dépôt.',
  copied: (n: number) => `${n} caractères copiés dans le presse-papier.`,
  clipboardUnavailable: 'Presse-papier indisponible — sortie sur stdout.',
  exported: (n: number, out: string) => `${n} branche(s) → ${out}`,
  usageImport: 'Usage : contextree import <jeton|fichier.json> [--prefix equipe]',
  imported: (n: number, dir: string) => `${n} branche(s) importée(s) dans ${dir}/`,

  usageRemote: 'Usage : contextree remote <url> <clé anon>',
  backend: (url: string) => `Backend : ${url}`,
  usageLogin: 'Usage : contextree login <email> [--password <mdp>]',
  passwordExpected: 'Mot de passe attendu sur stdin, ou via --password.',
  loggedIn: (who: string) => `Connecté : ${who}`,
  loggedOut: 'Session fermée.',
  nobodyLoggedIn: "Personne n'est connecté. Lance : contextree login <email>",
  noGroups: 'Aucun groupe. Lance : contextree group new <slug> <nom>',
  usageGroup: 'Usage : contextree group new <slug> <nom>',
  groupCreated: (slug: string, name: string, role: string) => `Groupe créé : ${slug} — ${name} (${role})`,
  usageLink: 'Usage : contextree link <groupe>/<arbre> [--create]',
  linked: (target: string) => `Rattaché à ${target}\nLance : contextree pull`,
  notLinked: 'Copie de travail non rattachée.\nLance : contextree link <groupe>/<arbre> [--create]',
  base: (id: string | null) => `base : ${id ?? "(aucune — rien n'a encore été poussé ni récupéré)"}`,
  remoteBlank: "L'arbre distant est vierge. Lance : contextree push -m \"…\"",
  upToDate: 'Déjà à jour.',
  conflicts: (paths: string[]) =>
    `${paths.length} branche(s) modifiée(s) des deux côtés — rien n'a été écrit :\n` +
    paths.map(p => `  ✗ ${p}\n`).join('') +
    '\nRègle chacune à la main en éditant son .md, puis tranche en une fois :\n' +
    '  contextree pull --mine     garde ta version des branches en conflit\n' +
    '  contextree pull --theirs   prend celle du groupe',
  kept: 'gardée   ',
  pulled: (incoming: number, kept: number) => `${incoming} branche(s) récupérée(s), ${kept} gardée(s).`,
  usagePush: 'Usage : contextree push -m "<message>"',
  nothingToPush: 'Rien à pousser.',
  behind:
    'Le distant a avancé depuis ta dernière synchronisation.\n' +
    "Lance `contextree pull` d'abord — pousser écraserait le travail de quelqu'un d'autre.",
  pushed: (n: number) => `Poussé : ${n} changement(s).`,

  engineAnthropic: 'clé API Anthropic',
  engineOpenai: (base: string) => `endpoint compatible OpenAI — ${base}`,
  engineSampling:
    "sampling MCP — le modèle du client, disponible seulement dans le serveur MCP : `route` et `route --eval` ne peuvent pas s'en servir, ils tomberont dans le repli",
  engineNone:
    'aucun moteur — arbre entier injecté (installe un CLI `claude`/`codex`/`gemini`, ou pose ANTHROPIC_API_KEY / OPENAI_API_KEY)',
  engineCli: (engine: string, bin: string | null) => `CLI \`${engine}\` (ton abonnement) — ${bin ?? 'introuvable'}`,
};

const en: Dictionary<typeof fr> = {
  help: `contextree — a shareable context tree, routed and injected into every AI call.

  contextree init                    creates .contextree/ with a starter tree
  contextree install [--agent a]     wires injection (--status to see the state)
  contextree list                    shows the tree
  contextree add                     creates a branch (--title --type --load-when [--parent])
  contextree rm <path>               deletes a branch and its children
  contextree mv <from> <to>          moves or renames a branch (its children follow)
  contextree route "<prompt>"        shows what the router would load
  contextree route --eval [file]     measures routing on a set of prompts
  contextree bootstrap [--copy]      the instructions for your AI to build the tree
  contextree render [--agents]       prints the whole assembled tree (no routing)
                                     --agents: the short block for an AGENTS.md
                                     --copy:   to the clipboard (render, route)
  contextree export [--token] [-o f] exports the tree to share it
  contextree import <source>         grafts a pack (token, JSON, or file) [--prefix p]
  contextree mcp                     starts the MCP server (stdio)
  contextree hook                    entry point for the UserPromptSubmit hook

Shared context (phase 2):
  contextree remote <url> <key>      points to the Supabase backend
  contextree login <email>           signs in (password on stdin or --password)
  contextree logout                  closes the session
  contextree whoami                  who is signed in, and in which groups
  contextree group new <slug> <name> creates a group (you become its owner)
  contextree link <grp>/<tree>       links this working copy [--create]
  contextree pull [--mine|--theirs]  fetches the group tree (merge, never overwrite)
  contextree push -m "<message>"     pushes your local changes
  contextree status                  what this working copy tracks

Language: --lang fr|en on any command, or CONTEXTREE_LANG. Defaults to the system language.

Routing:  no key needed if an agent CLI (\`claude\`, \`codex\`, \`gemini\`) is
          installed — your subscription does the routing. A key (ANTHROPIC_API_KEY,
          OPENAI_API_KEY) is used when present.

Variables: CONTEXTREE_ROUTER (auto | anthropic | openai | claude | codex | gemini | off),
           CONTEXTREE_ROUTER_MODEL, CONTEXTREE_ROUTER_TIMEOUT_MS,
           OPENAI_API_KEY / OPENAI_BASE_URL, CONTEXTREE_CLAUDE_BIN,
           CONTEXTREE_LANG, CONTEXTREE_STATE_DIR (where the turn log lives)
`,
  unknownCommand: cmd => `Unknown command: ${cmd}`,
  noTree: dir => `No ${dir}/ found. Run: contextree init`,

  initDone: (dir, n) => `${dir}/ created with ${n} starter branches.\nNext step: edit the files, then \`contextree install\`.`,
  initForceHint: '--force to rewrite the starter files.',

  wiredCommand: 'Command written: ',
  stateWired: 'wired',
  stateToWire: 'to wire',
  stateNotDetected: 'not detected',
  noSurfaceAgents:
    'ChatGPT / Claude web: nothing to wire — `contextree render --copy`,\n' +
    '                     or `contextree route "<your request>" --copy`.',
  routing: engine => `Routing: ${engine}`,
  unknownAgent: (id, known) => `Unknown agent: ${id} (${known}, all)`,
  actionCreated: 'created',
  actionUpdated: 'updated',
  actionRepaired: 'repaired',
  actionUnchanged: 'unchanged',
  noInstructionsYet:
    'No instructions file yet: it is filled from the tree, which does not exist here.\n' +
    'Create it (or let your AI offer to), then run `install` again — these agents\n' +
    'will stay "to wire" until then, and rightly so: half of their surface is missing.',
  skippedAgents: ids => `Not wired (not detected): ${ids} — \`--agent <id>\` to force.`,
  relaunch:
    'Restart your agent so it picks up the hook and the MCP server.\n' +
    'None of these surfaces (Claude on the web, ChatGPT…): `contextree render --copy`,\n' +
    'or `contextree route "<your request>" --copy`, then paste.',
  machinePathsNote: 'contains paths from this machine — do not commit it',
  noCli: nodeMissing =>
    'contextree is not installed as a command on this machine' +
    (nodeMissing ? ' (node not found)' : '') +
    ': the button would write a command that launches nothing. Install it — ' +
    '`npm install -g <the contextree .tgz>` — then try again.',
  unknownAgentId: id => `Unknown agent: ${id}`,

  branchCount: n => `${n} branch(es).`,
  emptyTree: 'Empty tree.',
  usageAdd: 'Usage: contextree add --title "…" --type rule --load-when "…" [--parent p] [--content "…"]',
  unknownType: type => `Unknown type: ${type} (identity, rule, context, reference, skill)`,
  unknownParent: p => `Unknown parent: ${p}`,
  usageRm: 'Usage: contextree rm <path>',
  unknownBranch: p => `Unknown branch: ${p}`,
  removed: p => `Deleted: ${p}`,
  usageMv: 'Usage: contextree mv <from> <to>',
  children: n => ` (+ ${n} child(ren))`,
  usageRoute: 'Usage: contextree route "<prompt>"',

  evalUnreadable: file => `Unreadable eval set: ${file}`,
  evalEmpty: file => `No cases in ${file}`,
  evalHeader: (cases, branches, engine) => `${cases} cases · ${branches} branches · ${engine}`,
  evalNotInTree: 'not in the tree',
  evalTotals: (precision, recall, ms) => `precision ${precision} · recall ${recall} · ${ms} ms on average`,
  evalLegend: 'precision = what was loaded and was needed; recall = what was needed and was loaded.',

  bootstrapFound: files => `Instruction files found: ${files}`,
  bootstrapNone: 'No instruction file found — the instructions will have the repo read.',
  copied: n => `${n} characters copied to the clipboard.`,
  clipboardUnavailable: 'Clipboard unavailable — writing to stdout.',
  exported: (n, out) => `${n} branch(es) → ${out}`,
  usageImport: 'Usage: contextree import <token|file.json> [--prefix team]',
  imported: (n, dir) => `${n} branch(es) imported into ${dir}/`,

  usageRemote: 'Usage: contextree remote <url> <anon key>',
  backend: url => `Backend: ${url}`,
  usageLogin: 'Usage: contextree login <email> [--password <pwd>]',
  passwordExpected: 'Password expected on stdin, or via --password.',
  loggedIn: who => `Signed in: ${who}`,
  loggedOut: 'Session closed.',
  nobodyLoggedIn: 'Nobody is signed in. Run: contextree login <email>',
  noGroups: 'No group. Run: contextree group new <slug> <name>',
  usageGroup: 'Usage: contextree group new <slug> <name>',
  groupCreated: (slug, name, role) => `Group created: ${slug} — ${name} (${role})`,
  usageLink: 'Usage: contextree link <group>/<tree> [--create]',
  linked: target => `Linked to ${target}\nRun: contextree pull`,
  notLinked: 'Working copy not linked.\nRun: contextree link <group>/<tree> [--create]',
  base: id => `base: ${id ?? '(none — nothing has been pushed or pulled yet)'}`,
  remoteBlank: 'The remote tree is empty. Run: contextree push -m "…"',
  upToDate: 'Already up to date.',
  conflicts: paths =>
    `${paths.length} branch(es) changed on both sides — nothing was written:\n` +
    paths.map(p => `  ✗ ${p}\n`).join('') +
    '\nResolve each one by hand by editing its .md, then decide in one go:\n' +
    '  contextree pull --mine     keep your version of the conflicting branches\n' +
    "  contextree pull --theirs   take the group's version",
  kept: 'kept     ',
  pulled: (incoming, kept) => `${incoming} branch(es) fetched, ${kept} kept.`,
  usagePush: 'Usage: contextree push -m "<message>"',
  nothingToPush: 'Nothing to push.',
  behind:
    'The remote has moved since your last sync.\n' +
    "Run `contextree pull` first — pushing would overwrite someone else's work.",
  pushed: n => `Pushed: ${n} change(s).`,

  engineAnthropic: 'Anthropic API key',
  engineOpenai: base => `OpenAI-compatible endpoint — ${base}`,
  engineSampling:
    "MCP sampling — the client's model, only available inside the MCP server: `route` and `route --eval` cannot use it and will fall back",
  engineNone:
    'no engine — whole tree injected (install a `claude`/`codex`/`gemini` CLI, or set ANTHROPIC_API_KEY / OPENAI_API_KEY)',
  engineCli: (engine, bin) => `\`${engine}\` CLI (your subscription) — ${bin ?? 'not found'}`,
};

export const CLI_MESSAGES = { fr, en };

/** Les textes de la CLI dans la langue courante. */
export function cliText(): typeof fr {
  return pick(CLI_MESSAGES);
}
