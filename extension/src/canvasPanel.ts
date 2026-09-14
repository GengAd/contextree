import * as vscode from 'vscode';
import type { AiWrite, ContextTree, ShapeWarning } from '@gengad/contextree/view' with { 'resolution-mode': 'import' };
import { freshWrites } from './treeProvider.js';
import type { LastTurn } from './turn.js';
import type { EditOp } from './extension.js';
import type { SavePatch } from './edit.js';

import type { Core } from './treeProvider.js';

/** Ce que la webview reçoit. Plat et sans Map : ça passe par postMessage. */
type CanvasTree = {
  rootContent: string;
  /** L'écriture de l'IA sur la racine (`write_root`), si elle est fraîche. */
  rootWrite?: { at: number; op: string; why?: string };
  branches: Array<{
    path: string;
    parent: string | null;
    type: string;
    title: string;
    loadWhen: string;
    content: string;
    layer: string;
    /** L'écriture de l'IA sur cette branche, si elle est encore fraîche. */
    write?: { at: number; op: string; why?: string };
    /** Les défauts de forme qui la concernent (`lintTree`), déjà traduits. */
    warnings?: string[];
  }>;
  /** Les défauts de forme de l'arbre entier — plat, pas de racine… —, portés
   *  par la carte de la racine. */
  rootWarnings?: string[];
};

/** La toile 2D : l'arbre entier d'un coup d'œil, comme dans Lacis. On y lit,
 *  on y édite la structure, et depuis le 8 septembre 2026 le `load_when` et le
 *  corps — le `.md` reste la source de vérité, et reste à un clic. */
export class CanvasPanel {
  private static current: CanvasPanel | undefined;
  /** Le dernier tour connu, gardé même panneau fermé : la toile doit pouvoir
   *  s'allumer dès son ouverture, pas au tour suivant. */
  private static turn: LastTurn | null = null;

  /**
   * Le protocole webview → extension porte des **écritures**, pas seulement des
   * ouvertures de fichier : la toile envoie `{type:'edit', op, path}` et
   * l'extension exécute. C'est la couture par laquelle l'édition du contenu est
   * venue se brancher (`save`, plus bas) sans rien réécrire.
   */
  private static edit: ((op: EditOp, target?: string) => Promise<void>) | undefined;

  static onEdit(handler: (op: EditOp, target?: string) => Promise<void>): void {
    CanvasPanel.edit = handler;
  }

  /** L'écriture du contenu. Elle **répond** — la toile ne jette son brouillon
   *  que sur un accusé, jamais parce qu'elle a cliqué. */
  private static save: ((branchPath: string, patch: SavePatch) => Promise<boolean>) | undefined;

  static onSave(handler: (branchPath: string, patch: SavePatch) => Promise<boolean>): void {
    CanvasPanel.save = handler;
  }

  /** Poussé par l'observateur du journal — même source que la barre latérale. */
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
      vscode.l10n.t('contextree — context tree'),
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
      async (msg: {
        type: string;
        path?: string;
        prompt?: string;
        op?: EditOp;
        loadWhen?: string;
        content?: string;
      }) => {
        if (msg.type === 'ready') return void this.update();
        if (msg.type === 'open') return void this.open(msg.path);
        if (msg.type === 'route') return void this.route(msg.prompt ?? '');
        if (msg.type === 'save' && msg.path) {
          return void this.save(msg.path, {
            loadWhen: msg.loadWhen ?? '',
            content: msg.content ?? '',
          });
        }
        if (msg.type === 'edit' && msg.op) {
          // La racine n'est pas une branche : elle ne se renomme ni ne se
          // supprime. Seule « nouvelle branche » a du sens depuis elle.
          const target = msg.path === ':root' ? undefined : msg.path;
          return void CanvasPanel.edit?.(msg.op, target);
        }
      },
    );
  }

  /**
   * Écrire, puis dire ce qui s'est passé.
   *
   * Un `ok` faux n'est pas une anomalie : c'est un `load_when` vide refusé, ou
   * un onglet sale que l'utilisateur a préféré garder. Dans les deux cas la
   * toile doit conserver son brouillon — d'où l'accusé, plutôt qu'une écriture
   * qu'on suppose réussie.
   */
  private async save(branchPath: string, patch: SavePatch): Promise<void> {
    let ok = false;
    let error: string | undefined;
    try {
      ok = (await CanvasPanel.save?.(branchPath, patch)) ?? false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await this.panel.webview.postMessage({ type: 'saved', path: branchPath, ok, error });
  }

  private async open(branchPath: string | undefined): Promise<void> {
    const { findTreeDir, loadTree, fileForBranch, ROOT_FILE } = await this.core();
    const dir = await findTreeDir(this.searchFrom);
    if (!dir) return;
    // Une branche surchargée s'édite dans le calque local, pas dans l'arbre du
    // groupe : il faut l'arbre résolu pour savoir de quel dossier elle vient.
    const file =
      branchPath === undefined || branchPath === ':root'
        ? vscode.Uri.joinPath(vscode.Uri.file(dir), ROOT_FILE)
        : vscode.Uri.file(fileForBranch(await loadTree(dir), branchPath));
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
      if (!dir) return void post({ selected: null, error: vscode.l10n.t('no tree') });
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
    const { findTreeDir, loadTree, lintTree } = await this.core();

    let tree: ContextTree | null = null;
    let writes = new Map<string, AiWrite>();
    try {
      const dir = await findTreeDir(this.searchFrom);
      tree = dir ? await loadTree(dir) : null;
      if (dir) writes = await freshWrites(await this.core(), dir);
    } catch {
      tree = null;
    }
    await this.panel.webview.postMessage({
      type: 'tree',
      tree: tree ? flatten(tree, writes, lintTree(tree)) : null,
    });
    await this.postTurn();
  }

  private html(): string {
    const asset = (name: string) =>
      this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const nonce = String(Math.random()).slice(2);
    const csp =
      `default-src 'none'; img-src ${this.panel.webview.cspSource}; ` +
      `style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';`;
    // Les textes de la toile, traduits ici : la webview n'a pas `vscode.l10n`.
    // `<` échappé, pour qu'un texte ne puisse pas fermer la balise.
    const strings = JSON.stringify(
      Object.fromEntries(CANVAS_STRINGS.map(s => [s, vscode.l10n.t(s)])),
    ).replace(/</g, '\\u003c');
    const lang = vscode.env.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
    return `<!DOCTYPE html>
<html lang="${lang}">
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
    <button id="fit" title="${vscode.l10n.t('Fit (double-click on the background)')}">${vscode.l10n.t('Fit')}</button>
    <span id="count"></span>
    <span class="sep"></span>
    <input id="prompt" type="text" placeholder="${vscode.l10n.t('What would the router load for…')}" />
    <button id="go" title="${vscode.l10n.t('Route this prompt (Enter)')}">${vscode.l10n.t('Route')}</button>
    <button id="clear" title="${vscode.l10n.t('Back to the last turn (Esc)')}" hidden>✕</button>
  </div>
  <div class="row">
    <span id="trace"></span>
    <span id="excerpt"></span>
  </div>
</div>
<div id="legend"></div>
<script id="l10n" type="application/json">${strings}</script>
<script nonce="${nonce}" src="${asset('canvas.js')}"></script>
</body>
</html>`;
  }
}

