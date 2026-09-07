import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { RoutingTurn } from '@gengad/contextree' with { 'resolution-mode': 'import' };

type Core = typeof import('@gengad/contextree', { with: { 'resolution-mode': 'import' } });

/** Ce qu'un tour raconte, une fois lu : de quoi allumer la barre et la toile. */
export type LastTurn = {
  turn: RoutingTurn;
  /** Nombre total de branches de l'arbre au moment de la lecture. */
  total: number;
};

const LABELS: Record<string, string> = {
  routed: 'routé',
  all: 'tout chargé',
  fallback: 'repli',
};

/**
 * Le badge toujours visible.
 *
 * Une extension ne peut rien afficher dans le fil de conversation de Cursor ou
 * de Claude Code : la barre d'état est le seul endroit qui soit à la fois
 * permanent et jamais dans le chemin.
 *
 * Le point important n'est pas le compteur, c'est le repli : aujourd'hui le
 * routage peut tourner en fallback sans que rien ne le signale. Un repli change
 * la couleur du badge, pas seulement son texte.
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'contextree.openCanvas';
    this.item.name = 'contextree';
  }

  get disposable(): vscode.Disposable {
    return this.item;
  }

  hide(): void {
    this.item.hide();
  }

  show(last: LastTurn | null, total: number): void {
    if (last === null) {
      this.item.text = `$(type-hierarchy) contextree · ${total} branche(s)`;
      this.item.tooltip = "Aucun tour routé pour l'instant. Cliquer pour voir l'arbre.";
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const { turn } = last;
    const fallback = turn.reason === 'fallback';
    const icon = fallback ? '$(warning)' : '$(circle-filled)';
    this.item.text = `${icon} contextree · ${turn.selected.length}/${total} branches`;
    // La couleur d'avertissement est réservée au repli : c'est le seul état où
    // ce qui a été chargé n'est pas ce que le routeur avait décidé.
    this.item.backgroundColor = fallback
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(
      `**contextree** — ${LABELS[turn.reason] ?? turn.reason}, via \`${turn.source}\`, ${when(turn.at)}\n\n`,
    );
    if (turn.prompt) md.appendMarkdown(`> ${turn.prompt.replace(/\n/g, ' ')}\n\n`);
    md.appendMarkdown(`${turn.selected.length}/${total} branche(s) chargée(s).`);
    if (fallback) {
      md.appendMarkdown(
        `\n\n⚠️ **Repli** — le routage a échoué, ce sont les branches garanties${
          turn.error ? ` : ${turn.error}` : '.'
        }`,
      );
    }
    this.item.tooltip = md;
    this.item.show();
  }
}

function when(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.round(minutes / 60)} h`;
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
