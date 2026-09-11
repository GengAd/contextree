---
type: skill
title: Partager un arbre par git
load_when: quand on partage un arbre avec une équipe par git, en submodule ou dans le repo, ou qu'on règle un conflit sur .contextree/
---

Une équipe qui a déjà un dépôt commun n'a besoin de **rien d'autre que git** pour partager un arbre : pull/push, conflits, historique et revue sont ceux de git. Le backend (P7) est pour ceux qui n'ont pas ce dépôt.

## Deux montages, et lequel choisir

**Le dossier dans le repo du projet** — `.contextree/` versionné avec le code. C'est le défaut : l'arbre suit les branches et les PR du projet, un changement de contexte se relit dans la même revue que le changement de code. À préférer tant qu'un seul projet est concerné.

**Le submodule** — `.contextree/` est un dépôt à part, monté dans le projet :

```bash
git submodule add <url-de-l-arbre> .contextree
```

À prendre quand **plusieurs dépôts partagent le même contexte** (une équipe, un domaine métier), ou quand l'arbre doit se relire sans donner accès au code.

Les deux marchent, vérifié le 11 septembre 2026 : `.git` est un **dossier** dans un clone et un **fichier** dans un submodule, et `walk()` ignore les deux — `findTreeDir` remonte comme d'habitude, `install --status` ne change pas.

## Ce qui ne se partage jamais

`.contextree.local/` est **gitignoré dès la création de l'arbre**. C'est tout ce qui fait tenir le calque personnel : un dossier frère plutôt qu'un champ dans le frontmatter, précisément pour qu'un `git add -A` ne puisse pas pousser des notes privées au groupe.

La ligne s'ajoute toute seule (`ensureLocalIgnored`), sur les deux chemins de création — `init` et `write_root`. Elle n'écrase jamais un `.gitignore` existant, et ne fait rien hors d'un dépôt git.

Déroulé à deux : Béa surcharge `deploiement` dans son calque, ajoute une branche perso, et son `git status` reste **vide**. Adrien continue de voir la version du groupe. Les vues marquent la branche surchargée `· local`.

## Le rituel

Rien de particulier : `git pull` avant de travailler, `git push` après avoir écrit dans l'arbre. Un arbre modifié par l'IA en cours de session est un changement comme un autre — il se relit dans le diff avant d'être poussé, et c'est souhaitable : *l'arbre écrit par l'IA est réinjecté ensuite, donc il se relit comme du code*.

## Les conflits — deux choses qu'on ne devine pas

Un conflit sur une branche de l'arbre est un conflit git ordinaire, et le fichier reste lisible à la main. Mais :

**1. Un conflit non résolu dans le *corps* d'une branche part au modèle.** Mesuré : les marqueurs `<<<<<<<` se retrouvent tels quels dans le bloc injecté. Rien ne casse — le hook sort en 0, l'arbre se charge — mais le modèle reçoit deux versions contradictoires sans savoir laquelle vaut. **Résoudre avant de relancer l'agent**, pas après.

**2. Un conflit dans le *frontmatter* ne se voit pas du tout.** Le parseur prend la dernière valeur rencontrée et n'annonce rien : `contextree list` affiche un `load_when` plausible, choisi au hasard entre les deux. C'est le cas le plus traître, parce qu'il ressemble à un arbre sain. **Après un merge qui a touché `.contextree/`, relire les `load_when` des branches concernées** — c'est le champ qui décide de tout, et c'est celui qu'un conflit corrompt en silence.

**Effet de bord utile** : une branche surchargée dans le calque local masque son propre conflit — le local gagne, et l'utilisateur travaille sans voir le fichier de groupe abîmé. Pratique sur le moment, trompeur à la longue : le conflit reste à résoudre pour les autres.
