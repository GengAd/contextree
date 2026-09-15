---
type: rule
title: Règles du projet
load_when: quand la demande touche au code, aux fichiers, aux dépendances, à une feature, ou qu'on écrit dans l'arbre de ce dépôt
---

- **Le hook ne bloque jamais un prompt.** Toute erreur dans `cmdHook` sort en code 0 et en silence.
- **Le routage ne bloque jamais l'appel principal.** Erreur ou timeout ⇒ fallback ; le routeur ne rend jamais un ensemble vide. Un moteur lent se lance en tâche de fond.
- **Un agent n'est jamais laissé sans racine ni moyen d'atteindre une branche** — le catalogue avec les chemins, faute de mieux.
- **Aucun type de branche n'est privilégié** : c'est le `load_when` qui décide. L'identité reste une branche à part même quand elle sert presque toujours : c'est un type, pas un morceau de racine.
- **Les fichiers markdown sont la source de vérité** : `.contextree/` reste lisible et éditable à la main.
- **Pas de dépendance ajoutée sans discussion.** Trois : `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`. Frontmatter, compression, presse-papier, TOML, API Supabase sont faits main sur Node.
- `npm test` passe avant de valider.

## Écrire dans l'arbre

- **L'IA écrit directement**, sans demander, quand elle repère un fait durable — et l'**annonce** en une phrase. Le garde-fou est la visibilité : l'arbre écrit lui est réinjecté.
- **Une branche dit ce qui est vrai maintenant, pas comment on y est arrivé.** Pas de journal de décisions, de dates ni de « ce point renverse… » : l'histoire est dans git. Une mesure ne reste que si elle justifie une valeur du code.
- **Un fait vit à un seul endroit** ; ailleurs, on renvoie à la branche par son titre en italique.
- **Court** : au-delà de 6 000 caractères, découper en enfants (le contrôle de forme le signale). Un parent est injecté avec chacun de ses enfants : il ne porte que le commun.
- **Garder l'arbre vivant** : une branche fausse est pire qu'absente, elle est injectée avec autorité. Corriger en l'annonçant, jamais en silence.
