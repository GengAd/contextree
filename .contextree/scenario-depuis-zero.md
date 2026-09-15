---
type: skill
title: Le scénario « depuis zéro »
load_when: quand on vérifie qu'un agent marche de bout en bout, qu'on rejoue le scénario depuis zéro, ou qu'on prépare la démo
---

Le test qui compte : **quelqu'un part d'un projet qui n'a jamais entendu parler de contextree, demande à son IA de lui faire son contexte, et ça se passe proprement.** On le rejoue agent par agent ; il sert de trame à la démo.

## Le déroulé

1. **Un projet réel, jetable** : du code et un `CLAUDE.md` ou un `README` écrit par quelqu'un. Copie hors du dépôt d'origine, sans `node_modules` ni `.git`.
2. `contextree install` — **pas `init`**.
3. « bonjour, on fait quoi ? » → l'IA **propose** l'arbre, en fin de réponse, sans rien créer.
4. « oui » → l'IA montre **un plan** (chemins, types, `load_when`) et s'arrête. « Le plan me va » → `write_root` puis les branches, chaque écriture annoncée, renvoi à la toile.
5. La toile s'allume sur les écritures fraîches ; corriger deux `load_when` depuis la carte.
6. Trois prompts ciblés et différents (« comment on lance les tests ? », « ajoute une route API », « pourquoi ce choix d'archi ? ») → le journal montre une sélection **différente et pertinente** à chaque fois.
7. Une **vraie tâche** : l'IA écrit une branche et l'annonce avec sa motivation, **ou** dit qu'il n'y a rien à retenir. Un silence est un échec. Vérifier par les horodatages de `.contextree/`, pas par la parole de l'IA.

## Un passage réussi

- **Aucun fichier source touché** (seuls `.contextree/` et `.gitignore` bougent).
- **Aucun terminal après `install`.**
- **Aucun `load_when` qui soit un résumé**, aucun « toujours ».
- **Des familles, pas une liste** : un parent et un enfant par élément, même s'il n'y en a qu'un ; aucune `rule` sur un seul élément.
- **Le contrôle de forme est muet** (`contextree list`).
- **Le premier vrai prompt charge moins que tout l'arbre.**
- **D'une traite, sans reprise.** Un passage réparé en chemin ne prouve rien.

## Le mesurer sans y assister

`claude -p "…"` puis `claude -p -c "oui"` déroulent les étapes 3-4. Puis `contextree list`, `git status` (ou sommes de contrôle) dans le clone, et le journal sous `stateDir()/journal/`.

## Où on en est

Claude Code : déroulé en français et en anglais, étapes 3, 4, 6 et 7 ; forme de l'arbre vérifiée sur deux dépôts témoins « composants ». **Jamais joués** : l'étape 5 à la main, et tout le scénario sous Copilot (voir *Matrice des agents*).
