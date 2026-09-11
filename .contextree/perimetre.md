---
type: rule
title: Périmètre
load_when: quand on propose une nouvelle feature, ou qu'on se demande si quelque chose a sa place ici
---

Ce repo fait **une seule chose** : maintenir un arbre de contexte et n'en injecter que la fraction utile.

**Pour qui, et jusqu'où** (posé le 9 septembre 2026) : d'abord Adrien lui-même, sur ses propres projets, avec n'importe quel agent — Claude Code, Codex, Gemini, Cursor, VS Code et son IA intégrée. Le partage avec d'autres viendra bien plus tard ; pas d'objectif de popularité, pas de communication. Ce qui compte maintenant : que l'arbre soit la **seule** documentation de ce repo pour l'IA (aucun `.md` de consignes à côté), qu'un projet vierge se dote d'un arbre proprement quand on le demande à l'IA — et que l'IA le propose d'elle-même si le MCP est là et l'arbre absent —, et que ça marche sur chaque agent. Et au bout : **le présenter à son entreprise** — une démo de dix minutes, sur l'éditeur que la boîte utilise, où l'IA construit l'arbre depuis zéro, où l'on voit ce qui est routé, et où l'équipe partage un arbre par git. Le partage et la publication ne servent qu'à ça, et passent après.

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
- la génération de l'arbre **par contextree lui-même** : il n'y a pas de moteur de découpe dans le cœur, pas d'heuristique qui devine des `load_when`, et il n'y en aura pas. Un arbre entier deviné d'un coup n'est relu par personne, et c'est le `load_when` — le seul champ que l'utilisateur sait écrire et que le modèle devine mal — qui en fait les frais.

  **Ce qui est dans le périmètre, depuis le 9 septembre 2026 : inviter.** Sur un projet qui a déjà un `CLAUDE.md`, des règles Cursor ou un README nourri, `renderBootstrapPrompt` donne à l'IA *de l'utilisateur* une consigne pour les lire et écrire l'arbre elle-même, avec ses propres outils. La différence n'est pas cosmétique : le travail est fait par un agent qui a le projet sous les yeux, l'utilisateur voit passer chaque écriture, et le résultat est borné (6 à 12 branches) et tracé. contextree ne fournit que le texte — une seule copie, trois surfaces : prompt MCP `bootstrap`, `contextree bootstrap`, bouton de la vue.

  L'écriture **au fil de l'eau**, elle, est le régime assumé depuis le 7 septembre 2026 : quand l'IA repère un fait durable, elle l'écrit dans l'arbre directement, sans étape de validation. Le garde-fou est la **visibilité, pas l'interdiction** — chaque écriture est tracée, annoncée en conversation, et signalée dans les vues pendant un quart d'heure.

  C'est nécessaire parce que la boucle est fermée : l'IA écrit dans l'arbre qui lui est ensuite réinjecté. Si l'arbre se remplit de branches approximatives, le routeur en charge trop et le contexte devient du bruit auto-produit. Rien ne le signalerait — sauf la trace.

Toute feature qui n'améliore pas le **routage**, l'**édition** ou le **partage** de l'arbre est à refuser explicitement, pas à coder silencieusement.
