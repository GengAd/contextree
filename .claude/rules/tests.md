---
paths: "tests/**"
---

# Tests

- `node:test` et `node:assert/strict`, rien d'autre. La carte et les hooks se lancent en sous-processus, jamais en important le script.
- `tests/fixture/` est un faux projet : **un défaut de chaque sorte, une seule fois**. Son `CLAUDE.md` dit que c'est une fixture, pour que Claude ne le prenne pas pour une consigne.
- Un test dit dans son nom le comportement, pas la fonction.
- Le dernier test de la carte la lance sur ce dépôt et exige zéro avertissement : c'est le dogfooding, il ne se désactive pas.
