---
type: reference
title: Mécanique du routage
load_when: quand on touche au routeur, au prompt de routage, au fallback, au cache de sélection, ou qu'on se demande pourquoi telle branche a été chargée ou non
---

Un appel IA léger reçoit le catalogue (index **0-based**, type, titre, `load_when`) et le message, et renvoie les indices retenus ; `withAncestors` remonte les parents. Des indices plutôt que des chemins : recopier un chemin est une source classique d'échec.

**Le contrat : le routeur ne demande qu'un tableau d'entiers.** Rien n'y est propre à Claude — c'est ce qui ouvre le moteur à n'importe quelle IA. Le parseur est tolérant sur la forme (c'est le **dernier** tableau d'entiers de la sortie qui compte : un CLI préfixe sa réponse) et strict sur le contenu (un tableau qui n'est pas fait d'entiers vaut un repli, pas une sélection vide).

**Court-circuit à ≤ 3 branches** : on injecte tout, le routage ne se rentabilise pas. **Aucun type privilégié** : c'est le `load_when` qui décide.

**Fallback à trois niveaux** — le routeur ne rend jamais un ensemble vide :
1. la sélection de la session ;
2. la dernière sélection **routée** de l'arbre, toutes sessions confondues (`<clé>-last.json` sous `stateDir()/selection/`) — sans elle, chaque conversation neuve sous moteur CLI coûtait l'arbre entier ;
3. l'arbre entier — **sauf côté serveur MCP, où c'est le catalogue** (voir *Routage différé et budgets*).

Un **repli n'alimente pas** le niveau 2 : il y figerait l'arbre entier. **Une sélection vide ne s'écrit pas** (`writeSelection`) : un routage qui ne retient rien laisse la sélection précédente, sinon le tour suivant lisait un cache vide et héritait de l'arbre entier.

**Le cache s'écrit tmp + rename** et porte l'horodatage du **prompt** (`at`) : une sélection plus ancienne n'écrase jamais une plus récente, et deux `route-bg` qui se chevauchent ne laissent pas de JSON tronqué (lu comme « rien en cache », donc l'arbre entier).

**Deux garde-fous anti-récursion** — le hook tourne dans Claude Code et le routeur relance un `claude` : `--setting-sources ''` sur le fils (aucun hook), et `CONTEXTREE_ROUTING=1` dans son environnement, que `cmdHook` teste pour sortir.

`CONTEXTREE_ROUTER` (`auto`|`anthropic`|`openai`|`sampling`|`claude`|`codex`|`gemini`|`off`), `CONTEXTREE_ROUTER_MODEL`, `CONTEXTREE_ROUTER_TIMEOUT_MS`, `CONTEXTREE_ROUTER_BLOCKING`, `CONTEXTREE_MCP_FALLBACK`, `OPENAI_BASE_URL`, `CONTEXTREE_CLAUDE_BIN`.
