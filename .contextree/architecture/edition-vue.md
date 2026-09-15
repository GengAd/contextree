---
type: reference
title: Éditer l'arbre depuis la vue
load_when: quand on touche à la création, au renommage, au déplacement ou à la suppression d'une branche depuis l'extension, à la carte de la toile (affichage, édition du load_when ou du corps), ou à la trace des écritures de l'IA
---

**La structure** (créer, renommer, changer le type, déplacer, supprimer) et **le contenu** (`load_when` et corps, dans la carte). Une implémentation, deux appelants — menu contextuel et boutons de la carte : `runEdit(op, target)` dans `extension.ts` relit l'arbre avant et recharge les vues après.

- Protocole webview → extension : `{type:'edit', op, path}`, `{type:'save', path, loadWhen, content}`, accusé `{type:'saved', ok}`.
- **`load_when` demandé à la création** : sans lui, la branche n'est jamais routée.
- **Renommer change le titre** ; le fichier ne suit que si son nom venait du titre. Le `path` est l'identité.
- **Supprimer est confirmé**, avec le nombre d'enfants.
- Commandes de branche **masquées de la palette** (`when: false`) : il leur faut une sélection.
- **Pas de « recharger »** : l'observateur porte sur le dossier trouvé par `findTreeDir`, sinon `**/.contextree/**/*.md` dans le workspace.

## La carte

**Tout son texte, sous un plafond** : titre, `load_when` entier, corps en Markdown, sélectionnée ou non. Hauteur max `NODE_MAX_H` (300 px ; 560 sélectionnée), le corps défile au-delà — sans plafond, trois branches longues rendent l'arbre illisible. La molette fait défiler un corps tant qu'il a de la marge, zoome ailleurs ; la position survit aux rendus. Sélectionner élargit (340 → 540 px) et ajoute édition au double-clic et actions. **Hauteur mesurée, pas estimée** : `render` pose les cartes à leur largeur, lit `offsetHeight`, puis place l'arbre ; `select` rend avant de compenser la vue. La carte en écriture a une hauteur fixe.

**Pas un éditeur** : ni coloration ni recherche, le `.md` reste à un clic. Trois garde-fous (`edit.ts`, `saveBranch`) :
- **le cœur sérialise**, jamais la webview (`writeBranch` / `writeRoot`) ;
- **le `load_when` est aplati** sur une ligne ; vide, refusé ;
- **un onglet aux modifications non enregistrées gagne** sur la carte.

**Des brouillons** (`drafts`), pas un champ lié : ils survivent à la sélection et aux rechargements. Carte fermée avec brouillon : trait discontinu, `✎ brouillon non enregistré`. Fichier changé pendant la frappe : la carte le dit. Jeté seulement sur un accusé positif. **Échap ne jette rien.**

## L'IA écrit, et ça se voit

Écriture directe, **visibilité comme garde-fou** (voir *Règles du projet*) :
- `why` obligatoire sur les outils d'écriture ;
- la réponse de l'outil demande d'annoncer l'écriture ;
- **la trace** : `appendAiWrite` (racine comprise, sous `:root`), montrée 15 minutes — pastille `IA il y a 2 min` dans la barre latérale, liseré et `✎` sur la carte, le `why` en infobulle. `import_pack` n'est pas tracé.
