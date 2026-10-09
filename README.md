# contextree

Voir et bien remplir le contexte d'un projet pour Claude Code.

Claude Code charge déjà seul le bon contexte au bon moment : `CLAUDE.md` à chaque session, une règle de `.claude/rules/` quand on touche un fichier qu'elle vise, une skill quand la tâche correspond à sa description, un hook quand l'événement arrive. Ce qui manque, c'est de **voir** l'ensemble et de **l'entretenir** : un fichier de contexte périmé est pire qu'absent, il est lu avec autorité.

contextree est un plugin Claude Code, sans dépendance, qui fait ces deux choses.

## Les deux skills

**`/contextree:carte`** — la carte du contexte : chaque fichier que Claude peut charger, groupé par moment (toujours / en touchant un fichier / quand la tâche en parle / à la main), son poids, et ce qu'il faut vérifier : règle qui ne vise aucun fichier, racine trop longue, skill sans description, lien mort, hook vers un script absent. `/contextree:carte src/api/x.ts` dit ce qui se charge pour ce fichier.

**`/contextree:retenir`** — où écrire un fait durable. Claude la charge seul quand il découvre une convention, une contrainte, un piège ; une table décide du fichier (voir *La méthode*). Il écrit directement et l'annonce en une phrase.

Et un hook qui, à chaque tour, demande à Claude **avant de terminer sa réponse** ce que la tâche lui a appris que le contexte ne dit pas encore. C'est ce moment précis qui fait que l'entretien arrive : mesuré sur ce projet, « au bon moment, sans insister » donne 4 écritures sur 6, « avant de terminer ta réponse » 6 sur 6.

## Installer

```bash
git clone git@github.com:GengAd/contextree.git
claude plugin marketplace add ./contextree
claude plugin install contextree@contextree
```

Dans une session : `/contextree:carte`. Une modification du clone est prise à la session suivante, ou avec `/reload-plugins`.

## La méthode

Trois couches, de Jake Van Clief : une **carte** lue en premier, des **pièces** chargées quand on y entre, des **outils** câblés où ils servent. Chez Claude Code, une question décide où va un fait :

| Le fait vaut… | Il va dans | Chargé |
|---|---|---|
| partout | `CLAUDE.md`, moins de 80 lignes avec ses imports | toujours |
| pour des fichiers précis | `.claude/rules/<sujet>.md` avec `paths:` | en touchant ces fichiers |
| pour un dossier | `<dossier>/CLAUDE.md` | en touchant ce dossier |
| pour un sujet | une skill `user-invocable: false` ; sa description dit quand | quand la tâche en parle |
| comme une procédure | une skill, avec ses arguments | sur demande ou quand Claude juge |
| comme un interdit | un hook ou un `deny` dans `.claude/settings.json` | appliqué, pas conseillé |
| pour toi seul | `CLAUDE.local.md`, `~/.claude/CLAUDE.md` | toujours, pour toi |

Et quatre règles : 80 % du texte sur le travail, 20 % sur le comportement ; le présent, pas l'histoire ; un fait à un seul endroit ; on commence petit et on laisse l'usage grossir les fichiers.

## Ce que contextree ne fait pas, exprès

Pas de format à lui, pas de routeur, pas de serveur : Claude Code charge, contextree regarde et aide à remplir. Pas d'heuristique qui devine où va un fait : c'est Claude, le projet sous les yeux, qui écrit, et vous qui relisez.

## Développer

```bash
npm test                                      # la carte sur tests/fixture
node plugin/skills/carte/scripts/carte.mjs    # la carte de ce dépôt
claude plugin validate ./plugin
```

Le travail est piloté par le tableau Trello « contextree » ; la skill `tache-trello` de ce dépôt dit comment.
