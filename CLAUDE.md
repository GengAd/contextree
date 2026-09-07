# contextree — carte de navigation

**contextree** fait une seule chose : maintenir un **arbre de contexte** — de petites branches typées (identité, règles, contexte, références, skills) — et n'injecter **que les branches pertinentes** à chaque appel IA. Comme un `CLAUDE.md`, mais routé : la bonne fraction, pas tout le fichier.

Adrien Buot — développeur solo, TypeScript. Repo privé `GengAd/contextree`, package npm `@gengad/contextree`.

## Règles

- Lire ce fichier en premier sur chaque nouvelle tâche.
- **Une seule idée dans ce repo** : l'arbre de contexte. Toute feature qui n'améliore pas le routage, l'édition ou le partage de l'arbre est hors sujet — le dire plutôt que la coder.
- Ne pas créer de fichier `.md` à la racine sans demander.
- `npm test` (build + tests) doit passer avant de valider.
- Le **hook ne bloque jamais un prompt** : toute erreur sort en code 0 et silence. C'est l'invariant non négociable.
- Le **routage ne bloque jamais l'appel principal** : erreur ou timeout ⇒ fallback `identity` + `rule`, jamais un ensemble vide.
- Les **fichiers markdown sont la source de vérité**. Rien ne doit rendre `.contextree/` illisible ou non éditable à la main.
- Garder la doc vivante : proposer les mises à jour de `CLAUDE.md` / `CONTEXT.md` / `REFERENCES.md` / `ROADMAP.md`, ne jamais réécrire en silence.

## Workflow Trello

- Prendre les tâches dans cet ordre : d'abord la colonne **En cours**, et seulement si elle est vide, la colonne **À faire**.
- Une tâche terminée se **commit** avant de passer à la suivante : pas de tâche Trello close sans commit correspondant.
- Déplacer la carte dans la colonne suivante une fois le commit fait.

## Routing

| Tâche | Aller dans | Lire |
|---|---|---|
| Format de fichier, chargement de l'arbre | `src/core/store.ts` | `REFERENCES.md` § Format |
| Moteur de routage, prompt du routeur, fallback | `src/core/router.ts` | `REFERENCES.md` § Routage |
| Journal des tours (ce qui a été chargé) | `src/core/journal.ts` | `REFERENCES.md` § Journal |
| Bloc injecté, ordre des sections | `src/core/render.ts` | `REFERENCES.md` § Injection |
| Serveur MCP, outils exposés | `src/mcp/server.ts` | `REFERENCES.md` § MCP |
| CLI, hook Claude Code, installation | `src/cli.ts`, `src/install.ts` | `REFERENCES.md` § Hook |
| Partage (export/import) | `src/core/pack.ts` | `ROADMAP.md` § Phase 1 |
| Vue de l'arbre dans VS Code (barre latérale) | `extension/src/treeProvider.ts` | `extension/package.json` § contributes |
| Badge de barre d'état, dernier tour chargé | `extension/src/statusBar.ts` | `REFERENCES.md` § Journal |
| Toile 2D de l'arbre (webview) | `extension/src/canvasPanel.ts`, `extension/media/` | — |
| Ce qu'on construit et pourquoi | racine | `CONTEXT.md` |
| Ce qui vient après (groupes, orgs) | racine | `ROADMAP.md` |

## Conventions

- Modules `camelCase.ts`, types dans `src/core/types.ts` uniquement.
- Textes CLI et docs en français ; identifiants, noms d'outils MCP et clés de frontmatter en anglais (ils sont lus par des machines et par des tiers).
- Pas de dépendance ajoutée sans discussion : le projet en a trois (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`) et ça doit rester inconfortable d'en ajouter une quatrième.

## Commandes

```bash
npm run build      # tsc -b
npm run typecheck  # validation rapide
npm test           # build + tests unitaires
node dist/cli.js route "<prompt>"   # voir ce que le routeur chargerait
npm run build:ext  # compile l'extension VS Code (barre latérale + toile 2D)
```
