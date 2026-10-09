---
name: migrer-v1
description: Passer un projet de l'ancien contextree (arbre `.contextree/`, hook d'injection, serveur MCP) aux fichiers natifs Claude Code, et retirer le câblage v1. À la main seulement.
disable-model-invocation: true
allowed-tools: Bash(node *migrer-v1.mjs*) Bash(git *)
---

# Migrer un projet depuis l'ancien contextree

- Traces de la v1 ici : !`ls -d .contextree .contextree.local .mcp.json .claude/settings.json .vscode/mcp.json .cursor/mcp.json AGENTS.md .github/copilot-instructions.md 2>/dev/null | tr '\n' ' '; echo "(rien d'autre)"`
- Fichiers non commités : !`git status --short 2>/dev/null | wc -l | tr -d ' '`

Le script convertit par type, sans rien inventer : `root.md` et l'identité → `CLAUDE.md` ; `rule` → `.claude/rules/` ; `context` et `reference` → une skill `user-invocable: false` dont la description est l'ancien `load_when`, les enfants en fichiers voisins ; `skill` → une skill invocable. Il retire le hook, les serveurs MCP (`.mcp.json`, `.vscode`, `.cursor`), les blocs `<!-- contextree -->` d'`AGENTS.md` et de Copilot, et met `.gitignore` à jour.

## 1. Le plan, sans écrire

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/migrer-v1/scripts/migrer-v1.mjs" .
```

Lis le plan, puis règle avec l'utilisateur, en **une seule question**, ce que le script ne peut pas deviner :
- Chaque règle (`type: rule`) : vaut-elle **partout** (toujours chargée, rien à faire), vise-t-elle **des fichiers** (`--paths='regles=src/**;tools/**'` : chargée en les touchant), ou est-elle trop ciblée pour être une règle, comme un workflow Trello ou git (`--regle-skill=trello,dev/git` : elle devient une skill) ?
- D'autres agents lisent-ils le dépôt (Cursor, Copilot, Codex) ? Alors `--agents` : la racine va dans `AGENTS.md`, `CLAUDE.md` l'importe.

## 2. Appliquer

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/migrer-v1/scripts/migrer-v1.mjs" . --appliquer [--paths=…] [--regle-skill=…] [--agents]
git rm -r -q .contextree
```

`.contextree.local/` est personnel et ignoré par git : s'il existe, propose à l'utilisateur de le reporter dans `CLAUDE.local.md`, puis de le supprimer lui-même.

## 3. Relire ce qui parle encore de l'ancien mécanisme

```bash
grep -rn -i -E 'contextree|context tree|branche|arbre|get_context' CLAUDE.md AGENTS.md .claude 2>/dev/null | grep -v 'contextree:'
```

Chaque phrase qui décrit l'ancien mécanisme (« charger la branche `x` », « les branches de l'arbre », « noter dans l'arbre ») se réécrit en termes de skills et de fichiers voisins. Le contenu, lui, ne change pas : une « branche » de jeu ou une « branche git » reste ce qu'elle est.

## 4. Vérifier, puis commiter

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/carte/scripts/carte.mjs" --sans-perso
```

Zéro avertissement. Commit : `Contexte : passage de .contextree aux fichiers natifs Claude Code`. Termine en montrant à l'utilisateur la section « toujours chargé » de la carte, et en lui rappelant de désinstaller la v1 sur sa machine si ce n'est pas fait (section « Tu viens de l'ancien contextree » du README).
