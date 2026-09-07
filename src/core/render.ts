import { allBranches } from './tree.js';
import type { ContextTree } from './types.js';

/**
 * Assemble le bloc injecté dans l'appel IA.
 *
 * Ordre : racine (toujours) → Rules (identity + rule) → Context (le reste).
 * Les règles passent avant le contexte parce que ce sont des contraintes : le
 * modèle doit les avoir en tête avant de lire la doc de domaine.
 */
export function renderContext(tree: ContextTree, selected: Set<string>): string {
  const parts: string[] = [];
  const root = tree.rootContent.trim();
  if (root) parts.push(root);

  const chosen = allBranches(tree).filter(b => selected.has(b.path));
  const rules = chosen.filter(b => b.type === 'identity' || b.type === 'rule');
  const rest = chosen.filter(b => b.type !== 'identity' && b.type !== 'rule');

  if (rules.length) parts.push(`## Rules\n\n${rules.map(section).join('\n\n')}`);
  if (rest.length) parts.push(`## Context\n\n${rest.map(section).join('\n\n')}`);

  if (!parts.length) return '';
  return `<contextree>\n${parts.join('\n\n')}\n</contextree>`;
}

function section(b: { title: string; content: string }): string {
  return `### ${b.title}\n${b.content}`.trim();
}

/** Ligne de transparence : ce qui a été chargé, et pourquoi. Jamais de boîte noire. */
export function renderTrace(
  tree: ContextTree,
  selected: Set<string>,
  reason: 'routed' | 'all' | 'fallback',
): string {
  const titles = [...selected].map(p => tree.branches.get(p)?.title ?? p);
  const label =
    reason === 'all' ? 'tout chargé' : reason === 'fallback' ? 'fallback' : 'routé';
  return `contextree (${label}) — ${titles.length} branche(s) : ${titles.join(', ') || '—'}`;
}
