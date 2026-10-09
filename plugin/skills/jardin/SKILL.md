---
name: jardin
description: La revue de fin de session — relire le contexte du projet (CLAUDE.md, règles, skills, agents) contre ce que la session a changé, et proposer des diffs classés (faux, manquant, à extraire, à découper). N'écrit rien sans accord. À lancer en fin de session ou après une grosse tâche.
disable-model-invocation: true
argument-hint: "[depuis : « 2 days ago » ou une référence git]"
---

# Le jardin

Le contexte dérive : un fichier dit encore ce que le code ne fait plus, un fait appris n'a été écrit nulle part, une procédure refaite à la main mérite une skill, un fichier a grossi ou n'a plus été relu. Tu relis, tu proposes, **tu n'écris qu'après accord**.

## 1. Les faits

Lance, depuis la racine du projet :

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/jardin/scripts/jardin.mjs"
```

Si un argument est donné ($ARGUMENTS), ajoute `--depuis "$ARGUMENTS"` : une durée (« 2 days ago ») ou une référence git. Si `session.erreur` est rempli, dis-le et relance avec une durée valide.

Le JSON donne : `contexte` (les fichiers de contexte partagés par git), `session` (commits et fichiers changés depuis `--depuis`, 12 heures par défaut), `cites` (un fichier de contexte qui cite un chemin changé dans la session), `vieux` (pas de commit depuis six semaines), `avertissements` de la carte.

## 2. Les propositions, en quatre classes

Pour chacune, lis le fichier de contexte en entier avant de proposer quoi que ce soit.

1. **Faux** — un fichier de contexte contredit le code. Pars de `cites` : lis le diff du chemin cité (`git diff <base> -- <chemin>`, ou `git log -p` sur la session) et dis si le texte est encore vrai. Ajoute ce que la conversation t'a montré : une consigne suivie qui a mené à une erreur, une commande qui a changé.
2. **Manquant** — un fait appris dans cette conversation qui ne figure nulle part : une convention, un piège, une commande, une contrainte. Cherche-le d'abord (`grep -ri` dans les fichiers de `contexte`) ; la destination se décide avec la table de la skill `contextree:retenir`. Pas une question de lecture, pas l'histoire d'une décision.
3. **À extraire** — une procédure faite au moins deux fois dans la conversation (la même suite de commandes ou d'étapes) → une skill invocable, avec son `argument-hint`.
4. **À découper** — les `avertissements` de racine trop longue ou de skill trop longue : ce qui se déplace vers une règle à `paths` ou un fichier voisin. Et chaque fichier de `vieux` : relis-le contre le code d'aujourd'hui ; propose une correction, une suppression, ou « encore juste » s'il l'est.

## 3. Présenter, puis attendre

Une liste numérotée, la meilleure proposition d'abord, **dix au plus**. Pour chacune : la classe, le fichier, la raison en une phrase, et le diff exact (bloc `diff`). Une classe sans proposition s'écrit « rien ». Puis une seule question : « Lesquelles j'applique ? (numéros, « toutes », « aucune ») ».

**N'écris aucun fichier avant la réponse.** Ensuite, applique seulement les numéros choisis, puis lance la carte et corrige ses avertissements :

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/carte/scripts/carte.mjs" --sans-perso
```

Termine par une ligne par fichier modifié.
