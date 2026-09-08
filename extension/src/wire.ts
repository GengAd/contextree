import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AgentStatus } from '@gengad/contextree/view' with { 'resolution-mode': 'import' };

import type { Core } from './treeProvider.js';

/**
 * « Ajouter contextree à cette IA », depuis la vue.
 *
 * Le geste de démarrage était jusqu'ici une commande à taper dans un terminal,
 * qui ne câblait que Claude Code. Ici, une liste d'agents avec leur **état** —
 * câblé, à câbler, non détecté — parce qu'un bouton qui tente et échoue en
 * silence ne dit rien à personne.
 *
 * Rien n'est écrit sans un choix explicite, et ce qui a été écrit est affiché
 * fichier par fichier : les mêmes règles que `contextree install`, on fusionne,
 * on n'écrase jamais.
 */
export async function wireAgent(core: Core, projectDir: string): Promise<boolean> {
  const statuses = await core.agentStatus(projectDir);

  const pick = await vscode.window.showQuickPick(
    statuses.map(s => ({
      label: s.label,
      description: state(s),
      detail: s.files.map(shorten).join('  ·  '),
      status: s,
    })),
    {
      title: 'contextree — ajouter à une IA',
      placeHolder: 'Quel agent câbler ? (fusion, jamais d’écrasement)',
    },
  );
  if (!pick) return false;

  // Codex n'a pas de hook : il reçoit un bloc dans `AGENTS.md`. Sans arbre, on
  // câble quand même le serveur MCP — créer l'arbre peut venir après.
  let block: string | undefined;
  if (pick.status.id === 'codex') {
    const dir = await core.findTreeDir(projectDir);
    if (dir) block = core.renderAgentsBlock(await core.loadTree(dir));
  }

  const report = await core.installAgent(pick.status.id, projectDir, block);
  const touched = report.filter(r => r.action !== 'unchanged');

  if (!touched.length) {
    void vscode.window.showInformationMessage(`${pick.label} : déjà câblé, rien à changer.`);
    return false;
  }

  const written = touched.map(r => `${shorten(r.file)} (${r.action === 'created' ? 'créé' : 'mis à jour'})`);
  const choice = await vscode.window.showInformationMessage(
    `${pick.label} câblé — ${written.join(', ')}. Relance l’agent pour qu’il le voie.`,
    'Ouvrir',
  );
  if (choice === 'Ouvrir') {
    await vscode.window.showTextDocument(vscode.Uri.file(touched[0]!.file));
  }
  return true;
}

/** L'état d'un agent, en un mot — c'est ce qui distingue un bouton honnête
 *  d'un bouton qui tente sa chance. */
function state(s: AgentStatus): string {
  if (s.wired) return '✓ câblé';
  return s.detected ? 'à câbler' : 'non détecté';
}

/** Un chemin lisible : relatif au projet quand il en vient, `~` sinon. */
function shorten(file: string): string {
  const home = os.homedir();
  if (file.startsWith(home)) return `~${file.slice(home.length)}`;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return folder && file.startsWith(folder) ? path.relative(folder, file) : file;
}
