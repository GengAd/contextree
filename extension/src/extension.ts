import * as vscode from 'vscode';
import { CanvasPanel } from './canvasPanel.js';
import { ContextTreeProvider, ROOT_ELEMENT, freshWrites, loadCore } from './treeProvider.js';
import { LoadedDecorations, lastTurn, turnDescription, watchJournal } from './turn.js';
import * as edit from './edit.js';

/** Les opérations de structure exposées par les deux vues. Une seule liste :
 *  la barre latérale et la toile appellent le même code. */
export type EditOp = 'create' | 'child' | 'rename' | 'type' | 'move' | 'delete';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const searchFrom = folder?.uri.fsPath ?? process.cwd();
  const provider = new ContextTreeProvider(searchFrom);
  const view = vscode.window.createTreeView('contextree.tree', { treeDataProvider: provider });
  const decorations = new LoadedDecorations();

  /**
   * Ce qui a réellement été chargé au dernier tour, montré là où on regarde
   * déjà : les branches lues sont surlignées dans la barre latérale, et le
   * titre de la vue porte l'état du routage. La vue et la toile lisent le même
   * journal, elles ne peuvent pas se contredire.
   */
  const refreshTurn = async (): Promise<void> => {
    try {
      const core = await loadCore();
      const dir = await core.findTreeDir(searchFrom);
      if (!dir) {
        view.description = undefined;
        decorations.set([], null);
        return;
      }
      const tree = await core.loadTree(dir);
      const total = tree.order.length;
      const last = await lastTurn(core, dir, total);
      view.description = turnDescription(last, total);
      // `root.md` est toujours injecté : il fait partie de ce qui a été lu.
      decorations.set(
        last
          ? [
              vscode.Uri.joinPath(vscode.Uri.file(dir), core.ROOT_FILE).fsPath,
              ...last.turn.selected.map(p => core.branchFile(dir, p)),
            ]
          : [],
        last?.turn.reason ?? null,
      );
      await CanvasPanel.setTurn(last);
    } catch {
      // Le surlignage est un confort, pas un chemin critique.
      decorations.set([], null);
    }
  };

  const reloadViews = (): void => {
    void provider.refresh();
    void CanvasPanel.refreshIfOpen();
    void refreshTurn();
    // Créer ou supprimer `.contextree/` change le dossier à observer.
    void armWatcher();
    void tickFresh();
  };

  /**
   * Fait vivre la pastille « écrite par l'IA ».
   *
   * Rien sur le disque ne change quand une écriture vieillit : sans ce battement,
   * la pastille afficherait « il y a 2 min » une heure plus tard, puis ne
   * disparaîtrait jamais. Il ne tourne que tant qu'il reste une écriture fraîche
   * — c'est-à-dire quasiment jamais.
   */
  let freshTimer: ReturnType<typeof setTimeout> | undefined;

  const tickFresh = async (): Promise<void> => {
    clearTimeout(freshTimer);
    try {
      const core = await loadCore();
      const dir = await core.findTreeDir(searchFrom);
      if (!dir || !(await freshWrites(core, dir)).size) return;
    } catch {
      return;
    }
    freshTimer = setTimeout(() => {
      void provider.refresh();
      void CanvasPanel.refreshIfOpen();
      void tickFresh();
    }, 60_000);
  };

  context.subscriptions.push({ dispose: () => clearTimeout(freshTimer) });

  /**
   * Le point d'entrée unique de l'édition de structure.
   *
   * Les commandes de la barre latérale et les messages de la toile passent tous
   * par ici : l'arbre est relu juste avant l'opération (les `.md` sont la source
   * de vérité et ont pu changer entre-temps), et les vues sont rechargées après.
   * C'est aussi la couture où viendra se brancher l'édition du contenu, sans
   * réécrire l'existant.
   */
  const runEdit = async (op: EditOp, target?: string): Promise<void> => {
    try {
      const core = await loadCore();
      const dir = await core.findTreeDir(searchFrom);
      if (!dir) return;
      const tree = await core.loadTree(dir);

      // `create` part de la racine, `child` d'une branche : la cible est un
      // parent dans les deux cas, jamais une branche à modifier.
      if (op === 'create' || op === 'child') {
        const parent = op === 'child' && target && target !== ROOT_ELEMENT ? target : null;
        const created = await edit.createBranch(core, tree, parent);
        reloadViews();
        if (created) {
          await vscode.commands.executeCommand(
            'vscode.open',
            vscode.Uri.file(core.branchFile(dir, created)),
            { viewColumn: vscode.ViewColumn.Beside },
          );
        }
        return;
      }

      const branch = target ? tree.branches.get(target) : undefined;
      if (!branch) {
        vscode.window.showErrorMessage(`Branche inconnue : ${target ?? '(aucune)'}`);
        return;
      }
      if (op === 'rename') await edit.renameBranch(core, tree, branch);
      else if (op === 'type') await edit.changeType(core, tree, branch);
      else if (op === 'move') await edit.moveBranch(core, tree, branch);
      else if (op === 'delete') await edit.deleteBranch(core, tree, branch);
      reloadViews();
    } catch (err) {
      vscode.window.showErrorMessage(
        `contextree : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  CanvasPanel.onEdit(runEdit);

  // Le surlignage des branches lues est un confort, et `FileDecorationProvider`
  // est l'API la plus susceptible de manquer dans un fork de VS Code. Absente,
  // la vue perd la pastille et garde tout le reste — jamais une extension qui
  // ne s'active pas.
  if (typeof vscode.window.registerFileDecorationProvider === 'function') {
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));
  }

  context.subscriptions.push(
    view,
    vscode.commands.registerCommand('contextree.openCanvas', () =>
      CanvasPanel.show(context, loadCore, searchFrom),
    ),
    vscode.commands.registerCommand('contextree.newBranch', () => runEdit('create')),
    vscode.commands.registerCommand('contextree.newChild', (item?: string) => runEdit('child', item)),
    vscode.commands.registerCommand('contextree.rename', (item?: string) => runEdit('rename', item)),
    vscode.commands.registerCommand('contextree.changeType', (item?: string) => runEdit('type', item)),
    vscode.commands.registerCommand('contextree.move', (item?: string) => runEdit('move', item)),
    vscode.commands.registerCommand('contextree.delete', (item?: string) => runEdit('delete', item)),
  );

  /**
   * L'arbre est du markdown édité à la main : la vue suit le disque, pas
   * l'inverse. Tout `.md` touché recharge les deux vues.
   *
   * On observe le dossier **réellement trouvé**, pas le dossier ouvert :
   * `findTreeDir` remonte les parents comme `.git`, et un `.contextree/` situé
   * au-dessus de la racine du workspace n'était jamais rechargé. Le motif reste
   * complexe (`**\/*.md`), donc l'observateur est récursif même hors du dossier
   * ouvert.
   *
   * Tant qu'il n'y a pas d'arbre, on retombe sur le workspace : c'est ce qui
   * rattrape un `contextree init` fait après coup.
   */
  let watched: { dir: string | null; disposable: vscode.Disposable } | undefined;

  const armWatcher = async (): Promise<void> => {
    let dir: string | null = null;
    try {
      dir = await (await loadCore()).findTreeDir(searchFrom);
    } catch {
      dir = null;
    }
    if (watched && watched.dir === dir) return;

    const pattern = dir
      ? new vscode.RelativePattern(vscode.Uri.file(dir), '**/*.md')
      : folder
        ? new vscode.RelativePattern(folder, '**/.contextree/**/*.md')
        : null;
    watched?.disposable.dispose();
    if (!pattern) return void (watched = undefined);

    const w = vscode.workspace.createFileSystemWatcher(pattern);
    watched = {
      dir,
      disposable: vscode.Disposable.from(
        w,
        w.onDidCreate(reloadViews),
        w.onDidChange(reloadViews),
        w.onDidDelete(reloadViews),
      ),
    };
  };

  context.subscriptions.push({ dispose: () => watched?.disposable.dispose() });

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
  void armWatcher();
  void tickFresh();
}

export function deactivate(): void {}
