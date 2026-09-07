# Références — contextree

Stack, format, mécanique, pièges. À lire quand on touche au code.

## Stack

| | |
|---|---|
| Runtime | Node ≥ 20, ESM, TypeScript strict (`NodeNext`) |
| Dépendances | `@anthropic-ai/sdk` (routeur), `@modelcontextprotocol/sdk` (serveur MCP), `zod` (schémas des outils MCP) |
| Tests | `node:test` sur le build (`tests/*.test.js` → `dist/`) |
| Distribution | `npx @gengad/contextree` — pas d'install globale requise |

Le frontmatter, la compression des packs et le cache de session sont faits main sur des modules Node (`zlib`, `crypto`, `os`) : trois dépendances, c'est le budget.

## Format sur disque

```
.contextree/
  root.md                 # hub racine — toujours injecté, jamais routé
  identite.md             # une branche
  architecture.md
  architecture/           # ses enfants (même nom que le fichier, sans .md)
    commandes.md
    endpoints.md
```

**Deux axes indépendants** : le **parent** vient de l'arborescence de dossiers, le **type** du frontmatter. C'est ce qui permet d'avoir un `reference` sous un `context` sans que le rangement dicte la sémantique.

````markdown
---
type: reference
title: Commandes
load_when: quand il faut lancer, tester ou builder le projet
---

```bash
npm test
```
````

- `type` — `identity` | `rule` | `context` | `reference` | `skill`. Défaut `context`.
- `title` — titre lisible ; devient le `### heading` dans le bloc injecté. Défaut : le slug.
- `load_when` — **le signal de routage**. Une condition, pas un résumé. Défaut : le titre.

Le parseur de frontmatter (`src/core/frontmatter.ts`) n'accepte que des scalaires `clé: valeur` sur une ligne — pas de YAML complet, volontairement : assez simple pour être écrit à la main, assez strict pour ne jamais surprendre.

**Un dossier sans `.md` frère devient un hub implicite** (branche vide de type `context`). Ça évite le piège où l'on range des fichiers dans `.contextree/equipe/` et où rien ne se charge.

**`findTreeDir` remonte l'arborescence** comme `.git` : on peut lancer la CLI depuis n'importe quel sous-dossier.

### Le calque local

Le calque personnel est un **dossier frère**, `.contextree.local/`, de format identique — pas un champ `overrides:` dans le frontmatter (tranché le 7 septembre 2026). Il est gitignoré : il n'est à personne d'autre.

```
.contextree/              # au groupe : versionné, synchronisé
  archi-store.md
.contextree.local/        # à moi : jamais poussé, gitignorable
  archi-store.md          # surcharge la branche du groupe
  mes-raccourcis.md       # branche purement locale
```

Résolution : **même chemin des deux côtés ⇒ le local gagne** ; chemin qui n'existe qu'en local ⇒ il s'ajoute.

**La résolution est faite au chargement (`loadTree`), pas au rendu.** Le routeur lit les `load_when` avant que quoi que ce soit ne soit rendu : s'il voyait celui du groupe pendant que le rendu injecte le contenu local, il routerait sur une branche et chargerait l'autre. Résoudre au chargement donne en plus l'arbre superposé à tout le reste — `withAncestors`, `formatTree`, la barre latérale, la toile — sans qu'aucun n'ait à savoir qu'il y a deux dossiers.

**La surcharge est champ par champ** : un champ absent du fichier local retombe sur celui du groupe. C'est ce qui permet de ne surcharger qu'un `load_when` sans recopier le corps, et ce qui fait qu'un dossier local simplement porteur d'enfants (hub implicite, donc vide) n'efface pas la branche de groupe correspondante. Un `root.md` local l'emporte entièrement, sinon c'est celui du groupe.

Chaque branche porte son `layer` (`group` ou `local`) : `fileForBranch(tree, path)` ouvre le fichier du bon dossier — une branche surchargée s'édite dans le calque, pas dans l'arbre du groupe — et les vues l'affichent (`[context · local]` dans `contextree list`, `context · local` dans la barre latérale).

