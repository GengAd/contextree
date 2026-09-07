import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { isBranchType, type Branch, type BranchType, type ContextTree } from './types.js';

export const DIR_NAME = '.contextree';
export const ROOT_FILE = 'root.md';

/**
 * Convention de nommage sur le disque :
 *
 *   .contextree/
 *     root.md                    → le hub racine (toujours injecté)
 *     archi-store.md             → une branche
 *     archi-store/               → ses enfants (même nom que le fichier, sans .md)
 *       commandes-npm.md
 *
 * Le *parent* est porté par l'arborescence de dossiers, le *type* par le
 * frontmatter. Les deux axes restent ainsi indépendants et éditables à la main.
 */

/** Remonte depuis `from` jusqu'à trouver un dossier `.contextree/` (comme `.git`). */
export async function findTreeDir(from: string = process.cwd()): Promise<string | null> {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, DIR_NAME);
    if (await isDir(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadTree(dir: string): Promise<ContextTree> {
  const branches = new Map<string, Branch>();
  const order: string[] = [];

  await walk(dir, null, branches, order, dir);

  for (const branch of branches.values()) {
    if (branch.parentPath) branches.get(branch.parentPath)!.childPaths.push(branch.path);
  }

  return { dir, rootContent: await readRoot(dir), branches, order };
}

async function readRoot(dir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(dir, ROOT_FILE), 'utf8');
    return parseFrontmatter(raw).body;
  } catch {
    return '';
  }
}

async function walk(
  dir: string,
  parentPath: string | null,
  branches: Map<string, Branch>,
  order: string[],
  treeDir: string,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const files = new Set(
    entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.slice(0, -3)),
  );
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

  // Un dossier sans `.md` frère est un simple regroupement : on lui fabrique un
  // hub vide plutôt que d'ignorer silencieusement tout ce qu'il contient. Ça
  // laisse ranger l'arbre à la main sans piège.
  const slugs = [...new Set([...files, ...dirs])].sort();

  for (const slug of slugs) {
    if (dir === treeDir && `${slug}.md` === ROOT_FILE) continue;
    const branchPath = parentPath ? `${parentPath}/${slug}` : slug;
    const hasFile = files.has(slug);

    const { data, body } = hasFile
      ? parseFrontmatter(await fs.readFile(path.join(dir, `${slug}.md`), 'utf8'))
      : { data: {} as Record<string, string>, body: '' };

    branches.set(branchPath, {
      path: branchPath,
      parentPath,
      type: isBranchType(data['type']) ? data['type'] : 'context',
      title: data['title']?.trim() || slug.replace(/[-_]/g, ' '),
      loadWhen: data['load_when']?.trim() || data['title']?.trim() || slug,
      content: body,
      childPaths: [],
    });
    order.push(branchPath);

    const childDir = path.join(dir, slug);
    if (dirs.includes(slug)) await walk(childDir, branchPath, branches, order, treeDir);
  }
}

/** Chemin disque d'une branche, à partir de son `path` logique. */
export function branchFile(treeDir: string, branchPath: string): string {
  const parts = branchPath.split('/');
  const last = parts.pop()!;
  return path.join(treeDir, ...parts, `${last}.md`);
}

export async function writeBranch(
  treeDir: string,
  input: { path: string; type: BranchType; title: string; loadWhen: string; content: string },
): Promise<string> {
  const file = branchFile(treeDir, input.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    serializeFrontmatter(
      { type: input.type, title: input.title, load_when: input.loadWhen },
      input.content,
    ),
    'utf8',
  );
  return file;
}

/** Supprime une branche. Ses enfants (le dossier homonyme) partent avec elle. */
export async function deleteBranch(treeDir: string, branchPath: string): Promise<void> {
  const file = branchFile(treeDir, branchPath);
  await fs.rm(file, { force: true });
  await fs.rm(file.slice(0, -3), { recursive: true, force: true });
}

