---
type: skill
title: Le scénario « depuis zéro »
load_when: quand on vérifie qu'un agent marche de bout en bout, qu'on rejoue le scénario depuis zéro, ou qu'on prépare la démo
---

Le test qui compte : **quelqu'un part d'un projet qui n'a jamais entendu parler de contextree, demande à son IA de lui faire son contexte, et ça se passe proprement.** Aucune fonction prise séparément ne mesure ça. C'est celui-ci qu'on rejoue agent par agent (P4) et qui sert de trame à la démo (P5).

## Le déroulé

1. **Un projet réel, jetable.** Du code, et un `CLAUDE.md` ou un `README` écrit par quelqu'un — pas un dossier vide, pas un projet inventé pour l'occasion : ce qu'on teste, c'est la lecture de consignes que personne n'a écrites en pensant à contextree. Copie hors du dépôt d'origine, sans `node_modules` ni `.git`.
2. `contextree install` — **pas `init`**. Créer l'arbre à la main serait sauter l'étape qu'on veut voir.
3. Ouvrir l'agent, « bonjour, on fait quoi ? ». L'IA **propose** l'arbre.
4. « oui ». Elle lit les fichiers, écrit `root.md` puis 6 à 12 branches avec des `load_when` en condition, **annonce** chaque écriture, et renvoie à la toile.
5. La toile s'allume sur les écritures fraîches. Relire, corriger deux `load_when` depuis la carte.
6. Trois prompts ciblés et différents — « comment on lance les tests ? », « ajoute une route API », « pourquoi ce choix d'archi ? ». `contextree route` et le journal doivent montrer une sélection **différente et pertinente** à chaque fois.
7. Pendant une vraie tâche — pas une question de lecture —, l'IA découvre un fait durable : elle écrit une branche **et l'annonce avec sa motivation**, ou elle dit explicitement qu'il n'y a rien à retenir. Un silence est un échec de cette étape, même quand la réponse est juste. Vérification : les horodatages de `.contextree/`, pas la parole de l'IA.

## Ce qui fait un passage réussi

- **Aucun fichier source touché.** Ni `CLAUDE.md`, ni le code. L'IA écrit dans `.contextree/`, nulle part ailleurs.
- **Aucun `load_when` qui soit un résumé.** C'est le seul champ qui décide de quelque chose ; un titre déguisé en condition est un échec silencieux, pas un détail de style.
- **Le premier vrai prompt après création charge moins que tout l'arbre.** Un arbre qui se charge en entier n'a rien routé — autant garder le gros fichier de consignes.
- **Aucun terminal après `install`.** Tout se fait depuis la conversation et la toile. Le terminal est le geste qu'on cherche à supprimer.
- **Un plan avant toute écriture** (14 septembre 2026). Au premier tour, l'IA montre l'arborescence, les types et les `load_when`, et s'arrête : pas de `.contextree/` tant que l'utilisateur n'a pas dit oui.
- **Des familles, pas une liste.** Un projet qui a des composants, des écrans ou des endpoints donne un parent et un enfant par élément — **même s'il n'y en a qu'un**. Aucune `rule` ne parle d'un seul élément.
- **Le contrôle de forme est muet** sur l'arbre écrit : `contextree list` n'affiche aucun « ⚠ Forme de l'arbre ».

## Comment le mesurer sans y assister

`claude -p "…"` puis `claude -p -c "oui"` déroulent les étapes 3 et 4 sans session interactive. Ce qui s'est passé se lit ensuite sans deviner : `contextree list` pour les branches et leurs `load_when`, `git status` dans le clone pour vérifier qu'aucune source n'a bougé, et le journal (`<dossier d'état>/journal/`, voir *Journal des tours*) pour ce que chaque prompt a réellement chargé.

## Rejoué en anglais — 14 septembre 2026

Sur une copie de `lacis-site` (Astro, README en anglais écrit par quelqu'un, sans `.git` ni `node_modules`), Claude Code en `claude -p` (`sonnet`), `install --agent claude-code --lang en`. Étapes 3, 4 et 6 :

- **3** — « hi, what are we doing? » : l'IA répond à la question, puis **propose l'arbre en une phrase, à la fin** — la traduction n'a pas fait taire l'invitation.
- **4** — « yes » : racine + **5 branches**, en anglais, écrites sans terminal, `load_when` tous en condition (« when touching the deploy workflow, hosting config, or build output »), renvoi à la toile. **Aucun fichier source touché** (sommes de contrôle identiques). Un cran sous les 6 à 12 demandées : la consigne fixe une fourchette, le modèle a regroupé.
- **6** — « how does the deploy to Hostinger work? » : routé sur **1 branche sur 5**, la bonne, en 6 s.

Pas rejoués : l'étape 5 (la toile) et l'étape 7 (une vraie tâche qui fait écrire une branche).

## Rejeu « forme de l'arbre » — 14 septembre 2026

Claude Code (`sonnet`, `claude -p`, serveur MCP seul, sans hook), sur deux dépôts témoins « bibliothèque de composants » : « Construis l'arbre de contexte contextree de ce projet », puis « Le plan me va, écris l'arbre ».
- **3 composants** : au premier tour, liste de 10 demandes et plan en tableau (chemins, types, `load_when`), **aucun `.contextree/`**. Au second, 9 branches + racine : `composants` (`rule`, les conventions communes) et un enfant `context` par composant, `plateforme`, `commandes`, deux skills. Seule `rule` : le parent. Contrôle de forme : **aucun avertissement**. Aucun fichier source touché (seuls `.contextree/` et `.gitignore` apparaissent).
- **1 composant** : même déroulé, **la famille est créée quand même** (`composants/datepicker`). Le contrôle signalait « parent plus long que ses enfants » : c'était la règle qui était fausse — avec un seul enfant rien ne se multiplie. Corrigée (à partir de deux enfants) ; l'arbre passe ensuite sans avertissement.

Reste la mesure sous **Copilot** (carte H « Dérouler une ligne d'éditeur ») : même dépôt témoin, puis le projet réel d'Adrien.

