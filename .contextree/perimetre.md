---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile.

Hors périmètre, assumé :

- l'arbre de **conversation** (c'est Lacis, dans `../ai-tree`) ;
- les agents et l'exécution d'outils ;

  En revanche, sont dans le périmètre :
  - **voir** son arbre — sans vue, personne ne maintient ses `load_when`, et l'outil ne sert plus à rien ;
  - éditer sa **structure** depuis la vue — créer, renommer, changer le type, déplacer, supprimer. Ce ne sont pas des choses qu'on fait en ouvrant un `.md` : ce sont des opérations sur des fichiers et des dossiers (décidé le 7 septembre 2026) ;
  - éditer son **contenu** depuis la vue — le `load_when` et le corps, dans la carte de la toile.

  Ce dernier point **renverse** la ligne du 7 septembre 2026, qui plaçait l'édition du contenu dans une webview maison hors périmètre au motif que « l'éditeur, c'est celui de l'utilisateur ». Renversé le 8 septembre 2026, et voici pourquoi : le `load_when` est le seul bouton de routage de l'outil, on le corrige en regardant la toile, et l'aller-retour vers un onglet suffisait à ce qu'on ne le corrige pas. Le corps suit le `load_when` — deux champs à deux endroits différents, c'est une carte qu'on n'ouvre pas.

  Ce que ça coûte, et qui reste vrai : la carte n'est pas un éditeur. Pas de coloration, pas de recherche, pas de multi-curseur — le `.md` reste la source de vérité et reste à un clic, bouton compris. Trois garde-fous tiennent la ligne, et se cassent ensemble si on les oublie (`extension/src/edit.ts`, `saveBranch`) : **le cœur sérialise** le frontmatter, jamais la webview ; le **`load_when` est aplati** sur une ligne avant écriture ; un **onglet aux modifications non enregistrées gagne** sur la carte, sauf décision explicite.

  Ce qui reste hors périmètre, lui, n'a pas bougé : faire de la webview un éditeur de texte à part entière.
- la génération de l'arbre **en masse**, à partir du code : un arbre entier deviné d'un coup n'est relu par personne, et c'est le `load_when` qui en fait les frais.

  L'écriture **au fil de l'eau**, elle, est le régime assumé depuis le 7 septembre 2026 : quand l'IA repère un fait durable, elle l'écrit dans l'arbre directement, sans étape de validation. Le garde-fou est la **visibilité, pas l'interdiction** — chaque écriture est tracée, annoncée en conversation, et signalée dans les vues pendant un quart d'heure.

  C'est nécessaire parce que la boucle est fermée : l'IA écrit dans l'arbre qui lui est ensuite réinjecté. Si l'arbre se remplit de branches approximatives, le routeur en charge trop et le contexte devient du bruit auto-produit. Rien ne le signalerait — sauf la trace.

Toute feature qui n'améliore pas le **routage**, l'**édition** ou le **partage** de l'arbre est à refuser explicitement, pas à coder silencieusement.
