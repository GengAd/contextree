import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { RoutingTurn } from '@gengad/contextree/view' with { 'resolution-mode': 'import' };

import type { Core } from './treeProvider.js';

/** Ce qu'un tour raconte, une fois lu : de quoi allumer la vue et la toile. */
export type LastTurn = {
  turn: RoutingTurn;
  /** Nombre total de branches de l'arbre au moment de la lecture. */
  total: number;
  /** La clé d'affichage, calculée par le cœur (`turnLabelKey`) : la barre
   *  latérale et la toile la lisent au lieu de la recalculer chacune. */
  key: string;
};

/** Une fonction : les libellés se lisent dans la langue de l'éditeur au moment
 *  où ils s'affichent. */
export const LABELS = (): Record<string, string> => ({
  routed: vscode.l10n.t('routed'),
  all: vscode.l10n.t('all loaded'),
  fallback: vscode.l10n.t('fallback'),
  deferred: vscode.l10n.t('deferred'),
  // Rien de routable : l'agent MCP a reçu la racine et le catalogue, et trie
  // lui-même. Aucune branche injectée — ce n'est pas un « tout chargé ».
  catalogue: vscode.l10n.t('catalogue only'),
  // Un tour venu du routage de fond : ces branches n'ont pas servi à ce
  // prompt-là, elles partiront au suivant. Le dire, sinon on lit « routé » et
  // on croit que le tour affiché est celui qui vient de passer.
  'routed-bg': vscode.l10n.t('routed (next turn)'),
  // Rien de routé, mais l'agent a lu ses branches lui-même (`read_branch`) :
  // c'est ce qui est parti, et « catalogue seul » laisserait croire que rien ne
  // l'a été.
  read: vscode.l10n.t('read by the agent'),
});

/** La teinte d'une branche injectée : celle des correspondances de recherche,
 *  jamais celle d'une erreur. */
export const LOADED_COLOR = new vscode.ThemeColor('list.highlightForeground');

/**
 * Les branches lues au dernier tour, marquées là où on regarde déjà : dans
 * l'arbre de la barre latérale.
 *
 * C'est d'abord un `FileDecorationProvider` parce que le `.md` est la vraie
 * chose : la même marque apparaît dans l'explorateur et sur l'onglet du fichier
 * ouvert, pas seulement dans la vue de contextree.
 *
 * **Le libellé entier est teinté, pas seulement pastillé.** Un point de trois
 * pixels ne se voit pas dans une liste de vingt lignes ; ce qui a été injecté
 * doit se repérer sans lire. Le fond de la ligne serait mieux encore, mais
 * l'API des vues arborescentes ne l'expose pas : `FileDecoration` ne donne
 * qu'une pastille et une couleur de libellé. On prend les deux, plus l'icône
 * (teintée par le fournisseur d'items), et c'est le maximum disponible.
 *
 * La couleur est celle des correspondances de recherche, pas celle d'une
 * erreur : une lecture est un fait ordinaire, pas une alerte. Ce qui distingue
 * un vrai routage d'un repli reste dans le titre de la vue et l'infobulle.
 */
export class LoadedDecorations implements vscode.FileDecorationProvider {
  private loaded = new Set<string>();
  private reason: string | null = null;
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;

  /** `files` : chemins absolus des `.md` injectés au dernier tour. */
  set(files: Iterable<string>, reason: string | null): void {
    this.loaded = new Set(files);
    this.reason = reason;
    this.changed.fire(undefined);
  }

  /** Le même ensemble, pour que la vue teinte aussi l'icône : la décoration de
   *  fichier ne touche que le libellé et la pastille. */
  has(file: string): boolean {
    return this.loaded.has(file);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.loaded.has(uri.fsPath)) return undefined;
    // La teinte dit seulement « ceci est parti à l'IA » ; ce qui distingue un
    // routage d'un repli est dans l'infobulle.
    return { badge: '•', color: LOADED_COLOR, tooltip: this.tooltip() };
  }

  /** Trois états, trois phrases : lue, choisie pour la suite, ou là faute de
   *  mieux. Les confondre, c'est laisser croire qu'un repli est un routage. */
  private tooltip(): string {
    if (this.reason === 'routed' || this.reason === 'read') return vscode.l10n.t('contextree: read by the AI on the last turn');
    if (this.reason === 'routed-bg') return vscode.l10n.t('contextree: chosen by the router for the next turn');
    return vscode.l10n.t('contextree: injected on the last turn ({0})', LABELS()[this.reason ?? ''] ?? String(this.reason));
  }
}

