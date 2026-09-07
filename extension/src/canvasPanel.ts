import * as vscode from 'vscode';
import type { ContextTree } from '@gengad/contextree' with { 'resolution-mode': 'import' };
import type { LastTurn } from './statusBar.js';
import type { EditOp } from './extension.js';

type Core = typeof import('@gengad/contextree', { with: { 'resolution-mode': 'import' } });

/** Ce que la webview reçoit. Plat et sans Map : ça passe par postMessage. */
type CanvasTree = {
  rootContent: string;
  branches: Array<{
    path: string;
    parent: string | null;
    type: string;
    title: string;
    loadWhen: string;
    content: string;
  }>;
};

/** La toile 2D : l'arbre entier d'un coup d'œil, comme dans Lacis. Lecture
 *  seule — un clic ouvre le `.md`, qui reste la source de vérité. */
export class CanvasPanel {
  private static current: CanvasPanel | undefined;
  /** Le dernier tour connu, gardé même panneau fermé : la toile doit pouvoir
   *  s'allumer dès son ouverture, pas au tour suivant. */
  private static turn: LastTurn | null = null;

  /**
   * Le protocole webview → extension porte des **écritures**, pas seulement des
   * ouvertures de fichier : la toile envoie `{type:'edit', op, path}` et
   * l'extension exécute. C'est la couture prévue pour que l'édition du contenu
   * vienne s'y brancher plus tard sans rien réécrire.
   */
  private static edit: ((op: EditOp, target?: string) => Promise<void>) | undefined;

  static onEdit(handler: (op: EditOp, target?: string) => Promise<void>): void {
    CanvasPanel.edit = handler;
  }

  /** Poussé par l'observateur du journal — même source que la barre d'état. */
  static async setTurn(turn: LastTurn | null): Promise<void> {
    CanvasPanel.turn = turn;
    await CanvasPanel.current?.postTurn();
  }

  static async show(
    context: vscode.ExtensionContext,
    core: () => Promise<Core>,
    searchFrom: string,
  ): Promise<void> {
    if (CanvasPanel.current) {
      CanvasPanel.current.panel.reveal();
      await CanvasPanel.current.update();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'contextree.canvas',
      'contextree — arbre de contexte',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    CanvasPanel.current = new CanvasPanel(panel, context, core, searchFrom);
    await CanvasPanel.current.update();
  }

  /** Rechargement depuis l'extérieur (watcher, commande) — sans ouvrir de panneau. */
  static async refreshIfOpen(): Promise<void> {
    await CanvasPanel.current?.update();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly core: () => Promise<Core>,
    private readonly searchFrom: string,
  ) {
    panel.webview.html = this.html();
    panel.onDidDispose(() => {
      CanvasPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage(
      async (msg: { type: string; path?: string; prompt?: string; op?: EditOp }) => {
        if (msg.type === 'ready') return void this.update();
        if (msg.type === 'open') return void this.open(msg.path);
        if (msg.type === 'route') return void this.route(msg.prompt ?? '');
        if (msg.type === 'edit' && msg.op) {
          // La racine n'est pas une branche : elle ne se renomme ni ne se
          // supprime. Seule « nouvelle branche » a du sens depuis elle.
          const target = msg.path === ':root' ? undefined : msg.path;
          return void CanvasPanel.edit?.(msg.op, target);
        }
      },
    );
  }

  private async open(branchPath: string | undefined): Promise<void> {
    const { findTreeDir, branchFile, ROOT_FILE } = await this.core();
    const dir = await findTreeDir(this.searchFrom);
    if (!dir) return;
    const file =
      branchPath === undefined || branchPath === ':root'
        ? vscode.Uri.joinPath(vscode.Uri.file(dir), ROOT_FILE)
        : vscode.Uri.file(branchFile(dir, branchPath));
    await vscode.commands.executeCommand('vscode.open', file, { viewColumn: vscode.ViewColumn.Beside });
  }

  /** Ce que le routeur retiendrait pour ce prompt — le `●` / `○` de
   *  `contextree route`, mais sur la toile. C'est la seule façon de vérifier un
   *  `load_when` sans lancer une vraie conversation. */
  private async route(prompt: string): Promise<void> {
    const post = (payload: Record<string, unknown>) =>
      this.panel.webview.postMessage({ type: 'routed', ...payload });
    if (!prompt.trim()) return void post({ selected: null });

    const started = Date.now();
    try {
      const { findTreeDir, loadTree, route } = await this.core();
      const dir = await findTreeDir(this.searchFrom);
      if (!dir) return void post({ selected: null, error: 'aucun arbre' });
      const tree = await loadTree(dir);
      const { selected, reason, error } = await route(tree, prompt);
      post({ selected: [...selected], reason, error, ms: Date.now() - started });
    } catch (err) {
      post({
        selected: null,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      });
    }
  }

  private async postTurn(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'turn', turn: CanvasPanel.turn });
  }

  private async update(): Promise<void> {
    const { findTreeDir, loadTree } = await this.core();
    let tree: ContextTree | null = null;
    try {
      const dir = await findTreeDir(this.searchFrom);
      tree = dir ? await loadTree(dir) : null;
    } catch {
      tree = null;
    }
    await this.panel.webview.postMessage({ type: 'tree', tree: tree ? flatten(tree) : null });
    await this.postTurn();
  }

  private html(): string {
    const asset = (name: string) =>
      this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const nonce = String(Math.random()).slice(2);
    const csp =
      `default-src 'none'; img-src ${this.panel.webview.cspSource}; ` +
      `style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${asset('canvas.css')}" />
</head>
<body>
<div id="viewport">
  <div id="scene">
    <svg id="edges"></svg>
    <div id="nodes"></div>
  </div>
</div>
<div id="hud">
  <div class="row">
    <button id="fit" title="Recadrer (double-clic sur le fond)">Recadrer</button>
    <span id="count"></span>
    <span class="sep"></span>
    <input id="prompt" type="text" placeholder="Que chargerait le routeur pour…" />
    <button id="go" title="Router ce prompt (Entrée)">Router</button>
    <button id="clear" title="Revenir au dernier tour (Échap)" hidden>✕</button>
  </div>
  <div class="row">
    <span id="trace"></span>
    <span id="excerpt"></span>
  </div>
</div>
<div id="legend"></div>
<script nonce="${nonce}" src="${asset('canvas.js')}"></script>
</body>
</html>`;
  }
}

function flatten(tree: ContextTree): CanvasTree {
  return {
    rootContent: tree.rootContent,
    branches: tree.order.flatMap(p => {
      const b = tree.branches.get(p);
      return b
        ? [
            {
              path: b.path,
              parent: b.parentPath,
              type: b.type,
              title: b.title,
              loadWhen: b.loadWhen,
              content: b.content,
            },
          ]
        : [];
    }),
  };
}
