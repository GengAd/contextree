---
type: reference
title: Packs, schéma et sync pull/push
load_when: quand on touche à export / import / jeton de pack, au schéma Supabase et ses politiques RLS, ou aux commandes link, pull, push, status et à leurs conflits
---

## Packs (`src/core/pack.ts`)

Un `ContextPack` est un objet plat (`v: 1`, `rootContent`, `branches[]` avec `parent` explicite). Véhicules sans serveur : git (committer `.contextree/`), fichier (`export -o pack.json`), **jeton** (`export --token` : deflate + base64url, collable dans un chat — pas lisible par un modèle). `applyPack` refuse `..` et les chemins absolus, accepte un `prefix`.

## Schéma

- **Une version est un ensemble de branches, pas un blob** (`versions` + `branches`, colonnes de `Branch`) : `pull` dit quelle branche a changé, `push` refuse un conflit précis.
- **Une version est immuable, et ça s'entend** : un déclencheur `before update` lève. Sans lui, RLS bloquerait en silence (zéro ligne, aucun message). Le `delete` reste à RLS (un déclencheur casserait le cascade).
- **L'autorisation est dans la base** ; le client n'a que la clé anon. `is_member` / `can_write` / `is_owner` sont `security definer` (sinon une politique sur `memberships` récurse). Un trigger fait de l'auteur d'un groupe son `owner`.
- `npm run test:sql` rejoue le schéma sur un Postgres Docker et déroule deux comptes, **sous un rôle non privilégié** — RLS ne s'applique pas au propriétaire des tables.
- Version et branches partent en deux appels (pas de transaction multi-tables) ; un échec laisse une version vide, sans conséquence.

## Sync — modèle git, pas Dropbox

`contextree link <groupe>/<arbre> [--create]`, `pull`, `push -m`, `status`. La copie de travail se souvient de sa **base** : trois états à comparer.

| base → distant | base → local | résultat |
|---|---|---|
| a bougé | inchangé | on prend le distant |
| inchangé | a bougé | on garde le local |
| a bougé | pareil des deux côtés | rien |
| a bougé | autrement | **conflit** |

- **Un conflit n'écrit rien.** On règle les `.md`, puis `pull --mine` ou `pull --theirs` — sans quoi le conflit se redétecte sans fin.
- **`push` refuse une base périmée** (non-fast-forward).
- **Le calque local ne part jamais** : `loadTree(dir, { withLocal: false })`.
- **Le suivi est local**, comme `.git/` : `stateDir()/tracking/<clé>.json`.
- **`pull` écrit par renommage atomique** : un hook voit l'ancienne ou la nouvelle version, jamais un `.md` à moitié écrit.
