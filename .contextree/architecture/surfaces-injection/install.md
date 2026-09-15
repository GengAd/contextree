---
type: reference
title: Câbler un agent (install)
load_when: quand on touche à ce qu'écrit contextree install ou le bouton « Ajouter à une IA » — la commande inscrite, les formats de .vscode/mcp.json, .gemini/settings.json ou config.toml, les dialectes du hook, ou les hooks qu'on ne câble pas
---

## La commande inscrite (`selfCommand`)

Jamais `npx` en dur : le paquet n'est pas publié, et un hook qui échoue le fait **en silence** (code 0). On inscrit ce qui tourne :
- `argv[1]` dans un cache npx (`/_npx/`) → `npx -y @gengad/contextree <cmd>` ;
- sinon → `"<process.execPath>" "<argv[1]>" <cmd>`, chemins absolus (`npm i -g`, `npm link`, `node dist/cli.js`) ;
- **sous Electron** (le bouton de l'extension : `execPath` est l'hôte, `argv[1]` indéfini) → un `contextree` **installé**, trouvé par `findBin`, en `node` + `cli.js` absolus. Rien de trouvé : `NoCliError`, le bouton n'écrit rien et dit quoi installer.

Jamais `contextree` nu (le PATH d'un hook est pauvre), toujours entre guillemets en forme shell. Les trois écritures (`installHook`, `installMcpJson`, `installCodexMcp`) passent par la même fonction. `install --status` et le bouton **affichent la commande** avant d'écrire. Un hook déjà posé se reconnaît à `contextree` dans sa commande.

## Formats

- **La forme commune** `{ "mcpServers": … }` : une fonction (`installMcpJson`) et une table de chemins.
- **VS Code** veut `{ "servers": { …, "type": "stdio" } }` — la forme commune donne un JSON valide **ignoré en silence**. L'entrée porte `"cwd": "${workspaceFolder}"` ; filet côté serveur si la variable n'est pas expansée : sans arbre dans son `cwd` et si le client annonce `roots`, il demande ses dossiers une fois et prend le premier qui a un arbre. Au démarrage, le serveur écrit sur stderr où il tourne et s'il a trouvé un arbre.
- **Gemini** met ses deux surfaces dans un seul fichier ; « câblé » exige les deux.
- **Codex** : la table `[mcp_servers.contextree]` est ajoutée **à la fin** de `config.toml` — pas de parseur TOML, et une table finale ne peut être avalée par aucune autre.
- `install` inscrit `--lang <langue>` dans chaque commande.

## Le hook : trois dialectes, une enveloppe

`contextree hook [--agent claude|gemini|codex]`. Gemini lit le **même payload** que Claude Code (`prompt`, `cwd`, `session_id`) ; seule la sortie change — texte brut pour Claude Code et Codex, `{"hookSpecificOutput":{"hookEventName":"BeforeAgent","additionalContext":"<bloc>"}}` et **rien d'autre** pour Gemini. D'où `HOOK_DIALECTS`, pas un `cmdHook` par agent. **Toute** écriture sur stdout passe par l'enveloppe, l'invitation comprise ; la trace va sur stderr. Un `--agent` inconnu retombe sur le texte brut.

## Les hooks qu'on ne câble pas

- **Copilot** ignore la sortie de son `UserPromptSubmit` ; **Cursor** n'a que `beforeSubmitPrompt`, qui bloque sans injecter. Un process à chaque prompt qui n'injecte rien : non. Le fichier de consignes fait le travail.
- **Codex** : l'événement n'est pas confirmé par sa doc. Le dialecte existe pour qui l'active à la main ; `install` n'écrit pas une config qu'on ne peut pas vérifier.
