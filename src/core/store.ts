import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { isBranchType, type Branch, type BranchType, type ContextTree } from './types.js';
import { coreText } from './messages.js';

export const DIR_NAME = '.contextree';
/** Le calque personnel : même format, dossier frère. Voir `overlay` plus bas. */
export const LOCAL_DIR_NAME = '.contextree.local';
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

/** Le calque local d'un arbre : `.contextree.local/`, dossier frère. */
export function localDirFor(treeDir: string): string {
  return path.join(path.dirname(treeDir), LOCAL_DIR_NAME);
}

/**
 * Charge l'arbre, calque local superposé.
 *
 * **La résolution est faite ici, pas au rendu.** Le routeur lit les `load_when`
 * avant que quoi que ce soit ne soit rendu : s'il voyait celui du groupe pendant
 * que le rendu injecte le contenu local, il router*ait* sur une branche et
 * charger*ait* l'autre. Résoudre au chargement donne en plus l'arbre superposé à
 * tout le reste — `withAncestors`, `formatTree`, la barre latérale, la toile —
 * sans qu'aucun d'eux n'ait à savoir qu'il y a deux dossiers.
 *
 * La règle : **même chemin des deux côtés ⇒ le local gagne**, champ par champ ;
 * chemin qui n'existe qu'en local ⇒ il s'ajoute. Un champ absent du fichier
 * local retombe sur celui du groupe — c'est ce qui permet de ne surcharger qu'un
 * `load_when` sans recopier le corps, et ce qui fait qu'un simple dossier local
 * porteur d'enfants n'efface pas la branche de groupe qui lui correspond.
 */
export async function loadTree(
  dir: string,
  opts: { withLocal?: boolean } = {},
): Promise<ContextTree> {
  const group = new Map<string, RawBranch>();
  await walk(dir, null, group, dir);

  // `withLocal: false` donne l'arbre du groupe seul. C'est ce que lit la sync :
  // le calque personnel ne doit jamais quitter la machine.
  const localDir = localDirFor(dir);
  const local = new Map<string, RawBranch>();
  if (opts.withLocal !== false) await walk(localDir, null, local, localDir);

  const branches = new Map<string, Branch>();
  for (const [branchPath, raw] of group) branches.set(branchPath, materialize(raw, 'group'));
  for (const [branchPath, raw] of local) {
    branches.set(branchPath, materialize(raw, 'local', group.get(branchPath)));
  }

  // L'ordre est contractuel : les indices envoyés au routeur en dépendent. Le
  // parcours en profondeur alphabétique se reconstruit segment par segment — un
  // tri lexicographique nu se tromperait, `-` passant avant `/` (`a`, `a-b`,
  // `a/b` au lieu de `a`, `a/b`, `a-b`).
  const order = [...branches.keys()].sort(compareBranchPaths);

  for (const branchPath of order) {
    const branch = branches.get(branchPath)!;
    if (branch.parentPath) branches.get(branch.parentPath)?.childPaths.push(branchPath);
  }

  const rootContent =
    (opts.withLocal === false ? '' : await readRoot(localDir)) || (await readRoot(dir));
  return { dir, localDir, rootContent, branches, order };
}

/** Le fichier d'une branche, dans le dossier d'où elle vient. */
export function fileForBranch(tree: ContextTree, branchPath: string): string {
  const branch = tree.branches.get(branchPath);
  return branchFile(branch?.layer === 'local' ? tree.localDir : tree.dir, branchPath);
}

export function compareBranchPaths(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) return as[i]! < bs[i]! ? -1 : 1;
  }
  return as.length - bs.length;
}

/** Ce qu'on a lu sur le disque, avant tout défaut : `data` dit quels champs le
 *  fichier portait vraiment, et c'est ce qui rend la superposition possible. */
type RawBranch = {
  path: string;
  parentPath: string | null;
  slug: string;
  data: Record<string, string>;
  body: string;
};

