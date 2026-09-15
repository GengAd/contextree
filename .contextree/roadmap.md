---
type: context
title: Roadmap et paliers
load_when: quand on se demande ce qui vient après, où en est le plan, pourquoi un palier passe avant un autre, ou ce qui est reporté ou hors plan
---

Le plan vit dans **Trello** (voir *Workflow Trello et git*). Ici : l'état des paliers et les décisions qui portent l'ordre.

**Règle d'ordre** : un palier n'ouvre que quand le précédent est **utilisé pour de vrai**, pas seulement codé. Priorités d'Adrien : s'en servir partout lui-même ; que ce repo n'ait de consignes que dans l'arbre ; qu'un projet vierge se dote d'un arbre par l'IA ; tous les agents ; le présenter à son entreprise. Le partage public vient bien après.

| Palier | État | Ce qui reste |
|---|---|---|
| P1 usage perso | fait | — |
| P2 dogfooding | fait — l'arbre est la seule doc du repo | — |
| P3 depuis zéro | fait — 7 critères sur 7 d'une traite | la toile (étapes 4-5) jamais jouée à la main |
| P4 tous les agents | mergé, porte reportée | dérouler les éditeurs, surtout Copilot (voir *Matrice des agents*) |
| P5 démo | mergé, porte reportée | l'éditeur de la boîte, le repo, la date — à Adrien |
| **P6 distribution** (en cours, `p6-distribution`) | Copilot sous Windows d'abord : sampling, catalogue, `cwd`, CLI Windows, bouton « Ajouter à une IA » — faits ; outil bilingue et contrôle de forme — faits | npm, Open VSX, hook pinné, README ; porte : `npx -y @gengad/contextree init` sur une machine vierge |
| P7 serveur | — | un second compte pull un arbre poussé par le premier et le monte ailleurs |
| P8 visibilité | — | un arbre public monté par quelqu'un hors de tout groupe |
| P9 entreprise | — | la chaîne entreprise → équipe → projet visible, une autre équipe ne voit pas la sienne |

P4 et P5 ont été mergés sans leur porte : ce qui manque est une observation ou une décision humaine, pas du code, et geler `main` derrière n'aurait rien rendu plus sûr.

## Décisions qui portent le plan

- **Cible entreprise : VS Code + Copilot, sur des PC Windows.** Copilot doit recevoir **des branches, jamais l'arbre entier**, y compris sans clé ni CLI.
- **Le serveur est un remote, pas une source** : l'arbre local reste la copie de travail, le routage ne touche jamais le réseau.
- **Pas de com, pas de télémétrie, pas de site** : publier sert à ce que des collègues installent.
- Ce que l'IA ne peut pas faire va dans *Bloqué — humain (Adrien)*.

Ce qui n'entre dans aucun palier est dans *Périmètre*. Le détail technique de P7 à P9 est dans *Montages, visibilité et hiérarchie*.
