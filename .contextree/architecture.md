---
type: context
title: Architecture
load_when: quand la demande porte sur la structure du code ou l'endroit où vit une logique
---

```
src/core/     le moteur, sans I/O externe autre que le disque
  types.ts        les 5 types de branche, Branch, ContextTree, ContextPack
  i18n.ts         la langue (fr | en), résolue à un seul endroit ; Dictionary
  messages.ts     les textes du cœur (erreurs, arbre de départ), fr + en
  frontmatter.ts  parseur maison, scalaires seulement
  store.ts        chargement/écriture de .contextree/, findTreeDir
  tree.ts         withAncestors, allBranches, formatTree
  render.ts       le bloc injecté, le bloc AGENTS.md, la ligne de transparence
  router.ts       l'appel IA de routage et son fallback
  pack.ts         export/import pour le partage
  session.ts      la sélection dont hérite le tour suivant (~/.contextree)
  journal.ts      les tours de routage et les écritures de l'IA
  eval.ts         la comparaison qui mesure le routage (npm run eval)
src/mcp/server.ts serveur MCP stdio, 10 outils
src/mcp/messages.ts instructions, descriptions d'outils et réponses, fr + en
src/cli.ts        toutes les commandes, dont `hook` et `mcp`
src/messages.ts   les textes de la CLI et d'install, fr + en
src/install.ts    câblage par agent : .mcp.json, .claude/settings.json,
                  ~/.codex/config.toml, AGENTS.md
```

**Stack** : Node ≥ 20, ESM, TypeScript strict (`NodeNext`), tests `node:test` sur le build. Trois dépendances — voir *Règles du projet*.

`core/` ne connaît ni MCP ni la CLI. Les trois surfaces d'injection (hook, MCP, `AGENTS.md`) sont des adaptateurs au-dessus du même moteur — si l'une diverge de l'autre, c'est un bug.

**La langue se résout à un seul endroit** (`i18n.ts`, 14 septembre 2026) : `setLang` (l'extension, pour sa copie du cœur) > `CONTEXTREE_LANG` (ou `--lang` sur toute commande) > `LC_ALL`/`LC_MESSAGES`/`LANG` hors `C`/`POSIX` > préférences macOS (`defaults read -g AppleLanguages`) > `Intl` > anglais. macOS a sa ligne parce que, mesuré sur un Mac réglé en français, `LANG=C.UTF-8` et `Intl` rend `en-US`. `install` inscrit `--lang <langue>` dans les commandes du hook et du serveur : les agents les lancent sans `LANG`, et le hook ne paie pas le process `defaults` à chaque prompt.