**L'ordre reste contractuel.** Fusionner deux dossiers oblige à reconstruire le parcours en profondeur alphabétique : `compareBranchPaths` compare segment par segment, parce qu'un tri lexicographique nu se tromperait — `-` (0x2D) passe avant `/` (0x2F), donnant `a`, `a-b`, `a/b` au lieu de `a`, `a/b`, `a-b`. Les indices envoyés au routeur en dépendent.

La raison est la sync, pas le diff. Un champ dans le frontmatter mettrait des données personnelles **dans** des fichiers appartenant au groupe : `push` devrait les filtrer fichier par fichier (une passe ratée pousse des notes personnelles), et le moindre réglage personnel salirait un fichier partagé, candidat au conflit au `pull` suivant. Deux dossiers rendent ces problèmes impossibles par construction — `push` n'envoie que `.contextree/`, et le calque local ne peut pas entrer en conflit. Voir `ROADMAP.md` § Phase 2.

### Déplacer et renommer (`moveBranch`)

Renommer et reparenter sont la même opération : changer le `path`. Il vit à deux endroits sur le disque — le `.md` et le dossier homonyme qui porte les enfants — et les deux bougent ensemble.

- **Refusé** : une arrivée déjà occupée, un déplacement sous son propre descendant, un chemin qui sort du dossier (`..`, absolu, segment vide, antislash).
- **Deux renommages ne sont pas atomiques ensemble** : si le dossier des enfants échoue à bouger, le `.md` est remis en place. Mieux vaut un arbre inchangé qu'une branche séparée de ses enfants.
- **Le dossier de départ vidé est supprimé** : sinon il resterait un hub implicite — une branche fantôme, sans contenu ni enfants.
- **Un parent inconnu est refusé côté CLI et MCP**, pas côté cœur : la même règle que `add` / `upsert_branch`. Un hub fabriqué au passage aurait un `load_when` qui ne veut rien dire, et le routeur routerait dessus.

Ce que ça invalide : le cache de session et le journal des tours référencent des `path`, et filtrent déjà ceux qu'ils ne retrouvent pas — un chemin périmé disparaît, il ne casse rien. Un pack déjà exporté est un instantané : il garde les anciens chemins, c'est le comportement attendu.

## Routage (`src/core/router.ts`)

Un appel IA léger reçoit le catalogue des branches — index, type, titre, `load_when` — plus le message de l'utilisateur, et renvoie les indices retenus. Les indices 0-based évitent au modèle de recopier des chemins, source classique d'échec.

Points de conception, chacun payé par une leçon :

- **Sortie structurée** (`output_config.format` + JSON Schema) : le routeur ne peut pas renvoyer autre chose qu'un tableau d'entiers. Le parseur reste tolérant (tableau nu, JSON encadré de texte) au cas où un modèle ou un proxy n'appliquerait pas le schéma.
- **Pas de thinking, `effort: low`** : le routeur a un budget latence, pas un budget réflexion. Les deux pièges connus du mode thinking-off ne s'appliquent pas ici — aucun outil déclaré, et la sortie est contrainte par un schéma.
- **Timeout 2,5 s, `maxRetries: 0`** : au-delà, on tombe en fallback. L'appel principal ne doit jamais attendre après le routeur.
- **Fallback jamais vide** : sélection précédente (sticky, cache de session) + `identity` + `rule`, ancêtres inclus. Un échec transitoire ne doit pas retirer d'un coup le contexte que le tour d'avant avait.
- **Court-circuit ≤ 3 branches** : en dessous, l'aller-retour de routage coûte plus que d'injecter tout l'arbre.
- **Pas de garde sur `ANTHROPIC_API_KEY`** : le SDK résout aussi `ANTHROPIC_AUTH_TOKEN` et les profils `ant auth login`. Une absence d'identifiants remonte comme n'importe quelle autre erreur, et tombe dans le même fallback.

