---
type: reference
title: Mécanique du routage
load_when: quand on touche au routeur, au prompt de routage, au moteur (clé API / CLI, Claude ou autre IA), au fallback, au choix de modèle, au journal des tours ou à la mesure du routage
---

Un appel IA léger reçoit le catalogue (index, type, titre, `load_when`) et le message utilisateur, et renvoie les indices retenus. Puis `withAncestors` remonte les parents. Les indices sont **0-based** : ça évite au modèle de recopier des chemins, source classique d'échec.

Le contrat tient en une phrase : **le routeur ne demande qu'un tableau d'entiers**. Rien ici n'est propre à Claude, et c'est ce qui permet d'ouvrir le moteur à n'importe quelle IA.

**Les moteurs, dans cet ordre** (`pickEngine`) — une clé explicite d'abord, puis le modèle du client MCP, sinon un CLI d'agent déjà authentifié :

- `anthropic` — une clé est là (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, ou passée en argument). Budget 2,5 s, sortie structurée par JSON Schema.
- `openai` — sinon `OPENAI_API_KEY` : un simple `fetch` sur `${OPENAI_BASE_URL}/chat/completions`, **pas un SDK** (ce serait la 4e dépendance). Le même dialecte couvre OpenAI, Groq, OpenRouter, Ollama, LM Studio. Corps minimal — modèle et messages : `temperature`, `max_tokens`, `response_format` sont refusés par une partie de ces endpoints, c'est le timeout qui borne.
- `sampling` — sinon, **dans le serveur MCP seulement**, quand le client annonce la capacité `sampling` : le routeur demande le tri au modèle **du client** par `sampling/createMessage` (14 septembre 2026). C'est ce qui fait router **Copilot dans VS Code sur un poste sans clé ni CLI** — la cible entreprise, sous Windows — qui tombait sur `none`, donc sur l'arbre entier. Le routeur reçoit une fonction `Complete` fabriquée par le serveur et ne sait rien de MCP (`core/` n'en dépend pas). Même prompt (`PLAIN_SYSTEM`), même parseur, `maxTokens: 256`, `includeContext: 'none'`, `modelPreferences` qui demande le rapide et bon marché (`speedPriority: 1`, indices `haiku`/`mini`/`flash` — le client reste libre). **Avant les CLI** parce qu'il répond comme une API et ne lance aucun process : **synchrone**, jamais différé. Budget d'un CLI (45 s sous `tool`), pas d'une API : au premier appel VS Code ouvre une invite de consentement, et c'est un humain qui clique.
  **Un refus coupe le sampling pour la session** — consentement décliné, aucun modèle autorisé, délai dépassé : repli normal, raison dans la trace et le journal (`engine: 'sampling'`, `error`), et le serveur ne redemande plus jusqu'à sa relance. Redemander à chaque appel rouvrirait la même invite à chaque tâche. Une réponse **illisible** n'est pas un refus et ne coupe rien. Hors du serveur — `route`, `route --eval`, le hook —, il n'y a pas de client : `CONTEXTREE_ROUTER=sampling` y tombe dans le repli, et `route` le dit.
  Côté VS Code (doc de l'API, 14 septembre 2026, pas encore vu en vrai) : consentement au premier appel, modèles autorisés par serveur via *MCP: List Servers → Configure Model Access*, stockés dans `chat.mcp.serverSampling` (`allowedModels`, `allowedDuringChat`) ; un bug connu (microsoft/vscode#267354) casse le sampling quand aucun modèle n'est choisi.
- `claude`, `codex`, `gemini` — 5 à 60 s mesurées — sinon le premier binaire trouvé sur la machine : **c'est l'abonnement de l'utilisateur, aucune clé requise**. Même mécanique (`CliSpec`) : prompt par stdin, process réduit au strict nécessaire, environnement débarrassé des `CLAUDE*` hérités (`CLAUDE_EFFORT` faisait réfléchir le routeur) sauf `CLAUDE_CONFIG_DIR`. `claude -p` sans outils, sans MCP, sans `--setting-sources` (donc sans hook) ; `codex exec -` en `--sandbox read-only --skip-git-repo-check` ; `gemini` sans TTY lit stdin.
- `none` — rien de tout ça : arbre entier injecté, et `error` le dit.

**Le journal dit qui a trié** : chaque tour qui a vraiment appelé un modèle porte `engine` (hook, MCP et fond). Absent d'un `deferred` ou d'un court-circuit — personne n'a été appelé.

**Sous Windows** (14 septembre 2026) : le binaire se cherche avec les extensions de `PATHEXT`, dans leur ordre (`claude.exe` natif comme `claude.cmd` de npm, plus `%APPDATA%\npm`). Un `.cmd`/`.bat` ne se lance que par `cmd.exe` depuis Node 20.12.2 : `run` passe par `cmd /d /s /c` avec une ligne échappée en deux couches (`cmdLine`, recette de `cross-spawn` sans la dépendance) et la consigne système part sur stdin, parce que `cmd` coupe une ligne au premier saut de ligne. Ce qui rend `cmd.exe` sûr ici : **le prompt ne passe jamais en argument**. `shell: true` est écarté — Node n'y échappe rien. `windowsHide: true` sur tous les `spawn`, sinon une console clignote à chaque routage. Prouvé par un faux CLI dans `npm test`, CI Windows écrite mais pas encore passée.

**Le hook n'attend jamais un moteur CLI** (5 à 60 s mesurées) : le tour part avec la sélection du tour précédent (`reason: 'deferred'`), et `contextree route-bg` — détaché, sans stdio — route ce prompt derrière pour le tour suivant. Hook à ~150 ms. `CONTEXTREE_ROUTER_BLOCKING=1` rend l'attente.

**Le routage de fond écrit son tour dans le journal** (9 septembre 2026), avec `source: 'bg'` et le **même `at`** que le tour du hook — passé en `--at`, pour que les deux entrées d'un prompt se lisent ensemble. Un prompt produit donc deux tours : le `deferred` du hook, puis le `routed`/`bg` du fond. On ne les fusionne pas, c'est ce qui s'est passé.

Sans ça, sous un moteur CLI le journal ne contenait **que** des `deferred` — mesuré sur ce dépôt : 25 tours, 20 `deferred`, 5 `fallback`, **0 `routed`**. La vue affichait « différé » à vie, et le seul routage réel de la session n'apparaissait nulle part : personne ne pouvait corriger un `load_when` en regardant ce que le routeur avait vraiment choisi, ce qui est pourtant toute la promesse de la barre latérale. Le fond n'écrit que s'il a **routé** : un repli n'apprend rien de plus que le `deferred` déjà inscrit.

`turnLabelKey` (dans `journal.ts`) traduit ce tour en `routed-bg`, affiché « routé (prochain tour) ». La règle vit dans le cœur, pas dans une vue : la barre latérale et la toile doivent dire la même chose du même tour. Ces branches n'ont pas servi au prompt qu'on vient d'envoyer — elles partiront au suivant, et l'infobulle le dit (« choisie par le routeur pour le prochain tour »).

Autres contraintes :

- **le modèle n'est deviné pour personne** : `haiku` sur le CLI `claude` (mesuré), le défaut de l'utilisateur sur `codex`/`gemini`. Inventer un identifiant de modèle pour un CLI qu'on ne maîtrise pas, c'est un moteur qui échoue au premier appel ;
- **un moteur forcé n'est pas vérifié** : `CONTEXTREE_ROUTER=codex` sans `codex` échoue et tombe dans le fallback, plutôt qu'un repli silencieux sur un moteur non demandé ;
- sortie structurée côté clé Anthropic ; ailleurs **pas de `--json-schema`** (un tour de plus, latence doublée), parseur tolérant mais strict sur le contenu — un tableau qui n'est pas fait d'entiers vaut un repli, pas une sélection vide. Comme un CLI d'agent préfixe sa réponse (bannière, horodatage), c'est le **dernier** tableau d'entiers de la sortie qui compte ;
- `thinking: disabled`, `effort: low` — budget latence, pas budget réflexion ;
- fallback à **deux niveaux** (9 septembre 2026) : la sélection de la session, sinon la dernière sélection **routée** de l'arbre — toutes sessions confondues, dans `<clé(arbre)>-last.json` —, sinon l'arbre entier — **sauf côté serveur MCP, où le troisième niveau est le catalogue** (voir plus bas). Pas de quatrième niveau. Le second existe parce qu'une session neuve repartait de 12/12 : sous un moteur CLI le premier tour n'est jamais routé, donc chaque conversation ouverte coûtait l'arbre entier alors que le routeur avait déjà répondu. Un **repli n'alimente pas** ce niveau : il y recopierait ce qui s'y trouve, ou y figerait l'arbre entier ;
- le cache s'écrit **tmp + rename**, et porte l'horodatage du **prompt** (`at`, passé au routage de fond) : une sélection plus ancienne n'écrase jamais une plus récente. Sans ça, c'est le dernier à *finir* qui gagnait, pas le dernier *lancé* — et deux `route-bg` qui se chevauchaient pouvaient laisser un JSON tronqué, que le lecteur suivant lisait comme « rien en cache », donc comme l'arbre entier. L'ancien format (tableau nu) reste lu ;
- **Aucun type privilégié** : plus de « garanties » `identity` + `rule` ;
- court-circuit à ≤ 3 branches : on injecte tout, le routage ne se rentabilise pas ;
- **deux garde-fous anti-récursion**, parce que le hook tourne *dans* Claude Code et que le routeur relance un `claude` : `--setting-sources ''` sur le fils (donc aucun hook), et `CONTEXTREE_ROUTING=1` dans son environnement, que `cmdHook` teste pour sortir immédiatement.

**Le budget dépend de qui attend, pas du moteur seul** (`RouteWaiter`, 11 septembre 2026). Trois appelants, trois patiences :

| `waiter` | qui attend | CLI | API |
|---|---|---|---|
| `prompt` | un humain devant son curseur — hook bloquant, `contextree route` | 45 s | 2,5 s |
| `tool` | un agent qui a appelé `get_context` et attend déjà | 45 s | 2,5 s |
| `batch` | personne — `route-bg`, `route --eval` | 120 s | 10 s |

`CONTEXTREE_ROUTER_TIMEOUT_MS` écrase tout, et c'est la seule échappatoire.

**Le différé ne dépend pas de l'agent.** Le hook part en tâche de fond sous moteur CLI quel que soit son dialecte — Claude Code, Gemini, Codex : c'est le même `cmdHook`, seule l'enveloppe de sortie change.

**Le budget CLI était à 20 s, soit la moitié basse de ce que le code mesurait lui-même** (« entre 5 et 60 s », écrit juste au-dessus de la constante). On l'a payé deux fois : 9 cas d'éval sur 20 tombés dans le repli le 9 septembre, puis deux prompts ciblés sur trois lors du passage « depuis zéro » du 11 — 20 007 et 20 006 ms, donc l'arbre entier injecté. Les mêmes, budget relevé : 11 420, **37 282** et 20 554 ms, tous routés. Le second dit pourquoi 45 s et pas 30 : la file d'un abonnement n'a pas de médiane utile, elle a une queue.

**Un budget serré ne protège de rien ici.** Le repli *injecte plus* — il n'abrège pas. La seule chose qu'un budget trop court fait gagner, c'est le temps d'écrire le contexte qu'on voulait éviter.

**Le budget d'un outil est plafonné par le client, pas par notre patience.** Le SDK MCP abandonne une requête à 60 s. Poussé à 60 s côté serveur, `get_context` expirait **côté client** avant d'avoir pu rendre son repli : plus de contexte du tout, au lieu d'un contexte trop large. D'où les 45 s, nettement dessous, pour que le repli arrive toujours.

**Sous moteur CLI, `get_context` diffère aussi** (11 septembre 2026). Router en synchrone revenait à choisir entre l'arbre entier (un repli à 45 s) et rien du tout (l'appel expire côté client) — aucune des deux n'est une réponse pour Cursor, Codex ou Copilot, qui n'ont que cette surface et pour qui `get_context` **est** contextree. L'outil rend donc tout de suite la sélection héritée, lance le routage derrière, et celui-ci sert à l'appel suivant : exactement ce que le hook fait depuis le début. Sous clé API, rien de tout ça — 2500 ms, pas de file, on route en synchrone.

Mesuré, dix appels d'affilée sur le vrai serveur stdio, arbre de 8 branches : **3 à 18 ms** chacun, aucun n'expire, et après le premier la sélection descend à 1, 4 ou 7 branches. Une session MCP neuve sur un projet déjà routé hérite du second niveau du cache — 1 branche sur 8, en 6 ms. L'arbre entier n'arrive plus que sur un projet jamais routé : un démarrage à froid, pas un échec.

**Ce qui tient lieu de session pour un serveur MCP** : le process lui-même. Il n'a pas de notion de tour, mais l'agent le relance à chaque session, donc sa durée de vie *est* la session — un id tiré au démarrage suffit à ranger le cache. Il ne collisionne pas avec celui du hook : quand les deux surfaces tournent côte à côte, chacune a sa piste, et le second niveau du cache les fait quand même se parler.

`routeInBackground` vit dans `router.ts` et non dans la CLI depuis qu'il a **deux appelants** — le hook et le serveur. Deux copies auraient divergé au premier correctif.

`CONTEXTREE_ROUTER` (`auto`|`anthropic`|`openai`|`sampling`|`claude`|`codex`|`gemini`|`off` ; `sdk` et `cli` restent compris), `CONTEXTREE_ROUTER_MODEL`, `CONTEXTREE_ROUTER_TIMEOUT_MS`, `OPENAI_BASE_URL`, `CONTEXTREE_CLAUDE_BIN`.

**Côté MCP, l'arbre entier ne sort plus jamais** (14 septembre 2026, demande d'Adrien pour Copilot). Quand `get_context` rendrait l'arbre complet faute de routage — à froid en différé (rien en cache), aucun moteur, repli sans sélection antérieure —, il rend **la racine et le catalogue avec les chemins** (`renderCatalogueOnly`) et une consigne avec un moment : « **avant de répondre**, lis avec `read_branch` les branches dont la condition correspond ». L'agent devient son propre routeur pour ce tour ; c'est un modèle, il lit un `load_when` aussi bien que le routeur. Le journal inscrit `reason: 'catalogue'`, `selected: []` — distinct d'un `fallback`, pour que la vue ne dise pas « tout chargé » d'un tour où rien n'est parti.

