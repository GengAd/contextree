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
| P3 depuis zéro | `p3-depuis-zero` | sur un dossier vierge, l'IA propose l'arbre, le construit proprement, renvoie à la toile | **pas franchie au 10 septembre 2026** — déroulé une fois, trois ratés ; voir plus bas |
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

## P3, déroulé le 10 septembre 2026 — porte **pas** franchie

Le scénario *depuis zéro* a été joué en entier sous Claude Code, sur une copie jetable d'un vrai projet (`ai-tree` : `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md`, `SETUP.md`, un `README` de 185 lignes). `contextree install`, puis quatre tours de conversation.

**Ce qui marche, et bien** :
- L'invitation part au premier prompt. « bonjour, on fait quoi ? » → l'IA a proposé l'arbre en une phrase, à la fin de sa réponse, sans insister et sans rien créer.
- L'arbre produit tient : racine + **10 branches**, hiérarchisées, et **tous** les `load_when` sont des conditions — aucun résumé, aucun « toujours », y compris sur l'identité. L'IA a annoncé ses écritures, désigné les deux branches à relire en priorité, et fini sur « rien n'est utile tant que ce n'est pas relu ».
- **Aucun fichier source touché** — vérifié par horodatage sur tout le clone.
- Le routage trie vraiment, dès le premier prompt : 2, 4 et 3 branches sur 10 pour « comment on lance les tests ? », « ajoute une commande VS Code au bridge » et « pourquoi ce choix d'archi pour le routeur ? ». Sélections différentes et justes à chaque fois.

**Ce qui casse** — et c'est ce qui tient la porte fermée :
- **L'IA ne peut pas créer l'arbre depuis la conversation.** `write_root` passe par `open()`, qui lève tant que `.contextree/` n'existe pas : l'agent a demandé un terminal (`init`). Le critère « aucun terminal après `install` » tombe, et l'invitation qu'on vient d'écrire promet quelque chose que les outils refusent.
- **L'agent ne peut pas atteindre la consigne `bootstrap`.** Un prompt MCP est exposé à l'utilisateur en slash-command, pas au modèle ; l'agent est donc allé vers `npx -y @gengad/contextree bootstrap`, un paquet non publié (P6). Il s'est arrêté et a demandé de l'aide.
- **L'IA n'enrichit pas l'arbre pendant une vraie tâche.** Sur « où sont les tests et avec quoi tournent-ils », elle a trouvé un fait durable et exact — la couverture ne concerne que `src/lib/`, rien dans `packages/vscode/` — et n'a **rien** écrit, ni dit qu'elle n'écrivait pas. Les `instructions` du serveur le demandent pourtant. Une consigne lue une fois à la connexion ne survit pas à la tâche.

Trois enseignements, un seul motif : **ce qui n'est pas un outil n'existe pas pour l'agent.** Une consigne dans les `instructions`, un prompt MCP, une invitation en texte — tout cela informe, et rien de tout cela n'agit. Ce qu'on veut voir se produire doit être atteignable par un appel d'outil, au moment où la tâche s'y prête.

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