Variables : `CONTEXTREE_ROUTER_MODEL` (défaut `claude-opus-5`), `CONTEXTREE_ROUTER_TIMEOUT_MS` (défaut `2500`).

> **Choix de modèle à trancher.** Le défaut est `claude-opus-5`. Pour un routeur appelé à chaque prompt, un modèle plus petit (`claude-haiku-4-5`, `claude-sonnet-5`) diviserait le coût et la latence — la tâche est une classification sur un catalogue court. À arbitrer en mesurant la qualité de sélection sur de vrais prompts avant de changer le défaut.

## Injection (`src/core/render.ts`)

Le bloc est encadré par `<contextree>…</contextree>` et assemblé dans cet ordre :

1. le contenu de `root.md` (toujours),
2. `## Rules` — les branches `identity` et `rule` retenues,
3. `## Context` — tout le reste.

Les règles passent avant le contexte parce que ce sont des contraintes : le modèle doit les avoir en tête avant de lire la doc de domaine. Chaque branche devient `### <title>` suivi de son corps.

`renderTrace` produit la ligne de transparence (nombre de branches, lesquelles, routé/fallback/tout). Le hook l'écrit sur stderr, l'outil MCP en commentaire HTML. **Jamais de boîte noire** — c'est un engagement produit, pas un détail de debug.

## Hook Claude Code (`src/cli.ts` → `cmdHook`)

`contextree hook` lit le payload JSON du hook `UserPromptSubmit` sur stdin (`prompt`, `cwd`, `session_id`) et écrit le bloc de contexte sur **stdout**, qui est ajouté au contexte du tour.

**Invariant : ne jamais bloquer un prompt.** Tout est enveloppé dans un `try` qui avale l'erreur et sort en code 0. Un contexte manquant est un désagrément ; un prompt bloqué est une panne.

C'est le seul chemin *déterministe* : il ne dépend pas de la décision de l'agent d'appeler un outil. Le serveur MCP est le chemin *portable*. Les deux lisent le même arbre et le même routeur.

`contextree install` fusionne les entrées dans `.mcp.json` et `.claude/settings.json` — jamais d'écrasement, idempotent, et on ne touche pas à une entrée existante qui ne vient pas de nous.

## MCP (`src/mcp/server.ts`)

Transport stdio. Sept outils : `get_context`, `list_branches`, `read_branch`, `upsert_branch`, `delete_branch`, `export_pack`, `import_pack`.

Le champ `instructions` du serveur dit à l'agent quand appeler `get_context` et l'invite à capitaliser via `upsert_branch` — c'est le levier « participatif » côté conversation.

**L'arbre est relu à chaque appel d'outil** : les fichiers sont la source de vérité et l'utilisateur peut les éditer pendant que le serveur tourne.

## Partage (`src/core/pack.ts`)

Un `ContextPack` est un objet plat autonome (`v: 1`, `rootContent`, `branches[]` avec `parent` explicite). Trois véhicules, aucun backend :

- **git** — la source de vérité étant du markdown, committer `.contextree/` suffit ;
- **fichier JSON** — `contextree export -o pack.json` ;
- **jeton compressé** — `contextree export --token` : deflate + base64url, collable dans un chat.

`applyPack` valide chaque chemin (`..` et chemins absolus refusés — un pack vient de quelqu'un d'autre) et accepte un `prefix` pour isoler les branches importées sous un hub.

## Journal des tours (`src/core/journal.ts`)

Ce qui a été chargé, tour après tour — la donnée que `renderTrace` envoyait sur `stderr`, gardée pour que la vue puisse montrer ce qui a **réellement** servi.

Par tour : horodatage, extrait du prompt (200 caractères, mis à plat), branches retenues, `reason` (`routed` / `all` / `fallback` — c'est lui l'indicateur de repli, pas un booléen en double), `source` (`hook` ou `mcp`) et l'erreur du routeur s'il y en a eu une.

