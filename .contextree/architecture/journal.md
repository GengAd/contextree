---
type: reference
title: Journal des tours et surlignage
load_when: quand on touche au journal des tours, au dossier d'état, à ce qui a été chargé ou lu au dernier tour, au surlignage des branches dans la barre latérale ou sur la toile, ou au canal Sortie › contextree
---

Ce qui a **réellement** servi, tour après tour — pas ce que le routeur ferait d'un prompt hypothétique.

**Un tour** : `at`, extrait du prompt (200 caractères), `selected`, `reason` (`routed` / `all` / `fallback` / `deferred` / `catalogue` / `read` — c'est lui l'indicateur de repli), `source` (`hook` / `mcp` / `bg`), `error`, `engine`, `read` (branches lues par l'agent), `session`, `version`. Pas de commande `contextree journal` : il se lit dans la vue.

- **Où : `stateDir()`**. `CONTEXTREE_STATE_DIR`, sinon `%LOCALAPPDATA%\contextree`, `~/Library/Application Support/contextree`, `$XDG_STATE_HOME/contextree` (défaut `~/.local/state/contextree`). **Jamais `~/.contextree`** (voir *Pièges*). Y vivent aussi `selection/`, `session/`, et `config.json` / `session.json` du backend.
- **Séparé du cache de sélection** : un journal corrompu ne doit jamais abîmer le routage. Les écritures de l'IA ont un troisième fichier.
- **Clé par dossier d'arbre** (`treeKey`, sur le `realpath`), toutes sessions confondues ; **en minuscules sous Windows** (`c:\` vs `C:\`). Toute clé dérivée d'un chemin passe par `treeKey`.
- **Trois écrivains** : `cmdHook`, `get_context`, `route-bg`.
- **`read_branch` journalise** (`recordRead`) : ajoute la branche à `selected` et `read` du dernier tour s'il vient de la même session MCP depuis moins de 5 min, sinon ouvre un tour `read`. Le dernier tour tout court, pas celui de la session : la vue ne montre que lui. Écritures d'un même fichier à la file (`updateLog`). `:root` n'est pas journalisée.
- **50 tours, 100 écritures d'IA**, fichier temporaire renommé. **`appendTurn` ne rejette jamais.**

## Ce que les vues en font — une lecture, deux affichages

**Barre latérale** (`extension/src/turn.ts`) : un `FileDecorationProvider` marque les `.md` lus d'une pastille `•` et teinte le libellé (couleur des correspondances de recherche — une lecture est un fait ordinaire, pas une erreur ; décorateur de fichier, pour que la marque suive dans l'explorateur et l'onglet). Le titre porte l'état (`4/9 · routé`, `12/12 · différé`) ; l'infobulle distingue lue au dernier tour, choisie pour le prochain, ou injectée faute de mieux.

**Toile** : un point couleur du type sur les cartes lues, gris en repli ; rien d'autre ne change — estomper le non-lu rendait illisibles les branches qu'on vient justement corriger. Deux surlignages jamais mélangés : le **dernier tour** et la **sonde** (« que chargerait le routeur pour ce prompt ? ») ; la sonde gagne tant qu'elle est active, ✕ ou Échap rend le dernier vrai tour.

**Canal *Sortie › contextree*** (`TurnLog`) : version de l'extension et journal surveillé, puis une ligne par tour. Il signale une fois un **écart de version** (tour d'une autre `version` que le cœur embarqué, ou ancien journal `~/.contextree/journal/` qui bouge). Premier endroit à regarder quand le surlignage ne suit pas.

L'observateur du journal est **non récursif** (`*.json`), seul motif que VS Code accepte hors du workspace.
