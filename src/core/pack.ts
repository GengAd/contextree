import { deflateSync, inflateSync } from 'node:zlib';
import { allBranches } from './tree.js';
import { writeBranch, writeRoot } from './store.js';
import { isBranchType, type ContextPack, type ContextTree } from './types.js';

/**
 * Phase 1 du partage : un arbre s'exporte en un objet plat et autonome.
 *
 * Deux véhicules, aucun backend :
 *  - un fichier JSON, à envoyer / committer,
 *  - un jeton compressé (deflate + base64url), à coller dans un chat.
 *
 * Et comme la source de vérité reste des fichiers markdown, `git` est le
 * troisième véhicule — gratuit.
 */

export function extractPack(tree: ContextTree, title?: string): ContextPack {
  return {
    v: 1,
    ...(title ? { title } : {}),
    rootContent: tree.rootContent,
    branches: allBranches(tree).map(b => ({
      path: b.path,
      parent: b.parentPath,
      type: b.type,
      title: b.title,
      loadWhen: b.loadWhen,
      content: b.content,
    })),
  };
}

/** Écrit un pack dans un dossier `.contextree/`. `mergeRoot` conserve la
 *  racine locale (import dans un arbre existant) au lieu de l'écraser. */
export async function applyPack(
  treeDir: string,
  pack: ContextPack,
  opts: { prefix?: string; mergeRoot?: boolean } = {},
): Promise<string[]> {
  validate(pack);
  const written: string[] = [];

  if (!opts.mergeRoot && pack.rootContent.trim()) {
    await writeRoot(treeDir, pack.rootContent);
  }

  for (const b of pack.branches) {
    const target = opts.prefix ? `${opts.prefix}/${b.path}` : b.path;
    written.push(
      await writeBranch(treeDir, {
        path: target,
        type: b.type,
        title: b.title,
        loadWhen: b.loadWhen,
        content: b.content,
      }),
    );
  }
  return written;
}

export function encodePack(pack: ContextPack): string {
  return deflateSync(Buffer.from(JSON.stringify(pack), 'utf8'), { level: 9 }).toString(
    'base64url',
  );
}

export function decodePack(payload: string): ContextPack {
  const token = payload.trim().replace(/^contextree:/, '');
  let json: string;
  try {
    json = inflateSync(Buffer.from(token, 'base64url')).toString('utf8');
  } catch {
    throw new Error('Jeton contextree illisible (payload corrompu).');
  }
  const pack = JSON.parse(json) as ContextPack;
  validate(pack);
  return pack;
}

function validate(pack: ContextPack): void {
  if (pack?.v !== 1 || typeof pack.rootContent !== 'string' || !Array.isArray(pack.branches)) {
    throw new Error('Format de pack non reconnu.');
  }
  for (const b of pack.branches) {
    if (!b.path || typeof b.content !== 'string' || !isBranchType(b.type)) {
      throw new Error(`Branche invalide dans le pack : ${b?.path ?? '(sans path)'}`);
    }
    if (b.path.includes('..') || b.path.startsWith('/')) {
      throw new Error(`Chemin de branche refusé : ${b.path}`);
    }
  }
}
