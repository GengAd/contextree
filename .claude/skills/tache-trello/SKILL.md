---
name: tache-trello
description: Prendre la prochaine tâche sur le tableau Trello contextree, commencer ou terminer une carte, ou tourner en /loop. À utiliser dès qu'on parle de carte, de ticket, de Trello, de prochaine tâche, ou de ce qu'il reste à faire.
---

# Une tâche Trello

Tableau **contextree**, id `6a9ebc7ca1b58d53d9cce21e`. Le MCP Trello a un autre tableau actif par défaut : passer ce `boardId` à chaque appel. Une carte = un commit sur `main`. Rien ne se ferme sans commit, rien ne se commit sans `npm test` vert et la carte de ce repo sans avertissement.

## Les colonnes, dans l'ordre où on les lit

| Colonne | id | Rôle |
|---|---|---|
| En cours | `6ac8f35f256f3727eda57edd` | s'il y a une carte, c'est elle ; jamais deux |
| A faire | `6ac8f35ee9b6c290f09b1a71` | sinon, la carte **du haut** ; l'ordre est le plan |
| Bloqué — humain (Adrien) | `6ac8f35f66910cee2316d650` | on y dépose, on n'y prend jamais rien |
| Fait | `6ac8f35f2f1ee984c1fea05e` | quand le commit existe, pas avant |
| Plus tard | `6ac8f35f134f177c678bcdee` | parking ; chaque carte porte sa **porte** d'usage |

## Une itération

1. Lire la carte **entière**. Elle porte : *Branche git*, *Dépend de*, *Quoi*, *Critères d'acceptation*, *Tests*, *Commit*.
2. Vérifier *Dépend de* : chaque carte citée est dans *Fait*. Sinon : commenter ce qui manque ; si c'est une carte humaine, déplacer dans *Bloqué* ; prendre la suivante.
3. `git status` propre, sur `main`. Déplacer la carte dans *En cours*.
4. Faire le travail. Une décision que la carte ne tranche pas : **la trancher**, l'écrire en commentaire, et dans le contexte si elle est durable (skill `contextree:retenir`). Ne jamais attendre l'utilisateur.
5. `npm test` vert ; `node plugin/skills/carte/scripts/carte.mjs --sans-perso` sans avertissement ; si `plugin/` ou `.claude/` ont changé, délègue au sous-agent `relecteur` et corrige ce qu'il signale.
6. Committer sur `main` avec le message proposé par la carte. Un ticket = un commit.
7. Commenter la carte : hash, décisions prises, ce qui reste. Déplacer dans *Fait*.
8. Bloqué pour de bon (compte, clé, choix d'Adrien) : remettre le dépôt propre, commenter, déplacer dans *Bloqué*, prendre la suivante.
9. *A faire* vide, ou plus que des cartes bloquées : le dire et s'arrêter.

## Une porte, pas un plan

Une carte de *Plus tard* ne monte dans *A faire* que quand sa porte est franchie : un agacement vécu, écrit en commentaire. On n'ajoute pas de carte « parce que ce serait bien ».
