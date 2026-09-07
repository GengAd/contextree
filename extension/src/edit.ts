import * as vscode from 'vscode';
import type { Branch, BranchType, ContextTree } from '@gengad/contextree' with { 'resolution-mode': 'import' };

type Core = typeof import('@gengad/contextree', { with: { 'resolution-mode': 'import' } });

/**
 * Édition de la **structure** de l'arbre : créer, renommer, changer le type,
 * déplacer, supprimer.
 *
 * Le contenu, lui, reste édité dans le `.md` qui s'ouvre à côté — c'est la ligne
 * de `perimetre.md`. Ce ne sont pas des choses qu'on fait en ouvrant un
 * fichier : ce sont des opérations sur des fichiers et des dossiers.
 *
 * Une seule implémentation, deux appelants : le menu contextuel de la barre
 * latérale et les boutons de la carte sélectionnée sur la toile. Toutes
 * renvoient le chemin touché (ou `null` si l'utilisateur a renoncé), pour que
 * l'appelant puisse enchaîner — ouvrir le `.md`, resélectionner la carte.
 */

const TYPES: { type: BranchType; label: string; detail: string }[] = [
  { type: 'identity', label: 'identity', detail: "Qui est l'assistant sur ce projet. Garantie en repli." },
  { type: 'rule', label: 'rule', detail: 'Une contrainte à respecter. Garantie en repli.' },
  { type: 'context', label: 'context', detail: 'Du contexte de domaine. Purement routée.' },
  { type: 'reference', label: 'reference', detail: 'Une référence à consulter. Purement routée.' },
  { type: 'skill', label: 'skill', detail: 'Un savoir-faire, une procédure. Purement routée.' },
];

/** Crée une branche, à la racine ou sous `parentPath`. */
export async function createBranch(
  core: Core,
  tree: ContextTree,
  parentPath: string | null,
): Promise<string | null> {
  const title = await vscode.window.showInputBox({
    title: parentPath ? `Nouvelle branche sous « ${label(tree, parentPath)} »` : 'Nouvelle branche',
    prompt: 'Titre de la branche',
    validateInput: v => (v.trim() ? null : 'Un titre est nécessaire.'),
  });
  if (!title) return null;

  const type = await pickType();
  if (!type) return null;

  // Le `load_when` est le seul champ que le modèle ne peut pas deviner : c'est
  // lui qui décide du routage, donc on le demande à la création, pas plus tard.
  const loadWhen = await vscode.window.showInputBox({
    title: `« ${title.trim()} » — charge-moi quand…`,
    prompt: 'La condition de chargement, en clair. C\'est elle que lit le routeur.',
    placeHolder: 'quand la demande touche au format des fichiers',
    validateInput: v => (v.trim() ? null : 'Sans condition de chargement, la branche ne sera jamais routée.'),
  });
  if (!loadWhen) return null;

  const slug = core.slugify(title);
  const branchPath = parentPath ? `${parentPath}/${slug}` : slug;
  if (tree.branches.has(branchPath)) {
    vscode.window.showErrorMessage(`Une branche occupe déjà ${branchPath}.`);
    return null;
  }
  await core.writeBranch(tree.dir, {
    path: branchPath,
    type,
    title: title.trim(),
    loadWhen: loadWhen.trim(),
    content: '',
  });
  return branchPath;
}

/**
 * Renomme une branche — son titre.
 *
 * Si le nom de fichier venait du titre précédent, il suit ; s'il a été choisi à
 * la main, on n'y touche pas. Le `path` est l'identité de la branche : on ne le
 * change pas dans le dos de quelqu'un qui l'a écrit lui-même.
 */
export async function renameBranch(core: Core, tree: ContextTree, branch: Branch): Promise<string | null> {
  const title = await vscode.window.showInputBox({
    title: `Renommer « ${branch.title} »`,
    value: branch.title,
    validateInput: v => (v.trim() ? null : 'Un titre est nécessaire.'),
  });
  if (!title || title.trim() === branch.title) return null;

  await core.writeBranch(tree.dir, {
    path: branch.path,
    type: branch.type,
    title: title.trim(),
    loadWhen: branch.loadWhen,
    content: branch.content,
  });

  const slug = branch.path.split('/').pop()!;
  if (slug !== core.slugify(branch.title)) return branch.path;

  const parent = branch.parentPath;
  const target = parent ? `${parent}/${core.slugify(title)}` : core.slugify(title);
  if (target === branch.path || tree.branches.has(target)) return branch.path;
  await core.moveBranch(tree.dir, branch.path, target);
  return target;
}

/** Change le type d'une branche. Le reste du frontmatter est préservé. */
export async function changeType(core: Core, tree: ContextTree, branch: Branch): Promise<string | null> {
  const type = await pickType(branch.type);
  if (!type || type === branch.type) return null;
  await core.writeBranch(tree.dir, {
    path: branch.path,
    type,
    title: branch.title,
    loadWhen: branch.loadWhen,
    content: branch.content,
  });
  return branch.path;
}

/** Déplace une branche sous un autre parent. Ses enfants suivent. */
export async function moveBranch(core: Core, tree: ContextTree, branch: Branch): Promise<string | null> {
  const items: (vscode.QuickPickItem & { value: string | null })[] = [
    { label: '$(symbol-namespace) Racine', description: 'branche de premier niveau', value: null },
    // Ni la branche elle-même ni son sous-arbre : elle y perdrait tout.
    ...tree.order
      .filter(p => p !== branch.path && !p.startsWith(`${branch.path}/`))
      .map(p => ({ label: tree.branches.get(p)!.title, description: p, value: p })),
    // Et pas son parent actuel : ce serait un déplacement sans déplacement.
  ].filter(i => i.value !== branch.parentPath);

  if (!items.length) {
    vscode.window.showInformationMessage('Aucun autre parent possible.');
    return null;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Déplacer « ${branch.title} »`,
    placeHolder: 'Nouveau parent',
  });
  if (!picked) return null;

  const slug = branch.path.split('/').pop()!;
  const target = picked.value ? `${picked.value}/${slug}` : slug;
  try {
    await core.moveBranch(tree.dir, branch.path, target);
    return target;
  } catch (err) {
    vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Supprime une branche, ses enfants avec elle. Toujours confirmé. */
export async function deleteBranch(core: Core, tree: ContextTree, branch: Branch): Promise<string | null> {
  const kids = descendants(tree, branch.path);
  const answer = await vscode.window.showWarningMessage(
    `Supprimer « ${branch.title} » ?`,
    {
      modal: true,
      detail: kids
        ? `${kids} branche(s) enfant(s) partent avec elle. Le fichier reste dans l'historique git s'il y était.`
        : "Le fichier reste dans l'historique git s'il y était.",
    },
    'Supprimer',
  );
  if (answer !== 'Supprimer') return null;
  await core.deleteBranch(tree.dir, branch.path);
  return branch.path;
}

async function pickType(current?: BranchType): Promise<BranchType | undefined> {
  const picked = await vscode.window.showQuickPick(
    TYPES.map(t => ({
      label: t.type === current ? `$(check) ${t.label}` : t.label,
      detail: t.detail,
      value: t.type,
    })),
    { title: 'Type de branche', placeHolder: current ? `Actuellement : ${current}` : 'identity, rule, context, reference, skill' },
  );
  return picked?.value;
}

function descendants(tree: ContextTree, branchPath: string): number {
  return tree.order.filter(p => p.startsWith(`${branchPath}/`)).length;
}

function label(tree: ContextTree, branchPath: string): string {
  return tree.branches.get(branchPath)?.title ?? branchPath;
}
