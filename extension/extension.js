// @ts-check
// La vue contextree : une barre latérale qui affiche `carte.mjs --json`. Elle ne calcule rien ;
// la mise en arbre, les problèmes et les prompts sont dans arbre.js, testés sans vscode.
'use strict';
const vscode = require('vscode');
const { execFile } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join, relative, isAbsolute, sep } = require('node:path');
const { homedir } = require('node:os');
const { arbre, aRafraichir, problemes, journal, fraisDe, bouges, FRAIS_MS } = require('./arbre.js');

const CARTE = join('skills', 'carte', 'scripts', 'carte.mjs');
const TEXTE = vscode.Uri.parse('contextree:/carte.txt');
/** La teinte d'un fichier que Claude vient de charger : celle des correspondances de recherche, jamais celle d'une erreur. */
const CHARGE = new vscode.ThemeColor('list.highlightForeground');

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

/**
 * Les fichiers que Claude vient de charger, marqués là où on regarde déjà : dans la vue, mais aussi
 * dans l'explorateur et sur l'onglet du fichier — la décoration vaut pour l'URI, partout.
 * Elle ne teinte que le libellé et la pastille ; la vue teinte l'icône elle-même.
 * @implements {vscode.FileDecorationProvider}
 */
class Frais {
  constructor() {
    /** @type {Set<string>} */
    this.fichiers = new Set();
    this.change = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.change.event;
  }

  /** @param {Set<string>} fichiers */
  poser(fichiers) {
    // le fsPath d'une Uri, comme celui que l'explorateur demande : sous Windows, la lettre du disque en minuscule
    const apres = new Set([...fichiers].map((f) => vscode.Uri.file(f).fsPath));
    const changes = bouges(this.fichiers, apres);
    this.fichiers = apres;
    if (changes.length) this.change.fire(changes.map((f) => vscode.Uri.file(f)));
  }

  /** @param {vscode.Uri} uri */
  provideFileDecoration(uri) {
    if (uri.scheme !== 'file' || !this.fichiers.has(uri.fsPath)) return undefined;
    return new vscode.FileDecoration('•', `contextree : chargé par Claude il y a moins de ${FRAIS_MS / 60_000} min`, CHARGE);
  }
}

/** @implements {vscode.TreeDataProvider<import('./arbre.js').Noeud>} */
class Vue {
  /** @param {vscode.DiagnosticCollection} diagnostics @param {Frais} frais */
  constructor(diagnostics, frais) {
    this.diagnostics = diagnostics;
    this.frais = frais;
    /** @type {any} la dernière carte : les « il y a » et la fraîcheur se recalculent sans la relancer */
    this.carte = undefined;
    this.change = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.change.event;
    /** @type {import('./arbre.js').Noeud[]} */
    this.noeuds = [];
    this.racinePerso = null;
    this.fichierActif = undefined;
    this.generation = 0;
    this.attente = undefined;
    /** @type {(() => void) | undefined} appelé après chaque rendu */
    this.apres = undefined;
  }

  get racine() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * Le fichier de l'éditeur, s'il est dans le projet : la carte dit ce qui se charge en plus pour lui.
   * Un onglet qui n'est pas un fichier (la carte en texte, les réglages) ne change rien ; un fichier
   * hors du projet, ou plus d'onglet du tout, retire la section.
   */
  suivre(editeur) {
    const uri = editeur?.document.uri;
    if (!this.racine || (uri && uri.scheme !== 'file')) return;
    const rel = uri && relative(this.racine, uri.fsPath);
    const fichier = rel && !rel.startsWith('..') && !isAbsolute(rel) ? uri.fsPath : undefined;
    if (fichier === this.fichierActif) return;
    this.fichierActif = fichier;
    this.rafraichir();
  }

  /** Les arguments de la carte, avec ou sans --json : la vue et le texte disent la même chose. */
  arguments(json) {
    return [...(json ? ['--json'] : []), '--racine', this.racine, ...(this.fichierActif ? ['--fichier', this.fichierActif] : [])];
  }

