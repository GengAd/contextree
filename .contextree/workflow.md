---
type: rule
title: Workflow Trello et git
load_when: quand on prend une tâche Trello, qu'on commence ou termine un ticket, qu'on se demande sur quelle branche git travailler, ou qu'on tourne en /loop
---

Le tableau Trello **contextree** est la file de travail. Un ticket = une carte. Un ticket terminé = un commit. Rien ne se ferme sans commit, rien ne se commit sans `npm test` vert.

## Les colonnes, dans l'ordre où on les lit

1. **En cours** — s'il y a une carte, c'est elle. Jamais deux en même temps.
2. **A faire** — sinon, la carte **du haut**. L'ordre de la colonne est le plan : on ne pioche pas plus bas.
3. **Bloqué — humain (Adrien)** — ce que l'IA ne peut pas faire (un compte, une clé, un choix qui lui appartient). On n'y prend jamais rien ; on y dépose.
4. **Fait** — une carte y va quand son commit existe, pas avant.
5. **Plus tard** — parking. On n'y touche pas tant que *A faire* n'est pas vide.

## Une itération — c'est exactement ce que fait le `/loop`

1. Lire la carte **entière** (`get_card`). Elle porte : *Branche git*, *Dépend de*, *Contexte*, *Quoi*, *Critères d'acceptation*, *Tests*, *Arbre à mettre à jour*, *Commit*.
2. Vérifier *Dépend de* : chaque carte citée doit être dans *Fait*. Sinon : commenter ce qui manque ; si la dépendance est une carte humaine, déplacer la carte dans *Bloqué — humain* ; prendre la suivante.
3. Se mettre sur la branche indiquée (règle plus bas). `git status` propre avant de commencer.
4. Déplacer la carte dans *En cours*.
5. Faire le travail. Une décision que la carte ne tranche pas : **la trancher soi-même**, l'écrire en commentaire de la carte, et dans l'arbre si elle est durable. Ne jamais attendre l'utilisateur.
6. `npm test` vert. Mettre à jour les branches de l'arbre listées dans la carte, et annoncer chaque écriture.
7. Committer avec le message proposé par la carte (adapté si besoin). Un ticket = un commit, sauf si la carte demande des commits séparés.
8. Commenter la carte : hash du commit, décisions prises, ce qui reste éventuellement. Déplacer dans *Fait*.
9. Bloqué pour de bon (identifiants, compte, question qu'on ne peut pas trancher) : remettre le dépôt propre (`git stash` ou revert), commenter, déplacer dans *Bloqué — humain*, prendre la carte suivante.
10. *A faire* vide, ou plus que des cartes bloquées : le dire clairement et s'arrêter.

## Branches git : une par palier (décidé le 9 septembre 2026)

Les cartes sont préfixées par leur palier (`P1 ·`, `P2 ·`…). Chaque palier vit sur **sa** branche, créée depuis `main` à la première carte du palier, et mergée dans `main` (`git merge --no-ff`) à la dernière — cette dernière carte est explicite dans le plan (« Pn · Merger … dans main »). `main` ne reçoit que des merges de palier.

| Palier | Branche |
|---|---|
| P1 usage perso | `p1-usage-perso` |
| P2 dogfooding | `p2-dogfooding` |
| P3 depuis zéro | `p3-depuis-zero` |
| P4 tous les agents | `p4-tous-les-agents` |
| P5 démo | `p5-demo` |
| P6 distribution | `p6-distribution` |
| P7 serveur | `p7-serveur` |
| P8 visibilité | `p8-visibilite` |
| P9 entreprise | `p9-entreprise` |

La carte dit toujours sa branche. Si elle n'existe pas encore : `git checkout main && git pull --ff-only && git checkout -b <branche>`. La branche `phase-2-contexte-commun` a été mergée dans `main` le 9 septembre 2026 et n'existe plus en local.

## Definition of done

- `npm test` vert (build + tous les tests) ;
- les invariants tiennent : le hook ne bloque jamais un prompt, le routage ne rend jamais un ensemble vide, `.contextree/` reste lisible à la main, `order` reste stable ;
- les branches de l'arbre touchées sont à jour, sans doc en double ailleurs ;
- le commit existe, la carte est dans *Fait* avec son commentaire.

## Ce qu'un clone frais doit savoir

`dist/` est ignoré par git : `npm run build` avant toute chose, sinon le hook local (`node dist/cli.js hook`) n'injecte rien et l'IA travaille sans contexte. Le hook de ce repo est câblé à la main dans `.claude/settings.json` ; `contextree install` ne le reconnaît pas comme sien, c'est normal.
