---
name: carte
description: Affiche la carte du contexte de ce projet — chaque fichier d'instructions (CLAUDE.md, AGENTS.md et leurs imports), règle, skill, sous-agent et hook, avec le moment où il se charge, son poids, et les incohérences (règle qui ne vise aucun fichier, racine trop longue, description absente, lien mort, hook vers un script disparu). À utiliser quand on demande ce que Claude sait du projet, pourquoi une consigne n'a pas été suivie, ce qui se charge pour un fichier donné, ou après avoir écrit dans le contexte.
argument-hint: "[fichier]"
allowed-tools: Bash(node *carte.mjs*)
---

# Carte du contexte

Lance, depuis la racine du projet :

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/carte/scripts/carte.mjs"
```

Si un fichier est donné ($ARGUMENTS), ajoute `--fichier $ARGUMENTS` : la carte dit alors ce qui se charge **en plus** quand on touche ce fichier. `--json` rend la même chose pour un outil.

La carte compte aussi le calque **perso**, hors git : `~/.claude` (ou `CLAUDE_CONFIG_DIR`), `CLAUDE.local.md`, `.claude/settings.local.json`, la mémoire automatique du projet et le journal de chargement. Il s'affiche à part dans chaque section. `--sans-perso` montre le projet seul, tel que git le partage.

Rends la sortie telle quelle, puis, s'il y a des avertissements, propose pour chacun la correction en une ligne. Ne corrige pas sans accord : la carte sert à voir, pas à décider.

Ce qui a **vraiment** été chargé, la carte le lit dans le journal que tient le hook du plugin (`.claude/contextree/journal.jsonl`, propre à la machine) : « chargé N fois, dernier il y a … » à côté de chaque fichier. Une règle à `paths` ou une skill jamais chargée en deux semaines et cinq sessions est signalée : c'est sa description, ou ses `paths`, qui visent à côté. Ce que la carte ne peut pas dire : si Claude **va** charger une skill — seul le modèle décide, sur la description. Pour la session en cours, la commande intégrée `/context` montre ce qui est chargé à l'instant.