  /** @returns {Promise<string>} */
  executer(json) {
    const script = this.racine && carteMjs(this.racine);
    if (!script) return Promise.reject(Object.assign(new Error('régler contextree.plugin'), { introuvable: true }));
    // le Node de l'éditeur lui-même : le PATH d'une app graphique n'a souvent pas `node`
    return new Promise((ok, ko) =>
      execFile(
        process.execPath,
        [script, ...this.arguments(json)],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, maxBuffer: 32 * 1024 * 1024 },
        (erreur, sortie, stderr) => (erreur ? ko(new Error(stderr || erreur.message)) : ok(sortie)),
      ),
    );
  }

  /** Plusieurs sauvegardes d'affilée (le hook de forme en fait) : une seule carte, la dernière. */
  rafraichir() {
    clearTimeout(this.attente);
    this.attente = setTimeout(() => this.lancer(), 200);
  }

  async lancer() {
    if (!this.racine) return;
    const generation = ++this.generation;
    try {
      const carte = JSON.parse(await this.executer(true));
      if (generation !== this.generation) return; // une carte plus récente est en route
      this.racinePerso = carte.racinePerso;
      this.carte = carte;
      this.signaler(problemes(carte, homedir()));
      this.afficher();
    } catch (e) {
      if (generation !== this.generation) return;
      this.diagnostics.clear(); // pas d'avertissement d'une carte d'avant
      this.carte = undefined;
      this.frais.poser(new Set());
      const message = String(e.message);
      const label = e.introuvable ? 'carte.mjs introuvable' : 'la carte a échoué';
      this.noeuds = [{ label, description: message.split('\n')[0], tooltip: message, icone: 'error', enfants: [] }];
      this.change.fire(undefined);
    }
    this.apres?.();
  }

  /** La dernière carte, rendue à l'heure qu'il est : ce qui n'est plus frais redevient gris. */
  afficher() {
    if (!this.carte) return;
    this.noeuds = arbre(this.carte, homedir());
    this.frais.poser(fraisDe(this.noeuds));
    this.change.fire(undefined);
  }

  /** Les avertissements dans le panneau Problèmes, ligne 1 du fichier concerné. */
  signaler(liste) {
    this.diagnostics.clear();
    const parFichier = new Map();
    for (const p of liste) {
      const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), p.message, vscode.DiagnosticSeverity.Warning);
      d.source = 'contextree';
      (parFichier.get(p.fichier) ?? parFichier.set(p.fichier, []).get(p.fichier)).push(d);
    }
    for (const [fichier, ds] of parFichier) this.diagnostics.set(vscode.Uri.file(fichier), ds);
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
    const couleur = n.frais
      ? CHARGE
      : n.perso
        ? new vscode.ThemeColor('disabledForeground')
        : n.icone === 'warning'
          ? new vscode.ThemeColor('problemsWarningIcon.foreground')
          : undefined;
    // l'URI du fichier porte la décoration : libellé teinté et pastille, comme dans l'explorateur
    if (n.frais && n.fichier) item.resourceUri = vscode.Uri.file(n.fichier);
    if (n.icone) item.iconPath = new vscode.ThemeIcon(n.icone, couleur);
    if (n.fichier) item.command = { command: 'vscode.open', title: 'Ouvrir', arguments: [vscode.Uri.file(n.fichier)] };
    if (n.invite) item.contextValue = 'demandable';
    return item;
  }
}

/** La sortie texte de la carte, dans un document virtuel en lecture seule. */
class Texte {
  /** @param {Vue} vue */
  constructor(vue) {
    this.vue = vue;
    this.change = new vscode.EventEmitter();
    this.onDidChange = this.change.event;
  }

  async provideTextDocumentContent() {
    try {
      return await this.vue.executer(false);
    } catch (e) {
      return `La carte a échoué :\n${e.message}`;
    }
  }
}

/** @param {vscode.ExtensionContext} contexte */
function activate(contexte) {
  const diagnostics = vscode.languages.createDiagnosticCollection('contextree');
  const frais = new Frais();
  const vue = new Vue(diagnostics, frais);
  const texte = new Texte(vue);
  vue.apres = () => texte.change.fire(TEXTE); // la carte en texte, si elle est ouverte, suit la vue
  vscode.commands.executeCommand('setContext', 'contextree.actif', true);
  // « il y a 3 min » vieillit, et la teinte s'éteint au bout de 15 min : la vue suit l'heure sans relancer la carte
  const minute = setInterval(() => vue.carte?.journal && vue.afficher(), 60_000);
  contexte.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider('contextree', vue),
    vscode.workspace.registerTextDocumentContentProvider('contextree', texte),
    vscode.commands.registerCommand('contextree.rafraichir', () => vue.rafraichir()),
    vscode.commands.registerCommand('contextree.ouvrirCarte', async () => {
      texte.change.fire(TEXTE);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(TEXTE), { preview: true });
    }),
    // Cursor n'expose pas d'API pour écrire dans Claude Code : le presse-papier est la voie fiable
    vscode.commands.registerCommand('contextree.demander', async (/** @type {import('./arbre.js').Noeud} */ n) => {
      if (!n?.invite) return;
      await vscode.env.clipboard.writeText(n.invite);
      vscode.window.showInformationMessage('Prompt copié : colle-le dans Claude Code.');
    }),
    vscode.window.onDidChangeActiveTextEditor((editeur) => vue.suivre(editeur)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (vue.racine && aRafraichir(doc.uri.fsPath, vue.racine, homedir(), vue.racinePerso)) vue.rafraichir();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('contextree') && vue.rafraichir()),
    vscode.window.registerFileDecorationProvider(frais),
    { dispose: () => clearInterval(minute) },
  );
  // Le hook du plugin écrit le journal à chaque chargement, sans rien sauvegarder dans l'éditeur.
  // Un observateur de l'éditeur plutôt que fs.watch : le journal n'existe pas encore au premier jour,
  // et sa taille se fait par renommage, qui perdrait un fs.watch posé sur l'ancien fichier.
  if (vue.racine) {
    const motif = relative(vue.racine, journal(vue.racine)).split(sep).join('/');
    const observateur = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vue.racine, motif));
    for (const quand of [observateur.onDidCreate, observateur.onDidChange, observateur.onDidDelete]) contexte.subscriptions.push(quand(() => vue.rafraichir()));
    contexte.subscriptions.push(observateur);
  }
  vue.suivre(vscode.window.activeTextEditor);
  vue.rafraichir();
}

function deactivate() {}

module.exports = { activate, deactivate };
