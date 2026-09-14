---
type: skill
title: Pièges déjà rencontrés
load_when: quand on debugge un comportement inattendu du serveur MCP, du hook ou du chargement de l'arbre
---

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après `connect()` et le client ne reçoit rien.
- **Un dossier sans `.md` frère était invisible.** Corrigé par le hub implicite dans `walk()`. Si tu retouches cette fonction, garde le comportement — c'est ce qui fait marcher `import --prefix`.
- **Le cache de sélection vit sous `stateDir()`** (`~/.contextree/selection/`), jamais dans le repo : c'est de l'état, pas du contenu, et il ne doit jamais devenir une dépendance. Il était dans `os.tmpdir()` jusqu'au 9 septembre 2026 — même piège que le journal : le transport stdio du SDK MCP lance le serveur sans `TMPDIR`, donc le serveur écrivait dans `/tmp` pendant que le hook écrivait dans le `/var/folders/…` de la session, et la sélection ne se transmettait pas d'une surface à l'autre. `HOME` est hérité des deux côtés. Effet de bord utile : `CONTEXTREE_STATE_DIR` isole le cache en test.
- **Le hook écrit le contexte sur stdout et la trace sur stderr.** Inverser les deux polluerait le contexte du modèle avec la ligne de debug — et, sous Gemini, casserait le JSON qu'il attend.
- **Sous Gemini, stdout ne contient *que* du JSON**, et un **code de sortie 2 bloque le tour en effaçant le prompt**. L'invariant du code 0 n'y est plus une politesse : il sépare un contexte manquant d'un prompt perdu. Toute écriture sur stdout passe donc par l'enveloppe du dialecte, l'invitation « pas d'arbre » comprise.
- **Windows n'a jamais tourné** (constat du 14 septembre 2026, à la lecture du code, rien d'exécuté). Le paquet est du JavaScript pur et s'installe, mais le routage par CLI y est très probablement mort : `findBin` ne cherche que `<nom>.cmd` (Claude Code en install native est un `claude.exe`), et depuis Node 20.12.2 un `spawn` sur un `.cmd` sans `shell: true` lève `EINVAL` — donc repli, arbre entier, en silence. Le `spawn` détaché du routage de fond n'a pas `windowsHide`. Une clé API contourne les deux : le SDK tourne dans le process.
