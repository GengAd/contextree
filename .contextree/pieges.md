---
type: skill
title: Pièges déjà rencontrés
load_when: quand on debugge un comportement inattendu du serveur MCP, du hook ou du chargement de l'arbre — y compris un MCP contextree qui ne se connecte pas dans une session cloud
---

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après `connect()` et le client ne reçoit rien.
- **Un dossier sans `.md` frère était invisible.** Corrigé par le hub implicite dans `walk()`. Si tu retouches cette fonction, garde le comportement — c'est ce qui fait marcher `import --prefix`.
- **Le cache de session vit dans `os.tmpdir()`**, jamais dans le repo : c'est de l'état, pas du contenu. Il ne doit jamais devenir une dépendance.
- **Le hook écrit le contexte sur stdout et la trace sur stderr.** Inverser les deux polluerait le contexte du modèle avec la ligne de debug.
- **Session cloud : `dist/` n'existe pas au démarrage** (non versionné). `.mcp.json` et le hook de ce dépôt lancent `node dist/cli.js` : sans build, le MCP `contextree` échoue en `CONNECTION_CLOSED`. C'est `.claude/hooks/session-start.sh` (SessionStart, cloud seulement) qui fait `npm install && npm run build` — sa trace va sur stderr, car le stdout d'un SessionStart part dans le contexte.
- **`npx -y @gengad/contextree` → 404 tant que le paquet n'est pas publié**, même installé en global : `npx` interroge toujours le registre (vérifié le 5 octobre 2026). Or c'est ce qu'écrit `install` (`MCP_COMMAND`, `HOOK_COMMAND`) : hors de ce dépôt, le câblage par défaut ne démarre pas.
- **`npm install -g github:GengAd/contextree` échoue au `prepare`** (`TS2591: Cannot find name 'node:fs'`) : npm passe `--global` à l'install de préparation du clone, les devDependencies (`typescript`, `@types/node`) n'y arrivent pas. En local (sans `-g`) ça marche. Pour un binaire global : cloner, `npm install`, `npm link` (vérifié le 5 octobre 2026).
