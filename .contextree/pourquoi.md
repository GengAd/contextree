---
type: context
title: Pourquoi contextree
load_when: quand on se demande pourquoi l'outil existe, d'où il vient, ce qui le différencie d'un CLAUDE.md, ou pour qui il est
---

## Le problème

Le contexte est le vrai goulot d'étranglement du travail avec l'IA :

- à chaque nouvelle session, l'IA repart de zéro, et on recolle à la main « qui je suis, comment je bosse, quelles sont les règles » ;
- si on charge tout d'un coup, la qualité se dilue et on paie du bruit ;
- ce contexte, chèrement construit, reste **prisonnier d'un repo et d'une personne** — le collègue d'à côté réécrit le sien de zéro, et l'équipe n'a jamais de socle commun.

Le premier point est un problème d'outillage. Les deux suivants sont un problème de **structure**, et c'est là que l'arbre gagne sur le fichier plat.

## Ce que c'est

Un `CLAUDE.md` avec deux propriétés en plus :

1. **Il est routé.** Un `CLAUDE.md` est chargé en entier, tout le temps. Passé quelques centaines de lignes, on paie des tokens pour du bruit et on dilue le signal. Ici une branche ne se charge que si son `load_when` — « charge-moi quand… » — correspond à la demande.
2. **Il est partageable.** Un `CLAUDE.md` vit dans un repo. Un arbre s'exporte, se donne, se greffe dans l'arbre de quelqu'un d'autre, et à terme se maintient à plusieurs.

## Ce qui le différencie

- Le contexte est **structuré et sélectif**, pas un mur de texte.
- Il **appartient à l'utilisateur** : du markdown, indépendant du modèle et de l'éditeur.
- Il est **participatif** dès le départ : l'IA écrit des branches, l'utilisateur arbitre en relisant un diff git.
- **La transparence est un invariant** : à chaque tour on peut voir exactement ce qui a été chargé. Jamais de boîte noire — c'est un engagement produit, pas un détail de mise au point.

## Pour qui

D'abord un développeur solo qui code avec l'IA et en a assez de réexpliquer son projet. Ensuite son équipe, quand l'arbre devient un bien commun. L'ordre dans lequel ça arrive est dans *Roadmap et paliers* ; ce qui est dedans et dehors, dans *Périmètre*.

## Ce que « bien fait » veut dire ici

Une feature est bien faite quand elle ne bloque jamais un prompt ni un appel IA, qu'elle respecte la règle des ancêtres, qu'elle laisse `.contextree/` éditable à la main et lisible dans un diff, qu'elle n'ajoute ni dépendance ni concept sans en retirer un, et que `npm test` passe.

## Origine

**La méthode** vient de la structure en trois couches de Jake Van Clief (cours dans `../workspace-sample`) : une **carte** (`CLAUDE.md`, lue en premier, avec une table « pour telle tâche, lis tels fichiers »), des **pièces** (un fichier de contexte par espace de travail, chargé seulement quand on y entre) et des **outils** (skills et serveurs MCP câblés là où ils servent). L'idée centrale y est déjà : ne pas tout charger, router vers la fraction utile.

contextree en est la version automatisée. La table de routage écrite à la main devient un `load_when` par branche, évalué par un appel IA à chaque prompt ; « entrer dans une pièce » n'est plus un geste de l'utilisateur mais une conséquence de sa demande ; et le résultat est injecté par un hook plutôt que relu par l'agent.

Ce repo est allé un cran plus loin le 9 septembre 2026 : la carte humaine elle-même a disparu. `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md` et `ROADMAP.md` sont devenus des branches ; ce fichier-ci est l'ancien `CONTEXT.md`. Un outil qui remplace le gros fichier de consignes ne pouvait pas en maintenir quatre.

**Le code** est extrait de `../ai-tree` (produit **Lacis**), dont l'arbre de contexte était la vraie valeur mais restait enterré sous une extension VS Code complète : arbre de conversation, webview React, agent repo, coffre chiffré. Ici on ne garde que le cœur — routage, résolution des ancêtres, fallback non bloquant, partage par pack — et on jette le reste.
