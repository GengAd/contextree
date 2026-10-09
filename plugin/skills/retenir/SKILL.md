---
name: retenir
description: Écrire un fait durable sur ce projet dans le bon fichier de contexte (CLAUDE.md, une règle à paths, une skill, un CLAUDE.md de dossier, un hook). À utiliser dès que tu découvres une convention, une contrainte, un piège ou un chemin important que les fichiers de contexte ne disent pas encore, ou quand l'utilisateur dit « retiens », « note que », « à l'avenir ».
---

# Retenir un fait

Le contexte de ce projet est fait de fichiers que tu peux éditer. Écris **directement**, sans demander la permission, puis **annonce en une phrase** ce que tu as écrit et où — c'est le seul garde-fou : ce que tu écris te sera relu à chaque session, avec autorité.

## Est-ce que ça vaut un fichier ?

Oui si c'est **encore vrai demain** et que **rien ne le dit encore**. Non si :
- c'était une question de lecture (« de quoi parle le projet ? ») : la réponse est déjà dans les fichiers ;
- c'est l'histoire d'une décision (« on a d'abord essayé X ») : l'histoire est dans git ;
- c'est propre à toi et pas au projet : ta mémoire automatique s'en charge, pas le dépôt.

## Où l'écrire — une question décide

| Le fait vaut… | Il va dans | Chargé |
|---|---|---|
| partout, à chaque tâche | `CLAUDE.md` (court : moins de 80 lignes avec ses imports) | toujours |
| pour des fichiers précis | `.claude/rules/<sujet>.md` avec `paths:` | en touchant ces fichiers |
| pour tout un dossier | `<dossier>/CLAUDE.md` | en touchant ce dossier |
| pour un sujet, sans fichier précis | une skill `user-invocable: false` ; la `description` dit **quand** | quand la tâche en parle |
| comme une suite d'étapes | une skill (procédure), avec `argument-hint` si elle prend des arguments | sur demande ou quand Claude juge |
| comme interdit absolu | un hook ou un `deny` dans `.claude/settings.json` — un texte ne bloque rien | toujours appliqué |
| comme justification longue | `docs/decisions/NNNN-titre.md`, cité depuis la règle | sur lien |
| pour toi seul, ou dans un dépôt qui ne doit rien recevoir | `CLAUDE.local.md` (ignoré par git) ou `~/.claude/CLAUDE.md` | toujours, pour toi |

Si le projet a un `AGENTS.md` importé par `CLAUDE.md`, ce qui vaut pour tous les agents va dans `AGENTS.md`, ce qui est propre à Claude Code reste dans `CLAUDE.md`.

## Comment l'écrire

1. **Cherche d'abord le fichier qui couvre déjà le sujet** et complète-le. Un fait vit à un seul endroit ; ailleurs, on renvoie à ce fichier.
2. **Le présent, pas l'histoire** : « les montants sont en centimes », pas « on est passé aux centimes ».
3. **Le travail, pas le comportement** : « l'audience est… », « les tests ne mockent pas le domaine » changent plus la sortie que « sois concis ».
4. **Court.** Une skill au-delà de 500 lignes se découpe en fichiers voisins ; une règle qui grossit se coupe en deux sujets.
5. **Une description dit quand**, avec les mots qu'emploiera la demande : c'est sur elle seule que tu choisiras de charger la skill.
6. Un fait qui contredit un fichier existant : **corrige le fichier** et dis-le. Un fichier faux est pire qu'absent.

Ensuite, la carte doit rester sans avertissement :

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/carte/scripts/carte.mjs"
```
