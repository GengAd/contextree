---
type: reference
title: Mécanique du routage
load_when: quand on touche au routeur, au prompt de routage, au fallback ou au choix de modèle
---

Un appel IA léger reçoit le catalogue (index, type, titre, `load_when`) et le message utilisateur, et renvoie les indices retenus. Puis `withAncestors` remonte les parents.

Contraintes de conception :

- sortie structurée (`output_config.format` + JSON Schema) ; parseur tolérant au cas où ;
- `thinking: disabled`, `effort: low` — budget latence, pas budget réflexion ;
- timeout 2,5 s, `maxRetries: 0` ;
- fallback = sélection précédente (sticky) + `identity` + `rule`, ancêtres inclus ;
- court-circuit à ≤ 3 branches : on injecte tout, le routage ne se rentabilise pas ;
- pas de garde sur `ANTHROPIC_API_KEY` — le SDK résout aussi `ANTHROPIC_AUTH_TOKEN` et les profils `ant auth login`.

`CONTEXTREE_ROUTER_MODEL` (défaut `claude-opus-5`) et `CONTEXTREE_ROUTER_TIMEOUT_MS` (défaut 2500) permettent de surcharger. **Le défaut de modèle reste à arbitrer** : un modèle plus petit conviendrait sans doute à cette classification, à mesurer avant de changer.
