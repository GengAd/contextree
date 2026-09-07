---
type: skill
title: Revue de code
load_when: quand on relit un diff, une PR, ou qu'on demande une revue
---

Dans l'ordre de gravité :

1. **Les deux invariants tiennent-ils ?** Le hook peut-il, sur ce chemin, remonter une exception ou un code ≠ 0 ? Le routeur peut-il renvoyer un ensemble vide ?
2. **`.contextree/` reste-t-il éditable à la main et lisible dans un diff ?**
3. **Le périmètre est-il tenu ?** Une feature hors routage/édition/partage n'a pas sa place ici.
4. **Une dépendance a-t-elle été ajoutée ?** Le justifier ou la retirer.
5. **`order` est-il resté déterministe ?** Un changement d'ordre casse le routage en silence.

Signale tout ce que tu trouves, même incertain, avec ton niveau de confiance — le tri se fait après.
