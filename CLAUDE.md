# contextree

Un plugin Claude Code pour **voir** et **bien remplir** le contexte natif d'un projet (`CLAUDE.md`, règles, skills, sous-agents, hooks). Quatre skills : `/contextree:init-contexte` construit le contexte d'un projet (plan validé avant d'écrire), `/contextree:carte` montre chaque fichier et quand il se charge, `/contextree:retenir` écrit un fait durable au bon endroit, `/contextree:migrer-v1` convertit un projet de l'ancien contextree ; un hook rappelle à chaque tour de retenir. Repo privé `GengAd/contextree`, mainteneur solo (Adrien Buot), tout en français.

## Carte du dépôt

```
plugin/                   ce qui s'installe (.claude-plugin/plugin.json)
plugin/skills/carte/      la carte : SKILL.md + scripts/carte.mjs, sans dépendance
plugin/skills/retenir/    la table « où écrire un fait » — c'est la méthode
plugin/skills/init-contexte/  le premier jour d'un projet : comprendre, proposer un plan, écrire, vérifier
plugin/skills/migrer-v1/  l'ancien arbre .contextree vers le natif, scripts/migrer-v1.mjs sans dépendance
plugin/hooks/             le rappel de fin de tour
extension/                la vue en barre latérale (Cursor, VS Code) : affiche carte --json, JS sans build
tests/                    node --test ; fixture/ un faux projet, fixture-home/ un faux ~/.claude
docs/decisions/           les décisions d'architecture, une par fichier
.claude/                  ce qui ne sert qu'à travailler sur ce repo : règles, skills, agent, hook
.claude-plugin/           la marketplace locale qui sert plugin/
```

## Où aller

| Tâche | Va voir | Se charge |
|---|---|---|
| modifier la carte ou ses avertissements | `plugin/skills/carte/` | règle `carte.md`, en touchant |
| modifier la vue dans Cursor | `extension/` | règle `extension.md`, en touchant |
| écrire une skill, un agent, un hook | `.claude/rules/consignes.md` | en touchant un `SKILL.md` |
| ajouter un test ou un défaut à la fixture | `tests/` | règle `tests.md`, en touchant |
| prendre ou finir une carte Trello | skill `tache-trello` | quand on en parle |
| pousser sur origin | `/livrer` | à la main |
| pourquoi ni routeur ni serveur | `docs/decisions/0001-…` | sur lien |

## Commandes

```bash
npm test                                      # la carte, le hook de forme et la vue, sur tests/fixture
npm run package:ext                           # extension/contextree.vsix, à installer dans Cursor
node plugin/skills/carte/scripts/carte.mjs --sans-perso   # la carte de ce repo : doit rester sans avertissement
claude plugin validate ./plugin && claude plugin validate .
```

## Règles

- **Aucune dépendance npm** : le plugin marche avec Node seul. `npm install` est refusé par `.claude/settings.json`.
- **On ne refait pas ce que Claude Code fait** : pas de format à nous, pas de routeur, pas de serveur (`docs/decisions/0001`).
- **On n'outille qu'un agacement vécu.** Une feature sans porte d'usage réel va dans *Plus tard* du Trello, sa porte écrite.
- **Un fait sur ce projet** va ici s'il vaut partout, sinon dans une règle ou une skill — la table est dans `plugin/skills/retenir/SKILL.md`. Le hook de forme relance la carte après chaque écriture dans le contexte.
- `npm test` vert, carte propre, et le sous-agent `relecteur` passé avant tout commit qui touche `plugin/` ou `.claude/`. Les commits vont sur `main`.
