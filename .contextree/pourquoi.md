---
type: context
title: Pourquoi contextree
load_when: quand on se demande pourquoi l'outil existe, d'où il vient, ce qui le différencie d'un CLAUDE.md, ou pour qui il est
---

## Le problème

- À chaque session, l'IA repart de zéro, et on recolle « qui je suis, comment je bosse, quelles règles ».
- Tout charger dilue la qualité et coûte du bruit.
- Ce contexte reste **prisonnier d'un repo et d'une personne** : l'équipe n'a pas de socle commun.

Le premier point est de l'outillage ; les deux autres sont de la **structure**, là où l'arbre gagne sur le fichier plat.

## Ce que c'est

Un `CLAUDE.md` avec deux propriétés de plus :
1. **Routé** : une branche ne se charge que si son `load_when` correspond à la demande. Sur le projet de la démo : 15 997 caractères par prompt avec le gros fichier, 4 007 avec l'arbre routé sur la même question.
2. **Partageable** : il s'exporte, se greffe, se maintient à plusieurs.

Et trois engagements : du **markdown** qui appartient à l'utilisateur, indépendant du modèle et de l'éditeur ; **participatif** — l'IA écrit, l'utilisateur relit ; **transparent** — à chaque tour on voit ce qui a été chargé, jamais de boîte noire.

## Pour qui

Un développeur solo qui code avec l'IA et en a assez de réexpliquer son projet ; puis son équipe, quand l'arbre devient un bien commun.

## Origine

**La méthode** vient des trois couches de Jake Van Clief (`../workspace-sample`) : une carte lue en premier, des pièces chargées quand on y entre, des outils câblés où ils servent. contextree l'automatise : la table de routage écrite à la main devient un `load_when` par branche, évalué à chaque prompt.

**Le code** est extrait de `../ai-tree` (Lacis), dont l'arbre de contexte était la vraie valeur, enterré sous une extension complète. Ici on ne garde que le cœur : routage, ancêtres, fallback non bloquant, partage.
