---
type: reference
title: Mécanique du routage
load_when: quand on touche au routeur, au prompt de routage, au moteur (clé API / CLI), au fallback ou au choix de modèle
---

Un appel IA léger reçoit le catalogue (index, type, titre, `load_when`) et le message utilisateur, et renvoie les indices retenus. Puis `withAncestors` remonte les parents.

**Trois moteurs, dans cet ordre** (`pickEngine`) :

- `sdk` — une clé est là (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`). Budget 2,5 s.
- `cli` — sinon, le binaire `claude` trouvé sur la machine : **c'est l'abonnement de l'utilisateur, aucune clé requise**. `claude -p` lancé sans outils, sans MCP, sans `--setting-sources` (donc sans hook), prompt par stdin, environnement débarrassé des `CLAUDE*` hérités (`CLAUDE_EFFORT` faisait réfléchir le routeur) sauf `CLAUDE_CONFIG_DIR`.
- `none` — ni l'un ni l'autre : arbre entier injecté, et `error` le dit.

**Le hook n'attend jamais le moteur `cli`** (5 à 60 s mesurées) : le tour part avec la sélection du tour précédent (`reason: 'deferred'`), et `contextree route-bg` — détaché, sans stdio — route ce prompt derrière pour le tour suivant. Hook à ~150 ms. `CONTEXTREE_ROUTER_BLOCKING=1` rend l'attente.

Autres contraintes :

- sortie structurée côté SDK ; côté CLI **pas de `--json-schema`** (un tour de plus, latence doublée), parseur tolérant mais strict sur le contenu — un tableau qui n'est pas fait d'entiers vaut un repli, pas une sélection vide ;
- `thinking: disabled`, `effort: low` — budget latence, pas budget réflexion ;
- fallback = sélection précédente (sticky), sinon l'arbre entier. **Aucun type privilégié** : plus de « garanties » `identity` + `rule` ;
- court-circuit à ≤ 3 branches : on injecte tout, le routage ne se rentabilise pas.

`CONTEXTREE_ROUTER` (`sdk`|`cli`|`off`), `CONTEXTREE_ROUTER_MODEL` (défaut `claude-opus-5` en SDK, `haiku` en CLI), `CONTEXTREE_ROUTER_TIMEOUT_MS`, `CONTEXTREE_CLAUDE_BIN`. **Le défaut de modèle SDK reste à arbitrer.**
