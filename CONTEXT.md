# Contexte projet — contextree

## Ce que c'est

Un **arbre de contexte** pour travailler avec une IA : tu décris une fois qui tu es, tes règles, ton domaine et tes savoir-faire, sous forme de petites branches typées. À chaque appel, un routeur ne charge que celles qui comptent pour la demande en cours.

C'est un `CLAUDE.md` qui aurait deux propriétés en plus :

1. **Il est routé.** Un `CLAUDE.md` est chargé en entier, tout le temps. Passé quelques centaines de lignes, on paie des tokens pour du bruit et on dilue le signal. Ici, une branche ne se charge que si sa condition (`load_when` : « charge-moi quand… ») correspond à la demande.
2. **Il est partageable.** Un `CLAUDE.md` vit dans un repo. Un arbre de contexte s'exporte, se donne, se greffe dans l'arbre de quelqu'un d'autre — et à terme se maintient à plusieurs.

## Le problème qu'on résout

Le contexte est le vrai goulot d'étranglement du travail avec l'IA :

- À chaque nouvelle session, l'IA repart de zéro. On recolle à la main « qui je suis, comment je bosse, quelles sont les règles ».
- Si on charge tout d'un coup, la qualité se dilue et on paie du bruit.
- Ce contexte, chèrement construit, reste **prisonnier d'un repo et d'une personne**. Le collègue d'à côté réécrit le sien de zéro, et l'équipe n'a jamais de socle commun.

Le premier point est un problème d'outillage. Les deux suivants sont un problème de **structure** — et c'est là que l'arbre gagne sur le fichier plat.

## Comment ça marche

**Cinq types de branche.** `identity` (qui est l'IA) · `rule` (contraintes dures) · `context` (connaissance de domaine, et nœuds de regroupement) · `reference` (API, chemins, commandes) · `skill` (savoir-faire activable). Toutes sont routées ; `identity` et `rule` sont en plus le filet de sécurité quand le routage échoue.

**Chaque branche porte sa condition de chargement.** Une phrase, écrite pour le routeur : « quand on touche à un composant ou du CSS », « si la demande parle d'API HTTP ». C'est le cœur du système, et c'est ce que l'utilisateur écrit lui-même.

**Si on charge un enfant, on charge tous ses parents.** Une branche profonde n'a de sens qu'avec le chemin qui y mène. Le routeur choisit des feuilles, le système remonte les ancêtres.

**Deux surfaces d'injection.** Un **hook** `UserPromptSubmit` sous Claude Code : déterministe, à chaque prompt, sans que l'agent ait à décider quoi que ce soit. Un **serveur MCP** partout ailleurs (Cursor, Windsurf, tout client MCP) : l'agent appelle `get_context` — moins déterministe, mais portable, et il sert aussi à *éditer* l'arbre depuis la conversation.

**Les fichiers sont la source de vérité.** Un dossier `.contextree/` de markdown avec frontmatter. Lisible, diffable, versionnable. Aucun format binaire, aucune base à migrer, et `git` fait le partage phase 1 gratuitement.

## Pour qui

D'abord un développeur solo qui code avec l'IA et en a assez de réexpliquer son projet. Ensuite son équipe, quand l'arbre devient un bien commun (voir `ROADMAP.md`).

## Ce qui différencie

- Le contexte est **structuré et sélectif**, pas un mur de texte.
- Il est **la propriété de l'utilisateur** : des fichiers markdown, indépendants du modèle et de l'éditeur.
- Il est **participatif** dès le départ : l'IA peut proposer des branches (`upsert_branch`), l'utilisateur arbitre en relisant un diff git.
- La transparence est un invariant : à chaque tour on peut voir exactement quelles branches ont été chargées.

## Ce que « bien fait » veut dire ici

Une feature est bien faite quand :

- Elle ne bloque jamais un prompt ni un appel IA (hook et routeur tombent en silence).
- Elle respecte la règle des ancêtres.
- Elle laisse `.contextree/` éditable à la main et lisible dans un diff.
- Elle n'ajoute pas de dépendance ni de concept sans en retirer un.
- `npm test` passe.

## Origine

Extrait de [`../ai-tree`](../ai-tree) (produit **Lacis**), dont l'arbre de contexte était la vraie valeur mais restait enterré sous une extension VS Code complète : arbre de conversation, webview React, agent repo, coffre chiffré. Ici on ne garde que le cœur — routage, résolution des ancêtres, fallback non bloquant, partage par pack — et on jette le reste.
