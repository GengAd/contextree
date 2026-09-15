---
type: context
title: Démarrage à froid
load_when: quand on touche à la création de l'arbre (init, write_root sur un projet vierge), à l'invitation sans arbre, à la consigne bootstrap et ses arbres types, au tronc de départ, ou quand le routeur ne trie rien sur un petit arbre
---

## Sans arbre, on invite — on ne crée pas

Une consigne courte, `renderBootstrapInvite(found)`, par trois canaux : les `instructions` du serveur MCP, la réponse de `get_context`, le stdout du hook (marqueur `claimBootstrapInvite` sous `stateDir()/session/`).
- **`get_context` répond, il n'échoue pas** : un outil qui lève, le modèle l'abandonne. `list_branches` et `read_branch` gardent l'erreur.
- **Une fois par session, pas par tour** : répéter harcèle qui a déjà dit non.
- **Mais « avant de terminer ta réponse »** : fréquence et déclenchement sont deux réglages distincts.
- **Proposer, jamais créer** : un arbre non demandé, ce sont des `load_when` que personne ne relira.
- **`bootstrap_prompt` doit être le premier appel**, avant `write_root`.

**`write_root` crée le dossier**, et lui seul, sans tronc de départ : l'IA écrit ses branches. Le message d'erreur des autres outils nomme `write_root` avant le terminal.

## La consigne de construction (`renderBootstrapPrompt`)

Du texte, pas un moteur. Quatre surfaces, une copie : l'outil `bootstrap_prompt`, le prompt MCP `bootstrap`, `contextree bootstrap [--copy]`, le bouton de la vue. `detectInstructionFiles` cherche `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.github/copilot-instructions.md`, `README.md`, `CONTRIBUTING.md` — du plus intentionnel au plus général ; s'il en trouve, la vue met « Copier la consigne pour l'IA » devant « Créer l'arbre ».

Elle dit : lire ces fichiers et le dépôt ; **6 à 12 branches de premier niveau** (une famille compte pour une) ; `load_when` en condition, avec contre-exemples ; commencer par `write_root` ; **ne toucher à aucun fichier source** ; écrire dans la langue de l'utilisateur ; finir en renvoyant à la toile. Et une **méthode** (`TREE_METHOD`, exportée : la réponse de `write_root` la reprend) :
- **deux temps** : un plan montré (chemins, types, `load_when`, une phrase par parent), **arrêt**, écriture après accord ;
- lister 8 à 15 demandes futures ; repérer les familles — un parent, un enfant par élément **même s'il n'y en a qu'un** ; le parent porte le commun, en court ; une `rule` vaut pour le projet ou une famille, jamais pour un élément ; chaque `load_when` reprend les demandes qu'elle sert ; chaque demande charge au moins une branche et jamais la moitié de l'arbre ;
- **trois arbres types** (`TREE_EXAMPLES`) : bibliothèque de composants, API web, monorepo — génériques, localisés, et validés par le contrôle de forme dans un test.

Mesuré : sans la consigne, 15 branches et une identité « Toujours utile… » ; avec, 12 branches et aucun « toujours ».

## Le tronc de départ (`contextree init`, bouton « Créer l'arbre »)

`initTree` (`store.ts`), dans le cœur : la vue le crée aussi. Quatre amorces, en fr (`identite`, `regles`, `architecture`, `architecture/commandes`) ou en (`identity`, `rules`, `architecture`, `architecture/commands`), textes dans `core/messages.ts`, `load_when` écrits en condition parce que c'est la forme qu'on veut voir imitée.

**La vue est visible sans arbre** : une `viewsWelcome` (`when: !contextree.hasTree`) porte « Créer l'arbre » et « Ajouter contextree à une IA ». Les boutons qui exigent un arbre sont gardés par `contextree.hasTree`.

**Un arbre neuf qui ne trie rien n'est pas une panne** : dès 4 branches le routeur tourne, mais les amorces sont larges et il les garde toutes. Le tri paie quand l'arbre grossit et que les conditions se resserrent.
