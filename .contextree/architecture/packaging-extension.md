---
type: reference
title: Packaging de l'extension (.vsix)
load_when: quand on touche à l'extension VS Code / Cursor, à sa compilation, à son packaging en .vsix, à son installation, à sa publication, ou à la façon dont elle charge le cœur
---

L'extension se compile en **CommonJS** et charge un cœur **ESM** : c'est ce qui contraint tout le reste.

- **Le cœur est copié, pas lié.** `npm run bundle:core` copie `dist/` dans `extension/out/core/` avec un `package.json` `{"type":"module"}` — sans lui, l'extension ne s'active pas. `@gengad/contextree` reste en **devDependency** (`file:..`) : en production, `vsce` suit le lien et échoue sur les 48 Mo de `node_modules` du repo.
- `loadCore()` importe `./core/view.js` par un **spécificateur non littéral** ; `module: node16` préserve l'`import()` dans la sortie CommonJS.
- **`view.js`, pas `index.js`** : le barillet tire le SDK MCP et `zod`. `src/view.ts` n'expose que store, tree, journal, routeur — `.vsix` d'environ 80 Ko sans `node_modules`. Le routeur charge le SDK Anthropic à la demande ; dans l'extension il est absent, donc on route par le CLI.
- **L'extension ne câble jamais son propre process** : elle tourne dans un binaire Electron, et « Ajouter à une IA » exige un `contextree` installé (voir *Câbler un agent*). Tester un comportement de l'hôte sans installer : `ELECTRON_RUN_AS_NODE=1 "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)" -e 'import("…/dist/install.js").then(…)'`.
- **Cursor** : `engines.vscode` à `^1.85.0` (`@types/vscode` aligné, sinon `vsce` refuse). `FileDecorationProvider` est testée avant enregistrement.
- **Le cœur embarqué dit sa version** (`VERSION`, constante dans `src/core/version.ts`, gardée alignée par un test), comparée aux tours du journal. **Réinstaller le `.vsix` et le contextree de l'agent au même commit** : rien d'autre ne signale qu'ils ont divergé.

## Construire et installer

```bash
npm run package:ext
"/Applications/Cursor.app/Contents/Resources/app/bin/cursor" --install-extension extension/contextree-vscode-0.1.0.vsix --force
```

`--force` : même numéro de version. Puis « Developer: Reload Window ». Ou « Extensions: Install from VSIX… ».

**Publication** : rien tant que le repo est privé. Le jour venu, **Open VSX d'abord** — le registre de Cursor, Windsurf et VSCodium.
