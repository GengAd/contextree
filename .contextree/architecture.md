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
  version.ts      la version du build, portée par chaque tour du journal
  eval.ts         la comparaison qui mesure le routage (npm run eval)
  lint.ts         le contrôle de forme de l'arbre : avertissements, jamais refus
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

**Le contrôle de forme** (`lint.ts`, 14 septembre 2026) : `lintTree` rend des **avertissements, jamais un refus** — pas de racine, moins de 4 branches, plus de 15 sœurs **sur un même niveau** (pas sur l'arbre entier : un arbre en familles doit pouvoir grandir), arbre plat (plus de 6 branches, aucun enfant), sœurs au même motif sans parent (premier segment d'un chemin composé, ou premier mot d'au moins 4 lettres d'un titre), `load_when` vide / en « toujours » / recopié du titre, parent plus long que tous ses enfants réunis (à partir de deux enfants — avec un seul, rien ne se multiplie). **Aucune sémantique** : ce qui ne se voit pas à la structure est le rôle du plan et des exemples de la consigne `bootstrap`. Chaque message dit quoi faire, en fr et en en — il est lu par un modèle dans la réponse d'un outil. Lu partout où l'arbre se lit : réponse d'`upsert_branch` / `delete_branch` / `move_branch`, `contextree list`, `install --status`, et **la toile** — chaque avertissement sur la carte qu'il nomme (bordure et ligne « ⚠ » couleur avertissement, la liste complète quand la carte est sélectionnée), ceux de l'arbre entier sur la carte de la racine. Les messages arrivent traduits du cœur : la webview n'a rien à traduire. Passé sur l'arbre de ce dépôt : aucun avertissement.
