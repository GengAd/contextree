# 0001 — Claude Code charge, contextree regarde

**Décision.** contextree ne définit ni format de contexte, ni routeur, ni serveur. Il lit les fichiers que Claude Code charge lui-même, et aide à les remplir.

**Pourquoi.** La v1 (tag `v1-arbre-route`) reconstruisait le chargement : un arbre `.contextree/`, un appel IA par prompt pour choisir les branches, un serveur MCP, un hook d'injection, une extension. Claude Code fait déjà l'essentiel sans appel de plus — `CLAUDE.md` toujours, `.claude/rules/` sur le fichier touché, les skills sur leur description — et il **applique** (hooks, permissions) ce qu'un texte ne peut que conseiller. Deux mécanismes en parallèle divergent, et c'est le natif que le modèle a appris.

Ce que le natif ne fait pas : montrer l'ensemble, contrôler la forme, et surtout **entretenir**. Un fichier périmé est la première cause de « Claude devient moins bon ». C'est le périmètre de contextree.

**Conséquences.** Une feature qui réinvente un chargement est refusée. Ce qui doit valoir pour tous les agents (Cursor, Copilot) ira dans `AGENTS.md` le jour où un projet en a besoin, pas avant.
