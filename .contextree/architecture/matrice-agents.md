---
type: reference
title: Matrice des agents
load_when: quand on se demande ce qui marche sur quel agent ou éditeur, ce qui a été vérifié en vrai, ou ce qui reste à vérifier
---

Trois états, jamais confondus — un fichier écrit à la bonne forme ne prouve pas qu'un agent le lit :
- **déroulé** — le scénario *depuis zéro* joué en vrai, réponses observées ;
- **câblage vérifié** — fichiers écrits, relus, et la surface produit ce qu'elle doit ; aucun tour d'agent ;
- **non vérifiable ici** — agent absent de la machine.

| Agent | État | Ce qui reste |
|---|---|---|
| **Claude Code** | **déroulé** (fr et en) — propose l'arbre, l'écrit sans terminal, route, écrit une branche en tâche réelle | — |
| **VS Code + Copilot** (cible entreprise, Windows) | **raté observé** : écrivait l'arbre sans jamais le lire. Corrigé côté code (bloc synchronisé, consigne avec moment, sampling, catalogue) | **la mesure** : Copilot en mode Agent, outils cochés, trois questions dont la réponse n'est que dans l'arbre → `get_context` appelé ? journal `source: 'mcp'` ? Si non, candidats : `.github/instructions/contextree.instructions.md` (`applyTo: "**"`), un prompt file qui appelle `get_context`, le catalogue dans chaque réponse d'écriture |
| **Cursor** | câblage vérifié | un tour dans l'agent de Cursor |
| **Gemini CLI** | câblage vérifié — la commande écrite, exécutée sur un payload `BeforeAgent`, rend le JSON attendu | CLI non installé |
| **Codex CLI** | câblage vérifié | CLI non installé |
| **Windsurf** | non vérifiable ici | tout |
| **Claude Desktop** | câblage vérifié | un tour réel |
| **ChatGPT / Claude web** | câblage vérifié (presse-papier) | — |

**Tout est mesuré sous macOS.** Windows n'a fait tourner aucun agent : le routage CLI y est testé par un faux `claude.cmd`, et `.github/workflows/test.yml` (`windows-latest`) n'a pas encore tourné.

**Ce qui se vérifie sans l'agent** : la forme des fichiers (`install --status`), le contenu du bloc (catalogue, zéro contenu de branche), la sortie de la surface exécutée telle quelle.

**Ce qui ne se vérifie qu'avec lui** : lit-il ses consignes ? appelle-t-il `get_context` sans qu'on le demande ? propose-t-il l'arbre ? annonce-t-il ses écritures ? Le journal est le seul juge.
