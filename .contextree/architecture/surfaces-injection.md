---
type: reference
title: Surfaces d'injection par agent
load_when: quand on touche à l'installation, au câblage d'un agent (Claude Code, Cursor, Codex, Windsurf, Claude Desktop), à AGENTS.md, au bouton « ajouter à une IA », ou à la façon dont l'arbre arrive dans un agent sans hook
---

Tous les agents n'ont pas de hook. Trois surfaces, par ordre de qualité — c'est l'ordre dans lequel `contextree install` câble :

| Surface | Où | Qualité |
|---|---|---|
| Hook par prompt | `.claude/settings.json` | **une avance gratuite** — mais routée sur le prompt seul |
| Serveur MCP | `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, … | portable, mais l'agent doit vouloir appeler `get_context` |
| Fichier de consignes | `AGENTS.md` | dernier recours, pour qui n'a ni l'un ni l'autre |

**Le registre `AGENTS`** (dans `src/install.ts`) tient cinq agents : Claude Code (hook + MCP), Cursor (`.cursor/mcp.json` — le projet, pas le home), Codex (`config.toml` + `AGENTS.md`), Windsurf, Claude Desktop. Quatre partagent la forme `{ "mcpServers": … }` : une seule fonction (`installMcpJson`) et une table de chemins, pas un adaptateur par agent qui divergerait au premier correctif.

**Regarder n'écrit jamais.** `agentStatus()` répond « câblé / à câbler / non détecté » sans toucher au disque. C'est ce qui permet au bouton de l'extension et à `install --status` de *montrer* l'état plutôt que de tenter l'écriture pour découvrir le résultat. **Câblé = tous ses fichiers le sont** : un serveur MCP posé sans le hook est un câblage à moitié fait, et l'annoncer comme terminé serait mentir sur la surface qui donne l'avance.

**Codex** n'a pas d'équivalent de `UserPromptSubmit`. La table `[mcp_servers.contextree]` est ajoutée **à la fin** de `config.toml` — pas de parseur TOML (ce serait la 4e dépendance pour six lignes), et une table finale ne peut être avalée par aucune table précédente.

**Aucune surface n'injecte sans donner le catalogue** (révisé le 8 septembre 2026). Le hook était classé premier au motif qu'il est « déterministe — l'agent ne décide de rien ». Ne rien décider n'est une qualité que si le prompt contient la tâche. « Prends la prochaine tâche » ne la contient pas : elle est dans une carte Trello. Mesuré sur cet arbre — 18 tours, 0 `routed` ; un tour à 12/12 branches, le suivant à 1 seule.

Le push est donc une **avance**, pas un remplacement du pull. `renderContext` termine par le catalogue des branches non chargées et la consigne de rappeler `get_context` dès que la tâche se précise. Sans ce catalogue, l'agent qui reçoit une branche n'a aucun moyen de savoir qu'il en existe onze autres : la ligne de transparence part sur stderr, qu'il ne voit pas. **On ne tire pas ce dont on ignore l'existence** — c'est la condition qui rend le modèle pull possible, et le seul rendu de catalogue est partagé entre les deux surfaces pour qu'elles ne redivergent pas.

**Le bloc `AGENTS.md` n'est jamais l'arbre entier** (`renderAgentsBlock`) : la racine, plus le catalogue — titre et `load_when`, les mêmes lignes que lit le routeur — et la consigne d'appeler `get_context` pour le reste. Y déverser le contenu des branches reconstituerait exactement le gros fichier de consignes que contextree existe pour remplacer. Le bloc est borné par `<!-- contextree:start -->` / `<!-- contextree:end -->` et remplacé à l'identique d'une resynchronisation à l'autre ; ce qui est dehors appartient à l'utilisateur.

**Sans aucune surface** (Claude sur le web, ChatGPT) : le presse-papier. `render --copy`, `route "<demande>" --copy`, `render --agents`. Même bloc que partout ailleurs, surtout pas un format de plus. Un jeton `export --token` **n'est pas** une réponse ici : du base64 compressé, fait pour greffer un arbre dans une autre installation, illisible pour un modèle.

**Ce qui vit hors du projet n'est câblé que si l'agent est détecté**, ou nommé par `--agent` : écrire dans le `~` de quelqu'un qui n'utilise pas l'outil serait une surprise, pas un service.

**On inscrit la commande qui tourne, pas `npx`** (`selfCommand`, 9 septembre 2026). `install` écrivait `npx -y @gengad/contextree <cmd>` en dur. Le paquet n'étant pas publié, tout projet autre que ce dépôt recevait un hook qui échoue **en silence** — l'invariant du code 0 rend la panne invisible. Le processus qui exécute `install` sait comment il a été lancé, alors il l'inscrit :

- `process.argv[1]` dans un cache npx (`/_npx/`, `\_npx\` sous Windows) → la forme `npx -y @gengad/contextree <cmd>` : c'est la bonne pour cet utilisateur, et P6 la pinnera sur une version ;
- sinon → `"<process.execPath>" "<argv[1]>" <cmd>`, **chemins absolus**. Couvre `npm i -g .`, `npm link`, et `node dist/cli.js` lancé depuis le dépôt.

Jamais `contextree` nu : le PATH d'un hook est plus pauvre que celui d'un shell — même raison que `findBin`, dans `router.ts`. Toujours entre guillemets dans la forme shell : un chemin avec une espace casserait le hook. Les trois écritures (`installHook` en forme shell, `installMcpJson` et `installCodexMcp` en `command` + `args`) passent par la même fonction, sinon elles divergeraient.

`install --status` et le bouton de l'extension **affichent cette commande** avant d'écrire : câbler sur `npx` ou sur un binaire local n'est pas le même geste, et on ne l'apprenait qu'en ouvrant le JSON après coup.

**Détection d'un hook déjà posé** : on cherche `contextree` dans la commande. C'est vrai des deux formes — le chemin d'un binaire global contient `@gengad/contextree`, celui du dépôt contient `contextree`. Un dépôt cloné sous un autre nom y échappe encore ; c'est le cas du développeur, pas celui d'un utilisateur.
