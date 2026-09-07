---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile.

Hors périmètre, assumé :

- l'arbre de **conversation** (c'est Lacis, dans `../ai-tree`) ;
- les agents, l'exécution d'outils, l'édition *dans* une webview maison — l'éditeur, c'est celui de l'utilisateur, et les `.md` s'y ouvrent déjà ; en revanche **voir** son arbre est dans le périmètre : sans vue, personne ne maintient ses `load_when`, et l'outil ne sert plus à rien (`extension/`, vue VS Code en lecture seule) ;
- la génération automatique de l'arbre : le `load_when` est ce que l'utilisateur sait et que le modèle ne devine pas. Assister la rédaction, oui ; générer à sa place, non.

Toute feature qui n'améliore pas le **routage**, l'**édition** ou le **partage** de l'arbre est à refuser explicitement, pas à coder silencieusement.
