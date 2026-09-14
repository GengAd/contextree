---
type: rule
title: Conventions de code
load_when: quand on écrit ou renomme du code, un fichier, un test, un message de commit, un texte affiché, une clé de frontmatter ou un nom d'outil MCP
---

- **Modules** en `camelCase.ts`. Les types vivent dans `src/core/types.ts` et nulle part ailleurs.
- **Langues** : textes affichés (CLI, extension, messages d'erreur) et documentation en **français** ; identifiants, noms d'outils MCP, clés de frontmatter, noms de commandes en **anglais** — ils sont lus par des machines et par des tiers. **Décidé le 14 septembre 2026, pas encore fait** (carte P6 « L'outil parle anglais et français ») : l'outil devient **bilingue FR + EN** — CLI, extension, ce que lit le modèle, arbre de départ, README — selon la langue de l'utilisateur. La doc de ce dépôt, les commentaires et les commits restent en français.
- **Commits** : `type(scope): sujet` en français — `feat`, `fix`, `docs`, `test`, `chore`. Le sujet dit ce qui change pour l'utilisateur, pas le fichier touché (voir `git log`). Le corps explique le pourquoi quand il n'est pas évident.
- **Tests** : `node:test` sur le build, dans `tests/core.test.js` (`npm test` builde d'abord). Un test par comportement, nommé « module : ce qui doit être vrai ». Un test qui a besoin du réseau ou d'un moteur de routage n'entre pas dans `npm test` : il est opt-in (`test:sql`, `route --eval`).
- **Commentaires** : le *pourquoi* et ce que ça coûte, pas le quoi. Un choix qui a été tranché se lit dans le code à l'endroit où il s'applique, avec la date s'il renverse un choix précédent.
- **Pas de fichier `.md` à la racine** hors `README.md` (procédure pour un humain). Toute la documentation vit dans `.contextree/` : une branche, un `load_when`, et rien en double ailleurs.
- **Le cœur ne connaît ni MCP ni la CLI ni l'extension** : `src/core/` ne dépend que de Node et du disque. Les trois surfaces sont des adaptateurs au-dessus du même moteur ; si l'une diverge de l'autre, c'est un bug.
