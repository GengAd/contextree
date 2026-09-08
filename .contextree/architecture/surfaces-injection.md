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

**Détection d'un hook déjà posé** : on cherche `contextree` dans la commande, ce que `install` écrit toujours (`npx -y @gengad/contextree hook`). Un câblage à la main avec un chemin local (`node dist/cli.js hook`, comme dans ce dépôt) n'est donc pas reconnu — c'est le cas du développeur, pas celui d'un utilisateur.
