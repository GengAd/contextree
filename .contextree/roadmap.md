---
type: context
title: Roadmap et paliers
load_when: quand on se demande ce qui vient après, pourquoi un palier passe avant un autre, ce qui est reporté ou hors périmètre, ou où en est le plan
---

Le plan vit dans **Trello** (tableau « contextree », colonne *A faire*, dans l'ordre — voir *Workflow Trello et git*). Ici : le pourquoi de l'ordre, et les décisions qui le portent. Posé le 9 septembre 2026.

## L'ordre, et pourquoi

Chaque palier n'ouvre que quand le précédent est **utilisé pour de vrai**, pas seulement codé. La phase 2 (serveur) a été codée le 7 septembre avant que la phase 1 ne serve à quiconque ; c'est l'erreur qu'on ne refait pas. Priorités d'Adrien, dans l'ordre : s'en servir lui-même partout ; que ce repo n'ait plus de consignes hors de l'arbre ; qu'un projet vierge se dote d'un arbre par l'IA ; que ça marche sur tous les agents ; le présenter à son entreprise. Le partage public vient bien après.

| Palier | Branche | But | Porte de sortie |
|---|---|---|---|
| ~~P1 usage perso~~ **fait le 9 septembre 2026** | `p1-usage-perso` (mergée) | l'outil marche sur les autres projets d'Adrien, et la vue dit la vérité sur le routage | **franchie** — voir plus bas |
| ~~P2 dogfooding~~ **fait le 9 septembre 2026** | `p2-dogfooding` (mergée) | plus aucun `.md` de consignes hors de l'arbre dans ce repo (`README.md` = procédure, seule exception) | **à moitié franchie** — voir plus bas |
| P3 depuis zéro | `p3-depuis-zero` | sur un dossier vierge, l'IA propose l'arbre, le construit proprement, renvoie à la toile | le scénario « depuis zéro » passe sous Claude Code |
| P4 tous les agents | `p4-tous-les-agents` | Claude Code, VS Code + Copilot (cible probable de l'entreprise), Cursor, Codex, Gemini ; ChatGPT web = presse-papier | la matrice est cochée ligne par ligne |
| P5 démo | `p5-demo` | dix minutes devant l'entreprise ; le partage par git, déroulé à deux | la démo tourne sur l'éditeur de la boîte, réseau coupé si besoin |
| P6 distribution | `p6-distribution` | npm, Open VSX, hook pinné, README procédure — pour que des collègues installent | `npx -y @gengad/contextree init` marche sur une machine vierge |
| P7 serveur | `p7-serveur` | le backend sert à deux : compte, invitation par code, premier vrai pull/push, calques et montages | un second compte pull un arbre poussé par le premier, et le monte dans un autre projet |
| P8 visibilité | `p8-visibilite` | plusieurs arbres par personne (l'arbre perso monté partout), privé/groupe/lien/public, annuaire, fork et amont | un arbre public est monté par quelqu'un qui n'est dans aucun groupe |
| P9 entreprise | `p9-entreprise` | groupes hiérarchiques, héritage descendant, accès par nœud, rôles et propositions, audit | une équipe voit la chaîne entreprise → équipe → projet ; une autre ne voit pas la sienne |

Les anciennes « phases » de la roadmap : phase 1 (pack, git) livrée ; phase 2 = P7 ; phase 3 = P8 ; phase 4 = P9. Le détail technique de P7 à P9 est dans *Arbres distants : calques, montages, hiérarchie*.

## P1, constaté le 9 septembre 2026

La porte de sortie était « le journal montre des tours *routés*, sur un autre repo que celui-ci ». Elle est franchie : sur un dossier hors du dépôt, câblé par `contextree install`, le journal porte `bg | routed | 2 branches` — un vrai tri, 4 branches ramenées à `identite, regles` sur « quelles sont les règles de ce projet ? ».

Ce que le palier a changé, dans l'ordre où ça se remarque :

- `install` inscrit **la commande qui tourne**, pas `npx` : l'outil marche là où le paquet n'est pas publié, c'est-à-dire partout aujourd'hui ;
- le routage de fond **écrit son tour**, donc la vue montre enfin ce que le routeur a choisi au lieu de « différé » à vie ;
- une session neuve **hérite** de la dernière sélection routée : plus de premier prompt à l'arbre entier ;
- `npm run eval` donne un chiffre à comparer avant/après une retouche.

Ce qui reste ouvert et qu'on sait maintenant : la mesure dit que **toute la perte de rappel tient au `load_when` d'`identite`** (« toujours pertinent » n'est pas une condition). Hors cette branche, le rappel est de 100 %. C'est le premier `load_when` à corriger.

## P2, constaté le 9 septembre 2026

La racine n'a plus qu'un `README.md`. `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md` et `ROADMAP.md` sont devenus des branches ; l'arbre est passé de 16 à **19 branches**, et c'est la seule documentation du dépôt.

**Ce qui est constaté** : les deux dernières cartes du palier ont été prises et faites **sans aucun `CLAUDE.md`** — l'agent n'avait que l'arbre injecté. Le workflow Trello, les conventions de commit et les invariants sont venus des branches, et rien n'a manqué.

**Ce qui ne l'est pas, et qu'il faut faire à froid** : la porte de sortie demandait une session **neuve**. Celle qui a fait la migration l'avait encore en mémoire, ce qui ne prouve rien sur ce que l'arbre transmet à quelqu'un qui arrive. Le vrai test est de prendre la première carte de P3 dans une session sans historique, et de regarder ce qui manque. Si l'IA rate un invariant, la réponse est de **resserrer un `load_when`**, jamais de recréer un fichier de consignes.

Ce que la migration a appris en chemin, et qui vaut pour tout arbre : **corriger un `load_when` invalide le jeu d'éval qui reposait dessus**. `identite` promettait « toujours pertinent » ; en lui donnant une vraie condition, la mesure a d'abord chuté à 65 % de rappel — l'instrument mesurait une promesse disparue. Recalibré, il donne 93 %. Un score qui bouge après un changement de `load_when` doit être relu avant d'être cru.

## Décisions tranchées le 9 septembre 2026

- **Branches git** : une par palier, mergée dans `main` (`--no-ff`) à la dernière carte du palier. `phase-2-contexte-commun` a été mergée dans `main` ce jour (fast-forward) et supprimée en local.
- **`README.md` reste**, réduit à une procédure pour un humain. `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md` et `ROADMAP.md` sont partis dans l'arbre le 9 septembre 2026 : la racine n'a plus qu'un `.md`.
- **Cible entreprise probable : VS Code + Copilot**, à confirmer par Adrien (carte humaine). P4 la traite juste après Claude Code, avant Cursor.
- **Le serveur est un remote, pas une source** : l'arbre local reste la copie de travail ; les arbres distants se montent en calques, sur disque ; le routage ne touche jamais le réseau.
- **Pas de com, pas de télémétrie, pas de site.** La publication (P6) n'est qu'un moyen pour des collègues d'installer.
- **Ce que l'IA ne peut pas faire** (comptes, clés, choix qui appartiennent à Adrien) vit dans la colonne *Bloqué — humain (Adrien)* ; une carte qui en dépend attend, le loop continue avec la suivante.

## Ce que le plan ne fait pas

- l'arbre de conversation (Lacis), les agents, l'exécution d'outils ;
- une webview éditeur de texte ;
- une génération d'arbre par contextree lui-même — c'est l'IA de l'utilisateur qui construit, contextree invite, borne et trace ;
- un serveur maison : Supabase reste un service HTTP (PostgREST + GoTrue), pas une dépendance ; ni temps réel, ni storage, ni interface web.
