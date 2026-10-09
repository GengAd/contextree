---
name: init-contexte
description: Construire le contexte natif d'un projet — un CLAUDE.md court avec sa table « où aller », des règles à paths, des skills de domaine, un hook pour chaque interdit — à partir de ce que l'utilisateur explique et de ce que le dépôt contient. Plan validé avant d'écrire. À lancer sur un projet neuf ou sur un projet qui n'a pas encore de contexte.
disable-model-invocation: true
argument-hint: "[ce que tu sais du projet]"
---

# Construire le contexte d'un projet

L'utilisateur t'explique son projet ($ARGUMENTS, et la conversation) ; toi, tu construis les fichiers que Claude Code chargera, puis tu les maintiens au fil de l'eau avec la skill `contextree:retenir`. Trois couches : une **carte** lue en premier, des **pièces** chargées quand on y entre, des **outils** câblés où ils servent.

- Derniers commits : !`git log --oneline -5 2>/dev/null || echo "(pas de dépôt git)"`
- Contexte déjà présent : !`ls -d CLAUDE.md AGENTS.md .claude/rules .claude/skills .claude/settings.json .cursor/rules 2>/dev/null | tr '\n' ' ' ; echo`

## 1. Comprendre, sans écrire

Lis dans cet ordre et arrête-toi dès que tu en sais assez : le README, le manifeste (`package.json`, `pyproject.toml`, `project.godot`…), l'arborescence sur deux niveaux, les vingt derniers commits, un fichier central par dossier de code. Si le dépôt est vide, tout vient de l'utilisateur : pose au plus **cinq questions**, celles dont la réponse change un fichier — stack et commandes, ce qui est interdit, où vivent les décisions, qui d'autre travaille dessus et avec quel agent.

## 2. Proposer un plan, et attendre l'accord

Un tableau, un fichier par ligne : chemin, ce qu'il contient en une phrase, quand il se charge. Règles du plan :

- `CLAUDE.md` sous 50 lignes : ce qu'est le projet, la stack, les commandes, la carte des dossiers, les règles qui valent partout, et une table « où aller » (tâche → fichier → quand). 80 % sur le travail, 20 % au plus sur le comportement.
- Un fait qui ne vaut que pour certains fichiers → `.claude/rules/<sujet>.md` avec `paths:`. Un fait qui vaut pour un sujet sans fichier précis → une skill `user-invocable: false` dont la description dit **quand**, avec les mots qu'emploiera la demande. Une procédure → une skill invocable, avec `argument-hint`. Un interdit → un hook ou un `deny` dans `.claude/settings.json`, jamais une phrase.
- Petit d'abord : deux ou trois règles, deux ou trois skills. Ce qui manque viendra par `retenir`, à l'usage.
- Rien qui raconte l'histoire, rien qui redise le code, un fait à un seul endroit.
- Si d'autres agents lisent le dépôt (Cursor, Copilot, Codex), la racine va dans `AGENTS.md` et `CLAUDE.md` l'importe (`@AGENTS.md`).

## 3. Écrire, puis vérifier

Écris les fichiers du plan validé, puis lance la carte :

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/carte/scripts/carte.mjs" --sans-perso
```

Zéro avertissement, et « toujours chargé » sous 2 000 tokens environ. Termine en disant à l'utilisateur ce que Claude chargera désormais à chaque session, et que la suite se fait seule : chaque fait nouveau sera écrit par `retenir` et annoncé en une phrase.
