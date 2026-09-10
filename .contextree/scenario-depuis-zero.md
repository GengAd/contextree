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
7. Pendant une vraie tâche, l'IA découvre un fait durable : elle écrit une branche, et elle le dit.

## Ce qui fait un passage réussi

- **Aucun fichier source touché.** Ni `CLAUDE.md`, ni le code. L'IA écrit dans `.contextree/`, nulle part ailleurs.
- **Aucun `load_when` qui soit un résumé.** C'est le seul champ qui décide de quelque chose ; un titre déguisé en condition est un échec silencieux, pas un détail de style.
- **Le premier vrai prompt après création charge moins que tout l'arbre.** Un arbre qui se charge en entier n'a rien routé — autant garder le gros fichier de consignes.
- **Aucun terminal après `install`.** Tout se fait depuis la conversation et la toile. Le terminal est le geste qu'on cherche à supprimer.

## Comment le mesurer sans y assister

`claude -p "…"` puis `claude -p -c "oui"` déroulent les étapes 3 et 4 sans session interactive. Ce qui s'est passé se lit ensuite sans deviner : `contextree list` pour les branches et leurs `load_when`, `git status` dans le clone pour vérifier qu'aucune source n'a bougé, et le journal (`~/.contextree/journal/`) pour ce que chaque prompt a réellement chargé.
