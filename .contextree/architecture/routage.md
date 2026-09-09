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

Autres contraintes :

- **le modèle n'est deviné pour personne** : `haiku` sur le CLI `claude` (mesuré), le défaut de l'utilisateur sur `codex`/`gemini`. Inventer un identifiant de modèle pour un CLI qu'on ne maîtrise pas, c'est un moteur qui échoue au premier appel ;
- **un moteur forcé n'est pas vérifié** : `CONTEXTREE_ROUTER=codex` sans `codex` échoue et tombe dans le fallback, plutôt qu'un repli silencieux sur un moteur non demandé ;
- sortie structurée côté clé Anthropic ; ailleurs **pas de `--json-schema`** (un tour de plus, latence doublée), parseur tolérant mais strict sur le contenu — un tableau qui n'est pas fait d'entiers vaut un repli, pas une sélection vide. Comme un CLI d'agent préfixe sa réponse (bannière, horodatage), c'est le **dernier** tableau d'entiers de la sortie qui compte ;
- `thinking: disabled`, `effort: low` — budget latence, pas budget réflexion ;
- fallback = sélection précédente (sticky), sinon l'arbre entier. **Aucun type privilégié** : plus de « garanties » `identity` + `rule` ;
- court-circuit à ≤ 3 branches : on injecte tout, le routage ne se rentabilise pas.

`CONTEXTREE_ROUTER` (`auto`|`anthropic`|`openai`|`claude`|`codex`|`gemini`|`off` ; `sdk` et `cli` restent compris), `CONTEXTREE_ROUTER_MODEL`, `CONTEXTREE_ROUTER_TIMEOUT_MS`, `OPENAI_BASE_URL`, `CONTEXTREE_CLAUDE_BIN`. **Le défaut de modèle sur clé Anthropic reste à arbitrer.**
