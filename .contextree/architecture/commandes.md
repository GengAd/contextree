---
type: reference
title: Commandes
load_when: quand il faut builder, tester ou lancer l'outil
---

```bash
npm run build       # tsc -b
npm run typecheck   # validation rapide
npm test            # build + node:test sur dist/
npm run eval        # mesure le routage sur tests/routing.eval.json (opt-in)
npm run test:sql    # schéma + politiques RLS sur un Postgres jetable (Docker)
npm run build:ext   # compile l'extension (barre latérale + toile 2D)
npm run package:ext # produit le .vsix

node dist/cli.js route "<prompt>"   # voir ce que le routeur chargerait
node dist/cli.js render             # tout l'arbre, sans routage
node dist/cli.js mcp                # serveur MCP sur stdio
```

`npm run eval` n'est **pas** un test : il faut un moteur, la réponse d'un modèle varie, et un mauvais score dit « le routage s'est dégradé », pas « le code est cassé ». Il sort donc toujours en 0, et n'entre jamais dans `npm test`. C'est le seul instrument qui dise si une retouche du `load_when`, du prompt du routeur ou du modèle améliore ou abîme quelque chose.

Les tests tournent sur le **build** (`tests/*.test.js` importent `dist/`), pas sur les sources : `npm test` builde d'abord.
