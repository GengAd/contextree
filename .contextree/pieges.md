---
type: skill
title: Pièges déjà rencontrés
load_when: quand on debugge un comportement inattendu du serveur MCP, du hook, de la vue ou du chargement de l'arbre — rien n'est chargé, la vue ne s'allume pas, un process tourne en boucle, un chemin change sous Windows
---

- **La vue ne s'allume pas** → ouvrir *Sortie › contextree* : journal surveillé et écart de version. Une extension et un contextree de commits différents lisent et écrivent des états différents, sans erreur. Réinstaller les deux au même commit.
- **Rien n'est injecté sur un clone frais** → `dist/` est ignoré : `npm run build`.
- **`process.exit` tue le serveur MCP** : la branche `mcp` ne rend jamais la main (`await new Promise(() => {})`).
- **stdout = contexte, stderr = trace.** Inverser pollue le modèle et casse le JSON de Gemini. **Sous Gemini, un code 2 efface le prompt** : l'invariant du code 0 y sépare un contexte manquant d'un prompt perdu.
- **Jamais `os.tmpdir()` pour de l'état partagé** : le SDK MCP lance le serveur sans `TMPDIR`, hook et serveur écrivaient dans deux dossiers différents. `stateDir()` partout ; `CONTEXTREE_STATE_DIR` isole en test.
- **Un nom de dossier qu'on cherche en remontant est un espace de noms.** L'état vivait dans `~/.contextree`, et tout projet sans arbre sous `~` le prenait pour son arbre — `write_root` y a écrit l'arbre d'un projet. D'où `stateDir()`, la remontée qui s'arrête avant `~`, et `contextree rescue --to <projet>` pour récupérer un arbre écrit là.
- **Ne jamais relancer `process.argv[1]` pour relancer la CLI** : sous `node --test`, c'est le fichier de tests — le différé relançait la suite en boucle, en process détachés et muets. L'entrée se résout depuis le module (`new URL('../cli.js', import.meta.url)`). Après `npm test`, `ps -ax | grep route-bg` doit être vide.
- **Windows : la casse de la lettre de lecteur change** (`c:\` / `C:\`) → deux clés, deux journaux. Toute clé dérivée d'un chemin passe par `treeKey`.
- **Windows : `spawn` sur un `.cmd` sans shell lève `EINVAL`**, et Claude Code natif est un `.exe`. Voir *Moteurs de routage*. Jamais `shell: true`.
- **Sous Homebrew, `process.execPath` est versionné** : une config écrite par `install` casse au prochain `brew upgrade node`. `install` la répare (`runnableHere`) ; la forme npx pinnée supprimera le problème.
- **Ce qui est dérivé de l'arbre et écrit ailleurs doit suivre l'arbre** (bloc des fichiers de consignes) — sinon Copilot construit l'arbre et ne le lit jamais.
- **Un outil qui envoie du contenu au modèle doit laisser une trace** dans le journal, sinon la vue ment par omission (`read_branch`).
- **Un conflit git dans un frontmatter ne se voit pas** : le parseur garde la dernière valeur. Voir *Partager un arbre par git*.
