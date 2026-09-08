import type { Branch, ContextTree } from './types.js';

/** Toutes les branches, dans l'ordre déterministe du disque. */
export function allBranches(tree: ContextTree): Branch[] {
  return tree.order.map(p => tree.branches.get(p)!).filter(Boolean);
}

/**
 * Étend une sélection à tous les ancêtres.
 *
 * Règle produit posée par l'utilisateur : « si on lit un enfant, on lit
 * forcément tous ses parents ». Une branche profonde n'a de sens qu'avec le
 * chemin de contexte qui y mène.
 */
export function withAncestors(tree: ContextTree, selected: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of selected) {
    let cur: string | null = p;
    while (cur && tree.branches.has(cur) && !out.has(cur)) {
      out.add(cur);
      cur = tree.branches.get(cur)!.parentPath;
    }
  }
  return out;
}

/** Rendu arborescent pour la CLI. */
export function formatTree(tree: ContextTree, highlight?: Set<string>): string {
  const lines: string[] = [];
  const roots = tree.order.filter(p => tree.branches.get(p)!.parentPath === null);
  const walk = (paths: string[], depth: number) => {
    for (const p of paths) {
      const b = tree.branches.get(p)!;
      const mark = highlight ? (highlight.has(p) ? '●' : '○') : '·';
      lines.push(`${'  '.repeat(depth)}${mark} [${b.type}] ${b.title}  — ${b.loadWhen}`);
      walk(b.childPaths, depth + 1);
    }
  };
  walk(roots, 0);
  return lines.join('\n');
}
