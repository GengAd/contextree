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

## Pièges connus

- **`process.exit` tue le serveur MCP.** La CLI sort en `process.exit(code)` ; la branche `mcp` ne rend donc jamais la main (`await new Promise(() => {})`). Sans ça, le serveur se coupe juste après le `connect()`.
- **Un dossier sans `.md` frère** était invisible avant le hub implicite. Si on retouche `walk()`, garder ce comportement.
- **L'ordre des branches est contractuel** : les indices envoyés au routeur en dépendent. `order` est un parcours en profondeur alphabétique — le rendre instable casserait silencieusement le routage.
- **Le cache de session vit dans `os.tmpdir()`**, pas dans le repo : c'est de l'état, pas du contenu. Il n'est jamais une dépendance — s'il disparaît, on perd juste la stickiness du fallback.
- **`os.tmpdir()` n'est pas le même des deux côtés.** Le transport stdio du SDK MCP lance le serveur avec un environnement nettoyé — `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`, mais **pas** `TMPDIR`. Le serveur retombe donc sur `/tmp` pendant que le hook écrit dans le `/var/folders/…` de la session. D'où le journal ancré sur `~/.contextree/journal/` (surchargeable par `CONTEXTREE_STATE_DIR`) : tout état que les deux chemins doivent partager doit l'être aussi. Le cache sticky, lui, n'a qu'un seul écrivain et peut rester dans `tmpdir`.
