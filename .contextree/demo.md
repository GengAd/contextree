---
type: skill
title: La démo de dix minutes
load_when: quand on prépare ou répète la démo pour l'entreprise
---

Ce qui convainc, dans l'ordre : **le problème que tout le monde a senti**, l'outil qui le règle sous leurs yeux, « et ça marche avec votre éditeur ». Pas d'architecture, pas de roadmap.

## Trois préparations non négociables

La répétition chronométrée donnait **six minutes trente d'attente muette** pour dix minutes annoncées (arbre construit en 237 s, prompts routés en 14 à 22 s, étape d'écriture ratée).

1. **Une clé API**, pas le CLI : routage ~1 s au lieu de 14-22 s. Sans clé : expliquer le différé en une phrase, et enchaîner deux prompts sur le même sujet.
2. **Ne pas construire l'arbre en direct.** Deux copies du repo : une **sans** arbre pour l'invitation (9 s, un beau moment), une **avec** l'arbre déjà écrit pour la suite.
3. **Une tâche sur un coin que la doc ne couvre pas** (piège de build, convention non écrite) : sinon l'IA répond, à juste titre, « rien à retenir, c'est déjà écrit ».

Et le `.vsix` installé avant sur la machine de démo.

## Le déroulé

1. **Avant** *(1 min, parlé)* — le gros fichier de consignes : **15 997 caractères injectés à chaque prompt**, pour toutes les questions.
2. **Depuis zéro** *(2 min)* — `install`, « bonjour » : l'IA propose. Basculer sur la copie préparée, ouvrir la toile.
3. **Le routage** *(2 min)* — trois prompts, la barre latérale montre ce qui part. **15 997 → 4 007 caractères** sur « comment on lance les tests ? ». « Jamais de boîte noire. »
4. **L'IA qui apprend** *(2 min)* — elle découvre, écrit la branche, l'annonce ; la pastille s'allume ; on corrige le `load_when` dans la carte.
5. **En équipe** *(2 min)* — `.contextree/` par git, le calque local invisible des autres. Le backend seulement si on demande « et sans repo commun ? ».

## Plan B

Tout est local sauf l'appel au modèle. Réseau tombé : `route` retombe en repli (jamais vide), le journal montre les tours précédents, la toile marche, `render --copy` montre le bloc. On finit sur l'arbre plutôt que sur l'IA.
