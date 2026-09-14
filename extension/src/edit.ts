import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Branch, BranchType, ContextTree } from '@gengad/contextree/view' with { 'resolution-mode': 'import' };

import { ROOT_ELEMENT, type Core } from './treeProvider.js';

/**
 * Édition de l'arbre depuis la vue : la **structure** — créer, renommer,
 * changer le type, déplacer, supprimer — et le **contenu**, `load_when` et
 * corps (`saveBranch`, en bas de ce fichier).
 *
 * Une seule implémentation, deux appelants : le menu contextuel de la barre
 * latérale et les boutons de la carte sélectionnée sur la toile. Toutes
 * renvoient le chemin touché (ou `null` si l'utilisateur a renoncé), pour que
 * l'appelant puisse enchaîner — ouvrir le `.md`, resélectionner la carte.
 */

/**
 * Ce que le type change, et c'est tout : la section du bloc injecté. Les
 * `identity` et `rule` sont rendues sous « Rules », avant « Context », parce
 * qu'une contrainte se lit avant la doc de domaine (`render.ts`).
 *
 * Le type ne décide **pas** du chargement — c'est le `load_when`, ou personne
 * (8 septembre 2026). Ces libellés annonçaient l'inverse jusqu'au 9 septembre :
 * « garantie en repli » pour les deux premiers, « purement routée » pour les
 * autres. C'était la première chose que lisait qui créait une branche.
 */
// Une fonction et non une constante : `vscode.l10n.t` se lit au moment où la
// liste s'affiche, dans la langue de l'éditeur.
const TYPES = (): { type: BranchType; label: string; detail: string }[] => [
  { type: 'identity', label: 'identity', detail: vscode.l10n.t("Who the assistant is on this project. Injected under “Rules”, before the context.") },
  { type: 'rule', label: 'rule', detail: vscode.l10n.t("A constraint to respect. Injected under “Rules”, before the context.") },
  { type: 'context', label: 'context', detail: vscode.l10n.t("Domain context. Injected under “Context”.") },
  { type: 'reference', label: 'reference', detail: vscode.l10n.t("A reference to consult. Injected under “Context”.") },
  { type: 'skill', label: 'skill', detail: vscode.l10n.t("A skill, a procedure. Injected under “Context”.") },
];

/** Crée une branche, à la racine ou sous `parentPath`. */
export async function createBranch(
  core: Core,
  tree: ContextTree,
  parentPath: string | null,
): Promise<string | null> {
  const title = await vscode.window.showInputBox({
    title: parentPath ? vscode.l10n.t('New branch under “{0}”', label(tree, parentPath)) : vscode.l10n.t('New branch'),
    prompt: vscode.l10n.t('Branch title'),
    validateInput: v => (v.trim() ? null : vscode.l10n.t('A title is required.')),
  });
  if (!title) return null;

  const type = await pickType();
  if (!type) return null;

  // Le `load_when` est le seul champ que le modèle ne peut pas deviner : c'est
  // lui qui décide du routage, donc on le demande à la création, pas plus tard.
  const loadWhen = await vscode.window.showInputBox({
    title: vscode.l10n.t('“{0}” — load me when…', title.trim()),
    prompt: vscode.l10n.t('The load condition, in plain words. It is what the router reads.'),
    placeHolder: vscode.l10n.t('when the request touches the file format'),
    validateInput: v => (v.trim() ? null : vscode.l10n.t('Without a load condition, the branch will never be routed.')),
  });
  if (!loadWhen) return null;

  const slug = core.slugify(title);
  const branchPath = parentPath ? `${parentPath}/${slug}` : slug;
  if (tree.branches.has(branchPath)) {
    vscode.window.showErrorMessage(vscode.l10n.t('A branch already exists at {0}.', branchPath));
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
    title: vscode.l10n.t('Rename “{0}”', branch.title),
    value: branch.title,
    validateInput: v => (v.trim() ? null : vscode.l10n.t('A title is required.')),
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
    { label: vscode.l10n.t('$(symbol-namespace) Root'), description: vscode.l10n.t('top-level branch'), value: null },
    // Ni la branche elle-même ni son sous-arbre : elle y perdrait tout.
    ...tree.order
      .filter(p => p !== branch.path && !p.startsWith(`${branch.path}/`))
      .map(p => ({ label: tree.branches.get(p)!.title, description: p, value: p })),
    // Et pas son parent actuel : ce serait un déplacement sans déplacement.
  ].filter(i => i.value !== branch.parentPath);

  if (!items.length) {
    vscode.window.showInformationMessage(vscode.l10n.t('No other parent available.'));
    return null;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Move “{0}”', branch.title),
    placeHolder: vscode.l10n.t('New parent'),
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
  const confirm = vscode.l10n.t('Delete');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete “{0}”?', branch.title),
    {
      modal: true,
      detail: kids
        ? vscode.l10n.t('{0} child branch(es) go with it. The file stays in git history if it was there.', kids)
        : vscode.l10n.t('The file stays in git history if it was there.'),
    },
    confirm,
  );
  if (answer !== confirm) return null;
  await core.deleteBranch(tree.dir, branch.path);
  return branch.path;
}

