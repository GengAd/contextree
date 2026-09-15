---
type: rule
title: Écrire une consigne pour un modèle
load_when: quand on écrit ou retouche un texte lu par un modèle — instructions du serveur MCP, description d'outil, bloc injecté, invitation, consigne bootstrap, fichier AGENTS.md — ou qu'un agent ne fait pas ce que la consigne lui demande
---

Les principes mesurés sur ce projet. Ils valent pour tout texte destiné à un agent.

- **Une consigne sans moment est remise à plus tard.** « Écris ce que tu découvres » : jamais fait. « **Avant de terminer ta réponse**, dis ce que tu as appris » : fait. « Propose-le au bon moment, sans insister » : 4 fois sur 6 ; « avant de terminer ta réponse » : 6 sur 6. « Au bon moment » et « sans insister » se lisent comme une permission de se taire.
- **Ce qui n'est pas un outil n'existe pas pour l'agent.** Une consigne dans les `instructions`, un prompt MCP, une invitation en texte informent ; rien de tout ça n'agit. Ce qu'on veut voir arriver doit être atteignable par un appel d'outil.
- **Là où la consigne arrive compte autant que ce qu'elle dit.** Les `instructions` sont lues une fois, à la connexion, avant toute tâche. Le bloc injecté et la description d'un outil sont là à chaque tour.
- **Un outil qui lève est abandonné ; un outil qui dit quoi faire est suivi.**
- **Fréquence et déclenchement sont deux réglages** : une invitation une fois par session, mais à un moment précis de ce tour-là.
- **Resserrer ce qui marche rend l'outil insistant pour rien.** On corrige le défaut observé, pas la politesse autour.
- **Traduire une consigne, c'est garder son moment**, pas seulement son sens.
- **Un scénario réparé en le déroulant ne prouve rien** : seul le passage sans reprise parle, et un critère qui tient à quelques secondes près est en sursis.
- **Borner ce qu'on demande d'écrire.** « Écris ce que tu as appris » sans borne a produit, sur « de quoi parle le projet ? », une branche éponyme qui redisait la racine. Le rappel dit maintenant : seulement ce que l'arbre ne dit pas encore ; pas une question de lecture ; dans la branche existante ou la racine avant une nouvelle branche.
