---
type: rule
title: Règles du projet
load_when: quand la demande touche au code, aux fichiers, aux dépendances ou à une feature
---

- **Le hook ne bloque jamais un prompt.** Toute erreur dans `cmdHook` sort en code 0 et silence. Invariant non négociable.
- **Le routage ne bloque jamais l'appel principal.** Erreur ou timeout ⇒ fallback `identity` + `rule`, jamais un ensemble vide.
- **Les fichiers markdown sont la source de vérité.** Rien ne doit rendre `.contextree/` illisible ou non éditable à la main.
- **Pas de dépendance ajoutée sans discussion.** Le projet en a trois ; ça doit rester inconfortable d'en ajouter une quatrième.
- `npm test` (build + tests) doit passer avant de valider.
- Ne pas créer de fichier `.md` à la racine sans demander.
