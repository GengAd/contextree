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
  // La commande qui *serait* écrite, avant de choisir : câbler sur `npx` (le
  // paquet publié) ou sur le binaire local n'est pas le même geste, et on ne
  // l'apprenait jusqu'ici qu'en ouvrant le JSON après coup.
  //
  // Calculée **avant** toute liste : sans contextree installé, il n'y a rien de
  // lançable à inscrire, et on le dit au lieu d'écrire une commande morte.
  let command: string;
  try {
    command = tildify(core.selfCommand('hook').shell);
  } catch (err) {
    void vscode.window.showWarningMessage(err instanceof Error ? err.message : String(err));
    return false;
  }
  const statuses = await core.agentStatus(projectDir);

  const pick = await vscode.window.showQuickPick(
    statuses.map(s => ({
      label: s.label,
      description: state(s),
      detail: s.files.map(shorten).join('  ·  '),
      status: s,
    })),
    {
      title: `contextree — ajouter à une IA · ${command}`,
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

  const written = touched.map(
    r =>
      `${shorten(r.file)} (${r.action === 'created' ? 'créé' : r.action === 'repaired' ? 'réparé' : 'mis à jour'}` +
      `${r.note ? ` — ${r.note}` : ''})`,
  );
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

/** Les chemins du home en `~` : une commande affichée doit tenir sur une ligne. */
function tildify(text: string): string {
  return text.split(os.homedir()).join('~');
}

/** Un chemin lisible : relatif au projet quand il en vient, `~` sinon. */
function shorten(file: string): string {
  const home = os.homedir();
  if (file.startsWith(home)) return `~${file.slice(home.length)}`;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return folder && file.startsWith(folder) ? path.relative(folder, file) : file;
}

/**
 * Créer l'arbre depuis la vue, sur un projet vierge.
 *
 * Sans `.contextree/`, l'extension n'avait rien à montrer et il fallait passer
 * par un terminal : le premier geste de l'outil échappait à l'outil. Ici, le
 * même tronc que `contextree init` — il vit dans le cœur (`initTree`), deux
 * copies auraient divergé au premier ajustement de `load_when`.
 *
 * Enchaîner sur le câblage est délibéré : créer l'arbre et le brancher à une
 * IA sont le même geste de démarrage, et un arbre que personne ne lit ne sert
 * à rien.
 */
export async function initFromView(core: Core, projectDir: string): Promise<boolean> {
  const existing = await core.findTreeDir(projectDir);
  if (existing) {
    void vscode.window.showInformationMessage(`Un arbre existe déjà : ${shorten(existing)}`);
    return false;
  }

  const { dir, branches } = await core.initTree(projectDir);

  // La racine s'ouvre tout de suite : c'est le seul fichier toujours injecté,
  // et le seul qu'il faut vraiment écrire soi-même.
  await vscode.window.showTextDocument(
    vscode.Uri.file(path.join(dir, core.ROOT_FILE)),
  );

  const next = await vscode.window.showInformationMessage(
    `Arbre créé — ${branches} branches de départ. Corrige leur « charger quand », c'est lui qui décide de tout.`,
    'Ajouter à une IA',
  );
  if (next === 'Ajouter à une IA') await wireAgent(core, projectDir);
  return true;
}
