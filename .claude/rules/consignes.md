---
paths:
  - "**/SKILL.md"
  - ".claude/agents/*.md"
  - "plugin/hooks/*.md"
---

# Écrire une consigne pour un modèle

Chargée en touchant une skill, un sous-agent ou le texte d'un hook. Ces principes ont été mesurés sur ce projet ; ils valent pour tout texte destiné à un agent.

- **Une consigne sans moment est remise à plus tard.** « Écris ce que tu découvres » : jamais fait. « Avant de terminer ta réponse, dis ce que tu as appris » : fait. « Au bon moment, sans insister » se lit comme une permission de se taire : 4 fois sur 6, contre 6 sur 6.
- **Une description dit quand**, avec les mots qu'emploiera la demande : c'est sur elle seule que Claude choisit de charger une skill. Une skill sans description n'existe pas pour lui.
- **Ce qui n'est pas un outil n'existe pas pour l'agent.** Un texte informe ; un hook, un `deny`, un script agissent. Ce qu'on veut voir arriver doit être atteignable par un appel d'outil ou appliqué par le client.
- **Un outil qui lève est abandonné ; un outil qui dit quoi faire est suivi.** Chaque avertissement, chaque refus porte sa correction en une ligne.
- **Borner ce qu'on demande d'écrire.** « Écris ce que tu as appris » sans borne produit un fichier qui redit la racine. Le rappel dit : seulement ce que le contexte ne dit pas encore ; pas une question de lecture ; dans le fichier existant avant un nouveau.
- **Le travail, pas le comportement** : 80 % du texte décrit le projet, 20 % au plus la manière de faire.
- **Resserrer ce qui marche rend l'outil insistant pour rien.** On corrige le défaut observé, pas la politesse autour.
- **Un scénario réparé en le déroulant ne prouve rien** : seul le passage sans reprise compte.
- Dans un `SKILL.md`, Claude Code remplace `$ARGUMENTS` et `${CLAUDE_PLUGIN_ROOT}`, rien d'autre : une expansion shell (`${ARGUMENTS:+…}`) arrive vide dans Bash. Un argument optionnel s'écrit en phrase (« si un argument est donné ($ARGUMENTS), ajoute … »), la commande reste nue.
