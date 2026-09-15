---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile. **Toute feature qui n'améliore pas le routage, l'édition ou le partage de l'arbre est à refuser explicitement**, pas à coder en silence.

**Pour qui** : d'abord Adrien, sur ses projets, avec n'importe quel agent ; puis une démo de dix minutes à son entreprise. Le partage public passe après, sans objectif de popularité.

**Dedans** :
- **voir** l'arbre et ce qui a été chargé — sans vue, personne ne maintient ses `load_when` ;
- éditer sa **structure** et son **contenu** depuis la vue (`load_when` et corps dans la carte : le `load_when` se corrige en regardant la toile, un aller-retour vers un onglet suffit à ce qu'on ne le corrige pas) ;
- **inviter** l'IA de l'utilisateur à construire l'arbre, avec une consigne bornée (`bootstrap`) ;
- laisser l'IA **écrire au fil de l'eau**, tracé et annoncé.

**Dehors** :
- l'arbre de **conversation** (Lacis, `../ai-tree`), les agents, l'exécution d'outils ;
- faire de la carte un **éditeur de texte** (coloration, recherche…) : le `.md` reste à un clic ;
- **générer l'arbre par contextree lui-même** : pas de découpe automatique, pas d'heuristique qui devine des `load_when`. Un arbre deviné d'un coup n'est relu par personne ; c'est l'IA de l'utilisateur, avec le projet sous les yeux, qui écrit ;
- télémétrie, site, communication.
