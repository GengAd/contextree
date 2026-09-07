import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { stateDir } from './journal.js';
import {
  RemoteError,
  createTree,
  findTree,
  getVersion,
  headVersion,
  myGroups,
  pushVersion,
  versionBranches,
  type RemoteBranch,
  type RemoteVersion,
} from './remote.js';
import { branchFile, loadTree, writeBranch, writeRoot } from './store.js';
import { allBranches } from './tree.js';
import { isBranchType, type BranchType } from './types.js';

/**
 * `pull` et `push`, sur le modèle de git — pas de Dropbox.
 *
 * L'arbre local est la copie de travail. On se souvient de la version dont elle
 * descend (la *base*), et c'est ce qui rend un conflit détectable : trois états
 * à comparer, la base, le distant et le local, jamais deux.
 *
 * **On n'écrase jamais silencieusement.** Une branche modifiée des deux côtés
 * arrête le `pull` et s'affiche ; un `push` sur une base périmée est refusé.
 *
 * **Le calque local ne part jamais** : la sync lit l'arbre avec
 * `withLocal: false`. C'est la propriété qui a fait choisir un dossier séparé
 * plutôt qu'un champ de frontmatter.
 *
 * **Rien ici ne peut casser un prompt en cours.** Ces commandes n'ont aucun lien
 * avec le hook, et `pull` écrit chaque fichier par renommage atomique : un hook
 * qui lit pendant un `pull` voit l'ancienne version ou la nouvelle, jamais un
 * `.md` à moitié écrit.
 */

/** Ce que la copie de travail suit. Local, comme `.git/` : c'est de l'état de
 *  poste de travail, et `.contextree/` ne contient que du markdown. */
export type Tracking = {
  treeId: string;
  groupSlug: string;
  treeSlug: string;
  /** La version dont la copie de travail descend. */
  baseVersionId: string | null;
};

export type BranchDiff = {
  path: string;
  kind: 'ajoutée' | 'modifiée' | 'supprimée';
};

export type PullReport = {
  status: 'à jour' | 'fusionné' | 'conflit' | 'vierge';
  head: RemoteVersion | null;
  incoming: BranchDiff[];
  kept: string[];
  conflicts: string[];
};

export type PushReport = {
  status: 'rien à pousser' | 'poussé' | 'en retard';
  version?: RemoteVersion;
  outgoing: BranchDiff[];
  head?: RemoteVersion | null;
};

// ── Suivi ────────────────────────────────────────────────────────────────────

function trackingFile(treeDir: string): string {
  let resolved = path.resolve(treeDir);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // Pas encore sur le disque : le chemin littéral fera l'affaire.
  }
  const key = createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  return path.join(stateDir(), 'tracking', `${key}.json`);
}

export async function readTracking(treeDir: string): Promise<Tracking | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(trackingFile(treeDir), 'utf8'));
    const t = raw as Partial<Tracking>;
    if (typeof t?.treeId === 'string' && typeof t.treeSlug === 'string') return t as Tracking;
  } catch {
    // Copie de travail non rattachée : ce n'est pas une erreur.
  }
  return null;
}

export async function writeTracking(treeDir: string, tracking: Tracking): Promise<void> {
  const file = trackingFile(treeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(tracking, null, 2)}\n`, 'utf8');
}

/** Rattache la copie de travail à `<groupe>/<arbre>`, en le créant au besoin. */
export async function link(
  treeDir: string,
  groupSlug: string,
  treeSlug: string,
  opts: { create?: boolean } = {},
): Promise<Tracking> {
  let remote = await findTree(groupSlug, treeSlug);
  if (!remote) {
    if (!opts.create) {
      throw new RemoteError(
        `Aucun arbre ${groupSlug}/${treeSlug} — ou tu n'y as pas accès.\n` +
          'Ajoute --create pour le créer.',
      );
    }
    const group = (await myGroups()).find(g => g.slug === groupSlug);
    if (!group) throw new RemoteError(`Tu n'es pas membre du groupe ${groupSlug}.`);
    remote = await createTree(group.id, treeSlug, treeSlug);
  }
  const tracking: Tracking = {
    treeId: remote.id,
    groupSlug,
    treeSlug,
    baseVersionId: null,
  };
  await writeTracking(treeDir, tracking);
  return tracking;
}

