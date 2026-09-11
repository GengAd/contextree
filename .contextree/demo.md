---
type: skill
title: La démo de dix minutes
load_when: quand on prépare ou répète la démo pour l'entreprise
---

Présenter contextree à une équipe. Ce qui convainc, dans l'ordre : **le problème que tout le monde a déjà senti**, l'outil qui le règle sous leurs yeux, puis « et ça marche avec votre éditeur ». Pas d'architecture, pas de roadmap.

## Ce que la répétition du 11 septembre 2026 a appris

Chronométrée sur un vrai projet (`ai-tree` : `CLAUDE.md` + `CONTEXT.md` + `REFERENCES.md`), moteur CLI, sans clé API :

| Étape | Temps machine | Verdict |
|---|---|---|
| `install` | 1 s | — |
| « bonjour » → l'IA propose | 9 s | bien |
| « oui » → l'IA construit l'arbre | **237 s** | **injouable en direct** |
| 3 prompts routés | 14 + 19 + 22 s | trop lent sans clé |
| l'IA écrit une branche | 84 s | **a répondu « rien à retenir »** |

Soit **six minutes trente d'attente muette** pour dix minutes annoncées, avant d'avoir dit un mot. Jouée naïvement, cette démo ne tient pas.

## Les trois corrections qui la font tenir

**1. Une clé API, pas le CLI.** `ANTHROPIC_API_KEY` met le routage à ~1 s contre 14-22 s. C'est la seule préparation non négociable : trois prompts sur scène, c'est une minute de silence sans elle. Si la clé manque, expliquer le différé en une phrase et enchaîner **deux prompts sur le même sujet** — le second profite du routage du premier.

**2. Ne pas construire l'arbre en direct.** Quatre minutes où il ne se passe rien à l'écran. Préparer **deux copies** du repo de démo : une **sans** arbre pour montrer l'invitation (« bonjour » → l'IA propose, 9 s, et c'est un beau moment), une **avec** l'arbre déjà construit pour la suite. Dire « je l'ai lancé tout à l'heure, voilà ce qu'il a écrit » et ouvrir la toile.

**3. Choisir une question dont la réponse n'est pas déjà écrite.** À la répétition, l'IA a répondu « rien à retenir : c'est déjà dans `REFERENCES.md` » — et **elle avait raison**. Le garde-fou anti-bruit fonctionne, mais il fait rater l'étape. Prendre un coin du code que la doc du projet ne couvre pas : un piège de build, une convention de nommage non écrite, le comportement d'un adaptateur.

## Le déroulé (10 min)

1. **Avant** *(1 min, parlé)* — ouvrir le gros fichier de consignes du repo. Le chiffre qui frappe : sur le projet de la répétition, **15 997 caractères injectés à chaque prompt**, pour toutes les questions, y compris « comment on lance les tests ». Le coût, le bruit, et l'obsolescence de ce qu'on relit jamais.
2. **Depuis zéro** *(2 min)* — `contextree install`, « bonjour » : l'IA propose l'arbre, sans rien créer. Puis basculer sur la copie préparée : racine + 9 branches, chacune avec son `load_when`. Ouvrir la toile.
3. **Le routage** *(2 min)* — trois prompts différents. Montrer la barre latérale : quelles branches sont parties, à chaque fois. Le chiffre : **15 997 → 4 007 caractères** sur « comment on lance les tests ? », soit une seule branche sur neuf. « Jamais de boîte noire. »
4. **L'IA qui apprend** *(2 min)* — une tâche réelle sur un coin non documenté : elle découvre, écrit la branche, l'annonce. La pastille s'allume dans la vue ; on corrige son `load_when` dans la carte, à la souris.
5. **En équipe** *(2 min)* — `.contextree/` partagé par git, un collègue le récupère, son calque local par-dessus, invisible des autres. Le backend seulement si quelqu'un demande « et sans repo commun ? ».

## Plan B

Tout est local : aucune étape ne demande le réseau sauf l'appel au modèle. Si le réseau tombe — `contextree route` échoue en repli (jamais vide), le journal déjà rempli montre les tours précédents, la toile et la barre latérale fonctionnent, et `render --copy` montre le bloc. La démo se termine sur l'arbre plutôt que sur l'IA.

Le `.vsix` doit être **installé avant** sur la machine de démo (`npm run package:ext`, puis `--install-extension`).
