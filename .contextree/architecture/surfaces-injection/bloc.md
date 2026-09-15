---
type: reference
title: Le bloc injecté et les fichiers de consignes
load_when: quand on touche au bloc <contextree> (ordre des sections, catalogue, rappel d'écrire), au bloc d'AGENTS.md / copilot-instructions.md / GEMINI.md, ou à sa resynchronisation quand l'arbre change
---

## Le bloc injecté (`renderContext`)

Encadré par `<contextree>…</contextree>`, dans cet ordre :
1. le contenu de `root.md` (toujours) ;
2. `## Rules` — les branches `identity` et `rule` retenues : des contraintes, à lire avant la doc ;
3. `## Context` — le reste ;
4. `## Catalogue — branches non chargées` — titre, type, `load_when`, et la consigne de rappeler `get_context` dès que la tâche se précise ;
5. **le rappel d'écrire** : « avant de terminer ta réponse, dis ce que cette tâche t'a appris… ».

Le rappel vit **dans le bloc et nulle part ailleurs** : les `instructions` du serveur sont lues une fois à la connexion, avant toute tâche ; le bloc arrive avec chaque tour, sur les deux surfaces. Un seul rendu de catalogue est partagé par le hook et le serveur.

## Le bloc des fichiers de consignes (`renderAgentsBlock`)

**Jamais l'arbre entier** : y verser les branches reconstituerait le gros fichier que contextree remplace. Il contient, dans cet ordre :
- la consigne **avec son moment** : « Avant de répondre à une demande sur ce projet, et avant d'ouvrir ou de modifier un fichier, appelle `get_context` » — le même moment ouvre la description de l'outil `get_context` ;
- la racine ;
- le catalogue — les mêmes lignes que lit le routeur.

Borné par `<!-- contextree:start -->` / `<!-- contextree:end -->`, remplacé à l'identique ; ce qui est dehors appartient à l'utilisateur. Rendu **sans le calque personnel** : ces fichiers se commitent.

## Le bloc suit l'arbre (`syncInstructionFiles`)

**Tout ce qui est dérivé de l'arbre et écrit ailleurs doit être réécrit quand l'arbre change**, sinon il ment dès la première branche ajoutée. Après toute écriture — outils MCP (et le premier `get_context` de la session), CLI (`init`, `add`, `rm`, `mv`, `import`), extension (l'observateur de `.contextree/`, regroupé à 500 ms) — le bloc est réécrit dans :
- un fichier qui **porte déjà** le bloc ;
- ceux d'un agent **câblé dans ce projet** (`.vscode/mcp.json` → `copilot-instructions.md` + `AGENTS.md` ; `.cursor/mcp.json` → `AGENTS.md` ; `.gemini/settings.json` → `GEMINI.md`) ;
- `.github/copilot-instructions.md` quand **le client MCP est VS Code** (`clientInfo.name`), créé au besoin : que VS Code lance le serveur ici tient lieu de câblage.

Jamais ailleurs. Chaque fichier touché est annoncé ; un échec de synchronisation n'échoue pas l'outil.
