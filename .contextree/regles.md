---
type: rule
title: Règles du projet
load_when: quand la demande touche au code, aux fichiers, aux dépendances ou à une feature
---

- **Le hook ne bloque jamais un prompt.** Toute erreur dans `cmdHook` sort en code 0 et silence. Invariant non négociable.
- **Le routage ne bloque jamais l'appel principal.** Erreur ou timeout ⇒ fallback sur la sélection du tour précédent, sinon l'arbre entier — le **routeur** ne rend jamais un ensemble vide. Un moteur lent (le CLI `claude`) se lance en tâche de fond, il ne se met pas devant le prompt.
- **Un agent n'est jamais laissé sans racine ni moyen d'atteindre une branche.** C'est ce que protège « jamais un ensemble vide ». Le serveur MCP, faute de routage, rend zéro branche mais la racine et le catalogue avec les chemins pour `read_branch` (14 septembre 2026) : l'invariant tient, il n'est pas violé en silence.
- **Aucun type de branche n'est privilégié.** Pas de « branches garanties » `identity` + `rule` : c'est le `load_when` qui décide, ou personne.
- **Les fichiers markdown sont la source de vérité.** Rien ne doit rendre `.contextree/` illisible ou non éditable à la main.
- **Pas de dépendance ajoutée sans discussion.** Le projet en a trois — `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod` — et ça doit rester inconfortable d'en ajouter une quatrième. Le frontmatter, la compression des packs, le presse-papier, le TOML de Codex et l'API Supabase sont faits main sur les modules Node (`zlib`, `crypto`, `os`, `fetch`).
- `npm test` (build + tests) doit passer avant de valider.
- **L'IA écrit dans l'arbre directement**, sans demander la permission, quand elle repère un fait durable — et elle l'**annonce** en une phrase à chaque fois. Le garde-fou est la visibilité, pas l'interdiction : écrire en silence est la seule façon de mal faire ici, parce que l'arbre écrit lui est réinjecté ensuite. Le pourquoi est dans *Périmètre*.
- **Garder l'arbre vivant.** Une branche qui ne dit plus la vérité est pire qu'une branche absente : elle est injectée avec autorité. Proposer les corrections, ne jamais réécrire en silence.
