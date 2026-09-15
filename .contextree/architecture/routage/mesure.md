---
type: reference
title: Mesurer le routage (eval)
load_when: quand on lance ou modifie npm run eval, le jeu tests/routing.eval.json, ou qu'on veut savoir si une retouche de load_when, du prompt du routeur ou du modèle améliore le tri
---

`npm run eval` (`route --eval`, `tests/routing.eval.json`) route des prompts réels et compare aux branches attendues, **ancêtres compris des deux côtés**. Précision = chargé et utile ; rappel = utile et chargé. **Micro-moyenné** : on somme les branches de tous les cas, pour que le score dise ce que coûte une session.

- **Pas un test** : il faut un moteur, et un modèle varie. Code 0 toujours, jamais dans `npm test`.
- **En `waiter: 'batch'`** : au budget d'un prompt, on mesure le timeout, pas le routeur.
- **Déplacer ou découper une branche, ou corriger un `load_when`, invalide les cas qui reposaient dessus.** Relire le jeu avant de croire un score qui bouge.
- `ROUTER_SYSTEM` reste en français : le traduire invaliderait la mesure.

Repère : 57 % de précision et 75 % de rappel au premier passage (CLI `claude`, haiku, 20 cas), 93 % de rappel après avoir donné une vraie condition à `identite` — un `load_when` « toujours pertinent » est un vœu que le routeur honore une fois sur trois.
