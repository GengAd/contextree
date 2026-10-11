# Changelog

Une version par changement visible du plugin. Pour la prendre : `claude plugin marketplace update contextree`, puis `claude plugin update contextree@contextree`.

## 2.4.0 — 2026-10-11

- **Le jardin se propose seul** : au début de la session suivante (hook `SessionStart`), si des fichiers de contexte parlent de code modifié depuis le dernier jardin, ou viennent de passer six semaines sans commit, Claude propose `/contextree:jardin` une fois, à la fin de ta première tâche. Rien s'il n'y a rien.
- **`/contextree:jardin` part du dernier jardin** : il marque son passage (`.claude/contextree/jardin.dernier`, hors git) ; sans marque, 12 heures, et jamais plus de 30 jours. Il relève aussi une règle dont les `paths` visent un fichier changé et le `CLAUDE.md` du dossier d'un fichier changé, plus seulement les fichiers qui citent son chemin. Le travail non commité d'avant le dernier jardin ne revient pas, sauf une suppression, qui n'a plus de date.
- `/contextree:carte --json` ne coupe plus sa sortie à 64 Ko quand elle passe par un pipe.

## 2.3.1 — 2026-10-11

- **`/contextree:carte --fichier`** dit, avec le journal, ce qui s'est vraiment chargé pour ce fichier (« chargé 2 fois pour ce fichier, dernier il y a 3 min ») et ce qui « se chargerait » ; en `--json`, `pourFichier.charges`. C'est ce que lit la vue dans Cursor, qui teinte désormais ce que Claude vient de charger.

## 2.3.0 — 2026-10-11

- **Le journal de chargement** : le plugin note ce que Claude Code charge vraiment — chaque `CLAUDE.md`, import et règle (hook natif `InstructionsLoaded`), chaque skill lancée par Claude ou tapée — dans `.claude/contextree/journal.jsonl`, hors git, taillé à 90 jours et 5 000 lignes.
- **`/contextree:carte` le lit** : « chargé 3 fois, dernier il y a 2 h » à côté de chaque fichier, et un avertissement pour une règle à `paths` ou une skill jamais chargée en deux semaines et cinq sessions — la seule mesure d'une description. En `--json` : `charges` par élément, `journal` à la racine. Le journal est propre à la machine : `--sans-perso` l'ignore.

## 2.2.0 — 2026-10-09

- **`/contextree:jardin`** : la revue de fin de session. Un script relève les fichiers de contexte qui citent un chemin changé dans la session et ceux sans commit depuis six semaines ; Claude y ajoute ce que la conversation a appris, et propose des diffs classés (faux, manquant, à extraire, à découper), appliqués seulement sur accord.

## 2.1.0 — 2026-10-09

- **`/contextree:carte` dit juste sur de vrais projets** : le poids suit `/context` (environ 2,5 caractères par token en français), les descriptions des sous-agents comptent dans « toujours chargé », un hook qui lance un script absent par chemin absolu est signalé, et chaque avertissement dit quoi faire.
- **Le calque perso** : la carte lit aussi `~/.claude` (ou `CLAUDE_CONFIG_DIR`), `CLAUDE.local.md`, `.claude/settings.local.json` et la mémoire automatique du projet, et les montre à part. `--sans-perso` montre le projet seul.
- **`/contextree:init-contexte`** : le premier jour d'un projet — Claude lit le dépôt, propose un plan de fichiers, écrit après accord.
- **`/contextree:migrer-v1`** : convertit un projet de l'ancien contextree (`.contextree/`) en fichiers natifs et retire le hook et le serveur MCP de la v1.
- Hors du plugin : **la vue dans Cursor** (`extension/`), la carte en barre latérale — voir le README.

## 2.0.0 — 2026-10-09

- Repartir de zéro : un plugin Claude Code sans dépendance. `/contextree:carte` montre chaque fichier de contexte et quand il se charge ; `/contextree:retenir` écrit un fait durable au bon endroit ; un rappel en fin de tour demande ce que la tâche a appris. L'arbre `.contextree/`, le routeur, le serveur MCP et l'extension de la v1 sont abandonnés.
