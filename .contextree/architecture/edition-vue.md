---
type: reference
title: Éditer l'arbre depuis la vue
load_when: quand on touche à la création, au renommage, au déplacement ou à la suppression d'une branche depuis l'extension, à l'édition du load_when ou du corps dans la carte de la toile, ou à la trace des écritures de l'IA
---

Deux moitiés. La **structure** — créer, renommer, changer le type, déplacer, supprimer — parce que ce sont des opérations sur des fichiers et des dossiers, pas des choses qu'on fait en ouvrant un `.md`. Et depuis le 8 septembre 2026 le **contenu** : le `load_when` et le corps, dans la carte de la toile.

Une seule implémentation, deux appelants — le menu contextuel de la barre latérale et les boutons de la carte. Tout passe par `runEdit(op, target)` dans `extension.ts`, qui relit l'arbre juste avant (les `.md` sont la source de vérité et ont pu changer) et recharge les vues après.

- **Le protocole webview → extension porte des écritures**, pas seulement des ouvertures : `{type:'edit', op, path}` pour la structure, `{type:'save', path, loadWhen, content}` pour le contenu. La seconde est venue se brancher sur la couture posée par la première.
- **`load_when` est demandé à la création**, pas plus tard : c'est le seul champ que le modèle ne peut pas deviner, et sans lui la branche ne sera jamais routée.
- **Renommer change le titre.** Le fichier ne suit que si son nom venait du titre précédent ; un slug choisi à la main n'est pas touché. Le `path` est l'identité d'une branche — on ne le change pas dans le dos de qui l'a écrit.
- **Supprimer est toujours confirmé**, avec le nombre d'enfants qui partent avec.
- Les commandes de branche sont **masquées de la palette** (`when: false`) : elles ont besoin d'une branche sélectionnée, que seul le menu contextuel fournit.
- Il n'y a **pas** de commande « recharger l'arbre » : l'observateur le fait déjà, et un bouton qui refait ce qui se fait tout seul est du bruit. Il porte sur le dossier **réellement trouvé** par `findTreeDir`, pas sur le dossier ouvert — un `.contextree/` au-dessus de la racine du workspace n'était sinon jamais rechargé. Tant qu'aucun arbre n'existe, on retombe sur `**/.contextree/**/*.md` dans le workspace, ce qui rattrape un `contextree init` fait après coup.

## Écrire le contenu dans la carte (`saveBranch`)

Ce point **renverse** la ligne du 7 septembre 2026, qui plaçait l'édition du contenu hors périmètre au motif que « l'éditeur, c'est celui de l'utilisateur ». La raison du renversement : le `load_when` est le seul bouton de routage de l'outil, on le corrige en regardant la toile, et l'aller-retour vers un onglet suffisait à ce qu'on ne le corrige pas.

Ce que la carte **n'est pas** : un éditeur. Pas de coloration, pas de recherche, pas de multi-curseur — le `.md` reste la source de vérité et reste à un clic. Trois garde-fous tiennent la ligne, et se cassent ensemble si on les oublie :

- **Le cœur sérialise, jamais la webview.** La toile envoie deux chaînes ; `writeBranch` (ou `writeRoot`) fabrique le fichier. Il n'existe pas de second code d'écriture qui pourrait diverger de `parseFrontmatter` — un frontmatter invalide n'a pas de chemin jusqu'au disque.
- **Le `load_when` est aplati sur une ligne** avant écriture : c'est un scalaire de frontmatter, et le parseur ne déséchappe pas ce qu'un multi-ligne produirait. Vide, il est refusé — une branche sans condition ne serait plus jamais routée.
- **Un onglet aux modifications non enregistrées gagne sur la carte.** C'est le seul endroit où quelque chose que la toile ne voit pas serait perdu.

Côté toile, ce sont des **brouillons** (`drafts`) et pas un champ lié : ils survivent au changement de sélection et aux rechargements — le watcher se réveille au moindre `.md` touché, et ce qu'on a écrit ne doit pas partir parce qu'un autre fichier a bougé. Une carte fermée qui porte un brouillon le montre (trait discontinu, `✎ brouillon non enregistré`). Si le fichier change sur le disque pendant qu'on tape, la carte le dit et propose de repartir du disque. Le brouillon n'est jeté que sur l'accusé `{type:'saved', ok}` : un refus le garde intact. `Échap` ne jette rien — un brouillon se règle avec « Enregistrer » ou « Abandonner », pas avec une touche pressée par réflexe.

## L'IA écrit aussi, et ça se voit

Régime assumé depuis le 7 septembre 2026 : l'IA écrit directement, sans validation préalable. Le garde-fou est la **visibilité**, pas l'interdiction — parce que la boucle est fermée. L'IA écrit dans l'arbre qui lui est ensuite réinjecté ; un arbre qui se remplit de branches approximatives fait charger trop au routeur, et le contexte devient du bruit auto-produit que rien ne signalerait.

Trois mécanismes, tous nécessaires :

- **`why` est un paramètre obligatoire** de `upsert_branch` et `delete_branch` (optionnel sur `move_branch`, qui est du rangement). Une écriture sans raison énoncée n'est pas possible.
- **L'annonce** : le texte que renvoie l'outil demande au modèle de dire ce qu'il vient d'écrire et pourquoi, et les `instructions` du serveur posent la règle — écrire en silence est la seule façon de mal faire.
- **La trace** : chaque écriture est journalisée (`appendAiWrite`, 100 dernières), et les deux vues la montrent pendant 15 minutes — pastille `IA il y a 2 min` et icône colorée dans la barre latérale, liseré et `✎` sur la carte, le `why` dans l'infobulle. Un battement d'une minute fait vieillir puis disparaître la pastille ; il ne tourne que tant qu'il reste quelque chose à afficher.

`import_pack` n'est pas tracé : c'est une greffe en masse, annoncée par nature, pas une capitalisation au fil de l'eau.
