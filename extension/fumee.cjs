// @ts-check
// Fait tourner extension.js hors de Cursor, avec un faux module vscode : la vue telle qu'elle
// s'afficherait, les problèmes, et le prompt de « Demander à Claude » sur le premier avertissement.
//
//   node extension/fumee.cjs <projet> [fichier actif]
//
// La carte est celle de ce clone (réglage contextree.plugin), pas la copie installée dans Claude Code.
'use strict';
const Module = require('node:module');
const { join, resolve, relative } = require('node:path');

const [projet, actif] = process.argv.slice(2).map((p) => p && resolve(p));
if (!projet) {
  console.error('usage : node extension/fumee.cjs <projet> [fichier actif]');
  process.exit(1);
}
const plugin = join(__dirname, '..', 'plugin');

/** @type {any} */ let vue;
/** @type {Map<string, string[]>} */ const problemes = new Map();
let presse = '';
const evenement = () => {
  const ecouteurs = [];
  return Object.assign((/** @type {any} */ f) => (ecouteurs.push(f), { dispose() {} }), { ecouteurs });
};
const vscode = {
  EventEmitter: class {
    constructor() {
      this.ecouteurs = [];
      this.event = (f) => (this.ecouteurs.push(f), { dispose() {} });
    }
    fire(x) {
      this.ecouteurs.forEach((f) => f(x));
    }
  },
  TreeItem: class {
    constructor(label) {
      this.label = label;
    }
  },
  TreeItemCollapsibleState: { None: 0, Expanded: 2 },
  ThemeIcon: class {},
  ThemeColor: class {},
  Range: class {},
  DiagnosticSeverity: { Warning: 1 },
  Diagnostic: class {
    constructor(_r, message) {
      this.message = message;
    }
  },
  Uri: { file: (f) => ({ fsPath: f, scheme: 'file' }), parse: (s) => ({ fsPath: s, scheme: 'contextree' }) },
  languages: {
    createDiagnosticCollection: () => ({
      clear: () => problemes.clear(),
      set: (uri, ds) => problemes.set(uri.fsPath, ds.map((d) => d.message)),
      dispose() {},
    }),
  },
  env: { clipboard: { writeText: async (t) => void (presse = t) } },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: projet } }],
    getConfiguration: () => ({ get: () => plugin }),
    onDidSaveTextDocument: evenement(),
    onDidChangeConfiguration: evenement(),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    openTextDocument: async () => ({}),
  },
  window: {
    activeTextEditor: actif ? { document: { uri: { scheme: 'file', fsPath: actif } } } : undefined,
    registerTreeDataProvider: (_id, p) => ((vue = p), { dispose() {} }),
    onDidChangeActiveTextEditor: evenement(),
    showInformationMessage: () => {},
    showTextDocument: async () => {},
  },
  commands: {
    /** @type {Record<string, Function>} */ faites: {},
    executeCommand: () => {},
    registerCommand(id, f) {
      this.faites[id] = f;
      return { dispose() {} };
    },
  },
};

const charger = /** @type {any} */ (Module)._load;
/** @type {any} */ (Module)._load = function (requete, ...reste) {
  return requete === 'vscode' ? vscode : charger.call(this, requete, ...reste);
};
require('./extension.js').activate({ subscriptions: [] });

const delai = setTimeout(() => {
  console.error('aucun rendu en 10 s');
  process.exit(1);
}, 10_000);

vue.onDidChangeTreeData(async () => {
  clearTimeout(delai);
  const lignes = [];
  const montrer = (noeuds, niveau) =>
    noeuds.forEach((n) => {
      const item = vue.getTreeItem(n);
      const extra = [item.description, n.perso && '(perso)', item.contextValue === 'demandable' && '💬'].filter(Boolean).join('  ');
      lignes.push(`${'  '.repeat(niveau)}${item.label}${extra ? '  ·  ' + extra : ''}`);
      montrer(vue.getChildren(n), niveau + 1);
    });
  montrer(vue.getChildren(), 0);
  lignes.push('', 'PROBLÈMES');
  for (const [fichier, messages] of problemes) for (const m of messages) lignes.push(`  ${relative(projet, fichier) || fichier} — ${m}`);
  const avertissement = vue.getChildren().find((s) => s.label === 'À VÉRIFIER')?.enfants.find((n) => n.invite);
  if (avertissement) {
    await vscode.commands.faites['contextree.demander'](avertissement);
    lignes.push('', 'DEMANDER À CLAUDE', `  ${presse}`);
  }
  console.log(lignes.join('\n'));
  process.exit(0);
});
