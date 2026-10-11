# contextree — la vue

La carte du contexte Claude Code dans la barre latérale de Cursor ou VS Code : ce qui se charge à chaque session, en touchant un fichier, quand la tâche en parle, à la main ; les sous-agents, les hooks, et ce qu'il faut vérifier. Le calque perso (hors git) est à part, grisé. Un clic ouvre le fichier.

- **Ce que Claude a vraiment chargé** : avec le journal du plugin (2.3.0 et plus), chaque fichier dit « chargé 3 fois, dernier il y a 2 min ». Ce qui a été chargé depuis moins de 15 minutes est teinté, avec une pastille •, dans la vue, dans l'explorateur et sur son onglet ; il redevient gris ensuite.
- **Pour ce fichier**, en tête : ce qui se charge en plus quand Claude touche le fichier de l'onglet actif (règles à `paths`, instructions de dossier, skills). Avec le journal (plugin 2.3.1 et plus), ce qui s'est vraiment chargé pour ce fichier est marqué, le reste « se chargerait ». Une règle ne se charge qu'une fois par session, pour le premier fichier qui la déclenche : sur un deuxième fichier, elle dit « se chargerait » alors qu'elle est déjà là. Suit le changement d'onglet.
- **Problèmes** : chaque avertissement de la carte y apparaît aussi, ligne 1 du fichier concerné, avec la correction.
- **Demander à Claude** (icône 💬 sur un avertissement ou un fichier, ou clic droit) : copie un prompt prêt dans le presse-papier, à coller dans Claude Code. Cursor n'offre pas d'autre voie pour lui écrire.
- **Carte en texte** (icône 📖 du titre) : la sortie de `/contextree:carte` dans un document en lecture seule.

La vue ne calcule rien : elle lance `carte.mjs --json` du plugin contextree et l'affiche. Elle se rafraîchit à l'ouverture, au changement d'onglet, quand tu sauvegardes un fichier de contexte (`CLAUDE.md`, `AGENTS.md`, `.claude/…`, `~/.claude/…`), quand le journal de chargement bouge (après chaque tour de Claude, sans rien sauvegarder), et avec le bouton ↻.

## Installer dans Cursor

Depuis le clone de contextree :

```bash
npm run package:ext                                   # → extension/contextree.vsix
cursor --install-extension extension/contextree.vsix  # ou code --install-extension
```

Sans la commande `cursor` dans le terminal : palette → **Extensions: Install from VSIX…** → `extension/contextree.vsix`. Puis **Developer: Reload Window**.

La vue apparaît dans l'explorateur, section **contextree**, dès que le dossier ouvert contient `CLAUDE.md`, `AGENTS.md` ou `.claude/`.

## Où elle trouve la carte

Dans l'ordre : le réglage `contextree.plugin` (le dossier du plugin, celui qui contient `skills/carte`), le clone de contextree s'il est le dossier ouvert, puis le plugin installé dans Claude Code (`~/.claude/plugins/installed_plugins.json`).
