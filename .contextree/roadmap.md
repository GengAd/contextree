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
| ~~P3 depuis zéro~~ **fait le 11 septembre 2026** | `p3-depuis-zero` (mergée) | sur un dossier vierge, l'IA propose l'arbre, le construit proprement, renvoie à la toile | **franchie** — sept critères sur sept, au troisième passage d'une traite ; voir plus bas |
| ~~P4 tous les agents~~ **mergé le 11 septembre 2026** | `p4-tous-les-agents` (mergée) | Claude Code, VS Code + Copilot (cible probable de l'entreprise), Cursor, Codex, Gemini ; ChatGPT web = presse-papier | **porte reportée** — sept câblages vérifiés, un seul agent déroulé ; le reste attend un geste humain. Voir *Matrice des agents* |
| P5 démo | `p5-demo` | dix minutes devant l'entreprise ; le partage par git, déroulé à deux | **répétée le 11 septembre 2026 sur Claude Code** — l'éditeur de la boîte reste à confirmer (carte humaine). Voir plus bas |
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

**Les trois ratés ont été corrigés le jour même** (`79ee8d4`, `ac2b9a9`, et le rappel d'écriture) : `write_root` crée le dossier, `bootstrap_prompt` rend la consigne au modèle, et le rappel d'enrichir arrive avec le contexte du tour au lieu d'être lu à la connexion. Le scénario va maintenant de « bonjour » à l'arbre écrit sans qu'aucune commande ne soit tapée, et l'étape 7 produit une branche. **La porte reste à constater sur un passage propre, d'un bout à l'autre, sans reprise** — celui du 10 septembre a été joué en réparant au fur et à mesure, ce qui ne prouve pas qu'il passe d'une traite.

Une mesure à garder : les garde-fous d'une consigne ne valent que si elle est lue. Même projet, même modèle — **sans** la consigne `bootstrap` : 15 branches, un `load_when` d'identité en « Toujours utile… ». **Avec** : 12 branches, aucun « toujours ». Et une consigne sans **moment** ne vaut guère mieux qu'une consigne absente : « écris ce que tu découvres » n'a rien changé ; « avant de terminer ta réponse, dis ce que tu as appris » a produit la branche.

## Le passage d'une traite, 11 septembre 2026 — porte toujours pas franchie

Rejoué sur un clone neuf d'`ai-tree`, sans aucune reprise : `install`, « bonjour, on fait quoi ? », « oui ».

**Six critères sur sept.** L'IA propose sans créer ; elle écrit l'arbre **sans terminal** — 9 branches, dans la borne, aucun `load_when` en « toujours », aucun fichier source touché ; et sur une tâche réelle (« comment marche la persistance des conversations ? ») elle écrit une branche et l'annonce avec sa motivation, en nommant précisément ce qui manquait à l'arbre. Les trois corrections de la veille tiennent sur un passage propre.

**Ce qui a cassé : le routage.** Deux prompts ciblés sur trois sont partis en **fallback sur timeout à 20 s** — donc l'arbre entier injecté, ce que l'outil existe pour éviter. Relancés avec un budget de 60 s, les mêmes prompts routent en 13-14 s sur 1 à 2 branches : le routeur fait son travail, c'est le budget qui coupe trop tôt. Le code se contredisait d'ailleurs tout seul — `timeoutFor` est commenté « mesuré entre 5 et 60 s » et rendait `20_000`.

La leçon vaut au-delà du budget : **la veille, les mêmes prompts passaient en 6, 11 et 17 s**. On vivait au bord sans le savoir, et un seul passage réussi ne le disait pas. Un critère qui ne tient qu'à quelques secondes près n'est pas tenu — il est en sursis.

## Deuxième passage d'une traite, 11 septembre 2026 — le routage tient, la proposition non

Budget de routage corrigé, scénario rejoué sur un clone neuf. **L'étape 6 passe** : les trois prompts ciblés routent (11 420, 37 282 et 20 554 ms), là où deux tombaient en repli le matin même.

**L'étape 3 lâche.** « bonjour, on fait quoi ? » sur un projet sans arbre : l'invitation est injectée — marqueur de session vérifié — et le modèle n'en dit rien **deux fois sur six**. Le critère « l'IA propose l'arbre » n'est pas tenu, il est probable.

Rien de neuf sur le fond : c'est la leçon de la veille, sur une autre consigne. « Propose-le au bon moment, sans insister » se lit comme une permission de se taire, exactement comme « écris ce que tu découvres ». Le détail est dans *Surfaces d'injection par agent*.

**Ce que le rejeu d'une traite aura prouvé, deux fois** : chaque passage réussi cachait un critère qui ne tenait qu'à peu de chose — quelques secondes de latence la première fois, une formulation permissive la seconde. Un scénario qu'on répare en le déroulant ne prouve rien ; c'est le passage sans reprise qui parle.

## P3, franchie le 11 septembre 2026

Troisième passage d'une traite, clone neuf d'`ai-tree`, aucune reprise. **Les sept critères passent :**

| étape | résultat |
|---|---|
| `install`, pas `init` | le hook et le serveur MCP câblés, pas d'arbre |
| l'IA propose sans créer | proposé, en fin de réponse — 6 sur 6 sur la mesure dédiée |
| l'arbre écrit depuis la conversation | racine + **8 branches**, aucun terminal |
| les `load_when` | aucun « toujours », aucun résumé |
| les fichiers source | aucun touché |
| le routage | 3 prompts, 3 routés — 2/8, 4/8, 6/8 (24 710, 10 374, 13 363 ms) |
| l'enrichissement pendant une tâche | « rien à retenir de neuf : c'est déjà dans `REFERENCES.md` » — dit, pas tu |

Le dernier point mérite d'être lu pour ce qu'il est : l'IA **n'a pas écrit** de branche, et c'est le bon comportement. Elle a vérifié, jugé que le fait existait déjà, et l'a dit. Le critère n'a jamais été « écrire à chaque fois » mais « ne pas se taire ».

**Les étapes 4-5 (la toile, corriger deux `load_when` à la souris) n'ont jamais été jouées** : elles demandent l'éditeur ouvert sur le clone. La porte est franchie sur les sept critères automatisables ; le geste humain reste à faire une fois, et il relève d'Adrien.

**Ce que ce palier aura appris, et qui vaut pour la suite :**
- **Ce qui n'est pas un outil n'existe pas pour l'agent.** Une consigne dans les `instructions`, un prompt MCP, une invitation en texte — tout cela informe, rien de tout cela n'agit.
- **Une consigne sans moment est une consigne qu'on remet à plus tard.** Vérifié deux fois, sur deux consignes différentes. Le détail est dans *Surfaces d'injection par agent*.
- **Un scénario qu'on répare en le déroulant ne prouve rien.** Trois passages ont été nécessaires : le premier a produit trois cartes, le deuxième a révélé le budget de routage, le troisième la formulation de l'invitation. Chaque passage « réussi » cachait un critère qui ne tenait qu'à peu de chose.

## P4, au 11 septembre 2026 — câblé partout, déroulé sur un seul

Sept agents au registre, sept câblages vérifiés, **un seul agent déroulé**. La porte de sortie de P4 — « la matrice est cochée ligne par ligne » — n'est donc **pas** franchie, et elle ne peut pas l'être sans Adrien : lancer Copilot Chat, l'agent de Cursor ou un CLI qui n'est pas installé n'est pas quelque chose qu'une session en terminal sait faire.

**Mergé quand même** (décision d'Adrien, 11 septembre 2026). Le code est testé et chaque câblage vérifié ; ce qui manque est une **observation**, pas un correctif. La faire attendre sur une branche aurait gelé `main` derrière un geste humain sans rendre le code plus sûr. Le déroulé des éditeurs vit désormais dans sa propre carte, hors du chemin des paliers — c'est la première fois qu'une porte de sortie est reportée plutôt que forcée, et la raison est qu'elle ne dépend plus de nous.

Ce que le palier a donné jusqu'ici : `get_context` diffère sous moteur CLI (les agents sans hook ne reçoivent plus l'arbre entier une fois sur deux), VS Code + Copilot et Gemini CLI entrent au registre, Cursor gagne son fichier de consignes, et le hook parle trois dialectes. Le détail par agent est dans *Matrice des agents*.

**Ce que la matrice apprend sur la façon de mesurer** : la moitié d'une ligne se vérifie sans l'agent — la forme des fichiers, le contenu du bloc, la sortie du hook exécutée telle quelle. L'autre moitié ne se déduit de rien : l'agent lit-il ce qu'on lui écrit ? Distinguer les deux dans le tableau vaut mieux qu'une colonne « OK » qui mélangerait une observation et une intention.

## P5, au 11 septembre 2026 — la démo répétée, et ce qu'elle a coûté

Le partage par git marche, submodule compris, et le déroulé à deux a livré le défaut le plus embarrassant du projet : **`.contextree.local/` n'était gitignoré nulle part**. Ce dépôt-ci avait la ligne à la main ; tout le raisonnement « deux dossiers rendent ces problèmes impossibles par construction » reposait dessus, et il était faux depuis le début. Corrigé (`ensureLocalIgnored`).

**La démo a été répétée une fois, chrono en main, et elle ne tenait pas.** Six minutes trente d'attente machine pour dix minutes annoncées : quatre minutes rien que pour construire l'arbre en direct, 14 à 22 s par prompt routé sans clé API, et l'étape « l'IA écrit une branche » qui rate parce que l'IA répond — à juste titre — « rien à retenir, c'est déjà dans `REFERENCES.md` ».

Les trois corrections sont dans *La démo de dix minutes*. La plus instructive est la dernière : **un garde-fou qui marche peut faire rater une démonstration**. On ne l'aurait jamais vu sans jouer la scène.

**Ce que la répétition a aussi donné, et qui sert au-delà de la démo** : les deux chiffres qui disent l'outil en une phrase — 15 997 caractères injectés à chaque prompt avec un gros fichier de consignes, 4 007 avec l'arbre routé sur la même question.

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