- **Séparé du cache sticky.** `session.ts` a un contrat dont dépend le fallback du tour suivant : un journal corrompu ne doit jamais pouvoir abîmer le routage.
- **Clé par dossier d'arbre, pas par session.** Un arbre, un journal, toutes sessions confondues — la vue ne connaît pas le `session_id` et n'a pas à deviner quel fichier lire.
- **Les deux chemins écrivent** : `cmdHook` (Claude Code) et `get_context` (chat de Cursor et autres clients MCP). Sans les deux, la vue est aveugle la moitié du temps.
- **50 derniers tours**, écriture par fichier temporaire renommé — un lecteur ne tombe jamais sur un JSON à moitié écrit.
- **`appendTurn` ne rejette jamais.** Même invariant que le hook : écrire le journal ne peut pas bloquer un prompt.

Côté vue (`extension/src/statusBar.ts`), le journal alimente deux choses, à partir de la même lecture — elles ne peuvent donc pas se contredire :

- **la barre d'état** — `contextree · 4/9 branches`, clic pour ouvrir la toile. Une extension ne peut rien afficher dans le fil de conversation de Cursor ou de Claude Code : c'est le seul endroit à la fois permanent et jamais dans le chemin. Un repli passe l'icône en `$(warning)` et le fond en `statusBarItem.warningBackground` — un repli doit se voir, pas se lire ;
- **la toile** — les branches du dernier tour en `●`, les autres estompées, l'extrait du prompt dans le bandeau. En repli, les cartes allumées perdent leur couleur de type : ce sont les branches garanties, pas un choix.

La toile porte deux surlignages, jamais mélangés : le **dernier tour** (le journal, permanent) et la **sonde** (« que chargerait le routeur pour ce prompt ? », à la demande). La sonde l'emporte tant qu'elle est active ; ✕ ou Échap rend la toile au dernier vrai tour — on ne peut pas effacer un fait, seulement une question.

L'observateur du journal est **non récursif** (`*.json` sur le dossier), seul motif que VS Code supporte hors du dossier ouvert. C'est lui qui fait bouger le badge pendant une conversation : aucun `.md` ne change quand un tour est routé.

## Édition de la structure depuis la vue (`extension/src/edit.ts`)

Créer, renommer, changer le type, déplacer, supprimer. Le **contenu** reste édité dans le `.md` qui s'ouvre à côté — c'est la ligne de `perimetre.md` : ces cinq opérations-là ne se font pas en ouvrant un fichier, ce sont des opérations sur des fichiers et des dossiers.

Une seule implémentation, deux appelants : le menu contextuel de la barre latérale et les boutons de la carte ouverte sur la toile. Tout passe par `runEdit(op, target)` dans `extension.ts`, qui relit l'arbre juste avant (les `.md` sont la source de vérité et ont pu changer) et recharge les vues après.

- **Le protocole webview → extension porte des écritures**, pas seulement des ouvertures : la toile envoie `{type:'edit', op, path}`. C'est la couture prévue pour que l'édition du contenu vienne s'y brancher sans réécrire l'existant.
- **`load_when` est demandé à la création**, pas plus tard : c'est le seul champ que le modèle ne peut pas deviner, et sans lui la branche ne sera jamais routée.
- **Renommer change le titre.** Le fichier ne suit que si son nom venait du titre précédent ; un slug choisi à la main n'est pas touché. Le `path` est l'identité d'une branche — on ne le change pas dans le dos de qui l'a écrit.
- **Supprimer est toujours confirmé**, avec le nombre d'enfants qui partent avec.
- Les commandes de branche sont masquées de la palette (`commandPalette` / `when: false`) : elles ont besoin d'une branche sélectionnée, que seul le menu contextuel fournit.

