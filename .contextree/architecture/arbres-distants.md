---
type: reference
title: Arbres distants : calques, montages, hiérarchie
load_when: quand on touche au partage d'un arbre hors git (export, import, pack, jeton), au backend Supabase, à la sync pull/push, aux montages, aux invitations, à la visibilité, aux groupes ou à la hiérarchie d'entreprise
---

**Le routage ne touche jamais le réseau.** Tout ce qui vient d'ailleurs est **sur le disque** avant d'être chargé ; `loadTree` ne lit que des dossiers de markdown. Le serveur est un remote façon git, pas une source consultée à chaque appel : un backend mort ne coûte rien à un prompt. Ni `cmdHook` ni `router.ts` n'importent `remote.ts`.

**Supabase est un service, pas une dépendance** : PostgREST et GoTrue en `fetch`. Ni temps réel, ni storage, ni edge functions, ni interface web, ni SDK. Si Supabase partait, on emporterait le schéma SQL et les politiques.

Le code du backend (`src/core/remote.ts`, `sync.ts`, `supabase/schema.sql`, `rls.test.sql`) est testé par bouchons et `npm run test:sql`, mais **n'a jamais tourné contre un vrai projet Supabase** (P7). Ses messages restent en français.
