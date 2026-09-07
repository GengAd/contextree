import * as path from 'node:path';
import * as vscode from 'vscode';
// Le paquet est ESM, ce fichier est compilé en CommonJS : les types doivent
// être résolus en mode `import`, et le module chargé par `import()` dynamique.
import type { Branch, BranchType, ContextTree } from '@gengad/contextree' with { 'resolution-mode': 'import' };

/** `root.md` — toujours injecté, jamais routé. Ce n'est pas une branche, mais
 *  il doit se lire et s'éditer comme les autres, donc il a sa ligne. */
export const ROOT_ELEMENT = ':root';

type Core = typeof import('@gengad/contextree', { with: { 'resolution-mode': 'import' } });

let corePromise: Promise<Core> | undefined;

/** Chargement paresseux et unique du cœur, partagé par les deux vues. */
export function loadCore(): Promise<Core> {
  corePromise ??= import('@gengad/contextree');
  return corePromise;
}

const ICONS: Record<BranchType, string> = {
  identity: 'account',
  rule: 'law',
  context: 'book',
  reference: 'link',
  skill: 'tools',
};

/** Vue arborescente de `.contextree/`. Lecture seule : un clic ouvre le `.md`,
 *  qui reste la source de vérité — l'édition se fait dans l'éditeur. */
export class ContextTreeProvider implements vscode.TreeDataProvider<string> {
  private tree: ContextTree | null = null;
  private readonly changed = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly searchFrom: string) {}

  get treeDir(): string | null {
    return this.tree?.dir ?? null;
  }

  async refresh(): Promise<void> {
    const { findTreeDir, loadTree } = await loadCore();
    try {
      const dir = await findTreeDir(this.searchFrom);
      this.tree = dir ? await loadTree(dir) : null;
    } catch {
      // Un arbre à moitié écrit ne doit pas laisser une vue cassée : on vide.
      this.tree = null;
    }
    await vscode.commands.executeCommand('setContext', 'contextree.hasTree', this.tree !== null);
    this.changed.fire(undefined);
  }

  getChildren(element?: string): string[] {
    const tree = this.tree;
    if (!tree) return [];
    if (element === undefined) {
      const roots = tree.order.filter(p => tree.branches.get(p)?.parentPath === null);
      return [ROOT_ELEMENT, ...roots];
    }
    if (element === ROOT_ELEMENT) return [];
    return tree.branches.get(element)?.childPaths ?? [];
  }

  async getTreeItem(element: string): Promise<vscode.TreeItem> {
    const tree = this.tree;
    if (!tree) return new vscode.TreeItem(element);

    const { branchFile, ROOT_FILE } = await loadCore();

    if (element === ROOT_ELEMENT) {
      const item = new vscode.TreeItem('Racine', vscode.TreeItemCollapsibleState.None);
      item.description = 'toujours injectée';
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.tooltip = tooltip('Racine', 'toujours injectée, jamais routée', tree.rootContent);
      item.resourceUri = vscode.Uri.file(path.join(tree.dir, ROOT_FILE));
      item.command = open(item.resourceUri);
      item.contextValue = 'contextree.root';
      return item;
    }

    const branch = tree.branches.get(element);
    if (!branch) return new vscode.TreeItem(element);

    const item = new vscode.TreeItem(
      branch.title,
      branch.childPaths.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = branch.path;
    item.description = branch.type;
    item.iconPath = new vscode.ThemeIcon(ICONS[branch.type] ?? 'circle-outline');
    item.tooltip = tooltip(branch.title, branch.loadWhen, branch.content, branch);
    item.resourceUri = vscode.Uri.file(branchFile(tree.dir, branch.path));
    item.command = open(item.resourceUri);
    item.contextValue = 'contextree.branch';
    return item;
  }
}

function open(uri: vscode.Uri): vscode.Command {
  return { command: 'vscode.open', title: 'Ouvrir la branche', arguments: [uri] };
}

/** Le `load_when` est le vrai contenu de la vue : c'est lui qui décide de ce
 *  qui sera chargé, et c'est lui qu'on relit pour corriger un routage. */
function tooltip(
  title: string,
  loadWhen: string,
  content: string,
  branch?: Branch,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**${branch ? ` · \`${branch.type}\`` : ''}\n\n`);
  md.appendMarkdown(`_charge-moi quand_ : ${loadWhen}\n\n`);
  const body = content.trim();
  if (body) {
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(body.length > 600 ? `${body.slice(0, 600)}…` : body);
  }
  return md;
}
