import { allBranches } from './tree.js';
import type { ContextTree } from './types.js';
import type { RouteReason } from './router.js';

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
  if (others.length) parts.push(`## Catalogue — branches non chargées\n\n${PULL}\n\n${catalogue(others)}`);

  if (!parts.length) return '';
  // Le rappel d'écrire passe en tout dernier : c'est une consigne pour la suite
  // du tour, pas une information sur ce qu'on vient de recevoir.
  return `<contextree>\n${parts.join('\n\n')}\n\n${CAPITALIZE}\n</contextree>`;
}

/** L'invitation à tirer le reste. Le push n'est qu'une avance : il route sur le
 *  prompt de départ, qui ne contient presque jamais la tâche entière. */
const PULL =
  "Le routage de ce tour s'est fait sur le prompt seul, et parfois avec un tour de retard. " +
  "Dès que la tâche se précise — une carte ou un ticket que tu viens de lire, une trace " +
  "d'erreur, un fichier que tu ouvres —, charge la branche qui va avec au lieu d'attendre le " +
  'tour suivant : outil MCP `get_context` avec ce que tu sais maintenant, ou ' +
  '`npx -y @gengad/contextree route "<la demande>"`.';

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
const CAPITALIZE =
  '**Avant de terminer ta réponse**, dis en une ligne ce que cette tâche t\'a appris sur ce ' +
  'projet et qui restera vrai demain — une convention, une contrainte, un chemin qui compte. ' +
  'Si c\'est le cas, écris-le dans l\'arbre avec `upsert_branch` **avant** de répondre, sans ' +
  "demander la permission ; sinon dis « rien à retenir » et passe. Ne termine pas sans l'un " +
  'ou l\'autre.';

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
function catalogue(branches: { title: string; type: string; loadWhen: string }[]): string {
  return branches
    .map(b => `- **${b.title}** (${b.type}) — charger quand : ${b.loadWhen}`)
    .join('\n');
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
export function renderAgentsBlock(tree: ContextTree): string {
  const parts: string[] = ['## Contexte du projet (contextree)'];
  const root = tree.rootContent.trim();
  if (root) parts.push(root);

  parts.push(
    "Le reste du contexte vit dans `.contextree/`, en petites branches typées. " +
      "**N'ouvre pas tout** : appelle l'outil MCP `get_context` avec la demande de " +
      "l'utilisateur, tu récupères uniquement les branches pertinentes. Sans MCP : " +
      '`npx -y @gengad/contextree route "<la demande>"`.',
  );

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
  const sources = found.length
    ? `Ce projet contient déjà de quoi partir :\n${found.map(f => `- \`${f}\``).join('\n')}\n\n` +
      'Lis-les, **et** parcours le dépôt : un fichier de consignes dit ce que ' +
      "quelqu'un a pris la peine d'écrire, le code dit ce qui est vrai."
    : "Ce projet n'a pas de fichier de consignes pour une IA. Parcours le dépôt : " +
      'le README, la structure des dossiers, les scripts, les tests.';

  return [
    '# Construire l\'arbre de contexte de ce projet',
    sources,
    'Écris ensuite les branches avec les outils MCP `write_root` et `upsert_branch`. ' +
      "Commence **toujours** par `write_root` : c'est le seul contenu toujours injecté, " +
      'et il tient en quelques lignes — qui, quoi, dans quel dépôt.',
    "Si l'arbre contient déjà des branches de départ génériques (« Architecture », " +
      '« Commandes », « Identité », « Règles du projet », avec un contenu à compléter), ' +
      '**remplace-les** — même chemin, `upsert_branch` — ou supprime celles qui ne servent ' +
      'pas. Ne laisse jamais une amorce vide à côté de la vraie branche : deux entrées pour ' +
      'le même sujet, et le routeur charge la mauvaise.',
    '## Ce qui fait un bon arbre',
    '- **6 à 12 branches, pas 40.** Un arbre que personne ne relit ne vaut rien, et ' +
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
    "S'il accepte, appelle l'outil `bootstrap_prompt` : il te donne la consigne complète, " +
      "et `write_root` crée l'arbre — rien à taper dans un terminal. (Sans serveur MCP : " +
      '`contextree bootstrap`.)',
    "**Ne crée rien tant qu'il n'a pas dit oui**, et ne touche à aucun fichier source. " +
      "Un arbre écrit dans son dos est un arbre que personne ne relit.",
  ].join('\n\n');
}

const TRACE_LABELS: Record<RouteReason, string> = {
  routed: 'routé',
  all: 'tout chargé',
  fallback: 'fallback',
  deferred: 'différé — routage en tâche de fond',
};

/** Ligne de transparence : ce qui a été chargé, et pourquoi. Jamais de boîte noire. */
export function renderTrace(
  tree: ContextTree,
  selected: Set<string>,
  reason: RouteReason,
): string {
  const titles = [...selected].map(p => tree.branches.get(p)?.title ?? p);
  const label = TRACE_LABELS[reason] ?? reason;
  return `contextree (${label}) — ${titles.length} branche(s) : ${titles.join(', ') || '—'}`;
}
