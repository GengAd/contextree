---
paths: "plugin/skills/carte/**"
---

# La carte

- `carte.mjs` n'a aucune dépendance et ne lit que le disque. Il suit la doc de Claude Code (memory, skills, sub-agents, hooks) : si la doc change, c'est lui qui a tort.
- Les sections suivent l'ordre où Claude Code charge : toujours, en touchant un fichier, quand la tâche en parle, à la main, sous-agents, hooks et permissions, à vérifier.
- **Un avertissement dit quoi faire**, en une ligne, avec le chemin. Pas d'avertissement sans correction possible.
- Un nouvel avertissement = un défaut de plus dans `tests/fixture/` et une assertion dans `tests/carte.test.mjs`, qui compte le total. `tests/forme.test.mjs` compte ce total lui aussi (`/N avertissement/`) : les deux changent ensemble.
- Les poids se vérifient contre `claude -p "/context"`, qui marche sans session interactive et donne les vrais tokens (Memory files, Skills, Custom agents).
- `--json` est le contrat pour les outils (le hook de forme, la future vue) : on ajoute des champs, on n'en renomme pas.
- Deux calques : le projet (partagé par git) et le perso (`~/.claude` ou `CLAUDE_CONFIG_DIR`, `CLAUDE.local.md`, `settings.local.json`, mémoire automatique). Chaque élément porte `perso` ; la sortie montre le partagé d'abord, le perso à part. Une règle perso qui ne vise rien dans ce projet n'est pas un défaut : elle sert ailleurs.
- Les limites (`LIMITE_RACINE`, `LIMITE_SKILL`, `LIMITE_DESCRIPTION`, `LIMITE_MEMOIRE`) et `CARACTERES_PAR_TOKEN` sont des constantes en tête du fichier, chacune avec sa raison.
