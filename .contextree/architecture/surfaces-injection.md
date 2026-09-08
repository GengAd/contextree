---
type: reference
title: Surfaces d'injection par agent
load_when: quand on touche à l'installation, au câblage d'un agent (Claude Code, Cursor, Codex, Windsurf, Claude Desktop), à AGENTS.md, au bouton « ajouter à une IA », ou à la façon dont l'arbre arrive dans un agent sans hook
---

Tous les agents n'ont pas de hook. Trois surfaces, par ordre de qualité — c'est l'ordre dans lequel `contextree install` câble :

| Surface | Où | Qualité |
|---|---|---|
| Hook par prompt | `.claude/settings.json` | **déterministe** — l'agent ne décide de rien |
| Serveur MCP | `.mcp.json`, `.cursor/mcp.json`, `~/.codex/config.toml`, … | portable, mais l'agent doit vouloir appeler `get_context` |
| Fichier de consignes | `AGENTS.md` | dernier recours, pour qui n'a ni l'un ni l'autre |

**Le registre `AGENTS`** (dans `src/install.ts`) tient cinq agents : Claude Code (hook + MCP), Cursor (`.cursor/mcp.json` — le projet, pas le home), Codex (`config.toml` + `AGENTS.md`), Windsurf, Claude Desktop. Quatre partagent la forme `{ "mcpServers": … }` : une seule fonction (`installMcpJson`) et une table de chemins, pas un adaptateur par agent qui divergerait au premier correctif.

**Regarder n'écrit jamais.** `agentStatus()` répond « câblé / à câbler / non détecté » sans toucher au disque. C'est ce qui permet au bouton de l'extension et à `install --status` de *montrer* l'état plutôt que de tenter l'écriture pour découvrir le résultat. **Câblé = tous ses fichiers le sont** : un serveur MCP posé sans le hook est un câblage à moitié fait, et l'annoncer comme terminé serait mentir sur la seule surface déterministe.

**Codex** n'a pas d'équivalent de `UserPromptSubmit`. La table `[mcp_servers.contextree]` est ajoutée **à la fin** de `config.toml` — pas de parseur TOML (ce serait la 4e dépendance pour six lignes), et une table finale ne peut être avalée par aucune table précédente.

**Le bloc `AGENTS.md` n'est jamais l'arbre entier** (`renderAgentsBlock`) : la racine, plus le catalogue — titre et `load_when`, les mêmes lignes que lit le routeur — et la consigne d'appeler `get_context` pour le reste. Y déverser le contenu des branches reconstituerait exactement le gros fichier de consignes que contextree existe pour remplacer. Le bloc est borné par `<!-- contextree:start -->` / `<!-- contextree:end -->` et remplacé à l'identique d'une resynchronisation à l'autre ; ce qui est dehors appartient à l'utilisateur.

**Sans aucune surface** (Claude sur le web, ChatGPT) : le presse-papier. `render --copy`, `route "<demande>" --copy`, `render --agents`. Même bloc que partout ailleurs, surtout pas un format de plus. Un jeton `export --token` **n'est pas** une réponse ici : du base64 compressé, fait pour greffer un arbre dans une autre installation, illisible pour un modèle.

**Ce qui vit hors du projet n'est câblé que si l'agent est détecté**, ou nommé par `--agent` : écrire dans le `~` de quelqu'un qui n'utilise pas l'outil serait une surprise, pas un service.

**Détection d'un hook déjà posé** : on cherche `contextree` dans la commande, ce que `install` écrit toujours (`npx -y @gengad/contextree hook`). Un câblage à la main avec un chemin local (`node dist/cli.js hook`, comme dans ce dépôt) n'est donc pas reconnu — c'est le cas du développeur, pas celui d'un utilisateur.
