---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile.

Hors périmètre, assumé :

- l'arbre de **conversation** (c'est Lacis, dans `../ai-tree`) ;
- les agents, l'exécution d'outils, un éditeur intégré ;
- la génération automatique de l'arbre : le `load_when` est ce que l'utilisateur sait et que le modèle ne devine pas. Assister la rédaction, oui ; générer à sa place, non.

Toute feature qui n'améliore pas le **routage**, l'**édition** ou le **partage** de l'arbre est à refuser explicitement, pas à coder silencieusement.
