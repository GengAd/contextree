# contextree

**Un arbre de contexte partageable, routé par IA, injecté à chaque appel.**

Comme un `CLAUDE.md` — mais au lieu de charger tout le fichier à chaque fois, un routeur ne charge que les branches pertinentes pour la demande en cours. Et au lieu de rester prisonnier d'un repo, il s'exporte et se partage.

```
.contextree/
├── root.md                    toujours injecté
├── identite.md                (identity) — chargé si pertinent
├── regles.md                  (rule)     — chargé si pertinent
├── architecture.md            (context)  — chargé si pertinent
│   └── commandes.md           (reference)
└── revue-de-code.md           (skill)
```

Chaque branche porte sa condition de chargement :

```markdown
---
type: rule
title: Conventions UI
load_when: quand on touche à un composant ou du CSS
---

- Tous les textes affichés sont en anglais.
```

À chaque prompt, un appel IA léger lit ces conditions et retient les branches qui comptent. **Si un enfant est retenu, ses parents le sont aussi** — une branche profonde n'a de sens qu'avec le chemin qui y mène. Aucun type n'est privilégié : c'est le `load_when` qui décide, ou personne. Si le routage échoue, on retombe sur la sélection du tour précédent, sinon sur l'arbre entier — jamais un contexte vide, jamais un prompt bloqué.

## Démarrer

```bash
npx @gengad/contextree init      # crée .contextree/ avec un arbre de départ
# édite les fichiers…
npx @gengad/contextree install   # câble le serveur MCP + le hook Claude Code
```

Puis relance Claude Code. **Aucune clé API n'est nécessaire** : si le binaire `claude` est installé, c'est ton abonnement qui route. Une clé (`ANTHROPIC_API_KEY`) est utilisée si elle est là — c'est juste plus rapide.

Le routage par le CLI coûte entre 5 et 60 s : le hook ne l'attend donc jamais. Le tour part avec la sélection du tour précédent et le routage tourne derrière, pour le tour suivant — le hook rend la main en ~150 ms. `contextree route "<prompt>"` montre à tout moment ce que le routeur retiendrait.

## Deux surfaces

| | Comment | Où |
|---|---|---|
| **Hook** `UserPromptSubmit` | Injection **déterministe** à chaque prompt, sans que l'agent ait à décider | Claude Code |
| **Serveur MCP** | L'agent appelle `get_context` ; sert aussi à lire et éditer l'arbre depuis la conversation | Claude Code, Cursor, Windsurf, tout client MCP |

Les deux lisent le même arbre et le même routeur.

## CLI

```bash
contextree list                      # affiche l'arbre
contextree route "<prompt>"          # montre ce que le routeur chargerait, et pourquoi
contextree add --title "…" --type rule --load-when "…"
contextree rm <chemin>
contextree render                    # tout l'arbre assemblé, sans routage
contextree export --token            # jeton à coller dans un chat
contextree import <jeton|fichier> [--prefix equipe]
```

`contextree route` est l'outil de mise au point : il affiche le temps de routage, les branches retenues (`●`) et écartées (`○`), et le bloc final.

## Partager

Trois véhicules, aucun serveur :

- **git** — la source de vérité est du markdown ; committer `.contextree/` suffit ;
- **fichier** — `contextree export -o pack.json`, à envoyer ;
- **jeton** — `contextree export --token`, à coller dans une conversation.

Les groupes, les arbres publics et les hiérarchies d'entreprise sont les phases 2 à 4 — voir [`ROADMAP.md`](./ROADMAP.md).

## Outils MCP

`get_context` · `list_branches` · `read_branch` · `upsert_branch` · `delete_branch` · `export_pack` · `import_pack`

`upsert_branch` est le levier participatif : quand l'IA découvre un fait durable sur le projet, elle le propose comme branche. L'arbitrage se fait en relisant un diff git.

## Transparence

À chaque tour, une ligne dit exactement ce qui a été chargé et pourquoi :

```
contextree (routé) — 3 branche(s) : Identité, Règles du projet, Architecture
```

Jamais de boîte noire.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — carte de navigation pour les assistants IA
- [`CONTEXT.md`](./CONTEXT.md) — ce qu'on construit et pourquoi
- [`REFERENCES.md`](./REFERENCES.md) — format, mécanique du routage, pièges
- [`ROADMAP.md`](./ROADMAP.md) — phases 1 à 4

## Origine

Extrait de [Lacis](../ai-tree) (repo `ai-tree`), dont l'arbre de contexte était la vraie valeur mais restait enterré sous une extension VS Code complète. Ici on ne garde que le cœur.
