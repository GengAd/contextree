---
paths: "extension/**"
---

# La vue (extension Cursor / VS Code)

- La vue ne calcule rien : elle lance `carte.mjs --json` et l'affiche. Une information absente de la vue s'ajoute d'abord au JSON de la carte (`.claude/rules/carte.md`).
- JavaScript CommonJS avec `// @ts-check`, sans build ni dépendance — pas même `@types/vscode` : `npm install` est refusé. `extension/package.json` sans `"type"` garde le CommonJS malgré le `"type": "module"` de la racine.
- La logique va dans `arbre.js`, qui n'importe pas `vscode` : l'arbre, la section « pour ce fichier », les problèmes et les prompts de « Demander à Claude ». `tests/extension.test.mjs` l'exerce sur la fixture. `extension.js` ne fait que brancher.
- `node extension/fumee.cjs <projet> [fichier actif]` fait tourner `extension.js` sans Cursor, avec un faux module `vscode` : la vue en texte, les problèmes, un prompt. C'est la façon de voir un changement de l'extension avant de réinstaller le `.vsix` ; un test le lance sur la fixture. Une API `vscode` nouvelle dans `extension.js` s'ajoute aussi au faux module.
- Une seule exécution de la carte par rafraîchissement : `--json` et `--fichier <onglet actif>` ensemble ; la carte en texte reprend les mêmes arguments sans `--json`.
- La carte tourne avec le Node de l'éditeur (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) : le PATH d'une app graphique n'a souvent pas `node`.
- La vue lit `installPath` dans `installed_plugins.json` : une copie dans `~/.claude/plugins/cache/`, rafraîchie au démarrage d'une session Claude Code. Elle peut donc être plus ancienne que la vue : `arbre.js` tolère un JSON sans `poidsToujours` ni `racinePerso` (« poids inconnu : mettre à jour le plugin »). Un champ nouveau de la carte se lit avec un repli, jamais en supposant qu'il existe.
- `npm run package:ext` produit `extension/contextree.vsix` (zip écrit à la main dans `empaqueter.mjs`, sans vsce). Un fichier ajouté à l'extension s'ajoute à `FICHIERS` dans `empaqueter.mjs`.
- Cursor installe depuis le `.vsix` (palette → *Install from VSIX*), pas depuis `~/.vscode`.
