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

### Déplacer et renommer (`moveBranch`)

Renommer et reparenter sont la même opération : changer le `path`. Il vit à deux endroits sur le disque — le `.md` et le dossier homonyme qui porte les enfants — et les deux bougent ensemble.

- **Refusé** : une arrivée déjà occupée, un déplacement sous son propre descendant, un chemin qui sort du dossier (`..`, absolu, segment vide, antislash).
- **Deux renommages ne sont pas atomiques ensemble** : si le dossier des enfants échoue à bouger, le `.md` est remis en place. Mieux vaut un arbre inchangé qu'une branche séparée de ses enfants.
- **Le dossier de départ vidé est supprimé** : sinon il resterait un hub implicite — une branche fantôme, sans contenu ni enfants.
- **Un parent inconnu est refusé côté CLI et MCP**, pas côté cœur : la même règle que `add` / `upsert_branch`. Un hub fabriqué au passage aurait un `load_when` qui ne veut rien dire, et le routeur routerait dessus.

Ce que ça invalide : le cache de session et le journal des tours référencent des `path`, et filtrent déjà ceux qu'ils ne retrouvent pas — un chemin périmé disparaît, il ne casse rien. Un pack déjà exporté est un instantané : il garde les anciens chemins, c'est le comportement attendu.

## Routage (`src/core/router.ts`)

Un appel IA léger reçoit le catalogue des branches — index, type, titre, `load_when` — plus le message de l'utilisateur, et renvoie les indices retenus. Les indices 0-based évitent au modèle de recopier des chemins, source classique d'échec.

### Les moteurs, dans cet ordre (`pickEngine`)

Le routeur ne demande qu'un **tableau d'entiers** : n'importe quel modèle correct sait le rendre, donc rien ici n'est propre à Claude. Deux familles, et un ordre — une clé explicite (le chemin le plus court), sinon un CLI d'agent déjà authentifié sur la machine.

| Moteur | Quand | Latence mesurée |
|---|---|---|
| `anthropic` | une clé est là (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, ou passée en argument) | ~1 s, budget 2,5 s |
| `openai` | sinon, si `OPENAI_API_KEY` est posée — endpoint compatible OpenAI | ~1 s, budget 2,5 s |
| `claude`, `codex`, `gemini` | sinon, le premier binaire trouvé — **c'est l'abonnement de l'utilisateur** | 5 à 60 s (voir plus bas) |
| `none` | rien de tout ça : l'arbre entier est injecté, et `error` le dit | 0 |

**Personne ne devrait avoir à sortir une clé API** pour router son propre arbre alors que sa machine sait déjà parler à un modèle. Les moteurs CLI partagent la même mécanique (`CliSpec`) : prompt sur stdin — un catalogue d'arbre n'a rien à faire dans un `argv` — et process réduit au strict nécessaire.

