import { allBranches } from './tree.js';
import type { ContextTree } from './types.js';
import type { RouteReason } from './router.js';
import { currentLang, type Lang } from './i18n.js';

/*
 * **La langue de ce que lit le modèle** (14 septembre 2026). Chaque texte existe
 * en français et en anglais, rangé en `Record<Lang, …>` : une langue oubliée
 * casse le typecheck. Le français est resté mot pour mot celui qui a été
 * mesuré ; l'anglais en garde les **moments** — « before you finish your
 * answer », « before answering » —, pas seulement le sens : une traduction qui
 * rendrait ces consignes permissives recréerait des ratés déjà payés (voir
 * `CAPITALIZE`, `renderBootstrapInvite`). `## Rules` et `## Context` étaient
 * déjà en anglais et le restent. Le contenu des branches n'est jamais traduit.
 */

/**
 * Assemble le bloc injecté dans l'appel IA.
 *
 * Ordre : racine (toujours) → Rules (identity + rule) → Context (le reste) →
 * catalogue de ce qui n'a **pas** été chargé. Les règles passent avant le
 * contexte parce que ce sont des contraintes : le modèle doit les avoir en tête
 * avant de lire la doc de domaine. Le catalogue passe en dernier — on le lit
 * une fois qu'on sait ce qu'on a reçu.
 */
export function renderContext(tree: ContextTree, selected: Set<string>): string {
  const parts: string[] = [];
  const root = tree.rootContent.trim();
  if (root) parts.push(root);

  const branches = allBranches(tree);
  const chosen = branches.filter(b => selected.has(b.path));
  const rules = chosen.filter(b => b.type === 'identity' || b.type === 'rule');
  const rest = chosen.filter(b => b.type !== 'identity' && b.type !== 'rule');

  if (rules.length) parts.push(`## Rules\n\n${rules.map(section).join('\n\n')}`);
  if (rest.length) parts.push(`## Context\n\n${rest.map(section).join('\n\n')}`);

  // Ce qui n'a pas été chargé, une ligne par branche.
  //
  // Sans ça, un agent qui reçoit une branche n'a aucun moyen de savoir qu'il en
  // existe onze autres : la ligne de transparence part sur stderr, qu'il ne voit
  // pas. Or le routage se fait sur le **prompt seul**, et un prompt comme
  // « prends la prochaine tâche » ne dit rien de la tâche — elle est dans une
  // carte qu'on n'a pas encore lue. On ne tire pas ce dont on ignore
  // l'existence : le catalogue est ce qui rend le rattrapage possible.
  //
  // C'est aussi ce qui aligne cette surface sur `renderAgentsBlock`, qui donne
  // le catalogue depuis toujours. Les trois surfaces sont des adaptateurs au-
  // dessus du même moteur ; celle-ci en divergeait.
  const others = branches.filter(b => !selected.has(b.path));
  const lang = currentLang();
  if (others.length) parts.push(`${CATALOGUE_HEADER[lang]}\n\n${PULL[lang]}\n\n${catalogue(others)}`);

  if (!parts.length) return '';
  // Le rappel d'écrire passe en tout dernier : c'est une consigne pour la suite
  // du tour, pas une information sur ce qu'on vient de recevoir.
  return `<contextree>\n${parts.join('\n\n')}\n\n${CAPITALIZE[lang]}\n</contextree>`;
}

/** L'invitation à tirer le reste. Le push n'est qu'une avance : il route sur le
 *  prompt de départ, qui ne contient presque jamais la tâche entière. */
const CATALOGUE_HEADER: Record<Lang, string> = {
  fr: '## Catalogue — branches non chargées',
  en: '## Catalogue — branches not loaded',
};

const PULL: Record<Lang, string> = {
  fr:
  "Le routage de ce tour s'est fait sur le prompt seul, et parfois avec un tour de retard. " +
  "Dès que la tâche se précise — une carte ou un ticket que tu viens de lire, une trace " +
  "d'erreur, un fichier que tu ouvres —, charge la branche qui va avec au lieu d'attendre le " +
  'tour suivant : outil MCP `get_context` avec ce que tu sais maintenant, ou ' +
  '`npx -y @gengad/contextree route "<la demande>"`.',
  en:
    "This turn was routed on the prompt alone, sometimes one turn late. " +
    'As soon as the task becomes clearer — a card or ticket you just read, an error trace, ' +
    'a file you open —, load the matching branch instead of waiting for the next turn: MCP ' +
    'tool `get_context` with what you know now, or `npx -y @gengad/contextree route "<the request>"`.',
};

