---
type: rule
title: Règles du projet
load_when: quand la demande touche au code, aux fichiers, aux dépendances ou à une feature
---

- **Le hook ne bloque jamais un prompt.** Toute erreur dans `cmdHook` sort en code 0 et silence. Invariant non négociable.
- **Le routage ne bloque jamais l'appel principal.** Erreur ou timeout ⇒ fallback sur la sélection du tour précédent, sinon l'arbre entier — jamais un ensemble vide. Un moteur lent (le CLI `claude`) se lance en tâche de fond, il ne se met pas devant le prompt.
- **Aucun type de branche n'est privilégié.** Pas de « branches garanties » `identity` + `rule` : c'est le `load_when` qui décide, ou personne.
- **Les fichiers markdown sont la source de vérité.** Rien ne doit rendre `.contextree/` illisible ou non éditable à la main.
- **Pas de dépendance ajoutée sans discussion.** Le projet en a trois ; ça doit rester inconfortable d'en ajouter une quatrième.
- `npm test` (build + tests) doit passer avant de valider.
- Ne pas créer de fichier `.md` à la racine sans demander.
