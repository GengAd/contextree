---
type: context
title: Démarrage à froid
load_when: quand on touche à la création de l'arbre (init), à la vue sur un projet vierge, au tronc de branches de départ, ou quand on se demande pourquoi le routeur ne trie rien sur un petit arbre
---

**Le tronc de départ vit dans le cœur** (`initTree`, dans `store.ts`), pas dans la CLI : la vue le crée aussi, et deux copies auraient divergé au premier ajustement de `load_when` — le champ dont dépend tout le routage.

Quatre branches, pas quarante : un arbre entier deviné d'un coup n'est relu par personne. Ce sont des amorces à corriger, et leur `load_when` est écrit comme une condition (« quand… »), parce que c'est la forme qu'on veut voir imitée.

**La vue est toujours visible**, même sans `.contextree/` : une `viewsWelcome` (`when: !contextree.hasTree`) porte « Créer l'arbre » et « Ajouter contextree à une IA ». Sans ça, le premier geste de l'outil échappait à l'outil — il fallait un terminal. Les boutons qui n'ont de sens qu'avec un arbre (nouvelle branche, toile) sont gardés par `contextree.hasTree`.

**Le démarrage à froid n'est pas une panne.** Mesuré sur un arbre neuf : le routeur *tourne* dès la 4ᵉ branche (le court-circuit s'arrête à ≤ 3), mais il retient les 4 — les `load_when` de départ sont volontairement larges. On lit donc `routé — 4 branche(s)` sans rien qui ressemble à un tri. Le routage se met à payer quand l'arbre grossit et que les conditions se resserrent, pas avant. Ne pas chercher un bug là.