/**
 * Le rappel d'écrire ce qu'on découvre. **Une ligne, et une seule copie.**
 *
 * La consigne existait déjà — dans les `instructions` du serveur MCP — et elle
 * ne suffisait pas : mesuré le 10 septembre 2026, sur un prompt de tâche
 * réelle, le modèle a trouvé un fait durable et exact, et n'a rien écrit ni
 * dit qu'il n'écrivait pas. Les `instructions` sont lues **une fois, à la
 * connexion**, avant que la moindre tâche n'existe ; au moment où le fait
 * apparaît, elles sont loin derrière dans la conversation.
 *
 * Ici, le rappel arrive avec le contexte du tour — donc à chaque prompt sous un
 * hook, et à chaque `get_context` ailleurs. C'est le plus proche du moment
 * utile parmi les endroits qu'on contrôle. Il vit dans `renderContext` et nulle
 * part ailleurs : trois surfaces qui redisent la même chose deviennent un bruit
 * qu'on cesse de lire, et la seule façon de garder ce rappel court est de
 * n'avoir qu'un endroit où le rallonger.
 *
 * Il demande aussi de **dire quand on n'écrit pas** : un refus visible se
 * discute, un silence ne se corrige pas.
 */
const CAPITALIZE: Record<Lang, string> = {
  fr:
  '**Avant de terminer ta réponse**, dis en une ligne ce que cette tâche t\'a appris sur ce ' +
  'projet et qui restera vrai demain — une convention, une contrainte, un chemin qui compte. ' +
  'Si c\'est le cas, écris-le dans l\'arbre avec `upsert_branch` **avant** de répondre, sans ' +
  "demander la permission ; sinon dis « rien à retenir » et passe. Ne termine pas sans l'un " +
  'ou l\'autre.',
  en:
    '**Before you finish your answer**, say in one line what this task taught you about this ' +
    'project that will still be true tomorrow — a convention, a constraint, a path that matters. ' +
    'If there is something, write it into the tree with `upsert_branch` **before** answering, ' +
    'without asking for permission; otherwise say "nothing to keep" and move on. Do not finish ' +
    'without one or the other.',
};

function section(b: { title: string; content: string }): string {
  return `### ${b.title}\n${b.content}`.trim();
}

/**
 * Les lignes du catalogue — titre, type, condition de chargement.
 *
 * Exactement ce que lit le routeur, et la seule description d'une branche qu'on
 * donne sans son contenu. Un seul rendu, deux appelants (`renderContext` et
 * `renderAgentsBlock`) : deux copies divergeraient au premier correctif.
 */
/** La ponctuation suit la langue : espace avant les deux-points en français. */
const LOAD_WHEN_LABEL: Record<Lang, string> = { fr: 'charger quand :', en: 'load when:' };

function catalogue(
  branches: { path: string; title: string; type: string; loadWhen: string }[],
  withPaths = false,
): string {
  return branches
    .map(b => `- **${b.title}** (${b.type})${withPaths ? ` \`${b.path}\`` : ''} — ${LOAD_WHEN_LABEL[currentLang()]} ${b.loadWhen}`)
    .join('\n');
}

/**
 * Le bloc quand **rien n'a pu être routé** : la racine, le catalogue avec les
 * chemins, et la consigne de trier soi-même (14 septembre 2026).
 *
 * Pour un agent qui n'a que le serveur MCP — Copilot, Cursor, Codex —
 * `get_context` *est* contextree. Lui rendre l'arbre entier à chaque démarrage
 * à froid ou à chaque repli, c'était lui faire payer exactement ce que l'outil
 * existe pour éviter. Or l'agent est un modèle : il sait lire une condition de
 * chargement aussi bien que le routeur. On lui donne les mêmes lignes que lit
 * le routeur, plus le chemin pour `read_branch`, et il devient son propre
 * routeur pour ce tour.
 *
 * La consigne a un **moment** — « avant de répondre » — parce qu'une consigne
 * sans moment est une consigne qu'on remet à plus tard (mesuré deux fois, voir
 * `CAPITALIZE`). Une branche par appel : `read_branch` garde un seul chemin, les
 * agents savent appeler plusieurs outils d'un coup, et un second schéma pour
 * la même lecture serait une surface de plus à tenir.
 *
 * Le hook de Claude Code n'y passe pas : il garde l'arbre entier en repli.
 * Changer ce qui arrive devant chaque prompt est une autre décision.
 */
const CATALOGUE_ONLY: Record<Lang, (cause: string) => string> = {
  fr: cause =>
    `## Catalogue — aucune branche chargée\n\n` +
    `Ce tour n'a pas pu être routé (${cause}). **Avant de répondre**, lis avec l'outil ` +
    '`read_branch` les branches dont la condition de chargement correspond à la tâche — ' +
    'par leur chemin exact, entre accents graves ci-dessous, un appel par branche. Pour ce ' +
    "tour, c'est toi qui tries ; si aucune ne correspond, dis-le et continue.",
  en: cause =>
    `## Catalogue — no branch loaded\n\n` +
    `This turn could not be routed (${cause}). **Before answering**, read with the ` +
    '`read_branch` tool the branches whose load condition matches the task — by their exact ' +
    'path, in backticks below, one call per branch. For this turn, you do the sorting; if none ' +
    'matches, say so and carry on.',
};