Ce qui ne change pas : une sélection héritée **partielle** reste servie (elle vient d'un vrai routage) ; un arbre sous le seuil de routage reste servi en entier ; un catalogue n'écrit **rien** dans le cache de session — sinon l'arbre entier y reviendrait au tour suivant comme « sélection héritée ». Le **hook de Claude Code garde l'arbre entier en repli** : changer ce qui arrive devant chaque prompt est une autre décision. `CONTEXTREE_MCP_FALLBACK=full` rend l'ancien comportement (éval, démo), et c'est la seule option.

**Mesuré le 14 septembre 2026**, faute de Copilot sur la machine : Claude Code (`sonnet`, `claude -p`, sans hook, `CONTEXTREE_ROUTER=off`) sur une copie de cet arbre, trois questions dont la réponse tient dans une seule branche. **Les deux agents qui ont reçu le catalogue ont atteint la bonne branche** : l'un par `read_branch workflow`, l'autre en lisant `.contextree/` sur le disque (`grep`) plutôt que par l'outil — même résultat, mais un agent sans accès au disque aurait dû passer par `read_branch`. Le troisième n'a appelé **aucun** outil et a répondu de mémoire, à côté de la skill *Partager un arbre par git* : le catalogue ne sert à rien si `get_context` n'est pas appelé, et ça, ce sont les consignes (`instructions`, `AGENTS.md`) qui le décident, pas ce mode. Trois cas, pas une statistique.

`read_branch` garde **un chemin par appel** — tranché : les agents savent appeler plusieurs outils d'un coup, et un second schéma pour la même lecture serait une surface de plus à tenir.

## Mesurer, au lieu de retoucher à l'aveugle

`npm run eval` (`route --eval`, `tests/routing.eval.json`) route un jeu de prompts réels et compare aux branches attendues, **ancêtres compris des deux côtés**. Précision = ce qui a été chargé et servait ; rappel = ce qui servait et a été chargé. Micro-moyenné : on somme les branches de tous les cas, pour que le score dise ce que coûte une session, pas ce que vaut un prompt moyen. Jamais dans `npm test`, et toujours code 0 : un mauvais score dit « le routage s'est dégradé », pas « le code est cassé ».

**Première mesure, 9 septembre 2026** — 20 cas, 16 branches, CLI `claude` (haiku) : **précision 57 %, rappel 75 %, 21,5 s par cas**.

Deux choses apprises le jour même :

- **Une éval ne se mesure pas au budget d'un prompt.** Au premier passage, 9 cas sur 20 ont expiré à 20 s et sont tombés dans le repli « arbre entier » : précision 24 %, rappel 81 % — on mesurait le timeout, pas le routeur. `--eval` passe donc en `waiter: 'batch'`, comme `route-bg`. Personne n'attend une mesure. C'était le premier signe que le budget était mal posé ; il a fallu le payer une seconde fois, sur le scénario « depuis zéro », pour le corriger à la racine.
- **Toute la perte de rappel tient à une seule branche.** `identite` est manquée dans 13 cas sur 20 ; **hors `identite`, le rappel est de 100 %** — aucune branche de fond n'a été ratée. Son `load_when` dit « toujours pertinent », ce qui n'est pas une condition : c'est un vœu, et le routeur l'honore une fois sur trois. Le choix est ouvert, et il n'est pas dans le code : soit on lui écrit une vraie condition et elle est routée comme les autres, soit on assume qu'elle n'est pas toujours chargée. Ce qu'on ne fera pas, c'est la garantir par son type — aucun type n'est privilégié.

**Le défaut de modèle sur clé Anthropic reste `claude-opus-5`**, faute de mesure : aucune clé n'était disponible sur la machine le jour de la mesure, et le chemin CLI (le seul mesuré) utilise `haiku`. Le changer sans chiffres reviendrait à remplacer un choix arbitraire par un autre. À reprendre dès qu'une clé permet de comparer haiku / sonnet / opus sur le même jeu.
