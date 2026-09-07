---
type: reference
title: Commandes
load_when: quand il faut builder, tester ou lancer l'outil
---

```bash
npm run build       # tsc -b
npm run typecheck   # validation rapide
npm test            # build + node:test sur dist/

node dist/cli.js route "<prompt>"   # voir ce que le routeur chargerait
node dist/cli.js render             # tout l'arbre, sans routage
node dist/cli.js mcp                # serveur MCP sur stdio
```

Les tests tournent sur le **build** (`tests/*.test.js` importent `dist/`), pas sur les sources : `npm test` builde d'abord.
