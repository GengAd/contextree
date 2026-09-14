import { currentLang, type Lang } from './i18n.js';
import type { Branch, ContextTree } from './types.js';

/**
 * Le contrôle de forme de l'arbre (14 septembre 2026).
 *
 * Observé chez Adrien : un arbre construit par Copilot **tout à plat**, sans une
 * branche enfant, et un composant unique décrit comme une règle. Rien ne l'a
 * signalé — un arbre plat de douze branches passait sans un mot. Ce contrôle le
 * dit, dans la réponse des outils qui écrivent et partout où l'arbre se lit.
 *
 * **Des avertissements, jamais un refus** : un arbre de forme discutable reste
 * un arbre, et c'est son auteur qui tranche. **Pas de sémantique** non plus
 * (« cette règle ne parle que d'un composant ») : ça, c'est le rôle du plan et
 * des exemples de la consigne `bootstrap`. On ne signale que ce qui se voit à
 * la structure.
 */
export type ShapeCode = 'no-root' | 'too-few' | 'crowded' | 'flat' | 'family' | 'load-when' | 'heavy-parent';

export type ShapeWarning = {
  code: ShapeCode;
  /** Les branches concernées — vide quand c'est l'arbre entier. */
  paths: string[];
  message: string;
};

/** Sous ce nombre de branches, l'arbre ne sert pas encore à router. */
const MIN_BRANCHES = 4;
/** Au-delà, un niveau n'est plus relu : c'est une liste, pas un arbre. */
const MAX_SIBLINGS = 15;
/** Plat : au-delà de ce nombre, sans un seul enfant. */
const FLAT_FROM = 6;

