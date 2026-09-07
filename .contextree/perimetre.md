---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile.

Hors périmètre, assumé :

- l'arbre de **conversation** (c'est Lacis, dans `../ai-tree`) ;
- les agents, l'exécution d'outils, et l'édition du **contenu** d'une branche dans une webview maison — l'éditeur, c'est celui de l'utilisateur, et les `.md` s'y ouvrent déjà ;

  En revanche, sont dans le périmètre :
  - **voir** son arbre — sans vue, personne ne maintient ses `load_when`, et l'outil ne sert plus à rien ;
  - éditer sa **structure** depuis la vue — créer, renommer, changer le type, déplacer, supprimer. Ce ne sont pas des choses qu'on fait en ouvrant un `.md` : ce sont des opérations sur des fichiers et des dossiers. C'est la jambe « édition » de la règle du bas, et la ligne passe là (décidée le 7 septembre 2026).

  Le contenu, lui, reste édité dans le `.md` ouvert à côté.
- la génération de l'arbre **en masse**, à partir du code : un arbre entier deviné d'un coup n'est relu par personne, et c'est le `load_when` qui en fait les frais.

  L'écriture **au fil de l'eau**, elle, est le régime assumé depuis le 7 septembre 2026 : quand l'IA repère un fait durable, elle l'écrit dans l'arbre directement, sans étape de validation. Le garde-fou est la **visibilité, pas l'interdiction** — chaque écriture est tracée, annoncée en conversation, et signalée dans les vues pendant un quart d'heure.

  C'est nécessaire parce que la boucle est fermée : l'IA écrit dans l'arbre qui lui est ensuite réinjecté. Si l'arbre se remplit de branches approximatives, le routeur en charge trop et le contexte devient du bruit auto-produit. Rien ne le signalerait — sauf la trace.

Toute feature qui n'améliore pas le **routage**, l'**édition** ou le **partage** de l'arbre est à refuser explicitement, pas à coder silencieusement.
