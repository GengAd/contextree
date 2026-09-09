---
type: reference
title: Mécanique du routage
load_when: quand on touche au routeur, au prompt de routage, au moteur (clé API / CLI, Claude ou autre IA), au fallback ou au choix de modèle
---

Un appel IA léger reçoit le catalogue (index, type, titre, `load_when`) et le message utilisateur, et renvoie les indices retenus. Puis `withAncestors` remonte les parents.

Le contrat tient en une phrase : **le routeur ne demande qu'un tableau d'entiers**. Rien ici n'est propre à Claude, et c'est ce qui permet d'ouvrir le moteur à n'importe quelle IA.

**Les moteurs, dans cet ordre** (`pickEngine`) — une clé explicite d'abord, sinon un CLI d'agent déjà authentifié :

- `anthropic` — une clé est là (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, ou passée en argument). Budget 2,5 s, sortie structurée par JSON Schema.
- `openai` — sinon `OPENAI_API_KEY` : un simple `fetch` sur `${OPENAI_BASE_URL}/chat/completions`, **pas un SDK** (ce serait la 4e dépendance). Le même dialecte couvre OpenAI, Groq, OpenRouter, Ollama, LM Studio. Corps minimal — modèle et messages : `temperature`, `max_tokens`, `response_format` sont refusés par une partie de ces endpoints, c'est le timeout qui borne.
- `claude`, `codex`, `gemini` — sinon le premier binaire trouvé sur la machine : **c'est l'abonnement de l'utilisateur, aucune clé requise**. Même mécanique (`CliSpec`) : prompt par stdin, process réduit au strict nécessaire, environnement débarrassé des `CLAUDE*` hérités (`CLAUDE_EFFORT` faisait réfléchir le routeur) sauf `CLAUDE_CONFIG_DIR`. `claude -p` sans outils, sans MCP, sans `--setting-sources` (donc sans hook) ; `codex exec -` en `--sandbox read-only --skip-git-repo-check` ; `gemini` sans TTY lit stdin.
- `none` — rien de tout ça : arbre entier injecté, et `error` le dit.

**Le hook n'attend jamais un moteur CLI** (5 à 60 s mesurées) : le tour part avec la sélection du tour précédent (`reason: 'deferred'`), et `contextree route-bg` — détaché, sans stdio — route ce prompt derrière pour le tour suivant. Hook à ~150 ms. `CONTEXTREE_ROUTER_BLOCKING=1` rend l'attente.

**Le routage de fond écrit son tour dans le journal** (9 septembre 2026), avec `source: 'bg'` et le **même `at`** que le tour du hook — passé en `--at`, pour que les deux entrées d'un prompt se lisent ensemble. Un prompt produit donc deux tours : le `deferred` du hook, puis le `routed`/`bg` du fond. On ne les fusionne pas, c'est ce qui s'est passé.

Sans ça, sous un moteur CLI le journal ne contenait **que** des `deferred` — mesuré sur ce dépôt : 25 tours, 20 `deferred`, 5 `fallback`, **0 `routed`**. La vue affichait « différé » à vie, et le seul routage réel de la session n'apparaissait nulle part : personne ne pouvait corriger un `load_when` en regardant ce que le routeur avait vraiment choisi, ce qui est pourtant toute la promesse de la barre latérale. Le fond n'écrit que s'il a **routé** : un repli n'apprend rien de plus que le `deferred` déjà inscrit.

`turnLabelKey` (dans `journal.ts`) traduit ce tour en `routed-bg`, affiché « routé (prochain tour) ». La règle vit dans le cœur, pas dans une vue : la barre latérale et la toile doivent dire la même chose du même tour. Ces branches n'ont pas servi au prompt qu'on vient d'envoyer — elles partiront au suivant, et l'infobulle le dit (« choisie par le routeur pour le prochain tour »).

Autres contraintes :

