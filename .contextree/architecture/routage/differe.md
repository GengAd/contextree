---
type: reference
title: Routage différé et budgets
load_when: quand on touche au routage en tâche de fond (route-bg, deferred), aux délais du routeur, à get_context sous moteur CLI, au mode catalogue du serveur MCP, ou à la latence du hook
---

**Le hook n'attend jamais un moteur CLI** (5 à 60 s) : le tour part avec la sélection héritée (`reason: 'deferred'`), et `contextree route-bg` — détaché, sans stdio — route ce prompt pour le tour suivant. Hook à ~150 ms. Vrai pour les trois dialectes du hook. `CONTEXTREE_ROUTER_BLOCKING=1` rend l'attente.

**`get_context` diffère aussi sous moteur CLI** : router en synchrone revenait à choisir entre un repli à 45 s et un appel expiré côté client. Il rend la sélection héritée tout de suite (3 à 18 ms mesurés) et route derrière. Sous clé API, synchrone. `routeInBackground` vit dans `router.ts` parce qu'il a deux appelants.

**Le routage de fond écrit son tour** (`source: 'bg'`, **même `at`** que le tour du hook, passé en `--at`) : un prompt donne deux tours, `deferred` puis `routed`. Sans lui, la vue n'affichait jamais un vrai routage. Il n'écrit que s'il a routé. `turnLabelKey` l'affiche « routé (prochain tour) ».

**Session d'un serveur MCP = le process** : un id tiré au démarrage range le cache. Hook et serveur ont chacun leur piste ; le niveau 2 du fallback les fait se parler.

## Budgets — selon qui attend (`RouteWaiter`)

| `waiter` | qui attend | CLI | API |
|---|---|---|---|
| `prompt` | un humain — hook bloquant, `contextree route` | 45 s | 2,5 s |
| `tool` | un agent qui a appelé `get_context` | 45 s | 2,5 s |
| `batch` | personne — `route-bg`, `route --eval` | 120 s | 10 s |

`CONTEXTREE_ROUTER_TIMEOUT_MS` écrase tout. Pourquoi ces valeurs :
- **45 s et pas 20** : à 20 s, des prompts routables tombaient en repli (mesures jusqu'à 37 s). La file d'un abonnement n'a pas de médiane utile, elle a une queue. Un budget serré ne protège de rien : **le repli injecte plus**, il n'abrège pas.
- **45 s et pas 60** : le SDK MCP abandonne une requête à 60 s ; au-delà, le client expire avant de recevoir le repli.

## Côté MCP, jamais l'arbre entier

Quand `get_context` rendrait l'arbre complet faute de routage (à froid, aucun moteur, repli sans sélection antérieure), il rend **la racine et le catalogue avec les chemins** (`renderCatalogueOnly`) et une consigne : « **avant de répondre**, lis avec `read_branch` les branches dont la condition correspond ». L'agent devient son propre routeur. Journal : `reason: 'catalogue'`, `selected: []`.

Restent servies : une sélection héritée partielle, un arbre sous le seuil de routage. Un catalogue n'écrit rien dans le cache. **Le hook garde l'arbre entier en repli.** `CONTEXTREE_MCP_FALLBACK=full` rend l'ancien comportement.

Le catalogue ne sert que si `get_context` est appelé — ce sont les consignes qui le décident. `read_branch` garde **un chemin par appel**.
