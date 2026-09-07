import * as vscode from 'vscode';
import { CanvasPanel } from './canvasPanel.js';
import { ContextTreeProvider, loadCore } from './treeProvider.js';
import { StatusBar, lastTurn, watchJournal } from './statusBar.js';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const searchFrom = folder?.uri.fsPath ?? process.cwd();
  const provider = new ContextTreeProvider(searchFrom);
  const status = new StatusBar();

  /** Ce qui a réellement été chargé au dernier tour : la barre d'état et la
   *  toile lisent le même journal, elles ne peuvent pas se contredire. */
  const refreshTurn = async (): Promise<void> => {
    try {
      const core = await loadCore();
      const dir = await core.findTreeDir(searchFrom);
      if (!dir) return status.hide();
      const tree = await core.loadTree(dir);
      const total = tree.order.length;
      const last = await lastTurn(core, dir, total);
      status.show(last, total);
      await CanvasPanel.setTurn(last);
    } catch {
      // La barre d'état est un badge, pas un chemin critique.
      status.hide();
    }
  };

  context.subscriptions.push(
    status.disposable,
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
      void refreshTurn();
    };
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(reload),
      watcher.onDidChange(reload),
      watcher.onDidDelete(reload),
    );
  }

  // Le journal vit hors du workspace : son observateur est à part, et c'est lui
  // qui fait bouger le badge pendant une conversation — aucun `.md` ne change
  // quand un tour est routé.
  void loadCore()
    .then(core => watchJournal(core, () => void refreshTurn()))
    .then(d => context.subscriptions.push(d))
    .catch(() => {
      // Sans observateur, le badge se met à jour au prochain rechargement de la
      // vue. Dégradé, jamais bloquant.
    });

  void provider.refresh();
  void refreshTurn();
}

export function deactivate(): void {}
