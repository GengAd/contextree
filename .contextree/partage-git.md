---
type: skill
title: Partager un arbre par git
load_when: quand on partage un arbre avec une équipe par git, en submodule ou dans le repo, qu'on se demande quoi commiter, ou qu'on règle un conflit sur .contextree/
---

Une équipe qui a un dépôt commun n'a besoin **que de git** : pull/push, conflits, historique et revue. Le backend est pour ceux qui n'en ont pas.

## Où le mettre

- **Dans le repo du projet** (défaut) : l'arbre suit les branches et les PR, un changement de contexte se relit dans la même revue que le code.
- **En submodule** (`git submodule add <url> .contextree`) : quand **plusieurs dépôts partagent le même contexte**, ou que l'arbre doit se relire sans accès au code.

## Ce qui ne se commite pas

- **`.contextree.local/`**, gitignoré à la création de l'arbre. Un collègue qui surcharge une branche dans son calque garde un `git status` vide.
- **Les fichiers de câblage** (`.vscode/mcp.json`, `.mcp.json`, `.cursor/mcp.json`) **tant que le paquet n'est pas publié** : ils portent des chemins de cette machine, et `install` le dit. Déjà commités, rien de grave : `install` reconnaît une commande absente de la machine et la réécrit. Une fois publié et pinné (`npx -y @gengad/contextree@<version> mcp`), ils deviendront portables.
- Les fichiers de consignes (`AGENTS.md`, `copilot-instructions.md`) **se commitent** : leur bloc est rendu sans le calque personnel.

## Le rituel

`git pull` avant, `git push` après avoir écrit dans l'arbre. **Un arbre écrit par l'IA est réinjecté ensuite : il se relit comme du code**, dans le diff.

## Les conflits

- **Un conflit non résolu dans le corps part au modèle** : les marqueurs `<<<<<<<` arrivent tels quels dans le bloc. Résoudre **avant** de relancer l'agent.
- **Un conflit dans le frontmatter ne se voit pas** : le parseur garde la dernière valeur, `list` affiche un `load_when` plausible. **Après un merge qui touche `.contextree/`, relire les `load_when` concernés.**
- Une branche surchargée en local **masque son propre conflit** : il reste à résoudre pour les autres.
