---
type: reference
title: Packaging de l'extension (.vsix)
load_when: quand on touche à l'extension VS Code / Cursor, à sa compilation, à son packaging en .vsix, à sa publication, ou à la façon dont elle charge le cœur
---

L'extension se compile en **CommonJS** et charge un cœur **ESM** : c'est ce qui contraint tout le reste.

**Le cœur est copié, pas lié.** `npm run bundle:core` copie `dist/` dans `extension/out/core/` et y dépose un `package.json` de deux lignes (`{"type":"module"}`) — sans lui, Node lit ces `.js` comme du CommonJS et l'extension ne s'active pas. `@gengad/contextree` reste en **devDependency** (`file:..`), pour les types seulement : en dépendance de production, `vsce` suit le lien symbolique, tente d'embarquer les 48 Mo de `node_modules` du repo, et échoue sur des chemins qui sortent du dossier — le paquet ne se construit pas du tout.

`loadCore()` importe `./core/view.js` par un **spécificateur non littéral** : le dossier n'existe pas à la compilation, tsc n'a rien à résoudre. `module: node16` préserve l'`import()` dans la sortie CommonJS — seule façon d'y charger de l'ESM.

**`view.js`, pas `index.js`.** Le barillet complet tire le serveur MCP (`@modelcontextprotocol/sdk`, `zod`). `src/view.ts` n'expose que ce qu'une vue utilise — store, tree, journal, routeur — et ne dépend que de Node. D'où un `.vsix` de 81 Ko sans aucun `node_modules`. Le routeur en fait partie parce que la toile essaie des prompts : il charge le SDK Anthropic **à la demande**, et `pickEngine` ne choisit `anthropic` que si le SDK est réellement résolvable (`hasSdk`). Dans l'extension il ne l'est pas : une clé posée là ne mène pas à un moteur mort, on route par le CLI. Bénéfice collatéral côté hook — plus de SDK de 10 Mo chargé à chaque prompt quand on route par le CLI.

**L'extension ne câble jamais son propre process.** Le cœur embarqué tourne dans l'hôte d'extensions, un binaire Electron : tout ce qui inscrit « la commande qui tourne » (`selfCommand`) y est faux. Le bouton « Ajouter à une IA » demande donc un `contextree` installé sur la machine (`npm i -g`), et refuse d'écrire sans lui — voir *Surfaces d'injection par agent*. Pour vérifier un comportement de l'hôte sans installer le `.vsix` : `ELECTRON_RUN_AS_NODE=1 "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)" -e 'import("…/dist/install.js").then(…)'`.

**L'extension suit la langue de VS Code** (14 septembre 2026). Trois mécanismes, un par couche : `package.nls.json` (anglais, par défaut) et `package.nls.fr.json` pour le manifeste (titres de commandes, vues d'accueil, description), avec des `%clés%` dans `package.json` ; `vscode.l10n.t('texte anglais', …)` et `l10n/bundle.l10n.fr.json` pour le code (`"l10n": "./l10n"` dans le manifeste, API disponible depuis 1.73) ; et pour la toile, qui n'a pas l'API, l'hôte traduit la liste `CANVAS_STRINGS` et la pose dans la page en JSON, lue par `tr()` dans `canvas.js`. Un texte ajouté à la toile sans passer par `CANVAS_STRINGS` s'affiche en anglais — un test le vérifie. Le cœur embarqué reçoit la langue par `setLang`, **jamais par `CONTEXTREE_LANG`** : l'environnement de l'hôte d'extensions est hérité par tout ce que les autres extensions y lancent, jusqu'au hook de Claude Code. Les quatre fichiers sont bien dans le `.vsix` (`vsce ls`). **Pas vérifié dans un vrai VS Code lancé en `--locale fr` / `--locale en`.**

**Cursor.** `engines.vscode` à `^1.85.0` (et `@types/vscode` aligné, sinon `vsce` refuse) : aucune API utilisée n'est postérieure, et les forks suivent VS Code avec du retard. `FileDecorationProvider` est la plus susceptible de manquer — sa présence est testée avant enregistrement, et sans elle la vue perd la pastille et garde tout le reste.

**Publication.** Rien tant que le repo est privé : `npm run package:ext`, puis `code`/`cursor --install-extension`, ou « Extensions: Install from VSIX ». Le jour venu, **Open VSX d'abord** — c'est le registre que lisent Cursor, Windsurf et VSCodium, que le Marketplace de Microsoft ne sert pas.

**Le cœur embarqué dit sa version** (`VERSION`, `src/core/version.ts`, une constante et pas une lecture de `package.json` : le `.vsix` ne l'embarque pas ; un test la garde alignée). L'extension la compare à celle des tours du journal et l'annonce dans le canal *Sortie › contextree* — voir *Journal des tours*. Réinstaller le `.vsix` après avoir mis à jour le contextree que lance l'agent, et inversement : les deux écrivent et lisent le même état, et rien d'autre ne signale qu'ils ont divergé.
