import * as vscode from 'vscode';
import { CanvasPanel } from './canvasPanel.js';
import { ContextTreeProvider, loadCore } from './treeProvider.js';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const searchFrom = folder?.uri.fsPath ?? process.cwd();
  const provider = new ContextTreeProvider(searchFrom);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('contextree.tree', provider),
    vscode.commands.registerCommand('contextree.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('contextree.openCanvas', () =>
      CanvasPanel.show(context, loadCore, searchFrom),
    ),
  );

  if (folder) {
    // L'arbre est du markdown édité à la main : la vue suit le disque, pas
    // l'inverse. Tout `.md` touché sous `.contextree/` recharge les deux vues.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '**/.contextree/**/*.md'),
    );
    const reload = () => {
      void provider.refresh();
      void CanvasPanel.refreshIfOpen();
    };
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(reload),
      watcher.onDidChange(reload),
      watcher.onDidDelete(reload),
    );
  }

  void provider.refresh();
}

export function deactivate(): void {}
