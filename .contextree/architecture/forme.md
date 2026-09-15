---
type: reference
title: Contrôle de forme de l'arbre
load_when: quand on touche à lint.ts, aux avertissements de forme (arbre plat, famille sans parent, load_when faible, branche trop longue), ou à l'endroit où ils s'affichent
---

`lintTree` (`core/lint.ts`) rend des **avertissements, jamais un refus** : un arbre de forme discutable reste un arbre, son auteur tranche. **Aucune sémantique** : ce qui ne se voit pas à la structure relève du plan et des exemples de la consigne `bootstrap`.

| code | déclenche |
|---|---|
| `no-root` | racine vide |
| `too-few` | moins de 4 branches |
| `crowded` | plus de 15 sœurs **sur un même niveau** (pas sur l'arbre entier : un arbre en familles doit pouvoir grandir) |
| `flat` | plus de 6 branches, aucune n'a d'enfant |
| `family` | sœurs au même motif sans parent (premier segment d'un chemin composé, ou premier mot ≥ 4 lettres d'un titre) |
| `load-when` | vide, en « toujours », ou recopié du titre |
| `heavy-parent` | parent plus long que tous ses enfants réunis — **à partir de deux enfants** (avec un seul, rien ne se multiplie) |
| `long` | corps de plus de 6 000 caractères : injecté en entier dès qu'une question le touche |
| `overlap` | au moins 60 % des mots (≥ 5 lettres) d'une branche se retrouvent dans la racine ou dans une autre branche — typiquement la réponse à « de quoi parle le projet ? » écrite en branche. Lexical, pas sémantique ; ignoré sous 12 mots distincts. Seuil calibré sur l'arbre de ce dépôt, dont les paires les plus proches plafonnent à 44 % |

Chaque message dit **quoi faire**, en fr et en en : il est lu par un modèle dans la réponse d'un outil.

**Lu partout où l'arbre se lit** : réponse d'`upsert_branch` / `delete_branch` / `move_branch` (sous « ⚠ Forme de l'arbre »), `contextree list`, `install --status`, et la toile — bordure et ligne « ⚠ » sur la carte nommée, la liste complète quand elle est sélectionnée, ceux de l'arbre entier sur la racine. Rien quand l'arbre est sain.

Un test écrit les arbres types de la consigne `bootstrap` et exige qu'ils passent le contrôle : un exemple qui échoue apprendrait la mauvaise forme.
