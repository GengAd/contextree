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
const TYPES: { type: BranchType; label: string; detail: string }[] = [
  { type: 'identity', label: 'identity', detail: "Qui est l'assistant sur ce projet. Injectée sous « Rules », avant le contexte." },
  { type: 'rule', label: 'rule', detail: 'Une contrainte à respecter. Injectée sous « Rules », avant le contexte.' },
  { type: 'context', label: 'context', detail: 'Du contexte de domaine. Injectée sous « Context ».' },
  { type: 'reference', label: 'reference', detail: 'Une référence à consulter. Injectée sous « Context ».' },
  { type: 'skill', label: 'skill', detail: 'Un savoir-faire, une procédure. Injectée sous « Context ».' },
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
    vscode.window.showErrorMessage(`Branche inconnue : ${branchPath}`);
    return false;
  }

  const loadWhen = oneLine(patch.loadWhen);
  if (!loadWhen) {
    vscode.window.showErrorMessage(
      `« ${branch.title} » : sans « charger quand », la branche ne serait plus jamais routée.`,
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

  const answer = await vscode.window.showWarningMessage(
    `${path.basename(file)} est ouvert avec des modifications non enregistrées.`,
    {
      modal: true,
      detail:
        "Écrire depuis la toile passerait par-dessus le fichier. L'onglet garderait sa version et signalerait un conflit à son propre enregistrement.",
    },
    "Voir l'onglet",
    'Écrire quand même',
  );
  if (answer === 'Écrire quand même') return true;
  if (answer === "Voir l'onglet") await vscode.window.showTextDocument(doc);
  return false;
}

/** Un scalaire de frontmatter tient sur une ligne — on aplatit plutôt que de
 *  produire un échappement que le parseur ne relira pas. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
