---
type: reference
title: Matrice des agents
load_when: quand on se demande ce qui marche sur quel agent ou éditeur, ou ce qui reste à vérifier
---

Ce qui est **vu** marcher, ce qui est seulement **câblé**, et ce qu'on ne peut pas vérifier ici. La distinction est le cœur de cette branche : un fichier de configuration écrit à la bonne forme n'est pas la preuve qu'un agent le lit.

## Trois états, et pas deux

- **déroulé** — le scénario *depuis zéro* a été joué en vrai sur cet agent, réponses observées.
- **câblage vérifié** — les fichiers sont écrits, relus, à la bonne forme, et la surface produit ce qu'elle doit produire. Aucun tour d'agent n'a eu lieu.
- **non vérifiable ici** — l'agent n'est pas installé sur la machine.

## La matrice, au 11 septembre 2026

| Agent / éditeur | Injection | Édition | État | Ce qui reste |
|---|---|---|---|---|
| **Claude Code** (terminal, VS Code, Cursor) | hook `UserPromptSubmit` + MCP | MCP | **déroulé** le 11 sept. | — |
| **VS Code + Copilot** | `.vscode/mcp.json` (forme `servers`) + `copilot-instructions.md` + `AGENTS.md` | MCP | **raté observé** le 14 sept. par Adrien : Copilot **écrit** l'arbre quand on le lui demande, mais ne le **lit jamais** (aucun `get_context`). Routage par **sampling** testé seulement sur un client MCP en mémoire | carte P6 « Copilot ne lit jamais l'arbre » : le bloc de consignes n'est écrit qu'à `install` si l'arbre existe déjà (et jamais par le bouton de l'extension), les `instructions` MCP sont figées à la connexion, et la consigne n'a pas de moment. Puis re-mesurer |
| **Cursor** (agent intégré) | MCP + `AGENTS.md` | MCP | **câblage vérifié** | idem, dans l'agent de Cursor |
| **Gemini CLI** | hook `BeforeAgent` + MCP + `GEMINI.md` | MCP | **câblage vérifié** — la commande écrite par `install`, exécutée telle quelle, rend le JSON attendu | le CLI n'est pas installé ; un vrai tour reste à voir |
| **Codex CLI** | MCP + `AGENTS.md` | MCP | **câblage vérifié** (pas de hook — voir plus bas) | le CLI n'est pas installé |
| **Windsurf** | MCP | MCP | **non vérifiable ici** — absent de la machine | tout |
| **Claude Desktop** | MCP | MCP | **câblage vérifié** | un tour réel |
| **ChatGPT / Claude web** | presse-papier (`render --agents --copy`) | — | **câblage vérifié** — le bloc rendu tient en 13 lignes | — |

**Toute la matrice est mesurée sous macOS.** Windows — la cible entreprise — n'a jamais fait tourner un agent : le routage par CLI y a été corrigé et testé avec un faux `claude.cmd` le 14 septembre 2026, et `.github/workflows/test.yml` lance `npm test` sur `windows-latest`, mais aucune ligne de ce tableau n'est encore vérifiée sur un poste Windows.

## Ce qui est coché sans agent, et comment

Trois choses se vérifient sans jamais lancer l'agent, et elles couvrent la moitié du travail :

1. **Les fichiers sont à la bonne forme.** `install --status` dit « câblé » seulement quand *tous* les fichiers d'un agent le sont, et chaque fichier est relu selon **son** format (voir *Surfaces d'injection par agent*). Les sept lignes sont câblées sur un projet jetable.
2. **Le bloc de consignes donne le catalogue, jamais l'arbre entier.** Mesuré sur `AGENTS.md`, `GEMINI.md` et `.github/copilot-instructions.md` : quatre lignes de catalogue, **zéro** ligne de contenu de branche. C'est exactement le contrat de `renderAgentsBlock`.
3. **La surface produit ce que l'agent attend.** Pour Gemini, la commande écrite dans `.gemini/settings.json` a été exécutée telle quelle sur un payload `BeforeAgent` : JSON valide, `additionalContext` portant le bloc.

## Ce qui ne se coche qu'avec l'agent

Le reste des questions de cette matrice demande un tour réel, et aucune ne se déduit du câblage : l'agent **lit**-il le fichier de consignes qu'on lui a écrit ? appelle-t-il `get_context` sans qu'on le lui demande ? propose-t-il l'arbre quand il n'y en a pas ? annonce-t-il ses écritures ? Le journal (`source: 'hook'` ou `'mcp'`) est le seul juge : il ne se remplit que si quelque chose a vraiment traversé.

**Claude Code répond oui aux quatre**, mesuré le 11 septembre : proposition en 6 passages sur 6, arbre écrit sans terminal, routage à 1-6 branches sur 8 selon le prompt, et une branche écrite spontanément sur une tâche réelle.

## Pas de hook pour trois d'entre eux, et ce n'est pas un oubli

**Copilot** a des hooks mais **ignore la sortie** de son `UserPromptSubmit` ; **Cursor** n'a que `beforeSubmitPrompt`, qui sait bloquer et non injecter. Poser un hook là, ce serait lancer un process à chaque prompt pour qu'il n'injecte rien — en silence. Le fichier de consignes fait le même travail sans process.

**Codex** : la documentation du 11 septembre 2026 ne confirme ni l'événement `UserPromptSubmit` ni le statut expérimental qu'on lui prêtait. Le dialecte `hook --agent codex` existe (texte brut, comme Claude Code) pour qui l'activerait à la main, mais `install` n'écrit pas cette configuration — on n'inscrit pas une commande qu'on ne peut pas vérifier.