export function lintTree(tree: ContextTree): ShapeWarning[] {
  const t = LINT[currentLang()];
  const branches = tree.order.map(p => tree.branches.get(p)!).filter(Boolean);
  const out: ShapeWarning[] = [];

  if (!tree.rootContent.trim()) out.push({ code: 'no-root', paths: [], message: t.noRoot });
  if (branches.length < MIN_BRANCHES) {
    out.push({ code: 'too-few', paths: [], message: t.tooFew(branches.length) });
  }

  // Les bornes se comptent **par niveau**, pas sur l'arbre entier : un arbre
  // qui a des familles peut grandir avec l'usage — c'est ce qu'on lui demande —,
  // un niveau de seize sœurs, lui, est une liste qu'on ne relit plus.
  const levels = groupBy(branches, b => b.parentPath ?? '');
  for (const [parent, siblings] of levels) {
    if (siblings.length > MAX_SIBLINGS) {
      out.push({ code: 'crowded', paths: siblings.map(b => b.path), message: t.crowded(parent, siblings.length) });
    }
  }

  if (branches.length > FLAT_FROM && branches.every(b => !b.childPaths.length)) {
    out.push({ code: 'flat', paths: [], message: t.flat(branches.length) });
  }

  // Des sœurs au même motif — `composant-x`, `composant-y`, ou deux titres qui
  // commencent par le même mot — sont une famille qui n'a pas son parent.
  for (const siblings of levels.values()) {
    const motifs = new Map<string, Branch[]>();
    for (const b of siblings) {
      for (const m of new Set([pathMotif(b), titleMotif(b)].filter((m): m is string => Boolean(m)))) {
        motifs.set(m, [...(motifs.get(m) ?? []), b]);
      }
    }
    const seen = new Set<string>();
    for (const [motif, group] of motifs) {
      const key = group.map(b => b.path).join('|');
      if (group.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push({ code: 'family', paths: group.map(b => b.path), message: t.family(motif, group.map(b => b.path)) });
    }
  }

  for (const b of branches) {
    const why = loadWhenProblem(b);
    if (why) out.push({ code: 'load-when', paths: [b.path], message: t.loadWhen(b.path, why) });
  }

  // Un parent est injecté avec **chacun** de ses enfants : plus long qu'eux
  // tous réunis, il coûte plus que ce qu'il sert.
  for (const b of branches) {
    if (!b.childPaths.length || !b.content.trim()) continue;
    const children = b.childPaths.reduce((n, p) => n + (tree.branches.get(p)?.content.trim().length ?? 0), 0);
    if (b.content.trim().length > children) {
      out.push({ code: 'heavy-parent', paths: [b.path], message: t.heavyParent(b.path) });
    }
  }

  return out;
}

/** Les avertissements en un bloc lisible, ou `''` s'il n'y en a pas. */
export function renderShapeWarnings(warnings: ShapeWarning[]): string {
  if (!warnings.length) return '';
  return `${LINT[currentLang()].header}\n${warnings.map(w => `- ${w.message}`).join('\n')}`;
}

type LoadWhenProblem = 'empty' | 'always' | 'title';

function loadWhenProblem(b: Branch): LoadWhenProblem | null {
  const lw = normalize(b.loadWhen);
  if (!lw) return 'empty';
  if (/^(toujours|always)\b/.test(lw) || /\b(toujours (pertinent|utile)|always (relevant|useful))\b/.test(lw)) return 'always';
  if (lw === normalize(b.title)) return 'title';
  return null;
}

/** Le premier segment d'un nom composé : `composant` pour `composant-date`. */
function pathMotif(b: Branch): string | null {
  const last = b.path.slice(b.path.lastIndexOf('/') + 1);
  const i = last.indexOf('-');
  return i >= 3 ? last.slice(0, i) : null;
}

/** Le premier mot d'un titre de plusieurs mots, s'il en dit assez. */
function titleMotif(b: Branch): string | null {
  const words = normalize(b.title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length >= 2 && words[0]!.length >= 4 ? words[0]! : null;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.«»"“”]/g, '').trim();
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

/**
 * Lus par le modèle dans la réponse d'un outil, et par l'utilisateur dans la
 * CLI : chaque message dit **quoi faire**, pas seulement ce qui ne va pas.
 */
const LINT: Record<
  Lang,
  {
    header: string;
    noRoot: string;
    tooFew: (n: number) => string;
    crowded: (parent: string, n: number) => string;
    flat: (n: number) => string;
    family: (motif: string, paths: string[]) => string;
    loadWhen: (path: string, why: LoadWhenProblem) => string;
    heavyParent: (path: string) => string;
  }
> = {
  fr: {
    header: "⚠ Forme de l'arbre (avertissements, rien n'est refusé) :",
    noRoot: 'pas de racine : écris-la avec `write_root` — qui, quoi, dans quel dépôt. C\'est le seul contenu toujours injecté.',
    tooFew: n => `${n} branche(s) seulement : en dessous de ${MIN_BRANCHES}, le routage ne sert à rien encore.`,
    crowded: (parent, n) =>
      `${n} branches au même niveau${parent ? ` sous \`${parent}\`` : ''} : au-delà de ${MAX_SIBLINGS}, regroupe-les en familles.`,
    flat: n =>
      `arbre plat : ${n} branches et aucune n'a d'enfant. Regroupe les familles (composants, écrans, endpoints, modules…) sous un parent, un enfant par élément — un \`/\` dans le chemin crée l'enfant.`,
    family: (motif, paths) =>
      `${paths.map(p => `\`${p}\``).join(', ')} : même motif « ${motif} » sans parent commun — une famille ? Un parent qui porte ce qui vaut pour tous, et ces branches dessous.`,
    loadWhen: (path, why) =>
      `\`${path}\` : ${
        why === 'empty' ? '`load_when` vide' : why === 'always' ? '`load_when` en « toujours »' : '`load_when` identique au titre'
      } — écris une condition, à partir des demandes qu'elle doit servir (« quand on touche à… »).`,
    heavyParent: path =>
      `\`${path}\` est plus long que tous ses enfants réunis, et il est injecté avec chacun d'eux : garde-lui ce qui vaut pour tous, en court.`,
  },
  en: {
    header: '⚠ Tree shape (warnings, nothing is refused):',
    noRoot: 'no root: write it with `write_root` — who, what, which repo. It is the only content always injected.',
    tooFew: n => `only ${n} branch(es): below ${MIN_BRANCHES}, routing is of no use yet.`,
    crowded: (parent, n) =>
      `${n} branches on the same level${parent ? ` under \`${parent}\`` : ''}: past ${MAX_SIBLINGS}, group them into families.`,
    flat: n =>
      `flat tree: ${n} branches and none has a child. Group the families (components, screens, endpoints, modules…) under a parent, one child per item — a \`/\` in the path creates the child.`,
    family: (motif, paths) =>
      `${paths.map(p => `\`${p}\``).join(', ')}: same pattern "${motif}" with no common parent — a family? A parent holding what applies to all of them, and these branches below.`,
    loadWhen: (path, why) =>
      `\`${path}\`: ${
        why === 'empty' ? 'empty `load_when`' : why === 'always' ? '`load_when` says "always"' : '`load_when` identical to the title'
      } — write a condition, from the requests it must serve ("when working on…").`,
    heavyParent: path =>
      `\`${path}\` is longer than all its children together, and it is injected with each of them: keep only what applies to all, briefly.`,
  },
};
