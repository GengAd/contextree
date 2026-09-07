---
type: skill
title: Pièges déjà rencontrés
load_when: quand on debugge un comportement inattendu du serveur MCP, du hook ou du chargement de l'arbre
---

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après `connect()` et le client ne reçoit rien.
- **Un dossier sans `.md` frère était invisible.** Corrigé par le hub implicite dans `walk()`. Si tu retouches cette fonction, garde le comportement — c'est ce qui fait marcher `import --prefix`.
- **Le cache de session vit dans `os.tmpdir()`**, jamais dans le repo : c'est de l'état, pas du contenu. Il ne doit jamais devenir une dépendance.
- **Le hook écrit le contexte sur stdout et la trace sur stderr.** Inverser les deux polluerait le contexte du modèle avec la ligne de debug.
