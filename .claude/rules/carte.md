---
paths: "plugin/skills/carte/**"
---

# La carte

- `carte.mjs` n'a aucune dépendance et ne lit que le disque. Il suit la doc de Claude Code (memory, skills, sub-agents, hooks) : si la doc change, c'est lui qui a tort.
- Les sections suivent l'ordre où Claude Code charge : toujours, en touchant un fichier, quand la tâche en parle, à la main, sous-agents, hooks et permissions, à vérifier.
- **Un avertissement dit quoi faire**, en une ligne, avec le chemin. Pas d'avertissement sans correction possible.
- Un nouvel avertissement = un défaut de plus dans `tests/fixture/` et une assertion dans `tests/carte.test.mjs`, qui compte le total.
- `--json` est le contrat pour les outils (le hook de forme, la future vue) : on ajoute des champs, on n'en renomme pas.
- Les limites (`LIMITE_RACINE`, `LIMITE_SKILL`, `LIMITE_DESCRIPTION`) sont des constantes en tête du fichier, chacune avec sa raison.
