---
type: reference
title: Surfaces d'injection par agent
load_when: quand on touche à l'installation, au câblage d'un agent (Claude Code, Cursor, Codex, Windsurf, Claude Desktop), au bloc injecté et à l'ordre de ses sections, au catalogue, à AGENTS.md, au bouton « ajouter à une IA », ou à la façon dont l'arbre arrive dans un agent sans hook
---

Tous les agents n'ont pas de hook. Trois surfaces, par ordre de qualité — c'est l'ordre dans lequel `contextree install` câble :

| Surface | Où | Qualité |
|---|---|---|
| Hook par prompt | `.claude/settings.json`, `.gemini/settings.json` | **une avance gratuite** — mais routée sur le prompt seul |
| Serveur MCP | `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `~/.codex/config.toml`, … | portable, mais l'agent doit vouloir appeler `get_context` — différé comme le hook sous moteur CLI (voir *Mécanique du routage*) |
| Fichier de consignes | `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md` | dernier recours, pour qui n'a ni l'un ni l'autre |

**Le registre `AGENTS`** (dans `src/install.ts`) tient **sept** agents depuis le 11 septembre 2026 — un agent = le serveur MCP, plus **la meilleure surface d'injection qu'il sait offrir** :

| Agent | MCP | Injection |
|---|---|---|
| Claude Code | `.mcp.json` | hook `UserPromptSubmit` |
| Gemini CLI | `.gemini/settings.json` | hook `BeforeAgent` |
| VS Code + Copilot | `.vscode/mcp.json` — forme **`servers`** | `.github/copilot-instructions.md` + `AGENTS.md` |
| Cursor | `.cursor/mcp.json` (le projet, pas le home) | `AGENTS.md` |
| Codex | `~/.codex/config.toml` | `AGENTS.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | — |
| Claude Desktop | config du système | — |
| ChatGPT / Claude web | — | presse-papier (`render --copy`) |

Quatre partagent la forme `{ "mcpServers": … }` : une seule fonction (`installMcpJson`) et une table de chemins, pas un adaptateur par agent qui divergerait au premier correctif.

**Les deux exceptions sont des exceptions de format, et elles ont leur fonction.** VS Code veut `{ "servers": { … , "type": "stdio" } }` — écrire la forme commune donne un JSON valide **que VS Code ignore en silence**, la panne la plus coûteuse de ce projet parce qu'elle ressemble à une réussite. Gemini met ses deux surfaces dans un seul fichier, et « câblé » exige les deux.

**Un fichier ne se reconnaît pas à son nom.** `isWired` testait `basename === 'settings.json'` : deux agents en ont un, et le `.gemini/` passait pour un `.claude/`. Chaque fichier se vérifie selon son format, reconnu par son **chemin**. Un `--status` qui se trompe est pire qu'absent — il dit « câblé » sur un agent qui ne reçoit rien.

**Les hooks qu'on ne câble pas, et pourquoi.** Copilot en a (préversion) mais **ignore la sortie** de son `UserPromptSubmit` ; Cursor a `beforeSubmitPrompt`, qui ne sait que bloquer. Poser un hook là serait poser un process qui n'injecte rien, en silence. Le fichier de consignes fait le même travail sans process. Pour Codex, la doc du 11 septembre 2026 ne confirme ni l'événement `UserPromptSubmit` ni le statut expérimental qu'on lui prêtait : tant que ce n'est pas vérifiable, on n'écrit pas une config muette.

**Sans arbre, le câblage est à moitié fait, et `install` le dit.** Le bloc de consignes se remplit depuis l'arbre ; s'il n'y en a pas, les agents qui en dépendent restent « à câbler ». C'est exact, et c'est la même règle que pour le hook sans MCP — mais il fallait le dire, sinon `--status` accuse sans expliquer.

**Regarder n'écrit jamais.** `agentStatus()` répond « câblé / à câbler / non détecté » sans toucher au disque. C'est ce qui permet au bouton de l'extension et à `install --status` de *montrer* l'état plutôt que de tenter l'écriture pour découvrir le résultat. **Câblé = tous ses fichiers le sont** : un serveur MCP posé sans le hook est un câblage à moitié fait, et l'annoncer comme terminé serait mentir sur la surface qui donne l'avance.

**Codex** n'a pas d'équivalent de `UserPromptSubmit`. La table `[mcp_servers.contextree]` est ajoutée **à la fin** de `config.toml` — pas de parseur TOML (ce serait la 4e dépendance pour six lignes), et une table finale ne peut être avalée par aucune table précédente.

**Le bloc injecté** (`renderContext`) est encadré par `<contextree>…</contextree>` et assemblé dans cet ordre : le contenu de `root.md` (toujours), `## Rules` (les branches `identity` et `rule` retenues), `## Context` (tout le reste), `## Catalogue — branches non chargées` (une ligne par branche écartée : titre, type, `load_when`), puis **une ligne de rappel : écrire ce qu'on vient d'apprendre**. Les règles passent avant le contexte parce que ce sont des contraintes — le modèle doit les avoir en tête avant de lire la doc de domaine. Le catalogue passe en dernier : on le lit une fois qu'on sait ce qu'on a reçu.

