---
type: reference
title: Format sur disque
load_when: quand on touche au chargement, à l'écriture ou au parcours de .contextree/, au frontmatter, au calque local .contextree.local/, ou au déplacement / renommage d'une branche
---

Le **parent** vient des dossiers, le **type** du frontmatter — deux axes indépendants.

```
.contextree/
  root.md              toujours injecté, jamais routé
  architecture.md      une branche
  architecture/        ses enfants (même nom, sans .md)
    format-disque.md
```

Frontmatter : `type` (défaut `context`), `title` (défaut : le slug), `load_when` (défaut : le titre). **Scalaires sur une ligne**, parseur maison.

À préserver :
- **Un dossier sans `.md` frère est un hub implicite** (vide, `context`), sinon ses fichiers seraient ignorés en silence. C'est ce qui fait marcher `import --prefix`.
- **`order` est un parcours en profondeur alphabétique, contractuel** : les indices du routeur en dépendent. `compareBranchPaths` compare **segment par segment** (`-` passe avant `/` en octets : un tri nu donne `a`, `a-b`, `a/b`).
- **`walk()` écarte les dossiers en `.` et ne lit que les `.md`** : un `.git` (dossier ou fichier de submodule) passe à travers, d'où le submodule possible.
- **`findTreeDir` remonte comme `.git`, mais jamais jusqu'au dossier utilisateur**, et ne rend jamais le dossier d'état. `write_root` et `init` refusent `~`.

**Où vit quoi** : l'arbre dans `<projet>/.contextree/` (partagé) et `.contextree.local/` (perso) ; l'état hors du projet, dans `stateDir()` (voir *Journal des tours*).

## Le calque local

Un **dossier frère** de format identique, gitignoré à la création (`ensureLocalIgnored`, sur `init` et `write_root`).
- **Même chemin des deux côtés ⇒ le local gagne ; chemin seulement local ⇒ il s'ajoute.**
- **Résolu au chargement (`loadTree`), pas au rendu** : le routeur lit les `load_when` avant le rendu, il doit voir les mêmes que ce qui sera injecté. Tout le reste reçoit un arbre déjà superposé.
- **Champ par champ** : un champ absent du local retombe sur le groupe (surcharger un `load_when` sans recopier le corps). Un `root.md` local l'emporte entièrement.
- Chaque branche porte son `layer` ; `fileForBranch` ouvre le fichier du bon dossier ; les vues marquent `· local`.

**Pourquoi un dossier et pas un champ `overrides:`** : la sync. Un champ mettrait des données perso dans des fichiers du groupe — `push` devrait les filtrer un par un, et un réglage perso ferait un conflit au `pull`. Deux dossiers rendent ça impossible par construction.

## Déplacer et renommer (`moveBranch`)

Même opération : changer le `path`, qui vit dans le `.md` **et** le dossier des enfants — les deux bougent ensemble.
- **Refusé** : arrivée occupée, sous son propre descendant, chemin qui sort (`..`, absolu, segment vide, antislash).
- Si le dossier échoue à bouger, le `.md` est remis en place.
- Le dossier de départ vidé est supprimé (sinon hub fantôme).
- **Parent inconnu refusé côté CLI et MCP**, pas dans le cœur : un hub fabriqué au passage aurait un `load_when` vide de sens.

Cache et journal filtrent les chemins qu'ils ne retrouvent plus ; un pack exporté garde les anciens chemins.