- **le modèle n'est deviné pour personne** : `haiku` sur le CLI `claude` (mesuré), le défaut de l'utilisateur sur `codex`/`gemini`. Inventer un identifiant de modèle pour un CLI qu'on ne maîtrise pas, c'est un moteur qui échoue au premier appel ;
- **un moteur forcé n'est pas vérifié** : `CONTEXTREE_ROUTER=codex` sans `codex` échoue et tombe dans le fallback, plutôt qu'un repli silencieux sur un moteur non demandé ;
- sortie structurée côté clé Anthropic ; ailleurs **pas de `--json-schema`** (un tour de plus, latence doublée), parseur tolérant mais strict sur le contenu — un tableau qui n'est pas fait d'entiers vaut un repli, pas une sélection vide. Comme un CLI d'agent préfixe sa réponse (bannière, horodatage), c'est le **dernier** tableau d'entiers de la sortie qui compte ;
- `thinking: disabled`, `effort: low` — budget latence, pas budget réflexion ;
- fallback à **deux niveaux** (9 septembre 2026) : la sélection de la session, sinon la dernière sélection **routée** de l'arbre — toutes sessions confondues, dans `<clé(arbre)>-last.json` —, sinon l'arbre entier. Pas de troisième niveau. Le second existe parce qu'une session neuve repartait de 12/12 : sous un moteur CLI le premier tour n'est jamais routé, donc chaque conversation ouverte coûtait l'arbre entier alors que le routeur avait déjà répondu. Un **repli n'alimente pas** ce niveau : il y recopierait ce qui s'y trouve, ou y figerait l'arbre entier ;
- le cache s'écrit **tmp + rename**, et porte l'horodatage du **prompt** (`at`, passé au routage de fond) : une sélection plus ancienne n'écrase jamais une plus récente. Sans ça, c'est le dernier à *finir* qui gagnait, pas le dernier *lancé* — et deux `route-bg` qui se chevauchaient pouvaient laisser un JSON tronqué, que le lecteur suivant lisait comme « rien en cache », donc comme l'arbre entier. L'ancien format (tableau nu) reste lu ;
- **Aucun type privilégié** : plus de « garanties » `identity` + `rule` ;
- court-circuit à ≤ 3 branches : on injecte tout, le routage ne se rentabilise pas.

`CONTEXTREE_ROUTER` (`auto`|`anthropic`|`openai`|`claude`|`codex`|`gemini`|`off` ; `sdk` et `cli` restent compris), `CONTEXTREE_ROUTER_MODEL`, `CONTEXTREE_ROUTER_TIMEOUT_MS`, `OPENAI_BASE_URL`, `CONTEXTREE_CLAUDE_BIN`.

## Mesurer, au lieu de retoucher à l'aveugle

`npm run eval` (`route --eval`, `tests/routing.eval.json`) route un jeu de prompts réels et compare aux branches attendues, **ancêtres compris des deux côtés**. Précision = ce qui a été chargé et servait ; rappel = ce qui servait et a été chargé. Micro-moyenné : on somme les branches de tous les cas, pour que le score dise ce que coûte une session, pas ce que vaut un prompt moyen. Jamais dans `npm test`, et toujours code 0 : un mauvais score dit « le routage s'est dégradé », pas « le code est cassé ».

**Première mesure, 9 septembre 2026** — 20 cas, 16 branches, CLI `claude` (haiku) : **précision 57 %, rappel 75 %, 21,5 s par cas**.

Deux choses apprises le jour même :

- **Une éval ne se mesure pas au budget d'un prompt.** Au premier passage, 9 cas sur 20 ont expiré à 20 s et sont tombés dans le repli « arbre entier » : précision 24 %, rappel 81 % — on mesurait le timeout, pas le routeur. `--eval` relève donc le budget à 120 s comme le fait `route-bg`. Personne n'attend une mesure.
- **Toute la perte de rappel tient à une seule branche.** `identite` est manquée dans 13 cas sur 20 ; **hors `identite`, le rappel est de 100 %** — aucune branche de fond n'a été ratée. Son `load_when` dit « toujours pertinent », ce qui n'est pas une condition : c'est un vœu, et le routeur l'honore une fois sur trois. Le choix est ouvert, et il n'est pas dans le code : soit on lui écrit une vraie condition et elle est routée comme les autres, soit on assume qu'elle n'est pas toujours chargée. Ce qu'on ne fera pas, c'est la garantir par son type — aucun type n'est privilégié.

**Le défaut de modèle sur clé Anthropic reste `claude-opus-5`**, faute de mesure : aucune clé n'était disponible sur la machine le jour de la mesure, et le chemin CLI (le seul mesuré) utilise `haiku`. Le changer sans chiffres reviendrait à remplacer un choix arbitraire par un autre. À reprendre dès qu'une clé permet de comparer haiku / sonnet / opus sur le même jeu.
