---
type: reference
title: Arbres distants : calques, montages, hiérarchie
load_when: quand on touche au partage d'un arbre (export, import, pack, jeton), au backend Supabase, à la sync pull/push, aux arbres montés, au cache local des arbres distants, aux invitations, à la visibilité, aux groupes ou à la hiérarchie d'entreprise
---

## Partager sans backend (`src/core/pack.ts`)

Un `ContextPack` est un objet plat autonome (`v: 1`, `rootContent`, `branches[]` avec `parent` explicite). Trois véhicules, aucun serveur :

- **git** — la source de vérité étant du markdown, committer `.contextree/` suffit ;
- **fichier JSON** — `contextree export -o pack.json` ;
- **jeton compressé** — `contextree export --token` : deflate + base64url, collable dans un chat.

`applyPack` valide chaque chemin (`..` et chemins absolus refusés — un pack vient de quelqu'un d'autre) et accepte un `prefix` pour isoler les branches importées sous un hub.

## Le backend, tel qu'il est aujourd'hui

**Supabase est un service, pas une dépendance** : son API est du HTTP simple (PostgREST pour les données, GoTrue pour l'auth) et Node 20 a `fetch` en global. Ni temps réel, ni storage, ni edge functions — le projet reste à trois dépendances.

**Le schéma**, trois idées :

- **Une version est un ensemble de branches, pas un blob.** `versions` porte l'instantané, `branches` ses lignes, colonnes identiques à `Branch`. C'est ce qui permet à `pull` de dire *quelle* branche a changé et à `push` de refuser un conflit sur une branche précise.
- **Une version est immuable**, et ça s'entend : un déclencheur `before update` lève une erreur. L'absence de politique RLS suffirait à empêcher l'écriture, mais *silencieusement* — zéro ligne touchée, aucun message, un client qui croit avoir réécrit l'histoire. Le `delete` reste gouverné par RLS seule : un déclencheur casserait le `on delete cascade`.
- **L'autorisation est dans la base.** Le client n'a que la clé anon, publique par construction. `is_member` / `can_write` / `is_owner` sont `security definer` — obligatoire, sinon une politique sur `memberships` qui lit `memberships` récurse. Un trigger fait de l'auteur d'un groupe son `owner` : sans lui, personne ne peut s'ajouter au groupe qu'il vient de créer.

`npm run test:sql` rejoue le schéma sur un Postgres nu (Docker, donc hors de `npm test`) et déroule un scénario à deux comptes : création de groupe, filiation des versions, immuabilité, cloisonnement (un non-membre ne voit même pas l'`id` du groupe), lecture sans écriture, promotion en `writer`, refus de signer une version au nom d'un autre. Le test bascule sur un rôle non privilégié — RLS ne s'applique pas au propriétaire des tables, et l'oublier ne testerait rien.

**La sync** (`contextree link <groupe>/<arbre> [--create]`, `pull`, `push -m`, `status`) suit le modèle **git, pas Dropbox**. La copie de travail se souvient de la version dont elle descend — la *base* — et c'est ce qui rend un conflit détectable : trois états à comparer, jamais deux.

| base → distant | base → local | résultat |
|---|---|---|
| a bougé | inchangé | on prend le distant |
| inchangé | a bougé | on garde le local |
| a bougé | a bougé pareil | rien à faire |
| a bougé | a bougé autrement | **conflit** |

- **Un conflit n'écrit rien** : `pull` liste les branches concernées et s'arrête ; ni le disque ni la base suivie ne bougent.
- **Il faut pouvoir en sortir.** Une version réglée à la main diffère par construction du distant *et* de la base : un `pull` nu la redétecterait indéfiniment. On règle les `.md`, puis on tranche en une fois — `pull --mine` ou `pull --theirs`. C'est le seul moyen, et l'oublier rendait le conflit insoluble.
- **`push` refuse une base périmée** — le non-fast-forward de git : pousser écraserait le travail d'un autre sans que rien ne le dise.
- **Le calque local ne part jamais** : la sync lit `loadTree(dir, { withLocal: false })`. C'est la propriété qui a fait choisir un dossier séparé.
- **Le suivi est local**, comme `.git/` : `~/.contextree/tracking/<clé>.json`, clé sur le `realpath`. `.contextree/` ne contient que du markdown. `~/.contextree/` porte aussi `journal/`, `selection/`, `config.json` (url + clé anon) et `session.json` (jetons, en 0600) — surchargeable par `CONTEXTREE_STATE_DIR`.
- **`pull` écrit par renommage atomique** : un hook qui lit pendant un `pull` voit l'ancienne version ou la nouvelle, jamais un `.md` à moitié écrit.

Une version et ses branches partent en **deux appels** — PostgREST n'a pas de transaction multi-tables. Si le second échoue, la version reste sans branches : visible comme telle, et sans conséquence, puisque les versions sont immuables et n'écrasent personne.

## Ce qui vient ensuite (P7 à P9)

Décisions posées le 9 septembre 2026 pour les paliers P7 à P9. Le code de la phase 2 (`src/core/remote.ts`, `src/core/sync.ts`, `supabase/schema.sql`, `supabase/rls.test.sql`) est le point de départ ; il est testé par bouchons et par `npm run test:sql` (Docker), mais n'a **jamais été exercé contre un vrai projet Supabase**.

## L'invariant qui commande tout

**Le routage ne touche jamais le réseau.** Tout ce qui vient du serveur est **sur le disque** avant d'être chargé : `loadTree` ne lit que des dossiers de markdown. Le serveur est un remote façon git, pas une source consultée à chaque appel. Un backend mort ne coûte pas une milliseconde à un prompt (mesuré : 142 ms, identique). Ni `cmdHook` ni `router.ts` n'importent `remote.ts` — et ça reste vrai.

## Calques : de deux à N

`loadTree` superpose déjà deux calques — le groupe (`.contextree/`) et le calque personnel (`.contextree.local/`) —, le plus spécifique gagnant **champ par champ** (`materialize(raw, layer, under)`). On **généralise à une liste ordonnée** : `[montage₁, …, montageₙ, groupe, local]`, résolue de bas en haut, même règle. `Branch.layer` devient `'local' | 'group' | 'mount:<alias>'`. Rien ne change pour `withAncestors`, le routeur, le rendu ni les vues : ils reçoivent un arbre déjà résolu. `order` reste le parcours en profondeur alphabétique sur l'arbre résolu — contractuel.

## Montages

- Un **montage** rend un arbre distant visible sous un **alias** : ses branches vivent sous `alias/…` ; l'alias est un hub (type `context`) dont le corps est le `root.md` de l'arbre monté et dont le `load_when` vient du frontmatter de ce `root.md` (défaut : le nom de l'arbre). Seul le `root.md` de la copie de travail est « toujours injecté » ; un arbre monté est routé comme le reste — aucun calque privilégié, comme aucun type ne l'est.
- **Déclaration** dans le frontmatter de `root.md` : `mounts: acme/entreprise, acme/backend` (arbre du groupe, partagé par git) et dans `.contextree.local/root.md` (montages personnels, ex. `mounts: adrien/perso`). Union des deux, dans l'ordre écrit, ceux du local après ceux du groupe. Scalaire sur une ligne, virgules : le parseur de frontmatter ne change pas. Un `root.md` local qui déclare des montages ne remplace **pas** le corps du `root.md` du groupe s'il n'a pas de corps — c'est l'exception à « le root local l'emporte entièrement » : frontmatter et corps se résolvent séparément.
- **Cache** : `~/.contextree/cache/<treeId>/`, même format disque (markdown + frontmatter), écrit par `writeSnapshot`. Lisible et diffable à la main. Cache absent = montage absent, dit dans la trace (« montage acme/entreprise absent — lance contextree pull »), jamais une erreur.
- **Rafraîchissement** : `contextree pull` met à jour la copie de travail **et** tous ses montages, en une commande. En tâche de fond : le hook, une fois par session et seulement s'il existe un montage, lance `contextree pull-bg` détaché — même mécanique que `route-bg`, même contrat (silence, code 0, jamais devant le prompt).
- CLI : `contextree mount <groupe>/<arbre> [--as <alias>] [--local]`, `contextree unmount <alias>`, `contextree mounts`. `--local` écrit dans `.contextree.local/root.md`.

## Entrer dans un groupe (P7)

- **Compte** : `contextree signup <email>` sur GoTrue (`POST /auth/v1/signup`, mot de passe sur stdin comme `login`). La confirmation par mail se règle dans le projet Supabase (humain). Le `signup` crée aussi le **groupe personnel** de l'utilisateur (slug = la partie locale de l'e-mail, ou `--handle`), qui portera son arbre `perso` (P8).
- **Invitation par code, pas par e-mail** : chercher un utilisateur par e-mail est impossible sous RLS sans exposer `auth.users`. Table `invites (code, group_id, role, expires_at, created_by)` ; `contextree group invite <slug> [--role writer]` crée le code ; `contextree join <code>` appelle `accept_invite(code)` (`security definer`) qui insère la `membership` de l'appelant et consomme ou non le code selon `max_uses`. Un code se colle dans un chat, comme un jeton de pack.

## Visibilité (P8)

- `trees.visibility` : `private` (l'auteur seul — un brouillon, `trees.created_by`) · `group` (tous les membres, l'actuel) · `link` (quiconque connaît le `share_token`, via `tree_by_token(token)` en `security definer`) · `public` (tout compte connecté). Les politiques `trees_read`, `versions_read`, `branches_read` remontent jusqu'à `visibility` par `tree_group`/`version_group` — une fonction `can_read_tree(tid)` centralise la règle.
- **Annuaire** : une vue `directory` sur les arbres `public` — slug, nom, groupe, date de la dernière version, auteur. `contextree search <mots>`. La provenance est dans la vue dès le départ, pas ajoutée après.
- **Plusieurs arbres par personne** : l'arbre `perso` du groupe personnel, monté dans chaque projet via `.contextree.local/root.md` (`contextree mount <moi>/perso --local`). C'est un montage comme un autre.
- **Fork et amont** : un fork = `import --prefix` (copie éditable dans l'arbre) ou un montage (lecture seule). Le suivi = `upstream: { treeId, versionId }` dans le fichier de tracking ; `contextree upstream` montre le diff depuis cette version, avec la fusion à trois voies déjà écrite (`merge`, `sync.ts`).

## Hiérarchie d'entreprise (P9) — le pari, tranché

La même mécanique sert aux branches et aux entités : **une hiérarchie d'entités est une chaîne de montages**.

- `groups.parent_id`. `is_member(gid)` est vrai si membre de `gid` **ou d'un de ses ancêtres** : l'appartenance se propage vers le bas, jamais vers le haut. Ne pas être dans l'équipe A, c'est ne voir ni ses arbres ni son existence. `can_write` et `is_owner` suivent la même remontée.
- Chaque groupe peut avoir un **arbre de contexte de groupe** (`groups.context_tree_id`). Au `link` ou au `pull` d'un arbre du groupe G, les arbres de contexte de la chaîne racine → … → G sont montés **implicitement**, dans cet ordre, sous les montages explicites, avec pour alias le slug du groupe. Un projet hérite de son équipe, qui hérite de l'entreprise — la règle des ancêtres, un cran au-dessus.
- **Rôles** par nœud : `reader` (l'arbre est injecté), `writer` (pousse des versions), `owner` (membres, invitations, visibilité). Le *contributeur* = `reader` + le droit de **proposer** : une proposition est une version dont `parent_id` est la tête et dont `status = 'proposed'` ; un `writer`/`owner` la promeut ou la rejette (`contextree proposals`, `accept <id>`, `reject <id>`). `upsert_branch` sur un arbre où l'on n'est que contributeur produit une proposition au `push`. C'est la « proposition plutôt qu'écriture directe » de la phase 2, réduite à une colonne `status`.
- **Audit** : `versions` porte déjà `author_id` et `created_at` ; `contextree log [<groupe>/<arbre>]` les affiche, et `contextree diff <v1> <v2>` réutilise `outgoingDiff`.

## Ce qui reste hors

Temps réel, storage, edge functions, interface web, SDK Supabase. Tout passe par PostgREST + GoTrue en `fetch` — trois dépendances, toujours. Un serveur maison n'est pas prévu : si Supabase devait partir, c'est le schéma SQL et les politiques qu'on emporte.
