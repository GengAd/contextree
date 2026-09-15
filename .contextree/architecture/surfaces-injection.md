---
type: reference
title: Surfaces d'injection par agent
load_when: quand on touche à la façon dont l'arbre arrive dans un agent (hook, serveur MCP, fichier de consignes, presse-papier), au registre des agents, ou à contextree install et son --status
---

Trois surfaces, par ordre de qualité — l'ordre dans lequel `contextree install` câble :

| Surface | Où | Qualité |
|---|---|---|
| Hook par prompt | `.claude/settings.json`, `.gemini/settings.json` | une **avance** gratuite, routée sur le prompt seul |
| Serveur MCP | `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `~/.codex/config.toml`… | portable, mais l'agent doit appeler `get_context` |
| Fichier de consignes | `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md` | ce qui fait appeler `get_context` à qui n'a pas de hook |

Sans aucune surface (Claude web, ChatGPT) : le presse-papier — `render --copy`, `route "<demande>" --copy`, `render --agents`. Même bloc, pas un format de plus.

**Le registre `AGENTS`** (`src/install.ts`) — un agent = le serveur MCP + la meilleure injection qu'il offre :

| Agent | MCP | Injection |
|---|---|---|
| Claude Code | `.mcp.json` | hook `UserPromptSubmit` |
| Gemini CLI | `.gemini/settings.json` | hook `BeforeAgent` + `GEMINI.md` |
| VS Code + Copilot | `.vscode/mcp.json` (forme `servers`) | `copilot-instructions.md` + `AGENTS.md` |
| Cursor | `.cursor/mcp.json` | `AGENTS.md` |
| Codex | `~/.codex/config.toml` | `AGENTS.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | — |
| Claude Desktop | config du système | — |

**Le push est une avance, pas un remplacement du pull.** « Prends la prochaine tâche » ne contient pas la tâche : elle est dans une carte. Aucune surface n'injecte donc sans le catalogue des branches non chargées — on ne tire pas ce dont on ignore l'existence.

**Ce que `--status` promet** :
- **Regarder n'écrit jamais** (`agentStatus()`) : câblé / à câbler / non détecté, sans toucher au disque.
- **Câblé = tous ses fichiers le sont**, chacun vérifié selon **son** format, reconnu par son chemin (deux agents ont un `settings.json`). Un MCP sans son hook est à moitié câblé.
- **Câblé = lançable ici** (`runnableHere`) : une commande en chemin absolu absent de la machine n'est pas câblée, `install` la réécrit (`repaired`).
- **Sans arbre, un agent qui dépend d'un fichier de consignes reste « à câbler »**, et `install` dit pourquoi.
- **Hors du projet, on n'écrit que pour un agent détecté** ou nommé par `--agent`.
- L'état du bloc de consignes, fichier par fichier : absent ou périmé.
