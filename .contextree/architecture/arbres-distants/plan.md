---
type: reference
title: Montages, visibilité et hiérarchie (P7 à P9)
load_when: quand on conçoit ou code les montages d'arbres, le cache des arbres distants, le compte et les invitations, la visibilité (privé, groupe, lien, public), l'annuaire, le fork, ou les groupes hiérarchiques et leurs rôles
---

Décisions posées pour P7 à P9, **rien n'est codé**.

## Calques : de deux à N

`loadTree` superpose déjà groupe et local, champ par champ. On généralise à une liste ordonnée `[montage₁, …, montageₙ, groupe, local]`, même règle ; `Branch.layer` devient `'local' | 'group' | 'mount:<alias>'`. Rien ne change pour `withAncestors`, le routeur, le rendu ni les vues. `order` reste le parcours sur l'arbre résolu.

## Montages

- Un arbre distant visible sous un **alias** (`alias/…`) ; l'alias est un hub dont le corps est le `root.md` monté et le `load_when` celui de son frontmatter. **Routé comme le reste** : seul le `root.md` de la copie de travail est toujours injecté.
- **Déclaration** : `mounts: acme/entreprise, acme/backend` dans le frontmatter de `root.md` (groupe) et de `.contextree.local/root.md` (perso), union dans cet ordre. Un `root.md` local qui ne déclare que des montages ne remplace pas le corps du groupe.
- **Cache** : `stateDir()/cache/<treeId>/`, même format disque. Absent = montage absent, dit dans la trace, jamais une erreur.
- **Rafraîchissement** : `pull` met à jour la copie et ses montages ; le hook lance `pull-bg` détaché une fois par session s'il existe un montage.
- CLI : `mount <groupe>/<arbre> [--as <alias>] [--local]`, `unmount <alias>`, `mounts`.

## Entrer dans un groupe (P7)

- `contextree signup <email>` (GoTrue, mot de passe sur stdin) crée aussi le **groupe personnel** (slug = partie locale de l'e-mail, ou `--handle`).
- **Invitation par code, pas par e-mail** (chercher par e-mail exposerait `auth.users`) : table `invites`, `group invite <slug> [--role writer]`, `join <code>` → `accept_invite(code)` en `security definer`.

## Visibilité (P8)

- `trees.visibility` : `private` · `group` · `link` (`share_token`, `tree_by_token`) · `public`. Une fonction `can_read_tree(tid)` centralise la règle.
- **Annuaire** : vue `directory` des arbres publics, provenance comprise ; `contextree search`.
- **Arbre perso** : `perso` du groupe personnel, monté partout par `mount <moi>/perso --local`.
- **Fork** : `import --prefix` (copie éditable) ou montage (lecture seule) ; amont suivi dans le tracking, `contextree upstream` avec la fusion à trois voies de `sync.ts`.

## Hiérarchie d'entreprise (P9)

**Une hiérarchie d'entités est une chaîne de montages.**
- `groups.parent_id` ; l'appartenance se propage **vers le bas**, jamais vers le haut. Hors de l'équipe A, on ne voit ni ses arbres ni son existence.
- Chaque groupe peut avoir un arbre de contexte (`groups.context_tree_id`), monté implicitement de la racine jusqu'au groupe, sous les montages explicites.
- **Rôles** : `reader`, `writer`, `owner`. Contributeur = `reader` qui **propose** : une version `status = 'proposed'` que `writer`/`owner` promeut ou rejette (`proposals`, `accept`, `reject`).
- **Audit** : `author_id`, `created_at` ; `contextree log`, `contextree diff <v1> <v2>`.
