---
type: reference
title: Le serveur MCP et ses outils
load_when: quand on touche au serveur MCP (src/mcp/server.ts), à ses outils (get_context, read_branch, upsert_branch, write_root, delete_branch, move_branch, bootstrap_prompt, packs), à leurs descriptions ou à leurs réponses
---

Serveur stdio, dix outils : `get_context`, `bootstrap_prompt`, `list_branches`, `read_branch`, `upsert_branch`, `write_root`, `delete_branch`, `move_branch`, `export_pack`, `import_pack`. **L'arbre est relu à chaque appel** : les fichiers sont la source de vérité et l'utilisateur peut les éditer pendant que le serveur tourne.

- **`instructions`** : quand appeler `get_context`, écrire par `upsert_branch` et l'annoncer, commencer par `write_root` sur un arbre neuf. Sans arbre : l'invitation, **suivie de la consigne de lecture** — lues une fois, elles doivent valoir aussi si l'arbre naît pendant la session.
- **`write_root`** écrit la racine, le seul contenu toujours injecté, et **crée `.contextree/`** s'il n'existe pas. `read_branch` accepte `:root`. La racine se trace sous `:root`.
- **`upsert_branch`** refuse sans arbre (écrire une branche avant la racine est l'ordre inverse) ; **`move_branch`** refuse un parent inconnu (voir *Format sur disque*). Les descriptions disent qu'un `/` crée un enfant, chargé avec son parent.
- **`why` est obligatoire** sur `upsert_branch`, `write_root`, `delete_branch` (optionnel sur `move_branch`) ; chaque écriture est journalisée (voir *Éditer l'arbre depuis la vue*).
- **`bootstrap_prompt` est un outil** : un prompt MCP n'est exposé qu'à l'utilisateur, jamais au modèle. Le prompt `bootstrap` reste pour qui le lance à la main.
- **La forme arrive au moment d'écrire**, car rien ne garantit que l'agent a lu `bootstrap_prompt` : la réponse de `write_root` **à la création** porte « montre le plan avant toute branche » + `TREE_METHOD` ; `upsert_branch`, `delete_branch`, `move_branch` ajoutent les avertissements de forme.
- **La trace est la première ligne** des réponses de `get_context` et `read_branch`, en texte : le chat de VS Code masque les commentaires HTML.
- **`process.exit` tue le serveur** : la branche `mcp` de la CLI ne rend jamais la main.