function materialize(raw: RawBranch, layer: 'group' | 'local', under?: RawBranch): Branch {
  const field = (key: string): string | undefined =>
    raw.data[key]?.trim() || under?.data[key]?.trim() || undefined;
  const type = raw.data['type'] ?? under?.data['type'];
  const title = field('title');
  return {
    path: raw.path,
    parentPath: raw.parentPath,
    layer,
    type: isBranchType(type) ? type : 'context',
    title: title || raw.slug.replace(/[-_]/g, ' '),
    loadWhen: field('load_when') || title || raw.slug,
    content: raw.body.trim() ? raw.body : (under?.body ?? raw.body),
    childPaths: [],
  };
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
  branches: Map<string, RawBranch>,
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

    branches.set(branchPath, { path: branchPath, parentPath, slug, data, body });

    const childDir = path.join(dir, slug);
    if (dirs.includes(slug)) await walk(childDir, branchPath, branches, treeDir);
  }
}

/** Chemin disque d'une branche, à partir de son `path` logique. */
export function branchFile(treeDir: string, branchPath: string): string {
  const parts = branchPath.split('/');
  const last = parts.pop()!;
  return path.join(treeDir, ...parts, `${last}.md`);
}

/**
 * Écrit une branche.
 *
 * Par fichier temporaire renommé : un `pull` réécrit tout l'arbre, et un hook
 * peut le lire au même instant. Il doit voir l'ancienne version ou la nouvelle,
 * jamais un `.md` à moitié écrit.
 */