/** Le titre de la vue dit l'état du routage — ce que disait le badge d'en bas. */
export function turnDescription(last: LastTurn | null, total: number): string {
  if (!last) return vscode.l10n.t('{0} branch(es)', total);
  const label = LABELS()[last.key] ?? last.key;
  return `${last.turn.selected.length}/${total} · ${label}`;
}

/**
 * Surveille le journal des tours.
 *
 * Le journal vit hors du workspace (`stateDir()/journal/`) : le motif est
 * donc non récursif, seul cas supporté par VS Code hors dossier ouvert. On crée
 * le dossier s'il manque — un observateur n'a rien à observer sinon, et le cœur
 * le créerait de toute façon au premier tour.
 */
export async function watchJournal(core: Core, onChange: () => void): Promise<vscode.Disposable> {
  const dir = core.journalDir();
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Pas de dossier, pas d'observateur : la vue se rafraîchira au prochain
    // affichage. Jamais une raison de faire échouer l'activation.
  }
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(dir), '*.json'),
  );
  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onChange),
  );
}

/**
 * Le canal *Sortie › contextree* : une ligne par tour, et ce que l'extension
 * surveille.
 *
 * C'est le premier endroit à regarder quand le surlignage ne suit pas
 * (14 septembre 2026 : sous VS Code + Copilot, rien ne s'allumait et rien ne
 * disait pourquoi). Il dit quel journal est lu — si le serveur MCP écrit
 * ailleurs, ça se voit ici — et chaque tour tel que la vue l'a compris.
 */
export class TurnLog {
  private readonly channel = vscode.window.createOutputChannel('contextree');
  private lastLine = '';
  private versionWarned = false;
  private legacyWarned = false;

  dispose(): void {
    this.channel.dispose();
  }

  watching(core: Core, treeDir: string): void {
    this.channel.appendLine(
      vscode.l10n.t('contextree {0} — watching {1}', core.VERSION, core.journalFile(treeDir)),
    );
  }

  /** Un tour, une ligne — et seulement quand il a changé : l'observateur se
   *  déclenche aussi pour le journal des écritures. */
  turn(last: LastTurn): void {
    const t = last.turn;
    const line = [
      new Date(t.at).toLocaleTimeString(),
      t.source,
      LABELS()[last.key] ?? last.key,
      t.engine ?? '—',
      `${t.selected.length}/${last.total}`,
      t.selected.join(', ') || '—',
      ...(t.read?.length ? [vscode.l10n.t('read: {0}', t.read.join(', '))] : []),
      ...(t.error ? [vscode.l10n.t('error: {0}', t.error)] : []),
    ].join(' · ');
    if (line === this.lastLine) return;
    this.lastLine = line;
    this.channel.appendLine(line);
  }

  /**
   * L'extension et ce qui écrit le journal ne sont pas le même contextree.
   *
   * Deux signes, dits une fois chacun. Un tour signé d'une autre version : le
   * serveur ou le hook a été mis à jour sans le `.vsix`, ou l'inverse. Et
   * l'ancien journal, sous `~/.contextree/journal/`, qui bouge après le dernier
   * tour lu ici : un contextree d'avant le déménagement de l'état écrit encore
   * là, et la vue ne verra jamais ses tours.
   */
  async checkVersion(core: Core, treeDir: string, last: LastTurn | null): Promise<void> {
    const other = last?.turn.version;
    if (other && other !== core.VERSION && !this.versionWarned) {
      this.versionWarned = true;
      this.warn(vscode.l10n.t('the extension ({0}) and contextree ({1}) are not the same version: reinstall the .vsix', core.VERSION, other));
    }
    if (this.legacyWarned) return;
    try {
      const { mtimeMs } = await fs.stat(core.legacyJournalFile(treeDir));
      if (mtimeMs > (last?.turn.at ?? 0) && Date.now() - mtimeMs < 24 * 3600_000) {
        this.legacyWarned = true;
        this.warn(vscode.l10n.t('an older contextree writes its turns to {0}, which this extension no longer reads: update the contextree that your agent runs', core.legacyJournalFile(treeDir)));
      }
    } catch {
      // Pas d'ancien journal : le cas normal.
    }
  }

  private warn(message: string): void {
    this.channel.appendLine(`⚠ ${message}`);
    void vscode.window.showWarningMessage(`contextree: ${message}`);
  }
}

/** Le dernier tour de cet arbre, ou `null` s'il n'y en a pas encore. */
export async function lastTurn(core: Core, treeDir: string, total: number): Promise<LastTurn | null> {
  const turns = await core.readJournal(treeDir);
  const turn = turns.at(-1);
  return turn ? { turn, total, key: core.turnLabelKey(turn) } : null;
}
