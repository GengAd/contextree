---
type: skill
title: Revue de code
load_when: quand on relit un diff, une PR, ou qu'on demande une revue
---

Dans l'ordre de gravité — les règles elles-mêmes sont dans *Règles du projet* :

1. **Un invariant peut-il casser sur ce chemin ?** Le hook remonte-t-il une exception ou un code ≠ 0 ; le routeur peut-il rendre un ensemble vide ; un agent peut-il se retrouver sans racine ni catalogue ?
2. **`order` reste-t-il déterministe ?** Un changement d'ordre casse le routage en silence.
3. **Les surfaces divergent-elles ?** Hook, serveur MCP, fichiers de consignes et vues doivent dire la même chose : une logique copiée dans un adaptateur au lieu du cœur est un bug à venir.
4. **Un texte affiché ou lu par un modèle échappe-t-il au dictionnaire ?** Une chaîne en dur, une clé sans traduction dans l'extension, une consigne traduite qui perd son moment.
5. **Périmètre et dépendances** : une feature hors routage / édition / partage, ou une dépendance ajoutée.
6. **L'arbre suit-il le code ?** Les branches touchées sont à jour, sans doublon, et `contextree list` n'affiche aucun avertissement de forme.

Signale tout ce que tu trouves, même incertain, avec ton niveau de confiance — le tri se fait après.
