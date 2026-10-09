# Changelog

Une version par changement visible du plugin. Pour la prendre : `claude plugin marketplace update contextree`, puis `claude plugin update contextree@contextree`.

## 2.2.0 — 2026-10-09

- **`/contextree:jardin`** : la revue de fin de session. Un script relève les fichiers de contexte qui citent un chemin changé dans la session et ceux sans commit depuis six semaines ; Claude y ajoute ce que la conversation a appris, et propose des diffs classés (faux, manquant, à extraire, à découper), appliqués seulement sur accord.

## 2.1.0 — 2026-10-09

- **`/contextree:carte` dit juste sur de vrais projets** : le poids suit `/context` (environ 2,5 caractères par token en français), les descriptions des sous-agents comptent dans « toujours chargé », un hook qui lance un script absent par chemin absolu est signalé, et chaque avertissement dit quoi faire.
- **Le calque perso** : la carte lit aussi `~/.claude` (ou `CLAUDE_CONFIG_DIR`), `CLAUDE.local.md`, `.claude/settings.local.json` et la mémoire automatique du projet, et les montre à part. `--sans-perso` montre le projet seul.
- **`/contextree:init-contexte`** : le premier jour d'un projet — Claude lit le dépôt, propose un plan de fichiers, écrit après accord.
- **`/contextree:migrer-v1`** : convertit un projet de l'ancien contextree (`.contextree/`) en fichiers natifs et retire le hook et le serveur MCP de la v1.
- Hors du plugin : **la vue dans Cursor** (`extension/`), la carte en barre latérale — voir le README.

## 2.0.0 — 2026-10-09

- Repartir de zéro : un plugin Claude Code sans dépendance. `/contextree:carte` montre chaque fichier de contexte et quand il se charge ; `/contextree:retenir` écrit un fait durable au bon endroit ; un rappel en fin de tour demande ce que la tâche a appris. L'arbre `.contextree/`, le routeur, le serveur MCP et l'extension de la v1 sont abandonnés.