export async function writeBranch(
  treeDir: string,
  input: { path: string; type: BranchType; title: string; loadWhen: string; content: string },
): Promise<string> {
  const file = branchFile(treeDir, input.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    tmp,
    serializeFrontmatter(
      { type: input.type, title: input.title, load_when: input.loadWhen },
      input.content,
    ),
    'utf8',
  );
  await fs.rename(tmp, file);
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
    throw new Error(coreText().moveUnderItself(target, source));
  }

  const srcFile = branchFile(treeDir, source);
  const srcDir = srcFile.slice(0, -3);
  const dstFile = branchFile(treeDir, target);
  const dstDir = dstFile.slice(0, -3);

  const hasFile = await exists(srcFile);
  const hasChildren = await isDir(srcDir);
  if (!hasFile && !hasChildren) throw new Error(coreText().branchNotFound(source));
  if ((await exists(dstFile)) || (await isDir(dstDir))) {
    throw new Error(coreText().targetTaken(target));
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
  if (refused) throw new Error(coreText().pathRefused(branchPath));
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

/**
 * Les fichiers de consignes déjà écrits pour une IA dans ce projet.
 *
 * Sur un repo qui a un `CLAUDE.md`, des règles Cursor ou un README nourri,
 * repartir des quatre branches génériques d'`initTree` jette ce qui existe.
 * Cette liste sert à **inviter** l'IA de l'utilisateur à les lire — contextree
 * ne les découpe pas lui-même : il n'y a pas de moteur de génération dans le
 * cœur, et il n'y en aura pas. Deviner un `load_when` à la place de quelqu'un,
 * c'est produire la branche qu'il ne relira jamais.
 *
 * Les chemins sont rendus relatifs au projet, dans l'ordre où ils comptent :
 * un fichier écrit *pour une IA* avant un fichier écrit pour un humain.
 */
export async function detectInstructionFiles(projectDir: string): Promise<string[]> {
  const candidates = [
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '.cursor/rules',
    '.github/copilot-instructions.md',
    'README.md',
    'CONTRIBUTING.md',
  ];
  const found: string[] = [];
  for (const rel of candidates) {
    try {
      await fs.stat(path.join(projectDir, rel));
      found.push(rel);
    } catch {
      // Absent : le suivant.
    }
  }
  return found;
}

export async function writeRoot(treeDir: string, content: string): Promise<void> {
  await fs.mkdir(treeDir, { recursive: true });
  const file = path.join(treeDir, ROOT_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${content.trim()}\n`, 'utf8');
  await fs.rename(tmp, file);
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
  return slug || coreText().defaultSlug;
}

/**
 * L'arbre de départ : une racine et quatre branches.
 *
 * Il vit ici et pas dans la CLI parce que la vue le crée aussi — deux copies
 * du tronc auraient divergé au premier ajustement de `load_when`, et c'est
 * précisément le champ dont dépend tout le routage.
 *
 * Quatre branches, pas quarante : un arbre entier deviné d'un coup n'est relu
 * par personne. Celles-ci sont des amorces à corriger, et leur `load_when` est
 * écrit comme une condition — c'est la forme qu'on veut voir imitée.
 */
/**
 * Le calque local n'est « à personne d'autre » que si git l'ignore.
 *
 * Tout le choix de faire du calque un **dossier frère** plutôt qu'un champ du
 * frontmatter reposait là-dessus : deux dossiers rendent impossible qu'un
 * réglage personnel parte au groupe. Sauf que rien ne l'écrivait (constaté le
 * 11 septembre 2026, en montant un vrai submodule) — ce dépôt-ci avait la ligne
 * à la main, et un projet qui créait son arbre n'obtenait rien. Un `git add -A`
 * chez un utilisateur poussait ses notes au groupe : exactement ce que le design
 * prétendait rendre impossible par construction.
 *
 * On **ajoute une ligne**, on ne réécrit jamais : le `.gitignore` appartient à
 * l'utilisateur. Rien à faire hors d'un dépôt git — un `.gitignore` posé dans un
 * dossier non versionné serait du bruit.
 */
export async function ensureLocalIgnored(projectDir: string): Promise<'added' | 'present' | 'skipped'> {
  try {
    // Pas de dépôt, pas de sujet. `.git` est un dossier dans un clone, un
    // *fichier* dans un submodule : `stat` répond oui aux deux.
    await fs.stat(path.join(projectDir, '.git'));
  } catch {
    return 'skipped';
  }

  const file = path.join(projectDir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    // Absent : on le crée avec la seule ligne qui nous regarde.
  }

  const wanted = `${LOCAL_DIR_NAME}/`;
  if (existing.split('\n').some(l => l.trim() === wanted || l.trim() === LOCAL_DIR_NAME)) {
    return 'present';
  }

  const comment = coreText().gitignoreComment;
  const body = existing.trim()
    ? `${existing.replace(/\n*$/, '')}\n\n${comment}\n${wanted}\n`
    : `${comment}\n${wanted}\n`;
  await fs.writeFile(file, body, 'utf8');
  return 'added';
}

export async function initTree(
  projectDir: string,
  opts: { force?: boolean } = {},
): Promise<{ dir: string; branches: number }> {
  const dir = path.join(projectDir, DIR_NAME);
  if (!opts.force && (await isDir(dir))) {
    throw new Error(coreText().treeExists(DIR_NAME));
  }
  const project = path.basename(projectDir);
  await ensureLocalIgnored(projectDir);

  // L'arbre de départ suit la langue de l'utilisateur (14 septembre 2026) : un
  // anglophone qui lance `init` corrige des amorces qu'il sait lire. Même forme
  // dans les deux langues — une racine, quatre branches.
  const t = coreText();
  await writeRoot(dir, t.starterRoot(project));
  const starters: Parameters<typeof writeBranch>[1][] = [
    {
      path: t.starterIdentityPath,
      type: 'identity',
      title: t.starterIdentityTitle,
      loadWhen: t.starterIdentityLoadWhen,
      content: t.starterIdentityContent(project),
    },
    {
      path: t.starterRulesPath,
      type: 'rule',
      title: t.starterRulesTitle,
      loadWhen: t.starterRulesLoadWhen,
      content: t.starterRulesContent,
    },
    {
      path: t.starterArchPath,
      type: 'context',
      title: t.starterArchTitle,
      loadWhen: t.starterArchLoadWhen,
      content: t.starterArchContent,
    },
    {
      path: t.starterCommandsPath,
      type: 'reference',
      title: t.starterCommandsTitle,
      loadWhen: t.starterCommandsLoadWhen,
      content: t.starterCommandsContent,
    },
  ];
  for (const branch of starters) await writeBranch(dir, branch);

  return { dir, branches: starters.length };
}