/** Les textes que `media/canvas.js` passe à `tr()` — sa clé est le texte
 *  anglais. Un texte ajouté là-bas sans passer ici s'affiche en anglais. */
const CANVAS_STRINGS: string[] = [
  "Root",
  "always injected, never routed",
  "{0} branch(es)",
  "just now",
  "{0} min ago",
  "edit",
  "Write the “load when” and the body here",
  "open the .md",
  "Edit in the editor, alongside",
  "+ child",
  "Create a branch under this one",
  "rename",
  "Change the title",
  "type",
  "Change the branch type",
  "move",
  "Change parent",
  "delete",
  "Delete the branch and its children",
  "load when…",
  "root — always injected",
  "body",
  "writing…",
  "the file changed on disk — saving will overwrite that version",
  "modified, not saved — ⌘/Ctrl + Enter writes the .md",
  "⌘/Ctrl + Enter writes the .md",
  "Save",
  "Write the .md (⌘/Ctrl + Enter)",
  "Discard",
  "Throw away the draft",
  "reload from disk",
  "Start again from the file's version",
  "Continue in the editor",
  "read by the AI on the last turn",
  "double-click to edit",
  "✎ unsaved draft",
  "open the card to pick it up again",
  "✎ written by the AI {0}",
  "✎ deleted by the AI {0}",
  "✎ moved by the AI {0}",
  "✎ touched by the AI {0}",
  "(empty)",
  "routed",
  "all loaded",
  "fallback",
  "deferred — routing in the background",
  "catalogue only — no routing available",
  "routed (next turn)",
  "routing…",
  "no routed turn yet",
  "probe",
  "last turn · {0}",
  "fallback to the previous selection{0}",
  "no branch injected — the agent received the root and the catalogue{0}",
  "previous turn's selection — routing for “{0}” is running behind",
  "chosen for “{0}” — injected on the next prompt",
  "read on the last turn",
  "nothing was written — the draft is kept",
  "no tree",
];

function flatten(tree: ContextTree, writes: Map<string, AiWrite>, shape: ShapeWarning[]): CanvasTree {
  // La racine est écrite par `write_root` comme une branche l'est par
  // `upsert_branch` : sa trace voyage par le même chemin, sous `:root`.
  const rootWrite = writes.get(':root');
  // Un défaut qui ne nomme aucune branche est un défaut de l'arbre : la racine
  // le porte. Les autres vont sur chaque carte qu'ils nomment.
  const rootWarnings = shape.filter(w => !w.paths.length).map(w => w.message);
  const warningsOf = (p: string) => shape.filter(w => w.paths.includes(p)).map(w => w.message);
  return {
    rootContent: tree.rootContent,
    ...(rootWarnings.length ? { rootWarnings } : {}),
    ...(rootWrite
      ? { rootWrite: { at: rootWrite.at, op: rootWrite.op, ...(rootWrite.why ? { why: rootWrite.why } : {}) } }
      : {}),
    branches: tree.order.flatMap(p => {
      const b = tree.branches.get(p);
      if (!b) return [];
      const w = writes.get(b.path);
      return [
        {
          path: b.path,
          parent: b.parentPath,
          type: b.type,
          title: b.title,
          loadWhen: b.loadWhen,
          content: b.content,
          layer: b.layer,
          ...(w ? { write: { at: w.at, op: w.op, ...(w.why ? { why: w.why } : {}) } } : {}),
          ...(warningsOf(b.path).length ? { warnings: warningsOf(b.path) } : {}),
        },
      ];
    }),
  };
}
