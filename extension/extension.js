// @ts-check
// La vue contextree : une barre latérale qui affiche `carte.mjs --json`. Elle ne calcule rien ;
// la mise en arbre est dans arbre.js, testée sans vscode.
'use strict';
const vscode = require('vscode');
const { execFile } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { arbre, aRafraichir } = require('./arbre.js');

const CARTE = join('skills', 'carte', 'scripts', 'carte.mjs');

/** Où trouver carte.mjs : le réglage, sinon le clone ouvert, sinon le plugin installé dans Claude Code. */
function carteMjs(racine) {
  const home = homedir();
  const candidats = [];
  const regle = vscode.workspace.getConfiguration('contextree').get('plugin');
  if (typeof regle === 'string' && regle) candidats.push(join(regle.replace(/^~(?=\/)/, home), CARTE));
  candidats.push(join(racine, 'plugin', CARTE));
  try {
    const config = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude');
    const installes = JSON.parse(readFileSync(join(config, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
    for (const [cle, versions] of Object.entries(installes))
      if (cle.startsWith('contextree@')) for (const v of versions) candidats.push(join(v.installPath, CARTE));
  } catch {
    // pas de Claude Code ici : le réglage ou le clone suffisent
  }
  return candidats.find((c) => existsSync(c));
}

/** @implements {vscode.TreeDataProvider<import('./arbre.js').Noeud>} */
class Vue {
  constructor() {
    this.change = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.change.event;
    /** @type {import('./arbre.js').Noeud[]} */
    this.noeuds = [];
    this.racinePerso = null;
    this.generation = 0;
    this.attente = undefined;
  }

  get racine() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Plusieurs sauvegardes d'affilée (le hook de forme en fait) : une seule carte, la dernière. */
  rafraichir() {
    clearTimeout(this.attente);
    this.attente = setTimeout(() => this.lancer(), 200);
  }

  lancer() {
    const racine = this.racine;
    if (!racine) return;
    const script = carteMjs(racine);
    const generation = ++this.generation;
    const montrer = (noeuds) => {
      if (generation !== this.generation) return; // une carte plus récente est en route
      this.noeuds = noeuds;
      this.change.fire(undefined);
    };
    if (!script)
      return montrer([{ label: 'carte.mjs introuvable', description: 'régler contextree.plugin', icone: 'error', enfants: [] }]);
    // le Node de l'éditeur lui-même : le PATH d'une app graphique n'a souvent pas `node`
    execFile(
      process.execPath,
      [script, '--json', '--racine', racine],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, maxBuffer: 32 * 1024 * 1024 },
      (erreur, sortie, stderr) => {
        try {
          if (erreur) throw new Error(stderr || erreur.message);
          const carte = JSON.parse(sortie);
          this.racinePerso = carte.racinePerso;
          montrer(arbre(carte, homedir()));
        } catch (e) {
          montrer([{ label: 'la carte a échoué', description: String(e.message).split('\n')[0], tooltip: String(e.message), icone: 'error', enfants: [] }]);
        }
      },
    );
  }

  /** @param {import('./arbre.js').Noeud} [n] */
  getChildren(n) {
    return n ? n.enfants : this.noeuds;
  }

  /** @param {import('./arbre.js').Noeud} n */
  getTreeItem(n) {
    const etat = n.enfants.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(n.label, etat);
    item.description = n.description;
    item.tooltip = n.tooltip ?? (n.description ? `${n.label} — ${n.description}` : n.label);
    const couleur = n.perso
      ? new vscode.ThemeColor('disabledForeground')
      : n.icone === 'warning'
        ? new vscode.ThemeColor('problemsWarningIcon.foreground')
        : undefined;
    if (n.icone) item.iconPath = new vscode.ThemeIcon(n.icone, couleur);
    if (n.fichier) item.command = { command: 'vscode.open', title: 'Ouvrir', arguments: [vscode.Uri.file(n.fichier)] };
    return item;
  }
}

/** @param {vscode.ExtensionContext} contexte */
function activate(contexte) {
  const vue = new Vue();
  vscode.commands.executeCommand('setContext', 'contextree.actif', true);
  contexte.subscriptions.push(
    vscode.window.registerTreeDataProvider('contextree', vue),
    vscode.commands.registerCommand('contextree.rafraichir', () => vue.rafraichir()),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (vue.racine && aRafraichir(doc.uri.fsPath, vue.racine, homedir(), vue.racinePerso)) vue.rafraichir();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('contextree') && vue.rafraichir()),
  );
  vue.rafraichir();
}

function deactivate() {}

module.exports = { activate, deactivate };
