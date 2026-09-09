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
| P1 usage perso | `p1-usage-perso` | l'outil marche sur les autres projets d'Adrien, et la vue dit la vérité sur le routage | le journal montre des tours *routés*, sur un autre repo que celui-ci |
| P2 dogfooding | `p2-dogfooding` | plus aucun `.md` de consignes hors de l'arbre dans ce repo (`README.md` = procédure, seule exception) | une session neuve prend une carte Trello sans `CLAUDE.md` et la fait bien |
| P3 depuis zéro | `p3-depuis-zero` | sur un dossier vierge, l'IA propose l'arbre, le construit proprement, renvoie à la toile | le scénario « depuis zéro » passe sous Claude Code |
| P4 tous les agents | `p4-tous-les-agents` | Claude Code, VS Code + Copilot (cible probable de l'entreprise), Cursor, Codex, Gemini ; ChatGPT web = presse-papier | la matrice est cochée ligne par ligne |
| P5 démo | `p5-demo` | dix minutes devant l'entreprise ; le partage par git, déroulé à deux | la démo tourne sur l'éditeur de la boîte, réseau coupé si besoin |
| P6 distribution | `p6-distribution` | npm, Open VSX, hook pinné, README procédure — pour que des collègues installent | `npx -y @gengad/contextree init` marche sur une machine vierge |
| P7 serveur | `p7-serveur` | le backend sert à deux : compte, invitation par code, premier vrai pull/push, calques et montages | un second compte pull un arbre poussé par le premier, et le monte dans un autre projet |
| P8 visibilité | `p8-visibilite` | plusieurs arbres par personne (l'arbre perso monté partout), privé/groupe/lien/public, annuaire, fork et amont | un arbre public est monté par quelqu'un qui n'est dans aucun groupe |
| P9 entreprise | `p9-entreprise` | groupes hiérarchiques, héritage descendant, accès par nœud, rôles et propositions, audit | une équipe voit la chaîne entreprise → équipe → projet ; une autre ne voit pas la sienne |

Les anciennes « phases » du `ROADMAP.md` : phase 1 (pack, git) livrée ; phase 2 = P7 ; phase 3 = P8 ; phase 4 = P9. Le détail technique de P7 à P9 est dans *Arbres distants : calques, montages, hiérarchie*.

## Décisions tranchées le 9 septembre 2026

- **Branches git** : une par palier, mergée dans `main` (`--no-ff`) à la dernière carte du palier. `phase-2-contexte-commun` a été mergée dans `main` ce jour (fast-forward) et supprimée en local.
- **`README.md` reste**, réduit à une procédure pour un humain. `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md`, `ROADMAP.md` partent dans l'arbre en P2.
- **Cible entreprise probable : VS Code + Copilot**, à confirmer par Adrien (carte humaine). P4 la traite juste après Claude Code, avant Cursor.
- **Le serveur est un remote, pas une source** : l'arbre local reste la copie de travail ; les arbres distants se montent en calques, sur disque ; le routage ne touche jamais le réseau.
- **Pas de com, pas de télémétrie, pas de site.** La publication (P6) n'est qu'un moyen pour des collègues d'installer.
- **Ce que l'IA ne peut pas faire** (comptes, clés, choix qui appartiennent à Adrien) vit dans la colonne *Bloqué — humain (Adrien)* ; une carte qui en dépend attend, le loop continue avec la suivante.

## Ce que le plan ne fait pas

- l'arbre de conversation (Lacis), les agents, l'exécution d'outils ;
- une webview éditeur de texte ;
- une génération d'arbre par contextree lui-même — c'est l'IA de l'utilisateur qui construit, contextree invite, borne et trace ;
- un serveur maison : Supabase reste un service HTTP (PostgREST + GoTrue), pas une dépendance ; ni temps réel, ni storage, ni interface web.
