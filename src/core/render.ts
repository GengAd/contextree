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
  '`contextree route "<la demande>"`.';

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
      '`contextree route "<la demande>"`.',
  );

  const branches = allBranches(tree);
  if (branches.length) parts.push(`### Branches\n${catalogue(branches)}`);

  return parts.join('\n\n');
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
