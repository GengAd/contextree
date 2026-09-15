---
type: context
title: Architecture
load_when: quand la demande porte sur la structure du code ou l'endroit où vit une logique
---

```
src/core/     le moteur, sans I/O externe autre que le disque
  types.ts        les 5 types de branche, Branch, ContextTree, ContextPack
  i18n.ts         la langue (fr | en), résolue à un seul endroit
  messages.ts     les textes du cœur (erreurs, arbre de départ), fr + en
  frontmatter.ts  parseur maison, scalaires seulement
  store.ts        chargement/écriture de .contextree/, findTreeDir
  tree.ts         withAncestors, allBranches, formatTree
  render.ts       le bloc injecté, le bloc AGENTS.md, la ligne de transparence
  router.ts       l'appel IA de routage et son fallback
  pack.ts         export/import pour le partage
  session.ts      la sélection dont hérite le tour suivant
  journal.ts      les tours de routage et les écritures de l'IA
  version.ts      la version du build, portée par chaque tour du journal
  eval.ts         la comparaison qui mesure le routage (npm run eval)
  lint.ts         le contrôle de forme de l'arbre
src/mcp/server.ts serveur MCP stdio, 10 outils ; messages.ts : ses textes
src/cli.ts        toutes les commandes, dont `hook` et `mcp`
src/install.ts    câblage par agent ; src/messages.ts : textes CLI et install
extension/        barre latérale + toile, charge une copie du cœur
```

**Stack** : Node ≥ 20, ESM, TypeScript strict (`NodeNext`), tests `node:test` sur le build. Trois dépendances — voir *Règles du projet*.

`core/` ne connaît ni MCP, ni la CLI, ni l'extension. Les surfaces (hook, MCP, fichiers de consignes, vues) sont des adaptateurs au-dessus du même moteur : si l'une diverge de l'autre, c'est un bug.
