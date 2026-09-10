---
type: context
title: Démarrage à froid
load_when: quand on touche à la création de l'arbre (init), à la vue sur un projet vierge, au tronc de branches de départ, ou quand on se demande pourquoi le routeur ne trie rien sur un petit arbre
---

**Le tronc de départ vit dans le cœur** (`initTree`, dans `store.ts`), pas dans la CLI : la vue le crée aussi, et deux copies auraient divergé au premier ajustement de `load_when` — le champ dont dépend tout le routage.

Quatre branches, pas quarante : un arbre entier deviné d'un coup n'est relu par personne. Ce sont des amorces à corriger, et leur `load_when` est écrit comme une condition (« quand… »), parce que c'est la forme qu'on veut voir imitée.

**Sur un projet qui a déjà des consignes, on n'initialise pas : on invite** (9 septembre 2026). `detectInstructionFiles` cherche `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.github/copilot-instructions.md`, `README.md`, `CONTRIBUTING.md` — dans cet ordre, du plus intentionnel au plus général. S'il en trouve, la vue d'accueil met « Copier la consigne pour l'IA » **devant** « Créer l'arbre » : repartir de quatre branches génériques quand quelqu'un a déjà écrit ses règles est une perte.

La consigne (`renderBootstrapPrompt`) est du texte, pas un moteur : elle dit de lire ces fichiers *et* le dépôt, borne à **6 à 12 branches**, montre un `load_when` en condition avec ses contre-exemples, exige de commencer par `write_root`, **interdit de toucher aux fichiers source**, et finit en renvoyant à la toile pour relire les conditions — jamais sur « c'est fait ». **Quatre** surfaces la servent, une seule copie : l'outil MCP `bootstrap_prompt`, le prompt MCP `bootstrap`, `contextree bootstrap [--copy]`, et le bouton de la vue.

**Sans arbre, les trois surfaces invitent — elles ne créent pas** (10 septembre 2026). Le hook sortait en silence et `get_context` **levait** : depuis l'endroit même où contextree sert, il était invisible pour qui n'avait jamais lancé `init`. Une seule consigne courte, `renderBootstrapInvite(found)`, servie par trois canaux — les `instructions` du serveur MCP (lues une fois à la connexion, donc une fois par session), la réponse de `get_context`, et le stdout du hook (une fois par session, marqueur `claimBootstrapInvite` sous `stateDir()/session/`). Elle **propose** et renvoie au prompt `bootstrap` pour la consigne longue.

**C'est `write_root` qui crée le dossier** (10 septembre 2026), et lui seul. Il pose la racine, donc il pose le contenant : sans ça, l'IA qui venait d'obtenir un « oui » renvoyait l'utilisateur au terminal (`contextree init`) — le geste que tout ceci existe pour supprimer. `upsert_branch` garde l'erreur : écrire une branche avant la racine est l'ordre inverse de la consigne, et donnerait un arbre sans son seul contenu toujours injecté. Le message d'erreur des autres outils nomme donc `write_root` **avant** le terminal. Le dossier créé est celui d'`initTree`, sans le tronc de départ : l'IA écrit ses branches, et deux entrées pour le même sujet font charger la mauvaise.

**La consigne est un outil, pas seulement un prompt** (10 septembre 2026). Un prompt MCP est exposé à l'utilisateur en slash-command et **jamais au modèle** : l'agent qui venait d'obtenir un « oui » ne trouvait rien à appeler, partait sur la commande `npx` — paquet non publié — et s'arrêtait pour demander de l'aide, au pire moment. `bootstrap_prompt` corrige ça ; le prompt reste pour qui le lance à la main.

Ce que ça change se mesure. Même projet, même modèle : **sans** la consigne, 15 branches et un `load_when` d'identité écrit « Toujours utile… » — le contre-exemple exact qu'elle donne. **Avec**, 12 branches et aucun « toujours ». Les garde-fous ne tiennent que s'ils sont lus.

Trois choix qui ne sont pas arbitraires :
- **`get_context` répond, il n'échoue pas.** Un outil qui lève, le modèle l'abandonne et n'y revient plus ; un outil qui répond « voilà quoi faire », il le suit. `list_branches` et `read_branch` gardent l'erreur — on ne liste pas ce qui n'existe pas.
- **Une fois par session, pas par tour.** Répéter l'invitation à chaque prompt, c'est harceler quelqu'un qui a déjà dit non, avec son contexte pour facture.
- **Proposer, jamais créer.** Un arbre fabriqué sans qu'on l'ait demandé, ce sont douze `load_when` que personne ne relira — or c'est le seul champ qui décide de quelque chose ici.

**La vue est toujours visible**, même sans `.contextree/` : une `viewsWelcome` (`when: !contextree.hasTree`) porte « Créer l'arbre » et « Ajouter contextree à une IA ». Sans ça, le premier geste de l'outil échappait à l'outil — il fallait un terminal. Les boutons qui n'ont de sens qu'avec un arbre (nouvelle branche, toile) sont gardés par `contextree.hasTree`.

**Le démarrage à froid n'est pas une panne.** Mesuré sur un arbre neuf : le routeur *tourne* dès la 4ᵉ branche (le court-circuit s'arrête à ≤ 3), mais il retient les 4 — les `load_when` de départ sont volontairement larges. On lit donc `routé — 4 branche(s)` sans rien qui ressemble à un tri. Le routage se met à payer quand l'arbre grossit et que les conditions se resserrent, pas avant. Ne pas chercher un bug là.