export function renderCatalogueOnly(tree: ContextTree, cause: string): string {
  const parts: string[] = [];
  const root = tree.rootContent.trim();
  if (root) parts.push(root);

  const lang = currentLang();
  const branches = allBranches(tree);
  if (branches.length) parts.push(`${CATALOGUE_ONLY[lang](cause)}\n\n${catalogue(branches, true)}`);

  if (!parts.length) return '';
  return `<contextree>\n${parts.join('\n\n')}\n\n${CAPITALIZE[lang]}\n</contextree>`;
}

/**
 * Le bloc pour un agent sans hook — `AGENTS.md` et compagnie.
 *
 * Surtout pas l'arbre entier : ce serait exactement le gros fichier de
 * consignes que contextree existe pour remplacer. On donne la **racine**
 * (toujours injectée, jamais routée) et le **catalogue** — titre plus
 * `load_when`, les mêmes lignes que lit le routeur. L'agent route alors
 * lui-même, à la demande, avec `get_context`.
 *
 * Dégradation prévue : sans MCP, il reste la racine et une carte des branches,
 * ce qui est déjà mieux que rien — et beaucoup moins que tout.
 */
const AGENTS_BLOCK: Record<Lang, { header: string; pull: string }> = {
  fr: {
    header: '## Contexte du projet (contextree)',
    pull:
      "**Avant de répondre à une demande sur ce projet, et avant d'ouvrir ou de modifier un fichier, " +
      "appelle l'outil MCP `get_context`** avec la demande de l'utilisateur. Recommence quand la tâche se précise. " +
      "Le contexte vit dans `.contextree/`, en petites branches typées : n'ouvre pas tout, " +
      '`get_context` rend uniquement les branches pertinentes. Sans MCP : ' +
      '`npx -y @gengad/contextree route "<la demande>"`.',
  },
  en: {
    header: '## Project context (contextree)',
    pull:
      '**Before answering a request about this project, and before opening or editing a file, ' +
      "call the MCP tool `get_context`** with the user's request. Do it again when the task becomes clearer. " +
      "The context lives in `.contextree/`, as small typed branches: don't open everything, " +
      '`get_context` returns only the relevant branches. Without MCP: ' +
      '`npx -y @gengad/contextree route "<the request>"`.',
  },
};

export function renderAgentsBlock(tree: ContextTree): string {
  const lang = currentLang();
  // La consigne **en tête**, avec son moment, avant la racine : lue en fin de
  // bloc, après le catalogue, elle arrivait une fois la réponse commencée — et
  // « appelle `get_context` » sans « avant de répondre » est une consigne qu'on
  // remet à plus tard (14 septembre 2026, Copilot qui ne lit jamais l'arbre).
  const parts: string[] = [AGENTS_BLOCK[lang].header, AGENTS_BLOCK[lang].pull];
  const root = tree.rootContent.trim();
  if (root) parts.push(root);

  const branches = allBranches(tree);
  if (branches.length) parts.push(`### Branches\n${catalogue(branches)}`);

  return parts.join('\n\n');
}

/**
 * La consigne qu'on donne à l'IA de l'utilisateur pour qu'elle construise
 * l'arbre depuis ce que le projet contient déjà.
 *
 * **contextree ne génère rien : il invite.** Pas de moteur de découpe dans le
 * cœur, pas de dépendance, pas d'heuristique qui devine des `load_when` — c'est
 * le champ que l'utilisateur sait écrire et que le modèle devine mal, et une
 * branche dont personne n'a relu la condition ne sera jamais routée
 * correctement. Ce qu'on fournit, c'est un texte bien écrit et des endroits
 * pour le déclencher.
 *
 * Une seule copie, comme `renderAgentsBlock` : le prompt MCP, la CLI et le
 * bouton de la vue lisent cette fonction. Trois formulations d'une même
 * consigne divergeraient au premier ajustement, et c'est le `load_when` qui en
 * paierait le prix.
 */
