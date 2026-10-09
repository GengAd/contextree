# contextree

Un plugin Claude Code pour **voir** et **bien remplir** le contexte natif d'un projet (`CLAUDE.md`, règles, skills, sous-agents, hooks). Deux skills : `/contextree:carte` montre chaque fichier et quand il se charge, `/contextree:retenir` écrit un fait durable au bon endroit ; un hook rappelle à chaque tour de le faire. Repo privé `GengAd/contextree`, mainteneur solo (Adrien Buot), tout en français.

## Carte du dépôt

```
plugin/                   ce qui s'installe (.claude-plugin/plugin.json)
plugin/skills/carte/      la carte : SKILL.md + scripts/carte.mjs, sans dépendance
plugin/skills/retenir/    la table « où écrire un fait » — c'est la méthode
plugin/hooks/             le rappel de fin de tour
tests/                    node --test ; fixture/ est un faux projet pour la carte
.claude/skills/           ce qui ne sert qu'à travailler sur ce repo
.claude-plugin/           la marketplace locale qui sert plugin/
```

## Commandes

```bash
npm test                                      # la carte sur tests/fixture
node plugin/skills/carte/scripts/carte.mjs    # la carte de ce repo : doit rester sans avertissement
claude plugin validate ./plugin && claude plugin validate .
```

## Règles

- **Aucune dépendance npm** : le plugin marche avec Node seul.
- **On ne refait pas ce que Claude Code fait.** Pas de format de contexte à nous, pas de routeur, pas de serveur : on lit les fichiers que Claude Code charge, on ne les remplace pas.
- **On n'outille qu'un agacement vécu.** Une feature sans porte d'usage réel va dans la colonne *Plus tard* du Trello, avec sa porte écrite.
- **Un fait sur ce projet** va ici s'il vaut partout, sinon dans une règle ou une skill — la table est dans `plugin/skills/retenir/SKILL.md`.
- `npm test` vert et la carte propre avant tout commit. Les commits vont sur `main`.
- Le travail est piloté par Trello : skill `tache-trello`.