export async function requireTracking(treeDir: string): Promise<Tracking> {
  const tracking = await readTracking(treeDir);
  if (!tracking) {
    throw new RemoteError(
      "Cette copie de travail n'est rattachée à aucun arbre distant.\n" +
        'Lance : contextree link <groupe>/<arbre> [--create]',
    );
  }
  return tracking;
}

// ── Fusion à trois voies ─────────────────────────────────────────────────────

type Snapshot = Map<string, RemoteBranch>;

export function snapshotOf(branches: RemoteBranch[]): Snapshot {
  return new Map(branches.map(b => [b.path, b]));
}

function same(a: RemoteBranch | undefined, b: RemoteBranch | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.parentPath === b.parentPath &&
    a.type === b.type &&
    a.title === b.title &&
    a.loadWhen === b.loadWhen &&
    a.content.trim() === b.content.trim()
  );
}

/** Comment trancher les conflits : garder le local, ou prendre le distant. */
export type Resolution = 'mine' | 'theirs';

/**
 * Fusionne trois états : la base commune, le distant et le local.
 *
 * Pour chaque chemin — la table de vérité tient en quatre lignes :
 *  - seul le distant a bougé ⇒ on prend le distant ;
 *  - seul le local a bougé ⇒ on garde le local ;
 *  - les deux ont bougé pareil ⇒ rien à faire ;
 *  - les deux ont bougé différemment ⇒ **conflit**, et on ne choisit pas.
 *
 * `resolve` tranche la dernière ligne, et c'est la seule sortie d'un conflit :
 * une version réglée à la main diffère par construction du distant *et* de la
 * base, donc un `pull` nu la redétecterait indéfiniment. On règle, puis on dit
 * `--mine` (ou `--theirs`) une fois.
 */
export function merge(
  base: Snapshot,
  remote: Snapshot,
  local: Snapshot,
  resolve?: Resolution,
): { merged: Snapshot; incoming: BranchDiff[]; kept: string[]; conflicts: string[] } {
  const merged: Snapshot = new Map();
  const incoming: BranchDiff[] = [];
  const kept: string[] = [];
  const conflicts: string[] = [];

  for (const branchPath of new Set([...base.keys(), ...remote.keys(), ...local.keys()])) {
    const b = base.get(branchPath);
    const r = remote.get(branchPath);
    const l = local.get(branchPath);
    const remoteMoved = !same(b, r);
    const localMoved = !same(b, l);

    if (remoteMoved && localMoved && !same(r, l)) {
      if (!resolve) {
        conflicts.push(branchPath);
        // On garde le local en attendant : un conflit ne doit rien détruire.
        if (l) merged.set(branchPath, l);
        continue;
      }
      // Tranché explicitement : c'est le seul moyen de sortir d'un conflit, la
      // version réglée à la main différant par construction du distant *et* de
      // la base — sans ça, `pull` le redétecterait indéfiniment.
      const chosen = resolve === 'mine' ? l : r;
      if (chosen) merged.set(branchPath, chosen);
      if (resolve === 'mine') kept.push(branchPath);
      else incoming.push({ path: branchPath, kind: !b ? 'ajoutée' : r ? 'modifiée' : 'supprimée' });
      continue;
    }
    if (remoteMoved && !localMoved) {
      if (r) merged.set(branchPath, r);
      incoming.push({ path: branchPath, kind: !b ? 'ajoutée' : r ? 'modifiée' : 'supprimée' });
      continue;
    }
    if (localMoved && !remoteMoved) {
      if (l) merged.set(branchPath, l);
      kept.push(branchPath);
      continue;
    }
    const winner = l ?? r;
    if (winner) merged.set(branchPath, winner);
  }

  const order = (d: { path: string }) => d.path;
  incoming.sort((x, y) => (order(x) < order(y) ? -1 : 1));
  kept.sort();
  conflicts.sort();
  return { merged, incoming, kept, conflicts };
}

/** Ce qui a changé localement depuis la base — ce qu'un `push` enverrait. */
export function outgoingDiff(base: Snapshot, local: Snapshot): BranchDiff[] {
  const diffs: BranchDiff[] = [];
  for (const branchPath of new Set([...base.keys(), ...local.keys()])) {
    const b = base.get(branchPath);
    const l = local.get(branchPath);
    if (same(b, l)) continue;
    diffs.push({ path: branchPath, kind: !b ? 'ajoutée' : l ? 'modifiée' : 'supprimée' });
  }
  return diffs.sort((x, y) => (x.path < y.path ? -1 : 1));
}