export function renderBootstrapPrompt(found: string[]): string {
  return BOOTSTRAP_PROMPT[currentLang()](found);
}

function bootstrapPromptFr(found: string[]): string {
  const sources = found.length
    ? `Ce projet contient déjà de quoi partir :\n${found.map(f => `- \`${f}\``).join('\n')}\n\n` +
      'Lis-les, **et** parcours le dépôt : un fichier de consignes dit ce que ' +
      "quelqu'un a pris la peine d'écrire, le code dit ce qui est vrai."
    : "Ce projet n'a pas de fichier de consignes pour une IA. Parcours le dépôt : " +
      'le README, la structure des dossiers, les scripts, les tests.';

  return [
    '# Construire l\'arbre de contexte de ce projet',
    sources,
    TREE_METHOD.fr,
    TREE_EXAMPLES.fr,
    "**Une fois le plan accepté**, écris les branches avec les outils MCP `write_root` et `upsert_branch`. " +
      "Commence **toujours** par `write_root` : c'est le seul contenu toujours injecté, " +
      'et il tient en quelques lignes — qui, quoi, dans quel dépôt.',
    // Ajouté le 14 septembre 2026 avec l'anglais : l'outil parle deux langues,
    // l'arbre doit parler celle de la personne qui le relira.
    "Écris l'arbre **dans la langue de l'utilisateur** — celle dans laquelle il te parle —, " +
      'titres et `load_when` compris : c\'est lui qui les relira et les corrigera.',
    "Si l'arbre contient déjà des branches de départ génériques (« Architecture », " +
      '« Commandes », « Identité », « Règles du projet », avec un contenu à compléter), ' +
      '**remplace-les** — même chemin, `upsert_branch` — ou supprime celles qui ne servent ' +
      'pas. Ne laisse jamais une amorce vide à côté de la vraie branche : deux entrées pour ' +
      'le même sujet, et le routeur charge la mauvaise.',
    '## Ce qui fait un bon arbre',
    '- **6 à 12 branches de premier niveau, pas 40.** Une famille compte pour une, ses enfants ' +
      "s'y ajoutent. Un arbre que personne ne relit ne vaut rien, et " +
      "c'est en relisant qu'on corrige les conditions de chargement. Regroupe plutôt " +
      'que de multiplier.\n' +
      '- **Une section de doc ≈ une branche**, en première approximation seulement : ' +
      "c'est le sens qui décide, pas le découpage du fichier d'origine. Deux sections " +
      "qui parlent de la même chose font une branche ; une section qui mélange deux " +
      'sujets en fait deux.\n' +
      "- **Le type dit où la branche est injectée**, et rien d'autre : `identity` et " +
      '`rule` sous « Rules », avant `context`, `reference` et `skill` sous « Context ». ' +
      'Aucun type ne garantit le chargement.',
    '## Le `load_when` est le seul champ qui compte',
    "C'est lui qui décide si la branche sera chargée. Écris une **condition**, pas un " +
      'résumé :\n\n' +
      '- ✅ « quand on touche au routeur, au prompt de routage ou au choix de modèle »\n' +
      '- ✅ « quand la demande parle d\'authentification, de session ou de jeton »\n' +
      "- ❌ « le routeur et son fonctionnement » — c'est un titre, pas une condition\n" +
      "- ❌ « toujours pertinent », « toujours » — ce n'est pas une condition. Mesuré : le " +
      "routeur ne l'honore qu'une fois sur trois, et c'est la branche la plus systématiquement " +
      'manquée d\'un arbre.\n\n' +
      "**Y compris pour la branche d'identité**, où la tentation est la plus forte : écris " +
      'quand elle sert vraiment — « quand on écrit, relit ou conçoit quelque chose sur ce ' +
      'projet » — plutôt que « toujours ».',
    '## Ce que tu ne fais pas',
    "**Ne modifie ni ne supprime aucun fichier source.** Les fichiers de consignes " +
      "existants restent tels quels : c'est à leur auteur de décider s'ils partent, " +
      'et quand. Tu écris dans `.contextree/`, nulle part ailleurs.',
    '## Pour finir',
    "Quand l'arbre est écrit, **dis à l'utilisateur d'ouvrir la toile** (commande " +
      '« contextree : toile ») et de relire les `load_when` un par un — ce sont eux ' +
      "qu'il faudra corriger, et lui seul sait ce qu'il demandera à son IA. Les " +
      'branches que tu viens d\'écrire y sont signalées pendant un quart d\'heure. ' +
      "Ne termine pas sur « c'est fait » : l'arbre n'est utile qu'une fois relu.",
  ].join('\n\n');
}

/**
 * **Plan d'abord, puis la méthode** (14 septembre 2026).
 *
 * Observé chez Adrien : un arbre construit par Copilot tout à plat, et un
 * composant unique écrit comme une règle. Dans la même conversation, Claude
 * Code avait proposé la bonne forme — et ce qui l'avait produite n'était pas
 * une règle mais une **méthode** : partir des demandes futures, regrouper en
 * familles, mettre le commun dans le parent, **montrer le plan avant
 * d'écrire**. Des règles abstraites se suivent mal ; des étapes et des
 * exemples se suivent bien, surtout pour les petits modèles.
 *
 * Deux temps parce que le plan est le moment où la forme se corrige à moindre
 * coût : on corrige un chemin, pas un contenu.
 *
 * Une seule copie : la consigne `bootstrap` la contient, et la réponse de
 * `write_root` la redonne au moment où l'arbre naît — le seul instant garanti
 * où l'agent construit un arbre, qu'il ait lu la consigne ou non.
 */
export const TREE_METHOD: Record<Lang, string> = {
  fr: [
    "## Deux temps : un plan, puis l'écriture",
    "**N'écris rien tout de suite.** Montre d'abord à l'utilisateur un **plan** : l'arborescence " +
      '(les chemins — un `/` crée un enfant), le type et le `load_when` de chaque branche, et une ' +
      'phrase sur ce que portera chaque parent. **Arrête-toi là et attends son accord** ou ses ' +
      "corrections ; écris seulement ensuite. C'est le moment où la forme se corrige à moindre coût : " +
      'on corrige un chemin, pas un contenu.',
    '## La méthode, dans cet ordre',
    '1. **Liste 8 à 15 demandes** que l\'utilisateur fera à son IA sur ce projet — « ajoute une ' +
      'propriété au composant X », « pourquoi la publication échoue », « écris le test de Y ».\n' +
      '2. **Repère les familles** — composants, écrans, endpoints, services, modules, jobs : une branche ' +
      'parente, et **un enfant par élément, même s\'il n\'y en a qu\'un**. Le deuxième viendra.\n' +
      "3. **Le parent porte ce qui vaut pour tous ses enfants**, en court : il est chargé avec chacun d'eux.\n" +
      '4. **Une `rule` vaut pour tout le projet ou toute une famille**, jamais pour un seul élément — ' +
      "celui-ci est du `context`.\n" +
      "5. **Chaque `load_when` reprend les demandes de l'étape 1** qu'elle doit servir.\n" +
      "6. **Vérifie** que chaque demande de l'étape 1 charge au moins une branche, et qu'aucune n'en " +
      "charge la moitié de l'arbre.",
  ].join('\n\n'),
  en: [
    '## Two steps: a plan, then the writing',
    "**Don't write anything yet.** First show the user a **plan**: the tree structure (the paths — " +
      'a `/` creates a child), the type and `load_when` of each branch, and one sentence on what each ' +
      'parent will hold. **Stop there and wait for their approval** or corrections; only write after ' +
      "that. It is when the shape is cheapest to fix: you fix a path, not a content.",
    '## The method, in this order',
    '1. **List 8 to 15 requests** the user will make to their AI on this project — "add a property ' +
      'to component X", "why does publishing fail", "write the test for Y".\n' +
      '2. **Spot the families** — components, screens, endpoints, services, modules, jobs: one parent ' +
      "branch, and **one child per item, even if there is only one**. The second will come.\n" +
      '3. **The parent holds what applies to all its children**, briefly: it is loaded with each of them.\n' +
      '4. **A `rule` applies to the whole project or a whole family**, never to a single item — ' +
      'that one is `context`.\n' +
      '5. **Each `load_when` reuses the requests from step 1** that it must serve.\n' +
      '6. **Check** that each request from step 1 loads at least one branch, and that none loads half the tree.',
  ].join('\n\n'),
};

/**
 * Des arbres types, pas une règle de plus : l'IA prend le plus proche et
 * l'adapte. Génériques exprès — aucun nom de plateforme ou de client ici.
 */
const TREE_EXAMPLES: Record<Lang, string> = {
  fr: [
    '## Des arbres types',
    'Prends le plus proche de ce projet et adapte-le : les noms sont des exemples, la forme est ce qui compte.',
    '**Bibliothèque de composants**\n```\n' +
      'identite           identity   quand on écrit, relit ou conçoit un composant de cette bibliothèque\n' +
      'composants         rule       quand on crée, modifie ou relit un composant — les conventions communes\n' +
      'composants/date    context    quand la demande parle du sélecteur de date, de ses propriétés ou de ses événements\n' +
      "composants/upload  context    quand la demande parle de l'envoi de fichiers ou du composant upload\n" +
      "plateforme         context    quand on touche à l'intégration avec la plateforme hôte ou à la configuration d'un composant\n" +
      'commandes          reference  quand il faut builder, tester, lancer la démo ou publier\n' +
      'nouveau-composant  skill      quand on crée un nouveau composant\n' +
      'publier            skill      quand on publie une version, ou que la publication échoue\n```',
    '**API web**\n```\n' +
      'identite                identity   quand on écrit, relit ou conçoit du code de cette API\n' +
      'regles                  rule       quand on touche au code, aux dépendances ou aux migrations\n' +
      'endpoints               context    quand on ajoute ou modifie un endpoint — routes, erreurs, pagination\n' +
      'endpoints/commandes     context    quand la demande parle des commandes, de leur statut ou de leur paiement\n' +
      "endpoints/utilisateurs  context    quand la demande parle des comptes, de l'inscription ou des profils\n" +
      "auth                    context    quand la demande parle d'authentification, de session ou de jeton\n" +
      'base-de-donnees         reference  quand on écrit une requête ou une migration, ou qu\'on touche au schéma\n' +
      "commandes               reference  quand il faut lancer, tester ou déployer l'API\n```",
    '**Monorepo**\n```\n' +
      'identite     identity   quand on écrit, relit ou conçoit quelque chose dans ce dépôt\n' +
      'regles       rule       quand on touche au code, aux dépendances partagées ou à la CI\n' +
      "paquets      context    quand on ajoute un paquet ou qu'on touche aux dépendances entre paquets\n" +
      "paquets/web  context    quand la demande porte sur l'application web, ses pages ou son build\n" +
      'paquets/api  context    quand la demande porte sur le serveur, ses routes ou ses workers\n' +
      'paquets/ui   context    quand la demande porte sur les composants partagés ou le design system\n' +
      'commandes    reference  quand il faut builder, tester ou lancer un paquet, ou tout le dépôt\n' +
      "release      skill      quand on prépare une version ou qu'on publie des paquets\n```",
  ].join('\n\n'),
  en: [
    '## Example trees',
    'Take the one closest to this project and adapt it: the names are examples, the shape is what matters.',
    '**Component library**\n```\n' +
      'identity             identity   when writing, reviewing or designing a component of this library\n' +
      'components           rule       when creating, changing or reviewing a component — the shared conventions\n' +
      'components/date      context    when the request is about the date picker, its properties or its events\n' +
      'components/upload    context    when the request is about file upload or the upload component\n' +
      "platform             context    when working on the integration with the host platform or a component's configuration\n" +
      'commands             reference  when building, testing, running the demo or publishing\n' +
      'new-component        skill      when creating a new component\n' +
      'publish              skill      when publishing a release, or when publishing fails\n```',
    '**Web API**\n```\n' +
      'identity           identity   when writing, reviewing or designing code for this API\n' +
      'rules              rule       when touching code, dependencies or migrations\n' +
      'endpoints          context    when adding or changing an endpoint — routes, errors, pagination\n' +
      'endpoints/orders   context    when the request is about orders, their status or their payment\n' +
      'endpoints/users    context    when the request is about accounts, sign-up or profiles\n' +
      'auth               context    when the request is about authentication, sessions or tokens\n' +
      'database           reference  when writing a query or a migration, or touching the schema\n' +
      'commands           reference  when running, testing or deploying the API\n```',
    '**Monorepo**\n```\n' +
      'identity       identity   when writing, reviewing or designing anything in this repo\n' +
      'rules          rule       when touching code, shared dependencies or CI\n' +
      'packages       context    when adding a package or touching dependencies between packages\n' +
      'packages/web   context    when the request is about the web app, its pages or its build\n' +
      'packages/api   context    when the request is about the server, its routes or its workers\n' +
      'packages/ui    context    when the request is about shared components or the design system\n' +
      'commands       reference  when building, testing or running a package, or the whole repo\n' +
      'release        skill      when preparing a release or publishing packages\n```',
  ].join('\n\n'),
};

