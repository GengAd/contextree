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
  return `<contextree>\n${parts.join('\n\n')}\n</contextree>`;
}

/** L'invitation à tirer le reste. Le push n'est qu'une avance : il route sur le
 *  prompt de départ, qui ne contient presque jamais la tâche entière. */
const PULL =
  "Le routage de ce tour s'est fait sur le prompt seul, et parfois avec un tour de retard. " +
  "Dès que la tâche se précise — une carte ou un ticket que tu viens de lire, une trace " +
  "d'erreur, un fichier que tu ouvres —, charge la branche qui va avec au lieu d'attendre le " +
  'tour suivant : outil MCP `get_context` avec ce que tu sais maintenant, ou ' +
  '`npx -y @gengad/contextree route "<la demande>"`.';

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
