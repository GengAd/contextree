---
type: reference
title: Format sur disque
load_when: quand on touche au chargement, à l'écriture ou au parcours de .contextree/
---

Le **parent** vient de l'arborescence de dossiers, le **type** du frontmatter — deux axes indépendants.

```
.contextree/
  root.md              hub racine, toujours injecté, jamais routé
  architecture.md      une branche
  architecture/        ses enfants (même nom, sans .md)
    format-disque.md
```

Frontmatter : `type` (défaut `context`), `title` (défaut : le slug), `load_when` (défaut : le titre). Scalaires une ligne uniquement.

Deux comportements à préserver :

- **un dossier sans `.md` frère devient un hub implicite** (branche vide, type `context`) — sinon les fichiers qu'il contient seraient silencieusement ignorés ;
- **`order` est un parcours en profondeur alphabétique et c'est contractuel** — les indices envoyés au routeur en dépendent. `compareBranchPaths` compare **segment par segment**, parce qu'un tri lexicographique nu se tromperait : `-` (0x2D) passe avant `/` (0x2F), donnant `a`, `a-b`, `a/b` au lieu de `a`, `a/b`, `a-b`.

**`findTreeDir` remonte l'arborescence** comme `.git` : la CLI se lance depuis n'importe quel sous-dossier. **Mais jamais jusqu'au dossier utilisateur** (14 septembre 2026) : sous `~`, la remontée s'arrête avant lui, et le dossier d'état n'est jamais rendu quel que soit son nom. Aucun arbre ne vit dans `~/.contextree` ni n'y naît — `write_root` et `init` y refusent. Un arbre perso monté dans chaque projet viendra par montage (P8), pas par remontée.

**Où vit quoi.** L'arbre : `<projet>/.contextree/` (partagé) et `<projet>/.contextree.local/` (le calque perso). L'état — journal, sélection, marqueurs de session, config et suivi du backend — hors du projet, dans `stateDir()` : voir *Journal des tours*. Rien de ce qui est dans l'un ne va dans l'autre.

**Un dépôt git *dans* l'arbre est ignoré**, ce qui rend le submodule possible. `walk()` écarte les dossiers commençant par `.`, et ne lit que les `.md` — or `.git` est un **dossier** dans un clone et un **fichier** dans un submodule (`gitdir: …`). Les deux passent à travers sans cas particulier. Vérifié le 11 septembre 2026 en montant un vrai submodule : l'arbre se lit, `findTreeDir` remonte, `install --status` ne bouge pas.

## Le calque local

Le calque personnel est un **dossier frère**, `.contextree.local/`, de format identique — pas un champ `overrides:` dans le frontmatter (tranché le 7 septembre 2026). Il est gitignoré : il n'est à personne d'autre.

```
.contextree/              au groupe : versionné, synchronisé
  archi-store.md
.contextree.local/        à moi : jamais poussé
  archi-store.md          surcharge la branche du groupe
  mes-raccourcis.md       branche purement locale
```

Résolution : **même chemin des deux côtés ⇒ le local gagne** ; chemin qui n'existe qu'en local ⇒ il s'ajoute.

**La résolution est faite au chargement (`loadTree`), pas au rendu.** Le routeur lit les `load_when` avant que quoi que ce soit ne soit rendu : s'il voyait celui du groupe pendant que le rendu injecte le contenu local, il routerait sur une branche et chargerait l'autre. Résoudre au chargement donne en plus l'arbre superposé à tout le reste — `withAncestors`, `formatTree`, la barre latérale, la toile — sans qu'aucun n'ait à savoir qu'il y a deux dossiers.

**La surcharge est champ par champ** : un champ absent du fichier local retombe sur celui du groupe. C'est ce qui permet de ne surcharger qu'un `load_when` sans recopier le corps, et ce qui fait qu'un dossier local simplement porteur d'enfants (hub implicite, donc vide) n'efface pas la branche de groupe. Un `root.md` local l'emporte entièrement, sinon c'est celui du groupe.

Chaque branche porte son `layer` : `fileForBranch` ouvre le fichier du bon dossier — une branche surchargée s'édite dans le calque, pas dans l'arbre du groupe — et les vues l'affichent.

**Pourquoi un dossier et non un champ** : la raison est la sync, pas le diff. Un champ dans le frontmatter mettrait des données personnelles **dans** des fichiers appartenant au groupe. `push` devrait les filtrer fichier par fichier — une seule passe ratée pousse des notes personnelles au groupe —, le moindre réglage personnel salirait un fichier partagé et en ferait un candidat au conflit au `pull` suivant, et « la branche la plus spécifique gagne » deviendrait une fusion champ par champ à l'intérieur d'un fichier au lieu d'une résolution de chemins. Deux dossiers rendent ces problèmes impossibles par construction.

## Déplacer et renommer (`moveBranch`)

Renommer et reparenter sont la même opération : changer le `path`. Il vit à deux endroits sur le disque — le `.md` et le dossier homonyme qui porte les enfants — et les deux bougent ensemble.

- **Refusé** : une arrivée déjà occupée, un déplacement sous son propre descendant, un chemin qui sort du dossier (`..`, absolu, segment vide, antislash).
- **Les deux renommages ne sont pas atomiques ensemble** : si le dossier des enfants échoue à bouger, le `.md` est remis en place. Mieux vaut un arbre inchangé qu'une branche séparée de ses enfants.
- **Le dossier de départ vidé est supprimé**, sinon il resterait un hub implicite — une branche fantôme, sans contenu ni enfants.
- **Un parent inconnu est refusé côté CLI et MCP**, pas côté cœur : un hub fabriqué au passage aurait un `load_when` qui ne veut rien dire, et le routeur routerait dessus.

Ce que ça invalide : le cache de sélection et le journal référencent des `path`, et filtrent déjà ceux qu'ils ne retrouvent pas — un chemin périmé disparaît, il ne casse rien. Un pack déjà exporté est un instantané : il garde les anciens chemins, c'est le comportement attendu.