/**
 * L'invitation, pour un projet qui n'a **pas** encore d'arbre.
 *
 * La version courte de `renderBootstrapPrompt`, et un rôle différent : celle-ci
 * n'est pas demandée, elle arrive toute seule — dans les `instructions` du
 * serveur MCP, dans la réponse de `get_context`, sur le stdout du hook. Elle
 * tient donc en quelques lignes, et elle dit à l'IA de **proposer**, jamais de
 * créer : une IA qui fabrique un arbre que personne n'a demandé finit par
 * écrire douze `load_when` que personne ne relira — or c'est le seul champ qui
 * décide de quoi que ce soit ici. La consigne longue reste derrière le prompt
 * `bootstrap`, qu'on ne lit qu'une fois qu'on a dit oui.
 *
 * **Elle est rattachée à la fin de la réponse** (11 septembre 2026). Elle disait
 * « propose-le au bon moment, sans insister » : mesuré sur six passages
 * identiques d'un même prompt, l'invitation injectée à chaque fois, le modèle
 * n'en disait rien **deux fois sur six**. « Au bon moment » se lit comme une
 * permission de se taire — le même défaut, au même moment, que « écris ce que
 * tu découvres » pour le rappel d'enrichissement (voir `CAPITALIZE`). Une
 * consigne sans moment est une consigne qu'on remet à plus tard.
 *
 * Ce qui retient l'outil reste ailleurs, et n'a jamais raté : le marqueur de
 * session (une invitation par session, pas par tour) et l'interdiction de créer
 * avant un oui. On a resserré le déclenchement, pas la politesse.
 */
