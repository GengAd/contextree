---
type: skill
title: Pièges déjà rencontrés
load_when: quand on debugge un comportement inattendu du serveur MCP, du hook ou du chargement de l'arbre
---

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après `connect()` et le client ne reçoit rien.
- **Un dossier sans `.md` frère était invisible.** Corrigé par le hub implicite dans `walk()`. Si tu retouches cette fonction, garde le comportement — c'est ce qui fait marcher `import --prefix`.
- **Le cache de sélection vit sous `stateDir()`** (`~/.contextree/selection/`), jamais dans le repo : c'est de l'état, pas du contenu, et il ne doit jamais devenir une dépendance. Il était dans `os.tmpdir()` jusqu'au 9 septembre 2026 — même piège que le journal : le transport stdio du SDK MCP lance le serveur sans `TMPDIR`, donc le serveur écrivait dans `/tmp` pendant que le hook écrivait dans le `/var/folders/…` de la session, et la sélection ne se transmettait pas d'une surface à l'autre. `HOME` est hérité des deux côtés. Effet de bord utile : `CONTEXTREE_STATE_DIR` isole le cache en test.
- **Le hook écrit le contexte sur stdout et la trace sur stderr.** Inverser les deux polluerait le contexte du modèle avec la ligne de debug.