/** Ce que la toile envoie pour une écriture : deux chaînes, jamais un fichier. */
export type SavePatch = { loadWhen: string; content: string };

/**
 * Écrit le `load_when` et le corps d'une branche depuis la vue.
 *
 * C'est la ligne de `perimetre.md` qui a bougé le 8 septembre 2026 : le contenu
 * s'édite aussi dans la carte, pas seulement dans le `.md` ouvert à côté. Trois
 * choses tiennent la promesse que ça reste sûr.
 *
 * **Le cœur écrit, pas la webview.** La toile n'envoie que deux chaînes ;
 * `writeBranch` sérialise le frontmatter. Un frontmatter invalide n'a donc
 * aucun chemin pour arriver sur le disque — il n'y a pas de code d'écriture à
 * côté du cœur qui pourrait diverger de son parseur.
 *
 * **Le `load_when` tient sur une ligne.** C'est un scalaire de frontmatter, et
 * `parseFrontmatter` ne déséchappe pas ce qu'un multi-ligne produirait : un
 * retour à la ligne collé dans le champ est aplati ici, avant l'écriture.
 *
 * **L'onglet gagne s'il est sale.** Voir `tabAgrees` — c'est le seul endroit où
 * quelque chose que la toile ne voit pas pourrait être perdu.
 */
export async function saveBranch(
  core: Core,
  tree: ContextTree,
  branchPath: string,
  patch: SavePatch,
): Promise<boolean> {
  // La racine n'est pas une branche : pas de frontmatter, pas de `load_when`,
  // et son propre point d'écriture dans le cœur.
  if (branchPath === ROOT_ELEMENT) {
    if (!(await tabAgrees(path.join(tree.dir, core.ROOT_FILE)))) return false;
    await core.writeRoot(tree.dir, patch.content);
    return true;
  }

  const branch = tree.branches.get(branchPath);
  if (!branch) {
    vscode.window.showErrorMessage(vscode.l10n.t('Unknown branch: {0}', branchPath));
    return false;
  }

  const loadWhen = oneLine(patch.loadWhen);
  if (!loadWhen) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('“{0}”: without “load when”, the branch would never be routed again.', branch.title),
    );
    return false;
  }
  if (!(await tabAgrees(core.branchFile(tree.dir, branch.path)))) return false;

  await core.writeBranch(tree.dir, {
    path: branch.path,
    type: branch.type,
    title: branch.title,
    loadWhen,
    content: patch.content,
  });
  return true;
}

/**
 * Le même `.md` ouvert dans un onglet avec des modifications non enregistrées :
 * le seul cas où écrire depuis la toile ferait perdre quelque chose.
 *
 * Rien n'est réellement détruit — l'onglet garde sa version en mémoire et
 * signalerait un conflit à son propre enregistrement — mais personne ne veut
 * découvrir ça plus tard. L'onglet gagne par défaut ; l'écrasement existe, il
 * se demande.
 */
async function tabAgrees(file: string): Promise<boolean> {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
  if (!doc?.isDirty) return true;

  const show = vscode.l10n.t('Show the tab');
  const force = vscode.l10n.t('Write anyway');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('{0} is open with unsaved changes.', path.basename(file)),
    {
      modal: true,
      detail: vscode.l10n.t(
        'Writing from the canvas would overwrite the file. The tab would keep its version and report a conflict when it is saved.',
      ),
    },
    show,
    force,
  );
  if (answer === force) return true;
  if (answer === show) await vscode.window.showTextDocument(doc);
  return false;
}

/** Un scalaire de frontmatter tient sur une ligne — on aplatit plutôt que de
 *  produire un échappement que le parseur ne relira pas. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function pickType(current?: BranchType): Promise<BranchType | undefined> {
  const picked = await vscode.window.showQuickPick(
    TYPES().map(t => ({
      label: t.type === current ? `$(check) ${t.label}` : t.label,
      detail: t.detail,
      value: t.type,
    })),
    {
      title: vscode.l10n.t('Branch type'),
      placeHolder: current ? vscode.l10n.t('Currently: {0}', current) : 'identity, rule, context, reference, skill',
    },
  );
  return picked?.value;
}

function descendants(tree: ContextTree, branchPath: string): number {
  return tree.order.filter(p => p.startsWith(`${branchPath}/`)).length;
}

function label(tree: ContextTree, branchPath: string): string {
  return tree.branches.get(branchPath)?.title ?? branchPath;
}