export function renderBootstrapInvite(found: string[]): string {
  return BOOTSTRAP_INVITE[currentLang()](found);
}

function bootstrapInviteFr(found: string[]): string {
  const sources = found.length
    ? `Il a déjà de quoi partir : ${found.map(f => `\`${f}\``).join(', ')} — plus le dépôt lui-même.`
    : "Il n'a pas de fichier de consignes pour une IA ; le dépôt lui-même fera l'affaire.";

  return [
    "Ce projet n'a pas d'arbre de contexte contextree (pas de dossier `.contextree/`).",
    sources,
    "**Avant de terminer ta réponse**, dis-lui en une phrase que ce projet n'a pas d'arbre " +
      'de contexte et que tu peux en construire un à partir de ces fichiers et du dépôt, à ' +
      "la place du gros fichier de consignes. Une phrase, à la fin, sans y revenir : c'est " +
      'la seule fois de la session où on le lui propose.',
    "S'il accepte, **ton premier appel est l'outil `bootstrap_prompt`** — avant `write_root`, avant " +
      "toute branche : il te donne le plan à lui montrer et la méthode. `write_root` crée ensuite " +
      "l'arbre — rien à taper dans un terminal. (Sans serveur MCP : `contextree bootstrap`.)",
    "**Ne crée rien tant qu'il n'a pas dit oui**, et ne touche à aucun fichier source. " +
      "Un arbre écrit dans son dos est un arbre que personne ne relit.",
  ].join('\n\n');
}

/**
 * La consigne de construction, en anglais — même plan, mêmes interdits, mêmes
 * exemples de `load_when`, même fin : « ne termine pas sur c'est fait ».
 */
function bootstrapPromptEn(found: string[]): string {
  const sources = found.length
    ? `This project already has something to start from:\n${found.map(f => `- \`${f}\``).join('\n')}\n\n` +
      'Read them, **and** walk through the repo: an instructions file says what someone ' +
      'took the trouble to write, the code says what is true.'
    : 'This project has no instructions file for an AI. Walk through the repo: ' +
      'the README, the folder structure, the scripts, the tests.';

  return [
    "# Build this project's context tree",
    sources,
    TREE_METHOD.en,
    TREE_EXAMPLES.en,
    '**Once the plan is accepted**, write the branches with the MCP tools `write_root` and `upsert_branch`. ' +
      '**Always** start with `write_root`: it is the only content that is always injected, ' +
      'and it fits in a few lines — who, what, which repo.',
    "Write the tree **in the user's language** — the one they speak to you in —, titles and " +
      '`load_when` included: they are the one who will reread and correct them.',
    'If the tree already holds generic starter branches ("Architecture", "Commands", ' +
      '"Identity", "Project rules", with content to fill in), **replace them** — same path, ' +
      '`upsert_branch` — or delete the ones that are not useful. Never leave an empty stub ' +
      'next to the real branch: two entries for the same topic, and the router loads the wrong one.',
    '## What makes a good tree',
    '- **6 to 12 top-level branches, not 40.** A family counts as one, its children come on top. ' +
      'A tree nobody rereads is worthless, and rereading is ' +
      'how load conditions get corrected. Group rather than multiply.\n' +
      '- **One doc section ≈ one branch**, as a first approximation only: meaning decides, ' +
      'not how the original file was split. Two sections about the same thing make one ' +
      'branch; a section mixing two topics makes two.\n' +
      '- **The type says where the branch is injected**, and nothing else: `identity` and ' +
      '`rule` under "Rules", before `context`, `reference` and `skill` under "Context". ' +
      'No type guarantees loading.',
    '## `load_when` is the only field that matters',
    'It decides whether the branch gets loaded. Write a **condition**, not a summary:\n\n' +
      '- ✅ "when touching the router, the routing prompt or the model choice"\n' +
      '- ✅ "when the request is about authentication, sessions or tokens"\n' +
      '- ❌ "the router and how it works" — that is a title, not a condition\n' +
      '- ❌ "always relevant", "always" — that is not a condition. Measured: the router honours ' +
      'it only one time in three, and it is the most consistently missed branch of a tree.\n\n' +
      '**Including for the identity branch**, where the temptation is strongest: write when it ' +
      'really helps — "when writing, reviewing or designing anything on this project" — rather ' +
      'than "always".',
    "## What you don't do",
    '**Do not modify or delete any source file.** Existing instruction files stay as they ' +
      'are: it is up to their author to decide whether they go, and when. You write in ' +
      '`.contextree/`, nowhere else.',
    '## To finish',
    'When the tree is written, **tell the user to open the canvas** ("contextree: canvas" ' +
      'command) and to reread the `load_when` one by one — those are what will need ' +
      'correcting, and only they know what they will ask their AI. The branches you just ' +
      'wrote are flagged there for a quarter of an hour. ' +
      'Do not end on "done": the tree is only useful once it has been reread.',
  ].join('\n\n');
}

/**
 * L'invitation, en anglais. Le moment est la partie qui a été payée : « before
 * you finish your answer », pas « at the right time ».
 */
function bootstrapInviteEn(found: string[]): string {
  const sources = found.length
    ? `It already has something to start from: ${found.map(f => `\`${f}\``).join(', ')} — plus the repo itself.`
    : 'It has no instructions file for an AI; the repo itself will do.';

  return [
    'This project has no contextree context tree (no `.contextree/` folder).',
    sources,
    '**Before you finish your answer**, tell them in one sentence that this project has no ' +
      'context tree and that you can build one from these files and the repo, in place of the ' +
      "big instructions file. One sentence, at the end, without coming back to it: it is the " +
      'only time in the session it is offered.',
    'If they accept, **your first call is the `bootstrap_prompt` tool** — before `write_root`, ' +
      'before any branch: it gives you the plan to show them and the method. `write_root` then ' +
      'creates the tree — nothing to type in a terminal. (Without an MCP server: `contextree bootstrap`.)',
    "**Do not create anything until they have said yes**, and do not touch any source file. " +
      'A tree written behind their back is a tree nobody rereads.',
  ].join('\n\n');
}

const BOOTSTRAP_PROMPT: Record<Lang, (found: string[]) => string> = { fr: bootstrapPromptFr, en: bootstrapPromptEn };
const BOOTSTRAP_INVITE: Record<Lang, (found: string[]) => string> = { fr: bootstrapInviteFr, en: bootstrapInviteEn };

const TRACE_LABELS: Record<Lang, Record<RouteReason, string>> = {
  fr: {
    routed: 'routé',
    all: 'tout chargé',
    fallback: 'fallback',
    deferred: 'différé — routage en tâche de fond',
    catalogue: 'catalogue seul — pas de routage disponible',
  },
  en: {
    routed: 'routed',
    all: 'all loaded',
    fallback: 'fallback',
    deferred: 'deferred — routing in the background',
    catalogue: 'catalogue only — no routing available',
  },
};

const TRACE_COUNT: Record<Lang, (n: number, titles: string) => string> = {
  fr: (n, titles) => `${n} branche(s) : ${titles}`,
  en: (n, titles) => `${n} branch(es): ${titles}`,
};

/** Ligne de transparence : ce qui a été chargé, et pourquoi. Jamais de boîte noire. */
export function renderTrace(
  tree: ContextTree,
  selected: Set<string>,
  reason: RouteReason,
): string {
  const titles = [...selected].map(p => tree.branches.get(p)?.title ?? p);
  const lang = currentLang();
  const label = TRACE_LABELS[lang][reason] ?? reason;
  return `contextree (${label}) — ${TRACE_COUNT[lang](titles.length, titles.join(', ') || '—')}`;
}
