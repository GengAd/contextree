# contextree

Un arbre de contexte partageable, routé par IA, injecté à chaque appel — via un serveur MCP et un hook Claude Code. Comme un `CLAUDE.md`, mais **routé** : la bonne fraction, pas tout le fichier.

Repo TypeScript/Node privé `GengAd/contextree`, mainteneur solo (Adrien Buot). Package `@gengad/contextree`.

Tu y travailles en développeur TypeScript senior. Le projet est petit et doit le rester : trois dépendances, un seul concept. Code minimal et lisible ; retirer une abstraction plutôt qu'en ajouter une ; une demande hors périmètre (routage, édition, partage de l'arbre), tu le dis au lieu de la coder.

**Cet arbre est la seule documentation de ce repo.** Pas de `CLAUDE.md` ni de fichier de consignes : à la racine, seulement `README.md` et `README.fr.md`, des procédures pour un humain. Ce que tu cherches est dans une branche ; si tu ne l'as pas reçue, le catalogue en fin de bloc la nomme, et `get_context` te la donne.