**Le serveur MCP** (stdio) expose dix outils : `get_context`, `bootstrap_prompt`, `list_branches`, `read_branch`, `upsert_branch`, `write_root`, `delete_branch`, `move_branch`, `export_pack`, `import_pack`. `bootstrap_prompt` rend la consigne de construction — un **outil**, parce qu'un prompt MCP n'est exposé qu'à l'utilisateur (voir *Démarrage à froid*). Son champ `instructions` dit quand appeler `get_context`, invite à capitaliser par `upsert_branch`, et envoie sur `write_root` en premier quand l'arbre est neuf.

**`write_root` est la pièce qui manquait pour construire un arbre depuis une conversation** (9 septembre 2026), et **il crée le dossier `.contextree/` s'il n'existe pas** (10 septembre 2026 — sans quoi il fallait encore un terminal entre le « oui » et la racine). `root.md` est le seul contenu toujours injecté, et aucun outil ne l'écrivait : une IA sans accès au disque — le chat de Cursor, Copilot — pouvait créer vingt branches sans jamais poser la racine, c'est-à-dire rater l'essentiel. `read_branch` accepte `:root` pour la même raison : on ne remplace pas un contenu qu'on n'a pas pu lire. La racine n'est pas une branche (ni type, ni `load_when`), mais elle se trace sous `:root`, le chemin que les vues emploient déjà — sa pastille « écrite par l'IA » s'allume donc au même endroit que les autres, sans cas particulier. **L'arbre est relu à chaque appel d'outil** : les fichiers sont la source de vérité, et l'utilisateur peut les éditer pendant que le serveur tourne.

**Le rappel d'écrire vit dans le bloc, et nulle part ailleurs** (10 septembre 2026). La consigne existait déjà dans les `instructions` du serveur — et ne suffisait pas : mesuré sur un prompt de tâche réelle, le modèle a trouvé un fait durable et exact, et n'a **rien** écrit ni dit qu'il n'écrivait pas. Les `instructions` sont lues une fois, à la connexion, avant que la moindre tâche n'existe. Le bloc, lui, arrive avec le contexte du tour — à chaque prompt sous un hook, à chaque `get_context` ailleurs — donc une seule copie couvre les deux surfaces.

**Une consigne sans moment est une consigne qu'on remet à plus tard** — vérifié deux fois, sur deux consignes différentes, le 10 et le 11 septembre 2026. C'est le résultat le plus réutilisable de ce palier, et il vaut pour tout ce qu'on écrit à destination d'un modèle :

| consigne | formulation | résultat |
|---|---|---|
| enrichir l'arbre | « écris ce que tu découvres » | jamais fait |
| enrichir l'arbre | « **avant de terminer ta réponse**, dis ce que tu as appris » | fait |
| proposer l'arbre | « propose-le **au bon moment**, sans insister » | 4 fois sur 6 |
| proposer l'arbre | « **avant de terminer ta réponse**, dis-lui que… » | 6 fois sur 6 |

« Au bon moment » et « sans insister » se lisent comme une permission de se taire. Mesuré sur six passages identiques d'un même prompt (« bonjour, on fait quoi ? »), sur un projet sans arbre, l'invitation **injectée à chaque fois** : deux fois le modèle n'en a rien dit. Une consigne probabiliste ne tient pas un critère de sortie. Rattachée à la fin de la réponse, même protocole : six sur six.

Ce qu'on n'a **pas** touché en corrigeant : le marqueur de session (une invitation par session, pas par tour) et l'interdiction de créer avant un oui. Ni l'un ni l'autre n'avait jamais raté — le défaut était dans le déclenchement, pas dans la politesse, et resserrer ce qui marchait déjà aurait rendu l'outil insistant pour rien.

**La formulation compte autant que l'endroit.** « Écris ce que tu découvres » n'a rien changé au deuxième essai : une consigne sans moment est une consigne qu'on remet à plus tard. Rattachée à un instant précis — « **avant de terminer ta réponse**, dis ce que cette tâche t'a appris ; si c'est le cas écris-le, sinon dis « rien à retenir » » —, elle a produit une branche juste, annoncée, avec sa motivation. Effet de bord redouté et non constaté : sur un prompt anodin, rien n'est écrit — le modèle ne fabrique pas une branche pour obéir.

**Aucune surface ne reste muette sur un projet sans arbre** (10 septembre 2026). Les `instructions` du serveur valent quand il y a un arbre ; sans dossier `.contextree/`, elles deviennent l'invitation (`renderBootstrapInvite`), et le hook l'écrit sur stdout une fois par session. Le hook n'étant installé que par projet, rien ne fuit vers un dépôt qui n'a rien demandé. Le détail et le pourquoi sont dans *Démarrage à froid*.

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
