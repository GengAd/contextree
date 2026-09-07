import * as path from 'node:path';
import * as vscode from 'vscode';
// Le paquet est ESM, ce fichier est compilé en CommonJS : les types doivent
// être résolus en mode `import`, et le module chargé par `import()` dynamique.
import type { AiWrite, Branch, BranchType, ContextTree } from '@gengad/contextree' with { 'resolution-mode': 'import' };

/** `root.md` — toujours injecté, jamais routé. Ce n'est pas une branche, mais
 *  il doit se lire et s'éditer comme les autres, donc il a sa ligne. */
export const ROOT_ELEMENT = ':root';

/**
 * Combien de temps une écriture de l'IA reste signalée dans les vues.
 *
 * C'est le garde-fou du régime d'écriture directe : l'IA écrit dans l'arbre qui
 * lui est ensuite réinjecté, boucle fermée. Assez long pour qu'on la voie en
 * revenant à l'éditeur, assez court pour que le signal veuille encore dire
 * « à l'instant » plutôt que « un jour ».
 */
export const FRESH_MS = 15 * 60 * 1000;

/** Les écritures de l'IA encore fraîches, la plus récente par branche. */
export async function freshWrites(
  core: typeof import('@gengad/contextree', { with: { 'resolution-mode': 'import' } }),
  treeDir: string,
): Promise<Map<string, AiWrite>> {
  const cutoff = Date.now() - FRESH_MS;
  const fresh = new Map<string, AiWrite>();
  try {
    for (const w of await core.readAiWrites(treeDir)) {
      if (w.at >= cutoff) fresh.set(w.path, w);
    }
  } catch {
    // Pas de trace, pas de pastille. Jamais une raison de casser la vue.
  }
  return fresh;
}

/** « il y a 2 min », pour une pastille qui doit se lire d'un coup d'œil. */
export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "à l'instant";
  return `il y a ${Math.round(seconds / 60)} min`;
}

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
  private writes = new Map<string, AiWrite>();
  private readonly changed = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly searchFrom: string) {}

  get treeDir(): string | null {
    return this.tree?.dir ?? null;
  }

  async refresh(): Promise<void> {
    const core = await loadCore();
    try {
      const dir = await core.findTreeDir(this.searchFrom);
      this.tree = dir ? await core.loadTree(dir) : null;
      this.writes = dir ? await freshWrites(core, dir) : new Map();
    } catch {
      // Un arbre à moitié écrit ne doit pas laisser une vue cassée : on vide.
      this.tree = null;
      this.writes = new Map();
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
    // Une écriture de l'IA se voit à l'endroit où elle a eu lieu, tant qu'elle
    // est fraîche : c'est tout l'intérêt de la trace.
    const write = this.writes.get(branch.path);
    item.description = write ? `${branch.type} · IA ${ago(write.at)}` : branch.type;
    item.iconPath = new vscode.ThemeIcon(
      ICONS[branch.type] ?? 'circle-outline',
      write ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') : undefined,
    );
    item.tooltip = tooltip(branch.title, branch.loadWhen, branch.content, branch, write);
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
  write?: AiWrite,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**${branch ? ` · \`${branch.type}\`` : ''}\n\n`);
  if (write) {
    const verb = { upsert: 'écrite', delete: 'supprimée', move: 'déplacée' }[write.op];
    md.appendMarkdown(`✎ _${verb} par l'IA ${ago(write.at)}_`);
    md.appendMarkdown(write.why ? ` — ${write.why}\n\n` : '\n\n');
  }
  md.appendMarkdown(`_charge-moi quand_ : ${loadWhen}\n\n`);
  const body = content.trim();
  if (body) {
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(body.length > 600 ? `${body.slice(0, 600)}…` : body);
  }
  return md;
}