- `claude -p` : `--tools ''`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, `--setting-sources ''` (donc **aucun hook** — sinon le routage relancerait le hook qui l'a appelé), `--no-session-persistence`, `--disable-slash-commands`, consigne système par `--system-prompt`.
- `codex exec - --sandbox read-only --skip-git-repo-check` : un routeur n'écrit rien, et tourne parfois hors d'un dépôt.
- `gemini` sans TTY : lit son prompt sur stdin et rend la main.

`CONTEXTREE_ROUTING=1` dans l'environnement du fils est le second garde-fou anti-récursion : `cmdHook` sort immédiatement s'il le voit.

**Le modèle n'est deviné pour personne.** `claude` route sur `haiku` (mesuré), les autres CLI partent sur le défaut de l'utilisateur sauf si `CONTEXTREE_ROUTER_MODEL` tranche : inventer un identifiant de modèle pour un CLI qu'on ne maîtrise pas, c'est un moteur qui échoue au premier appel.

Le moteur `openai` est **un `fetch`, pas un SDK** : la quatrième dépendance du projet ne se justifie pas pour trois lignes de POST, et le même dialecte couvre OpenAI, Groq, OpenRouter, Ollama et LM Studio (`OPENAI_BASE_URL`). Le corps est volontairement minimal — modèle et messages, rien d'autre : `temperature`, `max_tokens` et `response_format` sont refusés par une partie de ces endpoints (modèles de raisonnement, serveurs locaux), et c'est le timeout qui borne l'appel.

**Un moteur forcé n'est pas vérifié.** `CONTEXTREE_ROUTER=codex` sur une machine sans `codex` échoue et tombe dans le fallback — plutôt qu'un repli silencieux sur un moteur que l'utilisateur n'a pas demandé.

Deux détails payés par la mesure :

- **Pas de `--json-schema`** sur le chemin CLI : la sortie structurée y coûte un tour de plus et double la latence. On demande le tableau en toutes lettres et on garde un parseur tolérant — mais **strict sur le contenu** : un tableau qui n'est pas fait d'entiers n'est pas une réponse de routeur, c'est du texte avec des crochets, et on préfère le repli à une sélection vide obtenue en filtrant des chaînes. Comme un CLI d'agent préfixe volontiers sa réponse (bannière, horodatage, session), c'est le **dernier** tableau d'entiers de la sortie qui compte : la réponse est à la fin, le bruit est devant.
- **L'environnement est nettoyé** (`cleanEnv`) de tout `CLAUDE*` sauf `CLAUDE_CONFIG_DIR` : le hook tourne *dans* Claude Code, et le fils héritait sinon de `CLAUDE_EFFORT` — un routeur qui n'a rien à réfléchir se mettait à réfléchir. (`CLAUDE_CONFIG_DIR` reste : les identifiants de l'abonnement sont là.)

### Le hook ne l'attend pas : routage différé

Un moteur CLI est trop lent pour être mis devant un prompt. `cmdHook` ne l'attend donc **jamais** : le tour part avec la sélection du tour précédent (l'arbre entier au premier tour, `reason: 'deferred'`), et le routage de *ce* prompt part en tâche de fond — `contextree route-bg`, détaché, sans stdio, qui survit à la sortie du hook et n'écrit le cache de session que s'il a vraiment routé. Le tour suivant en profite. Mesuré : **hook à ~150 ms**, routage utile dès le deuxième prompt.

C'est le prix assumé : le routage est décalé d'un tour. Dans une conversation, deux prompts consécutifs portent presque toujours sur la même tâche — et un tour de retard coûte infiniment moins cher que 12 s d'attente avant chaque prompt. `CONTEXTREE_ROUTER_BLOCKING=1` rend l'attente à qui la préfère ; avec une clé API (moteur `anthropic` ou `openai`, ~1 s) le hook route en direct, sans différé.

### Les autres points de conception

- **Sortie structurée côté SDK** (`output_config.format` + JSON Schema) : là, elle est gratuite.
- **Pas de thinking, `effort: low`** : le routeur a un budget latence, pas un budget réflexion. Les deux pièges connus du mode thinking-off ne s'appliquent pas ici — aucun outil déclaré, et la sortie est contrainte par un schéma.
- **Fallback jamais vide, et jamais typé** (`withoutRouting`) : la sélection précédente (sticky, cache de session), sinon l'arbre entier. Aucun type n'est privilégié — un `identity` n'est pas plus « garanti » qu'un `reference`, c'est le `load_when` qui décide, ou personne. (Avant le 8 septembre 2026, le filet était `identity` + `rule` : une règle invisible qui décidait à la place du `load_when`, et qui faisait mentir la vue.)
- **Court-circuit ≤ 3 branches** : en dessous, l'aller-retour de routage coûte plus que d'injecter tout l'arbre.

Variables : `CONTEXTREE_ROUTER` (`auto` | `anthropic` | `openai` | `claude` | `codex` | `gemini` | `off` ; `sdk` et `cli` restent compris), `CONTEXTREE_ROUTER_MODEL` (défaut `claude-opus-5` sur clé Anthropic, `gpt-4o-mini` sur endpoint OpenAI, `haiku` sur le CLI `claude`, celui de l'utilisateur ailleurs), `CONTEXTREE_ROUTER_TIMEOUT_MS` (défaut `2500` sur API, `20000` en CLI), `CONTEXTREE_ROUTER_BLOCKING`, `OPENAI_API_KEY` / `OPENAI_BASE_URL`, `CONTEXTREE_CLAUDE_BIN`.

> **Choix de modèle à trancher.** Le défaut sur clé Anthropic est `claude-opus-5`. Pour un routeur appelé à chaque prompt, un modèle plus petit (`claude-haiku-4-5`, `claude-sonnet-5`) diviserait le coût et la latence — la tâche est une classification sur un catalogue court. À arbitrer en mesurant la qualité de sélection sur de vrais prompts avant de changer le défaut. (Le moteur CLI, lui, est déjà sur `haiku`.)

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

### Les autres agents (`src/install.ts`)

Tous les agents n'ont pas de hook. Trois surfaces, par ordre de qualité — c'est l'ordre dans lequel on câble :

| Surface | Où | Qualité |
|---|---|---|
| Hook par prompt | `.claude/settings.json` | **déterministe** — l'agent ne décide de rien |
| Serveur MCP | `.mcp.json`, `~/.codex/config.toml` | portable, mais l'agent doit vouloir appeler `get_context` |
| Fichier de consignes | `AGENTS.md` | dernier recours, pour qui n'a ni l'un ni l'autre |

**Codex** n'a pas d'équivalent de `UserPromptSubmit` : il reçoit le serveur MCP (`[mcp_servers.contextree]` ajouté **à la fin** de `~/.codex/config.toml` — pas de parseur TOML, ce serait la 4e dépendance pour six lignes, et une table finale ne peut être avalée par aucune table précédente) et un bloc dans `AGENTS.md`.

**Ce bloc n'est jamais l'arbre entier** (`renderAgentsBlock`) : la racine, plus le catalogue — titre et `load_when`, les mêmes lignes que lit le routeur — et la consigne d'appeler `get_context` pour le reste. Y déverser le contenu des branches reconstituerait exactement le gros fichier de consignes que contextree existe pour remplacer. Le bloc est borné par `<!-- contextree:start -->` / `<!-- contextree:end -->`, remplacé à l'identique d'une resynchronisation à l'autre, et ce qui est dehors appartient à l'utilisateur.

**Les agents sans aucune surface** (Claude sur le web, ChatGPT, un chat quelconque) : on ne peut rien y installer, mais on peut coller. `contextree render --copy` met l'arbre entier dans le presse-papier, `contextree route "<demande>" --copy` seulement la fraction routée, `contextree render --agents` le bloc court. C'est le même bloc que partout ailleurs — surtout pas un format de plus.

Un jeton d'export (`export --token`) **n'est pas** une réponse ici : c'est du base64 compressé, fait pour greffer un arbre dans une autre installation de contextree, illisible pour un modèle.

Ce qui est câblé hors du projet (le home de l'utilisateur) ne l'est **que si l'agent est détecté**, ou nommé par `--agent` : écrire dans le `~` de quelqu'un qui n'utilise pas l'outil serait une surprise, pas un service.

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

Par tour : horodatage, extrait du prompt (200 caractères, mis à plat), branches retenues, `reason` (`routed` / `all` / `fallback` / `deferred` — c'est lui l'indicateur de repli, pas un booléen en double), `source` (`hook` ou `mcp`) et l'erreur du routeur s'il y en a eu une.

- **Séparé du cache sticky.** `session.ts` a un contrat dont dépend le fallback du tour suivant : un journal corrompu ne doit jamais pouvoir abîmer le routage.
- **Clé par dossier d'arbre, pas par session.** Un arbre, un journal, toutes sessions confondues — la vue ne connaît pas le `session_id` et n'a pas à deviner quel fichier lire.
- **Les deux chemins écrivent** : `cmdHook` (Claude Code) et `get_context` (chat de Cursor et autres clients MCP). Sans les deux, la vue est aveugle la moitié du temps.
- **50 derniers tours**, écriture par fichier temporaire renommé — un lecteur ne tombe jamais sur un JSON à moitié écrit.
- **`appendTurn` ne rejette jamais.** Même invariant que le hook : écrire le journal ne peut pas bloquer un prompt.

Côté vue (`extension/src/turn.ts`), le journal alimente deux choses, à partir de la même lecture — elles ne peuvent donc pas se contredire :

- **la barre latérale** — un `FileDecorationProvider` pose une pastille `•` sur les `.md` lus au dernier tour, **sans couleur** : `FileDecoration.color` teint le libellé entier, et une moitié d'arbre colorée se lit comme une alerte alors qu'il ne s'est rien passé d'anormal. Le titre de la vue porte l'état (`4/9 · routé`), c'est là que se lit la différence entre un routage et un repli. Décorateur de *fichier* et pas couleur d'icône : la même marque apparaît dans l'explorateur et sur l'onglet ouvert. (Il a remplacé le badge de barre d'état le 8 septembre 2026 : personne ne regarde en bas à droite.)
- **la toile** — un **point dans la couleur du type** sur les cartes lues, à côté du badge ; le reste de l'arbre est intact. En repli, le point perd sa couleur de type et passe au gris.

Deux marches manquées avant d'arriver là, le 8 septembre 2026, et elles disent la même chose : **une lecture est un fait ordinaire, pas un événement.** Estomper le non-lu (opacité 0,32) rendait illisible la moitié de l'arbre — or c'est justement dans les branches *non* lues qu'on va corriger un `load_when`. Puis l'entourer de rouge criait pour rien. Un point dans une couleur déjà présente se remarque sans agresser, et n'ajoute rien à la palette.

La toile porte deux surlignages, jamais mélangés : le **dernier tour** (le journal, permanent) et la **sonde** (« que chargerait le routeur pour ce prompt ? », à la demande). La sonde l'emporte tant qu'elle est active ; ✕ ou Échap rend la toile au dernier vrai tour — on ne peut pas effacer un fait, seulement une question.

L'observateur du journal est **non récursif** (`*.json` sur le dossier), seul motif que VS Code supporte hors du dossier ouvert. C'est lui qui fait bouger le surlignage pendant une conversation : aucun `.md` ne change quand un tour est routé.

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

## Pièges connus

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après le `connect()`.
- **Un dossier sans `.md` frère** était invisible avant le hub implicite. Si on retouche `walk()`, garder ce comportement.
- **L'ordre des branches est contractuel** : les indices envoyés au routeur en dépendent. `order` est un parcours en profondeur alphabétique — le rendre instable casserait silencieusement le routage.
- **Le cache de session vit dans `os.tmpdir()`**, pas dans le repo : c'est de l'état, pas du contenu. Il n'est jamais une dépendance — s'il disparaît, on perd juste la stickiness du fallback.
- **`os.tmpdir()` n'est pas le même des deux côtés.** Le transport stdio du SDK MCP lance le serveur avec un environnement nettoyé — `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`, mais **pas** `TMPDIR`. Le serveur retombe donc sur `/tmp` pendant que le hook écrit dans le `/var/folders/…` de la session. D'où le journal ancré sur `~/.contextree/journal/` (surchargeable par `CONTEXTREE_STATE_DIR`) : tout état que les deux chemins doivent partager doit l'être aussi. Le cache sticky, lui, n'a qu'un seul écrivain et peut rester dans `tmpdir`.
