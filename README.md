# contextree

Voir et bien remplir le contexte d'un projet pour Claude Code.

Claude Code charge déjà seul le bon contexte au bon moment : `CLAUDE.md` à chaque session, une règle de `.claude/rules/` quand on touche un fichier qu'elle vise, une skill quand la tâche correspond à sa description, un hook quand l'événement arrive. Ce qui manque, c'est de **voir** l'ensemble et de **l'entretenir** : un fichier de contexte périmé est pire qu'absent, il est lu avec autorité.

contextree est un plugin Claude Code, sans dépendance, qui fait ces deux choses.

## Les cinq skills

**`/contextree:carte`** — la carte du contexte : chaque fichier que Claude peut charger, groupé par moment (toujours / en touchant un fichier / quand la tâche en parle / à la main), son poids, et ce qu'il faut vérifier : règle qui ne vise aucun fichier, racine trop longue, skill sans description, lien mort, hook vers un script absent. `/contextree:carte src/api/x.ts` dit ce qui se charge pour ce fichier.

**`/contextree:init-contexte`** — le premier jour d'un projet : tu expliques le projet, Claude lit le dépôt, propose un plan de fichiers (un `CLAUDE.md` court avec sa table « où aller », des règles à `paths`, des skills de domaine, un hook par interdit), écrit après ton accord, et finit par la carte sans avertissement. Ensuite il maintient tout seul avec `retenir`.

**`/contextree:migrer-v1`** — pour un projet encore sur l'ancien contextree (voir plus bas).

**`/contextree:jardin`** — la revue de fin de session : Claude relit le contexte contre ce que la session a changé (les fichiers qui citent un chemin modifié, ceux qui n'ont pas bougé depuis six semaines, les avertissements de la carte, ce que la conversation a appris) et propose des diffs classés — faux, manquant, à extraire, à découper. Il n'écrit que ceux que tu choisis.

**`/contextree:retenir`** — où écrire un fait durable. Claude la charge seul quand il découvre une convention, une contrainte, un piège ; une table décide du fichier (voir *La méthode*). Il écrit directement et l'annonce en une phrase.

Et un hook qui, à chaque tour, demande à Claude **avant de terminer sa réponse** ce que la tâche lui a appris que le contexte ne dit pas encore. C'est ce moment précis qui fait que l'entretien arrive : mesuré sur ce projet, « au bon moment, sans insister » donne 4 écritures sur 6, « avant de terminer ta réponse » 6 sur 6.

## Installer chez toi

Il ne faut que Claude Code :

```bash
claude plugin marketplace add GengAd/contextree
claude plugin install contextree@contextree
```

Ou depuis une session : `/plugin marketplace add GengAd/contextree`, puis `/plugin install contextree@contextree`. Ensuite, dans n'importe quel projet : `/contextree:carte`.

Mettre à jour, quand le [CHANGELOG](CHANGELOG.md) annonce une version :

```bash
claude plugin marketplace update contextree
claude plugin update contextree@contextree
```

puis une nouvelle session, ou `/reload-plugins` dans celle en cours.

## La vue dans Cursor

La même carte en barre latérale, dans l'explorateur : sections par moment de chargement, poids, calque perso grisé, avertissements ; un clic ouvre le fichier, une sauvegarde d'un fichier de contexte la rafraîchit.

```bash
npm run package:ext                                   # → extension/contextree.vsix
cursor --install-extension extension/contextree.vsix  # ou palette → « Extensions: Install from VSIX… »
```

Détails dans [`extension/README.md`](extension/README.md).

## Tu viens de l'ancien contextree

La v1 (arbre `.contextree/`, routeur, serveur MCP, extension) est remplacée, pas maintenue. Sur ta machine, une fois :

```bash
npm uninstall -g @gengad/contextree ; npm unlink @gengad/contextree 2>/dev/null   # le binaire global
rm -rf ~/.contextree                                                               # l'état du routeur
cursor --uninstall-extension gengad.contextree-vscode                              # ou code --uninstall-extension
```

Puis, dans chaque projet qui a un `.contextree/` : `/contextree:migrer-v1`. Claude convertit l'arbre en fichiers natifs, retire le hook et le serveur MCP du projet, relit ce qui parlait encore de « branches », et finit par la carte sans avertissement.

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

Le plugin installé est une **copie figée à sa version** (`~/.claude/plugins/cache/contextree/contextree/<version>`), même installé depuis un clone : une modification du clone ne sort pas de ce dépôt. Pour l'essayer dans un autre projet, monter la version, puis `claude plugin marketplace update contextree` et `claude plugin update contextree@contextree`, et ouvrir une nouvelle session.

```bash
git clone git@github.com:GengAd/contextree.git
claude plugin marketplace add ./contextree
claude plugin install contextree@contextree

npm test                                                  # la carte, le hook de forme, la vue et le jardin
node plugin/skills/carte/scripts/carte.mjs --sans-perso   # la carte de ce dépôt
claude plugin validate ./plugin && claude plugin validate .
```

Un changement visible du plugin monte la `version` de `plugin/.claude-plugin/plugin.json` et ajoute une entrée au [CHANGELOG](CHANGELOG.md) : c'est la version qui déclenche la mise à jour chez ceux qui l'ont installé.

Le dépôt applique sa propre méthode : un `CLAUDE.md` court avec sa table « où aller », des règles à `paths` dans `.claude/rules/`, un hook qui relance la carte après chaque écriture dans le contexte, un sous-agent `relecteur` avant commit, `/livrer` pour pousser, et une décision d'architecture dans `docs/decisions/`. Le travail est piloté par le tableau Trello « contextree » ; la skill `tache-trello` dit comment.

## Licence

MIT — voir [LICENSE](LICENSE).