Il n'y a **pas** de commande « recharger l'arbre » : l'observateur le fait déjà, et un bouton qui refait ce qui se fait tout seul est du bruit. L'observateur porte sur le dossier **réellement trouvé** par `findTreeDir`, pas sur le dossier ouvert — un `.contextree/` au-dessus de la racine du workspace était sinon jamais rechargé. Le motif `**/*.md` reste complexe, donc récursif même hors du dossier ouvert. Tant qu'aucun arbre n'existe, on retombe sur `**/.contextree/**/*.md` dans le workspace : c'est ce qui rattrape un `contextree init` fait après coup, et l'observateur bascule tout seul.

## Écriture de l'IA dans l'arbre (`AiWrite`)

Régime assumé depuis le 7 septembre 2026 : l'IA écrit directement, sans validation préalable. Le garde-fou est la **visibilité**, pas l'interdiction — parce que la boucle est fermée. L'IA écrit dans l'arbre qui lui est ensuite réinjecté ; un arbre qui se remplit de branches approximatives fait charger trop au routeur, et le contexte devient du bruit auto-produit que rien ne signale.

Trois mécanismes, tous nécessaires :

- **`why` est un paramètre obligatoire** de `upsert_branch` et `delete_branch` (optionnel sur `move_branch`, qui est du rangement). Une écriture sans raison énoncée n'est pas possible.
- **L'annonce** : le texte que renvoie l'outil demande explicitement au modèle de dire ce qu'il vient d'écrire et pourquoi, et les `instructions` du serveur posent la règle — écrire en silence est la seule façon de mal faire.
- **La trace** : chaque écriture est journalisée (`appendAiWrite`, 100 dernières), et les deux vues la montrent pendant `FRESH_MS` (15 min) — pastille `IA il y a 2 min` et icône colorée dans la barre latérale, liseré et `✎` sur la carte de la toile, le `why` dans l'infobulle. Un battement d'une minute fait vieillir puis disparaître la pastille : rien sur le disque ne change quand une écriture vieillit, et il ne tourne que tant qu'il reste quelque chose à afficher.

`import_pack` n'est pas tracé : c'est une greffe en masse, annoncée par nature, pas une capitalisation au fil de l'eau.

## Backend partagé (`supabase/schema.sql`, `src/core/remote.ts`)

