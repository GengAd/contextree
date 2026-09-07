# Roadmap — contextree

Quatre temps. Chacun n'ouvre que quand le précédent est utilisé pour de vrai : la structure sociale (groupes, orgs) ne vaut rien tant que l'arbre solo n'est pas devenu une habitude.

---

## Phase 1 — Partager facilement ✅ *(livré)*

**Objectif** : envoyer son arbre à un collègue ou un ami, sans compte ni serveur.

- Source de vérité en markdown ⇒ `git` partage l'arbre gratuitement pour qui travaille sur le même repo.
- `contextree export -o pack.json` — un fichier à envoyer.
- `contextree export --token` — un jeton compressé collable dans un chat.
- `contextree import <jeton|fichier> [--prefix equipe]` — greffe dans l'arbre local, en isolant si besoin.
- Outils MCP `export_pack` / `import_pack` : l'échange se fait depuis la conversation.

**Non fait exprès** : pas de registre, pas d'URL, pas de compte. Un pack circule comme un fichier.

---

## Phase 2 — Un groupe qui maintient un contexte commun

**Objectif** : plusieurs personnes lisent *et écrivent* le même arbre, avec la possibilité de spécialiser pour tout le monde.

Ce que ça demande, dans l'ordre :

1. **Une identité et un backend.** Premier vrai serveur : comptes, groupes, arbres versionnés. Supabase (Postgres + auth + RLS) est le candidat par défaut — les politiques de ligne préfigurent directement la hiérarchie de la phase 4.
2. **Sync bidirectionnelle.** `contextree pull` / `push`, avec l'arbre local qui reste la copie de travail. Le modèle mental est `git`, pas Dropbox : on résout les conflits, on ne les écrase pas.
3. **Superposition (« spécialiser pour tout le monde »).** Un arbre de groupe + un calque local. Une branche locale peut *surcharger* une branche de groupe ; le groupe peut pousser une branche qui s'ajoute chez tout le monde. Le rendu résout la superposition, la branche la plus spécifique gagne.
4. **Proposition plutôt qu'écriture directe.** L'IA propose (`upsert_branch`), un humain valide. Sur un arbre partagé, ça devient une revue : une proposition, une diff, un merge.

**Décision ouverte** : le calque local est-il un dossier séparé (`.contextree.local/`) ou un champ `overrides:` dans le frontmatter ? Le dossier séparé est plus lisible dans un diff ; le champ garde tout au même endroit.

---

## Phase 3 — Partager certains arbres, pas tous

**Objectif** : choisir ce qu'on expose et à qui, sans tout ouvrir.

- Plusieurs arbres par personne (un par projet, un « perso » transverse).
- Visibilité par arbre : privé / lien / groupe / public.
- Un annuaire minimal d'arbres publics — le contexte d'un framework, d'une stack, d'une méthodo, réutilisable par quiconque.
- Fork + suivi de l'amont : je greffe l'arbre de quelqu'un, je le modifie, je vois quand il évolue.

**Le risque à surveiller** : un annuaire public devient vite un dépotoir. Prévoir d'emblée la provenance (qui maintient, dernière mise à jour) plutôt que de l'ajouter après.

---

## Phase 4 — Structures d'entreprise

**Objectif** : une hiérarchie d'entités, avec un accès qui n'est pas uniforme.

```
Entreprise
 └─ Équipe A            (tout le monde n'a pas accès à toutes les équipes)
     └─ Sous-équipe
         └─ Projet      (dernier niveau)
 └─ Équipe B
```

- **Héritage descendant** : un projet hérite du contexte de son équipe, qui hérite de celui de l'entreprise. Un membre voit la chaîne complète de ce à quoi il a accès — et exactement la même règle que les ancêtres de branche, appliquée un cran au-dessus.
- **Accès par nœud** : l'appartenance se déclare à un niveau et se propage vers le bas. Ne pas être dans l'équipe A, c'est ne pas voir son sous-arbre.
- **Rôles** : lecteur / contributeur / mainteneur, par nœud.
- **Audit** : qui a changé quelle branche, quand. À ce niveau, le contexte devient de la doc opérationnelle.

**Le pari à vérifier avant de construire** : que la même mécanique d'héritage serve pour les branches *et* pour les entités. Si oui, la phase 4 est surtout du contrôle d'accès posé sur un moteur qui existe déjà. Sinon, c'est un deuxième produit — et il faudra le dire.

---

## Hors périmètre, assumé

- Pas d'arbre de conversation (c'est [Lacis](../ai-tree), un autre produit).
- Pas d'agent, pas d'exécution d'outils, pas d'éditeur intégré.
- Pas de génération automatique de l'arbre au démarrage : le `load_when` est ce que l'utilisateur sait et que le modèle ne devine pas. Une assistance à la rédaction, oui ; une génération à sa place, non.
