import { pick, type Dictionary, type Lang } from './i18n.js';

/**
 * Les textes du cœur qu'un humain lit : erreurs du store, du routeur et des
 * packs, et l'arbre de départ d'`init`.
 *
 * Le français donne la forme ; l'anglais doit la remplir clé pour clé (voir
 * `Dictionary`). Ce que lit un **modèle** — le bloc injecté, la consigne
 * `bootstrap` — vit dans `modelMessages.ts` : ses formulations ont été
 * mesurées, et on ne les relit pas avec les mêmes yeux qu'un message d'erreur.
 */
const fr = {
  // store
  moveUnderItself: (target: string, source: string) => `Déplacement impossible : ${target} est sous ${source}.`,
  branchNotFound: (p: string) => `Branche introuvable : ${p}`,
  targetTaken: (target: string) => `Une branche occupe déjà ${target}.`,
  pathRefused: (p: string) => `Chemin de branche refusé : ${p}`,
  treeExists: (dir: string) => `${dir}/ existe déjà.`,
  homeRefused: (dir: string) =>
    `Refusé : ${dir} est le dossier utilisateur. Un arbre y serait lu par tous les projets qu'il contient — ouvre le dossier du projet et crée l'arbre là.`,
  strayTree: (dir: string, n: number) =>
    `⚠ Un arbre a été écrit dans ${dir} par erreur (${n} fichier(s)) : ce dossier n'est l'arbre d'aucun projet, et contextree ne le lit plus. ` +
    "Dis-le à l'utilisateur. Pour le rendre à son projet : `contextree rescue --to <dossier du projet>` — rien n'est écrasé.",
  gitignoreComment: '# contextree : le calque personnel ne se partage pas',
  defaultSlug: 'branche',

  // pack
  packUnreadable: 'Jeton contextree illisible (payload corrompu).',
  packUnknownFormat: 'Format de pack non reconnu.',
  packInvalidBranch: (p: string) => `Branche invalide dans le pack : ${p}`,
  packNoPath: '(sans path)',

  // routeur — ce que disent `error` et la ligne de transparence
  routerNoEngine:
    'aucun moteur de routage (ni clé API, ni client MCP qui propose le sampling, ni CLI `claude`/`codex`/`gemini`) — arbre entier injecté',
  routerUnreadable: 'routeur : réponse illisible',
  routerError: (msg: string) => `routeur : ${msg}`,
  routerNoSampler: 'sampling : aucun client MCP ne le propose ici (seul le serveur MCP peut le demander)',
  routerRefusal: 'refus',
  routerHttp: (status: number, base: string) => `HTTP ${status} sur ${base}`,
  routerCliMissing: (bin: string) => `CLI \`${bin}\` introuvable`,
  routerTimeout: (ms: number) => `budget de ${ms} ms dépassé`,
  routerExitCode: (bin: string, code: number | null, first: string) => `${bin} : code ${code}${first ? ` — ${first}` : ''}`,

  // arbre de départ — l'arbre d'aujourd'hui, à l'identique
  starterRoot: (project: string) =>
    `# Contexte — ${project}\n\nCe bloc est injecté à chaque appel. Garde-le court : qui, quoi, dans quel repo.`,
  starterIdentityPath: 'identite',
  starterIdentityTitle: 'Identité',
  starterIdentityLoadWhen: "toujours pertinent — qui est l'assistant sur ce projet",
  starterIdentityContent: (project: string) =>
    `Tu assistes sur le projet **${project}**.\n\nDécris ici l'expertise attendue et le style de travail.`,
  starterRulesPath: 'regles',
  starterRulesTitle: 'Règles du projet',
  starterRulesLoadWhen: 'quand la demande touche au code, aux fichiers ou aux features',
  starterRulesContent: '- Une contrainte dure par ligne.\n- Ce qui est interdit, ce qui est obligatoire.',
  starterArchPath: 'architecture',
  starterArchTitle: 'Architecture',
  starterArchLoadWhen: "quand la demande porte sur la structure du projet ou l'endroit où vit un bout de code",
  starterArchContent: "Vue d'ensemble : les zones du repo et ce qu'elles portent.",
  starterCommandsPath: 'architecture/commandes',
  starterCommandsTitle: 'Commandes',
  starterCommandsLoadWhen: 'quand il faut lancer, tester ou builder le projet',
  starterCommandsContent: '```bash\n# à compléter\n```',
};