Phase 2, étape 1. **Supabase est un service, pas une dépendance** : son API est du HTTP simple (PostgREST pour les données, GoTrue pour l'auth) et Node 20 a `fetch` en global. On n'a besoin ni du temps réel, ni du storage, ni des edge functions — le projet reste à trois dépendances.

**Rien de tout ça n'est sur le chemin du routage.** Ni `cmdHook` ni `router.ts` n'appellent `remote.ts` : un backend injoignable ne doit pas coûter une milliseconde à un prompt. Mesuré avec un backend configuré et mort : 142 ms par tour, identique à sans.

### Le schéma

Trois idées :

- **Une version est un ensemble de branches, pas un blob.** `versions` porte l'instantané, `branches` ses lignes — colonnes identiques à `Branch`. C'est ce qui permettra à `pull` de dire *quelle* branche a changé et à `push` de refuser un conflit sur une branche précise.
- **Une version est immuable**, et ça s'entend : un déclencheur `before update` lève une erreur. L'absence de politique RLS suffirait à empêcher l'écriture, mais *silencieusement* — zéro ligne touchée, aucun message, un client qui croit avoir réécrit l'histoire. Le `delete`, lui, reste gouverné par RLS seule : un déclencheur casserait le `on delete cascade` qui permet de supprimer un arbre entier.
- **L'autorisation est dans la base.** Le client n'a que la clé anon, publique par construction. Les fonctions `is_member` / `can_write` / `is_owner` sont `security definer` — obligatoire, sinon une politique sur `memberships` qui lit `memberships` récurse.

Un trigger fait de l'auteur d'un groupe son `owner` : sans lui, personne ne peut s'ajouter à un groupe qu'il vient de créer.

### Le vérifier

```bash
npm run test:sql      # Docker requis, donc hors de `npm test`
```

`supabase/rls.test.sql` rejoue le schéma sur un Postgres nu et déroule un scénario à deux comptes : création de groupe, filiation des versions, immuabilité, cloisonnement (un non-membre ne voit même pas l'`id` du groupe), lecture sans écriture, promotion en `writer`, et refus de signer une version au nom d'un autre. Le test bascule sur un rôle non privilégié — RLS ne s'applique pas au propriétaire des tables, et l'oublier ne testerait rien.

### Sync (`src/core/sync.ts`)

`contextree link <groupe>/<arbre> [--create]`, `pull`, `push -m "…"`, `status`.

Le modèle est **git, pas Dropbox**. La copie de travail se souvient de la version dont elle descend — la *base* — et c'est ce qui rend un conflit détectable : trois états à comparer, jamais deux. La table de vérité tient en quatre lignes :

| base → distant | base → local | résultat |
|---|---|---|
| a bougé | inchangé | on prend le distant |
| inchangé | a bougé | on garde le local |
| a bougé | a bougé pareil | rien à faire |
| a bougé | a bougé autrement | **conflit** |

- **Un conflit n'écrit rien.** `pull` liste les branches concernées et s'arrête ; le disque et la base suivie ne bougent pas.
- **Il faut pouvoir en sortir.** Une version réglée à la main diffère par construction du distant *et* de la base : un `pull` nu la redétecterait indéfiniment. On règle les `.md`, puis on tranche en une fois — `pull --mine` ou `pull --theirs`. C'est le seul moyen, et l'oublier rendait le conflit insoluble.
- **`push` refuse une base périmée** (le non-fast-forward de git) : pousser écraserait le travail d'un autre sans que rien ne le dise.
- **Le calque local ne part jamais** : la sync lit `loadTree(dir, { withLocal: false })`. C'est la propriété qui a fait choisir un dossier séparé.
- **Le suivi est local**, comme `.git/` : `~/.contextree/tracking/<clé>.json`, clé sur le `realpath`. `.contextree/` ne contient que du markdown.
- **`pull` écrit par renommage atomique** (`writeBranch`, `writeRoot`) : un hook qui lit pendant un `pull` voit l'ancienne version ou la nouvelle, jamais un `.md` à moitié écrit. C'est la forme concrète de l'invariant « ni `pull` ni `push` ne peuvent casser un prompt en cours ».

Une version et ses branches partent en deux appels — PostgREST n'a pas de transaction multi-tables. Si le second échoue, la version reste sans branches : visible comme telle, et sans conséquence, puisque les versions sont immuables et n'écrasent personne.

### L'état local

`~/.contextree/` (surchargeable par `CONTEXTREE_STATE_DIR`) porte `journal/`, `tracking/` (à quel arbre distant chaque copie de travail se rattache), `config.json` (url + clé anon) et `session.json` (jetons, en 0600). Rien de tout ça dans le repo.

## Pièges connus

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après le `connect()`.
- **Un dossier sans `.md` frère** était invisible avant le hub implicite. Si on retouche `walk()`, garder ce comportement.
- **L'ordre des branches est contractuel** : les indices envoyés au routeur en dépendent. `order` est un parcours en profondeur alphabétique — le rendre instable casserait silencieusement le routage.
- **Le cache de session vit dans `os.tmpdir()`**, pas dans le repo : c'est de l'état, pas du contenu. Il n'est jamais une dépendance — s'il disparaît, on perd juste la stickiness du fallback.
- **`os.tmpdir()` n'est pas le même des deux côtés.** Le transport stdio du SDK MCP lance le serveur avec un environnement nettoyé — `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`, mais **pas** `TMPDIR`. Le serveur retombe donc sur `/tmp` pendant que le hook écrit dans le `/var/folders/…` de la session. D'où le journal ancré sur `~/.contextree/journal/` (surchargeable par `CONTEXTREE_STATE_DIR`) : tout état que les deux chemins doivent partager doit l'être aussi. Le cache sticky, lui, n'a qu'un seul écrivain et peut rester dans `tmpdir`.
