# contextree — la vue

La carte du contexte Claude Code dans la barre latérale de Cursor ou VS Code : ce qui se charge à chaque session, en touchant un fichier, quand la tâche en parle, à la main ; les sous-agents, les hooks, et ce qu'il faut vérifier. Le calque perso (hors git) est à part, grisé. Un clic ouvre le fichier.

La vue ne calcule rien : elle lance `carte.mjs --json` du plugin contextree et l'affiche. Elle se rafraîchit à l'ouverture, quand tu sauvegardes un fichier de contexte (`CLAUDE.md`, `AGENTS.md`, `.claude/…`, `~/.claude/…`), et avec le bouton ↻.

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