// ── L'arbre local, vu comme un instantané ────────────────────────────────────

/** L'arbre du groupe seul : le calque personnel ne quitte jamais la machine. */
export async function localSnapshot(
  treeDir: string,
): Promise<{ branches: RemoteBranch[]; rootContent: string }> {
  const tree = await loadTree(treeDir, { withLocal: false });
  return {
    rootContent: tree.rootContent,
    branches: allBranches(tree).map(b => ({
      path: b.path,
      parentPath: b.parentPath,
      type: b.type,
      title: b.title,
      loadWhen: b.loadWhen,
      content: b.content,
    })),
  };
}

/** Écrit un instantané sur le disque, et retire ce qui n'y est plus. */
async function writeSnapshot(
  treeDir: string,
  snapshot: Snapshot,
  rootContent: string,
): Promise<void> {
  const before = await loadTree(treeDir, { withLocal: false });
  for (const branch of snapshot.values()) {
    await writeBranch(treeDir, {
      path: branch.path,
      type: (isBranchType(branch.type) ? branch.type : 'context') as BranchType,
      title: branch.title,
      loadWhen: branch.loadWhen,
      content: branch.content,
    });
  }
  // Le fichier seul, jamais le dossier homonyme : un enfant peut avoir survécu
  // à la disparition de son parent, et `deleteBranch` l'emporterait avec lui.
  for (const branchPath of before.order) {
    if (!snapshot.has(branchPath)) await fs.rm(branchFile(treeDir, branchPath), { force: true });
  }
  if (rootContent.trim()) await writeRoot(treeDir, rootContent);
}

// ── pull / push ──────────────────────────────────────────────────────────────

export async function pull(
  treeDir: string,
  opts: { resolve?: Resolution } = {},
): Promise<PullReport> {
  const tracking = await requireTracking(treeDir);
  const head = await headVersion(tracking.treeId);
  if (!head) return { status: 'vierge', head: null, incoming: [], kept: [], conflicts: [] };

  const local = snapshotOf((await localSnapshot(treeDir)).branches);
  const base = tracking.baseVersionId
    ? snapshotOf(await versionBranches(tracking.baseVersionId))
    : new Map<string, RemoteBranch>();

  if (head.id === tracking.baseVersionId) {
    return { status: 'à jour', head, incoming: [], kept: [], conflicts: [] };
  }

  const remote = snapshotOf(await versionBranches(head.id));
  const { merged, incoming, kept, conflicts } = merge(base, remote, local, opts.resolve);

  // Un conflit arrête tout : on montre, on ne choisit pas, et rien n'est écrit.
  if (conflicts.length) return { status: 'conflit', head, incoming, kept, conflicts };

  await writeSnapshot(treeDir, merged, head.rootContent);
  await writeTracking(treeDir, { ...tracking, baseVersionId: head.id });
  return { status: 'fusionné', head, incoming, kept, conflicts };
}

export async function push(treeDir: string, message: string): Promise<PushReport> {
  const tracking = await requireTracking(treeDir);
  const head = await headVersion(tracking.treeId);

  // Le garde-fou du modèle git : si le distant a avancé sans nous, on refuse.
  // Pousser écraserait le travail de quelqu'un d'autre sans que rien ne le dise.
  if ((head?.id ?? null) !== (tracking.baseVersionId ?? null)) {
    return { status: 'en retard', outgoing: [], head };
  }

  const { branches, rootContent } = await localSnapshot(treeDir);
  const base = tracking.baseVersionId
    ? snapshotOf(await versionBranches(tracking.baseVersionId))
    : new Map<string, RemoteBranch>();
  const outgoing = outgoingDiff(base, snapshotOf(branches));

  const baseRoot = tracking.baseVersionId
    ? ((await getVersion(tracking.baseVersionId))?.rootContent ?? '')
    : '';
  if (!outgoing.length && baseRoot.trim() === rootContent.trim()) {
    return { status: 'rien à pousser', outgoing: [] };
  }

  const version = await pushVersion({
    treeId: tracking.treeId,
    parentId: tracking.baseVersionId,
    message,
    rootContent,
    branches,
  });
  await writeTracking(treeDir, { ...tracking, baseVersionId: version.id });
  return { status: 'poussé', version, outgoing };
}