/**
 * Déplace ou renomme une branche — c'est la même opération : changer son `path`.
 *
 * Le `path` *est* l'identité d'une branche, et il vit à deux endroits sur le
 * disque : le `.md` et le dossier homonyme qui porte ses enfants. Les deux
 * bougent ensemble ou pas du tout.
 *
 * Ce qu'on refuse, et pourquoi :
 *  - une arrivée déjà occupée — on n'écrase jamais une branche existante ;
 *  - un déplacement sous son propre descendant — l'arbre y perdrait la branche
 *    et tout son sous-arbre d'un coup ;
 *  - un chemin qui sort du dossier (`..`, chemin absolu, segment vide).
 *
 * Ce que ça invalide, et pourquoi ce n'est pas grave : le cache de session et le
 * journal des tours référencent des `path`. Les deux filtrent déjà ce qu'ils ne
 * retrouvent pas dans l'arbre — un chemin périmé disparaît, il ne casse rien. Un
 * pack déjà exporté, lui, est un instantané : il garde les anciens chemins, et
 * c'est le comportement attendu.
 */
export async function moveBranch(treeDir: string, from: string, to: string): Promise<string> {
  const source = normalizeBranchPath(from);
  const target = normalizeBranchPath(to);
  if (source === target) return branchFile(treeDir, target);
  if (target.startsWith(`${source}/`)) {
    throw new Error(`Déplacement impossible : ${target} est sous ${source}.`);
  }

  const srcFile = branchFile(treeDir, source);
  const srcDir = srcFile.slice(0, -3);
  const dstFile = branchFile(treeDir, target);
  const dstDir = dstFile.slice(0, -3);

  const hasFile = await exists(srcFile);
  const hasChildren = await isDir(srcDir);
  if (!hasFile && !hasChildren) throw new Error(`Branche introuvable : ${source}`);
  if ((await exists(dstFile)) || (await isDir(dstDir))) {
    throw new Error(`Une branche occupe déjà ${target}.`);
  }

  await fs.mkdir(path.dirname(dstFile), { recursive: true });
  if (hasFile) await fs.rename(srcFile, dstFile);
  if (hasChildren) {
    try {
      await fs.rename(srcDir, dstDir);
    } catch (err) {
      // Deux renommages ne peuvent pas être atomiques ensemble : si le second
      // échoue, on remet le premier. Mieux vaut un arbre inchangé qu'une branche
      // séparée de ses enfants.
      if (hasFile) await fs.rename(dstFile, srcFile).catch(() => {});
      throw err;
    }
  }

  // Un dossier vide laissé derrière deviendrait un hub implicite : une branche
  // fantôme, sans contenu et sans enfants. On nettoie la trace du départ.
  await pruneEmpty(treeDir, path.dirname(srcFile));
  return dstFile;
}

/** Refuse tout ce qui sortirait de `.contextree/`. Même garde que pour un pack :
 *  un chemin peut venir d'ailleurs (MCP, vue, pack importé). */
function normalizeBranchPath(branchPath: string): string {
  // On refuse un chemin absolu plutôt que de le rendre relatif : réinterpréter
  // silencieusement ce qu'un appelant a demandé est la pire des réponses.
  const trimmed = branchPath.trim().replace(/\/+$/, '');
  const segments = trimmed.split('/');
  const refused =
    !trimmed ||
    path.isAbsolute(trimmed) ||
    trimmed.includes('\\') ||
    segments.some(s => !s || s === '.' || s === '..');
  if (refused) throw new Error(`Chemin de branche refusé : ${branchPath}`);
  return segments.join('/');
}

async function pruneEmpty(treeDir: string, dir: string): Promise<void> {
  let current = path.resolve(dir);
  const root = path.resolve(treeDir);
  while (current !== root && current.startsWith(root)) {
    try {
      if ((await fs.readdir(current)).length) return;
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function writeRoot(treeDir: string, content: string): Promise<void> {
  await fs.mkdir(treeDir, { recursive: true });
  await fs.writeFile(path.join(treeDir, ROOT_FILE), `${content.trim()}\n`, 'utf8');
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Slug sûr pour un nom de fichier, à partir d'un titre libre. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'branche';
}