const en: Dictionary<typeof fr> = {
  moveUnderItself: (target, source) => `Cannot move: ${target} is under ${source}.`,
  branchNotFound: p => `Branch not found: ${p}`,
  targetTaken: target => `A branch already exists at ${target}.`,
  pathRefused: p => `Branch path refused: ${p}`,
  treeExists: dir => `${dir}/ already exists.`,
  homeRefused: dir =>
    `Refused: ${dir} is the home folder. A tree there would be read by every project inside it — open the project folder and create the tree there.`,
  strayTree: (dir, n) =>
    `⚠ A tree was written to ${dir} by mistake (${n} file(s)): that folder is no project's tree, and contextree no longer reads it. ` +
    'Tell the user. To give it back to its project: `contextree rescue --to <project folder>` — nothing is overwritten.',
  gitignoreComment: '# contextree: the personal layer is never shared',
  defaultSlug: 'branch',

  packUnreadable: 'Unreadable contextree token (corrupted payload).',
  packUnknownFormat: 'Unrecognized pack format.',
  packInvalidBranch: p => `Invalid branch in pack: ${p}`,
  packNoPath: '(no path)',

  routerNoEngine:
    'no routing engine (no API key, no MCP client offering sampling, no `claude`/`codex`/`gemini` CLI) — whole tree injected',
  routerUnreadable: 'router: unreadable answer',
  routerError: msg => `router: ${msg}`,
  routerNoSampler: 'sampling: no MCP client offers it here (only the MCP server can request it)',
  routerRefusal: 'refusal',
  routerHttp: (status, base) => `HTTP ${status} from ${base}`,
  routerCliMissing: bin => `\`${bin}\` CLI not found`,
  routerTimeout: ms => `${ms} ms budget exceeded`,
  routerExitCode: (bin, code, first) => `${bin}: exit code ${code}${first ? ` — ${first}` : ''}`,

  // Same shape as the French tree. The identity branch gets a real condition
  // rather than "always relevant": the bootstrap guidance forbids that wording,
  // and a new English tree has no history to preserve.
  starterRoot: project =>
    `# Context — ${project}\n\nThis block is injected on every call. Keep it short: who, what, which repo.`,
  starterIdentityPath: 'identity',
  starterIdentityTitle: 'Identity',
  starterIdentityLoadWhen: 'when writing, reviewing or designing anything on this project',
  starterIdentityContent: project =>
    `You assist on the **${project}** project.\n\nDescribe the expected expertise and working style here.`,
  starterRulesPath: 'rules',
  starterRulesTitle: 'Project rules',
  starterRulesLoadWhen: 'when the request touches code, files or features',
  starterRulesContent: '- One hard constraint per line.\n- What is forbidden, what is mandatory.',
  starterArchPath: 'architecture',
  starterArchTitle: 'Architecture',
  starterArchLoadWhen: 'when the request is about the project structure or where a piece of code lives',
  starterArchContent: 'Overview: the areas of the repo and what they hold.',
  starterCommandsPath: 'architecture/commands',
  starterCommandsTitle: 'Commands',
  starterCommandsLoadWhen: 'when the project needs to be run, tested or built',
  starterCommandsContent: '```bash\n# to fill in\n```',
};

export const CORE_MESSAGES = { fr, en };

/** Les textes du cœur, dans la langue courante (ou celle demandée). */
export function coreText(lang?: Lang): typeof fr {
  return pick(CORE_MESSAGES, lang);
}
