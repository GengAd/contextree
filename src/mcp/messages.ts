import { pick, type Dictionary } from '../core/i18n.js';

/**
 * Ce que le serveur MCP dit au modèle et à l'utilisateur, en français et en
 * anglais (14 septembre 2026).
 *
 * Les `instructions`, les descriptions d'outils et de paramètres sont lues par
 * le **modèle** : elles gardent en anglais les mêmes appuis qu'en français —
 * « directement, sans demander la permission », « annonce-le maintenant »,
 * « rappeler cet outil est le régime normal ». Les noms d'outils, de paramètres
 * et les types de branche ne se traduisent pas : ce sont des identifiants.
 */
const fr = {
  instructions: `contextree expose l'arbre de contexte du projet courant : identité, règles,
contexte de domaine, références et skills, sous forme de petites branches typées.

Avant de travailler sur une tâche non triviale, appelle \`get_context\` avec la demande de
l'utilisateur : tu récupères uniquement les branches pertinentes. Quand tu découvres un fait
durable sur ce projet (une convention, une contrainte, un chemin qui compte), écris-le avec
\`upsert_branch\` — directement, sans demander la permission. L'arbre est fait pour être enrichi
à l'usage. Sur un arbre neuf, commence par \`write_root\` : c'est le seul contenu toujours
injecté, et aucune branche ne le remplace. Si le projet a déjà un \`CLAUDE.md\`, des règles
Cursor ou un README nourri, le prompt \`bootstrap\` donne la consigne pour en tirer l'arbre.

En échange, **dis-le**. Après chaque écriture, annonce en une phrase ce que tu as ajouté ou
changé dans l'arbre et pourquoi. Écrire en silence est la seule façon de mal faire ici : tu
écris dans l'arbre qui te sera réinjecté ensuite, et personne ne peut corriger ce qu'il ne
voit pas.

Sous Claude Code, un hook injecte déjà une première sélection à chaque prompt. Ce n'est qu'une
**avance** : elle est routée sur le prompt seul, parfois avec un tour de retard, et le bloc
injecté liste en fin de message les branches qu'il n'a **pas** chargées. Dès que la tâche se
précise — une carte ou un ticket que tu viens de lire, une trace d'erreur, un fichier que tu
ouvres —, rappelle \`get_context\` avec ce que tu sais maintenant. C'est le régime normal, pas
un rattrapage exceptionnel : un prompt de départ ne contient presque jamais la tâche entière.`,

  noTree: (dirName: string, base: string) =>
    `Aucun dossier ${dirName} trouvé depuis ${base}. Pour créer l'arbre d'ici : ` +
    '`write_root`, qui pose le dossier et la racine. Sinon : `contextree init`.',
  samplingRefused: (msg: string) => `sampling refusé ou en échec — plus demandé de la session : ${msg}`,
  samplingNotText: (kind: string) => `réponse ${kind}, texte attendu`,
  startup: (cwd: string, tree: string | null) =>
    `contextree mcp — lancé dans ${cwd} — ${tree ? `arbre ${tree}` : "pas d'arbre ici (les roots du client seront demandés)"}`,

  bootstrapPromptTitle: "Construire l'arbre depuis les fichiers du projet",
  bootstrapPromptDescription:
    "Donne à l'IA la consigne pour lire les fichiers de consignes existants " +
    "(CLAUDE.md, règles Cursor, README…) et en écrire un arbre de contexte : " +
    '6 à 12 branches, un `load_when` par branche, aucun fichier source touché.',
  bootstrapToolTitle: "La consigne pour construire l'arbre",
  bootstrapToolDescription:
    "Rend la consigne complète pour construire l'arbre de contexte de ce projet à partir " +
    'de ses fichiers de consignes existants et du dépôt. À appeler quand ce projet ' +
    "n'a pas encore d'arbre et que l'utilisateur vient d'accepter d'en créer un. " +
    "Suis ensuite ce qu'elle dit : `write_root` en premier, puis `upsert_branch`.",

  getContextTitle: 'Charger le contexte pertinent',
  getContextDescription:
    "Renvoie les branches de l'arbre de contexte pertinentes pour une demande donnée, " +
    "assemblées en un bloc prêt à lire. Les branches parentes sont incluses d'office. " +
    "À appeler dès que tu sais sur quoi porte la tâche : au début avec la demande telle " +
    "quelle, puis à nouveau chaque fois qu'elle se précise — une carte lue, une trace " +
    "d'erreur, un fichier ouvert. Rappeler cet outil est le régime normal.",
  getContextQuery: "La demande de l'utilisateur, en clair.",
  causeCold: 'à froid — le routage de cette demande tourne en tâche de fond et servira au prochain appel',
  causeNoEngine: 'aucun moteur de routage sur ce poste — ni clé API, ni sampling du client, ni CLI',
  causeFallback: (error: string | undefined) => `repli — ${error ?? 'raison inconnue'}`,
  emptyTree: '(arbre de contexte vide)',

  listTitle: "Lister l'arbre de contexte",
  listDescription:
    'Catalogue de toutes les branches : chemin, type, titre et condition de chargement. ' +
    "Utile pour savoir ce que le projet sait déjà avant d'en ajouter.",
  listEmpty: 'Arbre vide.',
  listCount: (n: number, paths: string) => `${n} branche(s).\nChemins : ${paths}`,

  readTitle: 'Lire une branche',
  readDescription: "Contenu complet d'une branche, par son chemin (voir list_branches).",
  readPath: "Chemin logique, ex. 'archi-store/commandes-npm'. `:root` pour la racine.",
  readRoot: (content: string) => `# Racine\ntoujours injectée, jamais routée\n\n${content}`,
  readBranch: (title: string, type: string, loadWhen: string, content: string) =>
    `# ${title}\ntype: ${type}\ncharger quand: ${loadWhen}\n\n${content}`,
  unknownBranch: (p: string) => `Branche inconnue : ${p}`,
  unknownParent: (p: string) => `Parent inconnu : ${p}`,
  pathRefused: (p: string) => `Chemin refusé : ${p}`,

  upsertTitle: 'Créer ou mettre à jour une branche',
  upsertDescription:
    "Écrit une branche sur le disque. Utilise-le pour capitaliser un fait durable sur le " +
    "projet. `load_when` est la phrase que lira le routeur : formule-la comme une condition " +
    "(« quand on touche à X », « si la demande parle de Y »), pas comme un résumé.",
  upsertTitleParam: 'Titre lisible de la branche.',
  upsertTypeParam:
    "identity = qui est l'IA · rule = contrainte dure · context = connaissance de domaine · reference = API, chemins, commandes · skill = savoir-faire activable (feuille).",
  upsertLoadWhenParam: 'Condition de chargement, une phrase.',
  upsertContentParam: 'Corps markdown de la branche.',
  upsertPathParam: 'Chemin explicite. Par défaut, dérivé du titre.',
  upsertParentParam: "Chemin de la branche parente, si c'est un enfant.",
  upsertWhyParam:
    "Pourquoi cette branche mérite d'exister, en une phrase. Elle apparaît dans la vue " +
    "à côté de la branche : c'est ce qui permet à l'utilisateur de relire ce que tu as " +
    "écrit, et de le corriger. Dis la même chose à l'utilisateur en clair.",
  upsertDone: (existed: boolean, p: string, type: string, file: string) =>
    `${existed ? 'Branche mise à jour' : 'Branche écrite'} : ${p} (${type})\n${file}\n\n` +
    "Annonce-le maintenant à l'utilisateur : ce que tu viens d'écrire dans l'arbre, et pourquoi.",

  rootTitle: 'Écrire la racine',
  rootDescription:
    "Le contenu toujours injecté, jamais routé : qui, quoi, dans quel repo. Court. " +
    "C'est la première chose à poser sur un arbre neuf, et la seule que `upsert_branch` " +
    "ne sait pas écrire. **Crée le dossier `.contextree/` s'il n'existe pas encore** : " +
    "sur un projet sans arbre, c'est par ici qu'on commence, sans aucune commande à " +
    'taper. Relis la racine avec `read_branch` sur `:root` avant de la remplacer.',
  rootContentParam: 'Corps markdown de la racine. Quelques lignes, pas une page.',
  rootWhyParam:
    'Pourquoi la racine doit dire ça, en une phrase. Elle apparaît dans la vue à côté ' +
    "de la racine : c'est ce qui permet à l'utilisateur de relire ce que tu as écrit. " +
    "Dis la même chose à l'utilisateur en clair.",
  rootAiWriteTitle: 'Racine',
  rootDone: (file: string, createdDir: string | null) =>
    `Racine écrite : ${file}\n` +
    (createdDir ? `Arbre créé : ${createdDir}/\n` : '') +
    "\nAnnonce-le maintenant à l'utilisateur : ce que tu viens d'écrire dans la racine, et pourquoi." +
    (createdDir ? " Dis-lui aussi que le dossier `.contextree/` vient d'être créé." : ''),

  deleteTitle: 'Supprimer une branche',
  deleteDescription: 'Supprime une branche et toutes ses branches enfants. Irréversible.',
  deletePathParam: 'Chemin de la branche à supprimer.',
  deleteWhyParam: 'Pourquoi cette branche ne doit plus exister, en une phrase.',
  deleteDone: (p: string, kids: number) =>
    `Supprimé : ${p}${kids ? ` (+ ${kids} enfant(s))` : ''}\n\n` +
    "Annonce-le maintenant à l'utilisateur : ce que tu viens de retirer de l'arbre, et pourquoi.",

  moveTitle: 'Déplacer ou renommer une branche',
  moveDescription:
    "Change le chemin d'une branche — renommer et reparenter sont la même opération. " +
    "Ses branches enfants suivent. Refusé si le chemin d'arrivée est déjà occupé ou " +
    "s'il est sous la branche déplacée.",
  moveFromParam: 'Chemin actuel de la branche.',
  moveToParam: 'Nouveau chemin complet (parent inclus).',
  moveWhyParam: "Pourquoi ce rangement, si ce n'est pas évident.",
  moveChildren: (kids: number) => ` (+ ${kids} enfant(s))`,

  exportTitle: "Exporter l'arbre pour le partager",
  exportDescription:
    "Sérialise l'arbre complet en un pack autonome. `as_token` renvoie un jeton compressé " +
    "à coller dans une conversation ; sinon, du JSON.",
  exportTokenParam: 'Renvoyer un jeton compressé plutôt que du JSON.',
  exportNameParam: 'Nom du pack.',

  importTitle: 'Importer un arbre partagé',
  importDescription:
    "Greffe un pack (jeton `contextree:…`, JSON brut, ou chemin de fichier) dans l'arbre local. " +
    '`prefix` isole les branches importées sous une branche à toi.',
  importSourceParam: 'Jeton, JSON, ou chemin de fichier.',
  importPrefixParam: 'Préfixe de chemin pour les branches importées.',
  importDone: (n: number, prefix: string | undefined) =>
    `${n} branche(s) importée(s)${prefix ? ` sous ${prefix}/` : ''}.`,
};

