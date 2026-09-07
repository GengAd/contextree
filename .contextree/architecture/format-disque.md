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
- **`order` est un parcours en profondeur alphabétique et c'est contractuel** — les indices envoyés au routeur en dépendent.
