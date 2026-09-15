---
type: rule
title: Conventions de code
load_when: quand on écrit ou renomme du code, un fichier, un test, un message de commit, un texte affiché ou lu par un modèle, une clé de frontmatter ou un nom d'outil MCP
---

- **Modules** en `camelCase.ts`. Les types vivent dans `src/core/types.ts` et nulle part ailleurs.
- **Le cœur ne connaît ni MCP, ni la CLI, ni l'extension** : `src/core/` ne dépend que de Node et du disque.
- **Commits** : `type(scope): sujet` en français — `feat`, `fix`, `docs`, `test`, `chore`. Le sujet dit ce qui change pour l'utilisateur ; le corps, le pourquoi s'il n'est pas évident.
- **Tests** : `node:test` sur le build, `tests/core.test.js`, un test par comportement nommé « module : ce qui doit être vrai ». Réseau ou moteur de routage ⇒ opt-in (`test:sql`, `eval`), jamais dans `npm test`. Les tests posent `CONTEXTREE_LANG=fr`.
- **Commentaires** : le pourquoi et ce que ça coûte, pas le quoi.
- **Pas de `.md` à la racine** hors `README.md` (anglais) et `README.fr.md` : des procédures pour un humain. Toute la doc vit dans `.contextree/`.

## Langues

**L'outil est bilingue fr + en. Tout texte affiché ou lu par un modèle passe par un dictionnaire** :
- `src/core/messages.ts` (cœur), `src/messages.ts` (CLI, install), `src/mcp/messages.ts` (serveur), des `Record<Lang, …>` dans `render.ts` et `lint.ts` ;
- extension : `vscode.l10n.t` + `l10n/bundle.l10n.fr.json`, `package.nls*.json`, `CANVAS_STRINGS` pour la toile. La clé est le **texte anglais** ; un test vérifie chaque traduction.

Le français donne la forme, l'anglais la remplit : une clé oubliée casse le typecheck.

**Restent en français** : `.contextree/`, commentaires, commits, Trello, `ROUTER_SYSTEM` (le traduire invaliderait l'eval), messages du backend. **En anglais dans les deux langues** : identifiants, noms d'outils MCP, clés de frontmatter, commandes, `## Rules` / `## Context`.

Le mécanisme de résolution est dans *Langue de l'outil*.
