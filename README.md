# contextree

Un **arbre de contexte** pour travailler avec une IA : de petites branches typées — identité, règles, contexte, références, savoir-faire — dont seules les pertinentes sont injectées à chaque appel.

Comme un `CLAUDE.md`, mais **routé** : à chaque prompt, un appel IA léger lit la condition de chargement de chaque branche (`load_when` : « charge-moi quand… ») et ne retient que ce qui sert. Et **partageable** : la source de vérité est du markdown dans `.contextree/`, que git suffit à mettre en commun.

## Démarrer

Le paquet n'est pas encore publié sur npm. Depuis le dépôt :

```bash
npm install
npm run build
npm i -g .          # ou npm link
```

Puis, dans le projet à équiper :

```bash
contextree init      # crée .contextree/ avec un arbre de départ
# édite les branches, surtout leur load_when
contextree install   # câble les agents détectés
```

Relance ton agent. **Aucune clé API n'est nécessaire** : si un CLI d'agent (`claude`, `codex`, `gemini`) est installé, c'est ton abonnement qui route. Une clé (`ANTHROPIC_API_KEY`, ou `OPENAI_API_KEY` avec au besoin `OPENAI_BASE_URL`) est utilisée si elle est là — c'est juste plus rapide.

`contextree install` inscrit **la commande qui tourne** : chemins absolus vers le binaire local tant que le paquet n'est pas publié, forme `npx` ensuite. `contextree install --status` l'affiche sans rien écrire.

## Commandes

```bash
contextree list                      # l'arbre
contextree route "<prompt>"          # ce que le routeur chargerait, et pourquoi
contextree render                    # tout l'arbre, sans routage
contextree add --title "…" --type rule --load-when "…"
contextree rm <chemin>
contextree export --token            # un jeton à coller dans un chat
contextree import <jeton|fichier> [--prefix equipe]
contextree install --status          # câblé / à câbler / non détecté
```

Ajoute `--copy` à `render` ou `route` pour coller le bloc dans un chat qui n'a ni hook ni MCP.

## L'extension

```bash
npm run package:ext    # produit extension/contextree-vscode-0.1.0.vsix
code   --install-extension extension/contextree-vscode-0.1.0.vsix
cursor --install-extension extension/contextree-vscode-0.1.0.vsix
```

Elle montre l'arbre dans la barre latérale, surligne les branches réellement lues au dernier tour, et ouvre une toile 2D où l'on édite une branche et où l'on essaie un prompt sans lancer de conversation.

## Partager un arbre avec son équipe (git)

Une équipe qui a déjà un dépôt commun n'a besoin de rien d'autre : versionne
`.contextree/` avec le projet, ou monte-le en submodule si plusieurs dépôts
partagent le même contexte.

```bash
git submodule add <url-de-l-arbre> .contextree   # au choix : ou simplement le dossier du repo
```

Pull, push, conflits, historique et revue sont ceux de git. `.contextree.local/`
— ton calque personnel — est **gitignoré dès la création de l'arbre** : ce que tu
y surcharges ne part jamais au groupe.

Deux choses à savoir avant le premier merge : un conflit non résolu dans le corps
d'une branche **part au modèle** tel quel, et un conflit dans le frontmatter
**ne se voit pas** — le `load_when` affiché est alors l'un des deux, au hasard.
Après un merge qui touche `.contextree/`, relis les `load_when` concernés.

Le détail (`contextree list`, puis la branche « Partager un arbre par git »).

## La documentation de ce projet est son arbre

Il n'y a pas d'autre `.md` à la racine : tout vit dans `.contextree/`, une branche par sujet, chargée quand elle sert.

```bash
contextree list                        # les sujets et leurs conditions
contextree route "<une question>"      # ce qu'une IA en recevrait
contextree render                      # tout, d'un coup
```

C'est aussi le seul test honnête de l'outil : si une réponse ne s'y trouve pas, c'est un `load_when` à corriger, pas un fichier à recréer.

## Origine

Extrait de [Lacis](../ai-tree) (repo `ai-tree`), dont l'arbre de contexte était la vraie valeur mais restait enterré sous une extension VS Code complète. Ici on ne garde que le cœur.
