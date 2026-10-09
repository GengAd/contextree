---
name: livrer
description: Livrer — vérifier (tests, carte, validation du plugin) puis pousser main et les tags sur origin. À la main seulement.
disable-model-invocation: true
allowed-tools: Bash(npm test) Bash(node plugin/skills/carte/scripts/carte.mjs*) Bash(claude plugin validate*) Bash(git *)
---

# Livrer

Les lignes `!` ci-dessous s'exécutent **avant** que tu lises : tu reçois l'état réel du dépôt, pas une consigne d'aller le chercher.

- Branche : !`git branch --show-current`
- Fichiers non commités : !`git status --short | wc -l | tr -d ' '`
- Commits en avance sur `origin/main` : !`git fetch -q origin && git log --oneline origin/main..main | wc -l | tr -d ' '`
- Commits en retard : !`git log --oneline main..origin/main | wc -l | tr -d ' '`

## Étapes

1. Pas sur `main`, ou des fichiers non commités : **arrête-toi** et dis lesquels.
2. En retard sur origin : `git pull --ff-only` ; si ça échoue, arrête-toi.
3. `npm test`, puis `node plugin/skills/carte/scripts/carte.mjs --sans-perso` (zéro avertissement), puis `claude plugin validate ./plugin && claude plugin validate .`. Un échec arrête tout.
4. `git push origin main --tags`.
5. Rends trois lignes : ce qui est parti (hashes), ce que `/reload-plugins` changera dans les sessions, ce qui reste en haut de *A faire* dans Trello.
