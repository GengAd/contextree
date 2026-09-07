/** Les 5 types de branche. `identity` et `rule` sont garanties en fallback si
 *  le routage échoue ; les autres sont purement routées. */
export const BRANCH_TYPES = ['identity', 'rule', 'context', 'reference', 'skill'] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

export function isBranchType(v: unknown): v is BranchType {
  return typeof v === 'string' && (BRANCH_TYPES as readonly string[]).includes(v);
}

/** Une branche = un fichier `.md` sous `.contextree/`.
 *  `path` est l'identifiant stable, relatif à `.contextree/`, sans extension :
 *  `archi-store` ou `archi-store/commandes-npm` pour un enfant. */
export type Branch = {
  path: string;
  parentPath: string | null;
  /** D'où vient la branche : l'arbre partagé, ou le calque personnel
   *  `.contextree.local/`. Une branche surchargée est `local` — c'est là qu'on
   *  l'édite, même si certains de ses champs viennent encore du groupe. */
  layer: 'group' | 'local';
  type: BranchType;
  /** Titre lisible — sert de `### heading` dans le bloc injecté. */
  title: string;
  /** Le signal de routage : « charge-moi quand… ». Lu par le routeur IA. */
  loadWhen: string;
  /** Corps markdown du fichier (hors frontmatter). */
  content: string;
  childPaths: string[];
};

/** L'arbre complet chargé depuis le disque. */
export type ContextTree = {
  /** Racine du dossier `.contextree/` — l'arbre partagé. */
  dir: string;
  /** Racine du calque personnel `.contextree.local/`, qu'il existe ou non. */
  localDir: string;
  /** Contenu de `root.md` — toujours injecté en tête, jamais routé. */
  rootContent: string;
  branches: Map<string, Branch>;
  /** Ordre déterministe (parcours en profondeur, alphabétique) — les indices
   *  envoyés au routeur en dépendent, donc il doit être stable. */
  order: string[];
};

/** Format d'échange pour le partage (phase 1). Plat : `parent` pointe vers le
 *  `path` d'une autre entrée de la liste. */
export type ContextPack = {
  v: 1;
  title?: string;
  rootContent: string;
  branches: Array<{
    path: string;
    parent: string | null;
    type: BranchType;
    title: string;
    loadWhen: string;
    content: string;
  }>;
};