const en: Dictionary<typeof fr> = {
  instructions: `contextree exposes the current project's context tree: identity, rules,
domain context, references and skills, as small typed branches.

Before working on a non-trivial task, call \`get_context\` with the user's request: you get
only the relevant branches. When you discover a durable fact about this project (a convention,
a constraint, a path that matters), write it with \`upsert_branch\` — directly, without asking
for permission. The tree is meant to grow with use. On a new tree, start with \`write_root\`:
it is the only content that is always injected, and no branch replaces it. If the project
already has a \`CLAUDE.md\`, Cursor rules or a substantial README, the \`bootstrap\` prompt
gives the instructions to build the tree from them.

In return, **say it**. After every write, state in one sentence what you added or changed in
the tree and why. Writing silently is the only way to get this wrong: you are writing into the
tree that will be injected back into you, and nobody can correct what they cannot see.

Under Claude Code, a hook already injects a first selection on every prompt. It is only a
**head start**: it is routed on the prompt alone, sometimes one turn late, and the injected
block lists at the end the branches it did **not** load. As soon as the task becomes clearer —
a card or ticket you just read, an error trace, a file you open —, call \`get_context\` again
with what you know now. This is the normal routine, not an exceptional catch-up: an opening
prompt almost never contains the whole task.`,

  noTree: (dirName, base) =>
    `No ${dirName} folder found from ${base}. To create the tree from here: ` +
    '`write_root`, which creates the folder and the root. Otherwise: `contextree init`.',
  samplingRefused: msg => `sampling refused or failed — not requested again this session: ${msg}`,
  samplingNotText: kind => `${kind} answer, text expected`,
  startup: (cwd, tree) =>
    `contextree mcp — started in ${cwd} — ${tree ? `tree ${tree}` : 'no tree here (the client roots will be requested)'}`,

  bootstrapPromptTitle: "Build the tree from the project's files",
  bootstrapPromptDescription:
    'Gives the AI the instructions to read the existing instruction files ' +
    '(CLAUDE.md, Cursor rules, README…) and write a context tree from them: ' +
    '6 to 12 branches, one `load_when` per branch, no source file touched.',
  bootstrapToolTitle: 'The instructions to build the tree',
  bootstrapToolDescription:
    "Returns the full instructions to build this project's context tree from its existing " +
    'instruction files and the repo. Call it when this project has no tree yet and the ' +
    'user has just agreed to create one. Then follow what it says: `write_root` first, ' +
    'then `upsert_branch`.',

  getContextTitle: 'Load the relevant context',
  getContextDescription:
    'Returns the branches of the context tree relevant to a given request, assembled into a ' +
    'ready-to-read block. Parent branches are always included. Call it as soon as you know ' +
    'what the task is about: at the start with the request as is, then again every time it ' +
    'becomes clearer — a card read, an error trace, a file opened. Calling this tool again ' +
    'is the normal routine.',
  getContextQuery: "The user's request, in plain words.",
  causeCold: 'cold start — routing for this request is running in the background and will serve the next call',
  causeNoEngine: 'no routing engine on this machine — no API key, no client sampling, no CLI',
  causeFallback: error => `fallback — ${error ?? 'unknown reason'}`,
  emptyTree: '(empty context tree)',

  listTitle: 'List the context tree',
  listDescription:
    'Catalogue of all branches: path, type, title and load condition. ' +
    'Useful to know what the project already knows before adding to it.',
  listEmpty: 'Empty tree.',
  listCount: (n, paths) => `${n} branch(es).\nPaths: ${paths}`,

  readTitle: 'Read a branch',
  readDescription: 'Full content of a branch, by its path (see list_branches).',
  readPath: "Logical path, e.g. 'store-arch/npm-commands'. `:root` for the root.",
  readRoot: content => `# Root\nalways injected, never routed\n\n${content}`,
  readBranch: (title, type, loadWhen, content) => `# ${title}\ntype: ${type}\nload when: ${loadWhen}\n\n${content}`,
  unknownBranch: p => `Unknown branch: ${p}`,
  unknownParent: p => `Unknown parent: ${p}`,
  pathRefused: p => `Path refused: ${p}`,

  upsertTitle: 'Create or update a branch',
  upsertDescription:
    'Writes a branch to disk. Use it to capture a durable fact about the project. ' +
    '`load_when` is the sentence the router will read: phrase it as a condition ' +
    '("when touching X", "if the request is about Y"), not as a summary.',
  upsertTitleParam: 'Readable title of the branch.',
  upsertTypeParam:
    'identity = who the AI is · rule = hard constraint · context = domain knowledge · reference = APIs, paths, commands · skill = activatable know-how (leaf).',
  upsertLoadWhenParam: 'Load condition, one sentence.',
  upsertContentParam: 'Markdown body of the branch.',
  upsertPathParam: 'Explicit path. Derived from the title by default.',
  upsertParentParam: 'Path of the parent branch, if this is a child.',
  upsertWhyParam:
    'Why this branch deserves to exist, in one sentence. It appears in the view next to ' +
    'the branch: it is what lets the user reread what you wrote, and correct it. ' +
    'Tell the user the same thing in plain words.',
  upsertDone: (existed, p, type, file) =>
    `${existed ? 'Branch updated' : 'Branch written'}: ${p} (${type})\n${file}\n\n` +
    'Tell the user now: what you just wrote into the tree, and why.',

  rootTitle: 'Write the root',
  rootDescription:
    'The content that is always injected, never routed: who, what, which repo. Short. ' +
    'It is the first thing to write on a new tree, and the only thing `upsert_branch` ' +
    'cannot write. **Creates the `.contextree/` folder if it does not exist yet**: on a ' +
    'project without a tree, this is where you start, with no command to type. Reread the ' +
    'root with `read_branch` on `:root` before replacing it.',
  rootContentParam: 'Markdown body of the root. A few lines, not a page.',
  rootWhyParam:
    'Why the root should say this, in one sentence. It appears in the view next to the ' +
    'root: it is what lets the user reread what you wrote. Tell the user the same thing in ' +
    'plain words.',
  rootAiWriteTitle: 'Root',
  rootDone: (file, createdDir) =>
    `Root written: ${file}\n` +
    (createdDir ? `Tree created: ${createdDir}/\n` : '') +
    '\nTell the user now: what you just wrote into the root, and why.' +
    (createdDir ? ' Also tell them the `.contextree/` folder was just created.' : ''),

  deleteTitle: 'Delete a branch',
  deleteDescription: 'Deletes a branch and all its child branches. Irreversible.',
  deletePathParam: 'Path of the branch to delete.',
  deleteWhyParam: 'Why this branch should no longer exist, in one sentence.',
  deleteDone: (p, kids) =>
    `Deleted: ${p}${kids ? ` (+ ${kids} child(ren))` : ''}\n\n` +
    'Tell the user now: what you just removed from the tree, and why.',

  moveTitle: 'Move or rename a branch',
  moveDescription:
    "Changes a branch's path — renaming and reparenting are the same operation. " +
    'Its child branches follow. Refused if the target path is already taken or is under ' +
    'the moved branch.',
  moveFromParam: 'Current path of the branch.',
  moveToParam: 'New full path (parent included).',
  moveWhyParam: 'Why this arrangement, if it is not obvious.',
  moveChildren: kids => ` (+ ${kids} child(ren))`,

  exportTitle: 'Export the tree to share it',
  exportDescription:
    'Serializes the whole tree into a self-contained pack. `as_token` returns a compressed ' +
    'token to paste into a conversation; otherwise, JSON.',
  exportTokenParam: 'Return a compressed token rather than JSON.',
  exportNameParam: 'Name of the pack.',

  importTitle: 'Import a shared tree',
  importDescription:
    'Grafts a pack (`contextree:…` token, raw JSON, or file path) into the local tree. ' +
    '`prefix` isolates the imported branches under a branch of your own.',
  importSourceParam: 'Token, JSON, or file path.',
  importPrefixParam: 'Path prefix for the imported branches.',
  importDone: (n, prefix) => `${n} branch(es) imported${prefix ? ` under ${prefix}/` : ''}.`,
};

export const SERVER_MESSAGES = { fr, en };

/** Les textes du serveur dans la langue courante — lue à la création du serveur,
 *  que l'agent lance avec `--lang`. */
export function serverText(): typeof fr {
  return pick(SERVER_MESSAGES);
}
