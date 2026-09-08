import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { RoutingTurn } from '@gengad/contextree/view' with { 'resolution-mode': 'import' };

import type { Core } from './treeProvider.js';

/** Ce qu'un tour raconte, une fois lu : de quoi allumer la vue et la toile. */
export type LastTurn = {
  turn: RoutingTurn;
  /** Nombre total de branches de l'arbre au moment de la lecture. */
  total: number;
};

export const LABELS: Record<string, string> = {
  routed: 'routé',
  all: 'tout chargé',
  fallback: 'repli',
  deferred: 'différé',
};

/**
 * Les branches lues au dernier tour, marquées là où on regarde déjà : dans
 * l'arbre de la barre latérale.
 *
 * C'est un `FileDecorationProvider` et pas une couleur d'icône parce que le
 * `.md` est la vraie chose : la même marque apparaît dans l'explorateur et sur
 * l'onglet du fichier ouvert.
 *
 * **Un point, et rien d'autre.** Pas de couleur : `FileDecoration.color` teinte
 * le libellé entier, et une moitié d'arbre en rouge se lit comme une alerte
 * alors qu'il ne s'est rien passé d'anormal — une lecture est un fait ordinaire.
 * Ce qui distingue un vrai routage d'un repli est dans le titre de la vue, pas
 * dans la couleur de chaque ligne.
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

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.loaded.has(uri.fsPath)) return undefined;
    // Un repli et un routage diffèrent : dans un cas la branche a été choisie
    // pour ce prompt, dans l'autre elle est là faute de mieux. Ça se dit dans
    // l'infobulle, pas en repeignant la ligne.
    const chosen = this.reason === 'routed';
    return {
      badge: '•',
      tooltip: chosen
        ? "contextree : lue par l'IA au dernier tour"
        : `contextree : injectée au dernier tour (${LABELS[this.reason ?? ''] ?? this.reason})`,
    };
  }
}

/** Le titre de la vue dit l'état du routage — ce que disait le badge d'en bas. */
export function turnDescription(last: LastTurn | null, total: number): string {
  if (!last) return `${total} branche(s)`;
  const { turn } = last;
  const label = LABELS[turn.reason] ?? turn.reason;
  return `${turn.selected.length}/${total} · ${label}`;
}

/**
 * Surveille le journal des tours.
 *
 * Le journal vit hors du workspace (`~/.contextree/journal/`) : le motif est
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

/** Le dernier tour de cet arbre, ou `null` s'il n'y en a pas encore. */
export async function lastTurn(core: Core, treeDir: string, total: number): Promise<LastTurn | null> {
  const turns = await core.readJournal(treeDir);
  const turn = turns.at(-1);
  return turn ? { turn, total } : null;
}
