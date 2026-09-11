import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { findTreeDir, loadTree, slugify, writeBranch, writeRoot, deleteBranch, moveBranch, detectInstructionFiles, DIR_NAME, ROOT_FILE } from '../core/store.js';
import { allBranches, formatTree } from '../core/tree.js';
import { renderContext, renderTrace, renderBootstrapPrompt, renderBootstrapInvite } from '../core/render.js';
import { route, pickEngine, isCliEngine, withoutRouting, routeInBackground } from '../core/router.js';
import { appendTurn, appendAiWrite } from '../core/journal.js';
import { readSelection, writeSelection } from '../core/session.js';
import { randomUUID } from 'node:crypto';
import { decodePack, encodePack, extractPack, applyPack } from '../core/pack.js';
import { BRANCH_TYPES } from '../core/types.js';
import type { ContextTree } from '../core/types.js';

const INSTRUCTIONS = `contextree expose l'arbre de contexte du projet courant : identité, règles,
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
un rattrapage exceptionnel : un prompt de départ ne contient presque jamais la tâche entière.`;

const branchTypeSchema = z.enum(BRANCH_TYPES);

/** Le chemin sous lequel la racine se lit et se trace. Ce n'est pas une branche
 *  — elle n'a ni type ni `load_when` — mais les vues l'adressent déjà ainsi
 *  (`ROOT_ELEMENT` dans l'extension), et une écriture tracée là s'affiche au bon
 *  endroit sans cas particulier de plus. */
const ROOT_PATH = ':root';

export async function createServer(cwd: string = process.cwd()): Promise<McpServer> {
  /**
   * Ce qui tient lieu de session pour un serveur MCP.
   *
   * Il n'a pas de notion de tour — mais l'agent le **relance à chaque session**,
   * donc la durée de vie du process *est* la session. Un id tiré au démarrage
   * suffit à ranger le cache de sélection, et il ne collisionne pas avec celui
   * du hook : quand les deux surfaces tournent côte à côte, chacune a sa piste,
   * et le second niveau du cache (la dernière sélection routée de l'arbre,
   * toutes sessions confondues) les fait quand même se parler.
   */
  const sessionId = `mcp-${randomUUID()}`;
  /** Ce que l'IA doit faire ici quand il n'y a rien : proposer l'arbre.
   *
   *  Une seule copie pour les deux surfaces du serveur — les `instructions` et
   *  la réponse de `get_context`. Le dossier est relu à chaque appel : celui
   *  qui crée son arbre en cours de session n'a pas à relancer le serveur pour
   *  que les outils le voient. */
  const invite = async (): Promise<string> => renderBootstrapInvite(await detectInstructionFiles(cwd));

  /** Les `instructions` sont lues **une fois**, à la connexion — l'agent relance
   *  le serveur à chaque session, donc l'invitation arrive une fois par session
   *  et pas à chaque tour. C'est le seul endroit où un projet sans arbre peut
   *  encore parler à une IA qui n'a ni hook ni terminal. */
  const server = new McpServer(
    { name: 'contextree', version: '0.1.0' },
    { instructions: (await findTreeDir(cwd)) ? INSTRUCTIONS : await invite() },
  );

  /** L'arbre est relu à chaque appel : les fichiers sont la source de vérité et
   *  l'utilisateur peut les éditer pendant que le serveur tourne. */
  const open = async (): Promise<{ dir: string; tree: ContextTree }> => {
    const dir = await findTreeDir(cwd);
    // Le message nomme `write_root` avant le terminal : c'est le seul outil qui
    // sait créer l'arbre, et un agent à qui on répond « lance une commande »
    // s'arrête pour la demander (constaté le 10 septembre 2026, scénario
    // « depuis zéro »).
    if (!dir) {
      throw new Error(
        `Aucun dossier ${DIR_NAME} trouvé depuis ${cwd}. Pour créer l'arbre d'ici : ` +
          '`write_root`, qui pose le dossier et la racine. Sinon : `contextree init`.',
      );
    }
    return { dir, tree: await loadTree(dir) };
  };

  const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

  /**
   * Le premier geste sur un projet qui a déjà des consignes ailleurs.
   *
   * Un prompt et non un outil : c'est l'utilisateur qui décide de construire
   * son arbre, pas le modèle qui s'en saisit au détour d'une phrase. Les
   * clients MCP l'exposent en commande, ce qui en fait un geste explicite.
   */
  server.registerPrompt(
    'bootstrap',
    {
      title: "Construire l'arbre depuis les fichiers du projet",
      description:
        "Donne à l'IA la consigne pour lire les fichiers de consignes existants " +
        "(CLAUDE.md, règles Cursor, README…) et en écrire un arbre de contexte : " +
        '6 à 12 branches, un `load_when` par branche, aucun fichier source touché.',
    },
    async () => {
      const found = await detectInstructionFiles(cwd);
      return {
        messages: [
          { role: 'user' as const, content: { type: 'text' as const, text: renderBootstrapPrompt(found) } },
        ],
      };
    },
  );

  /**
   * La consigne de construction, en **outil** — pas seulement en prompt.
   *
   * Tranché le 10 septembre 2026, après l'avoir vu casser : le prompt
   * `bootstrap` ci-dessus est exposé à l'utilisateur en slash-command, et
   * jamais au modèle. L'agent qui venait d'obtenir un « oui » ne trouvait donc
   * rien à appeler, partait sur la commande `npx` — un paquet non publié — et
   * s'arrêtait pour demander de l'aide, au pire moment possible.
   *
   * C'est le même motif que les deux autres ratés de ce scénario : **ce qui
   * n'est pas un outil n'existe pas pour l'agent.** Une consigne informe, elle
   * n'agit pas. Le choix alternatif — faire rendre la consigne entière par
   * `get_context` quand il n'y a pas d'arbre — a été écarté : rien ne pousse le
   * modèle à rappeler `get_context` juste après avoir reçu l'invitation, et
   * cela alourdirait de deux mille caractères une invitation qu'on a
   * délibérément faite courte.
   *
   * Le texte reste celui de `renderBootstrapPrompt` : une seule copie pour le
   * prompt, l'outil, la CLI et le bouton de la vue. Quatre formulations d'une
   * même consigne divergeraient au premier ajustement, et c'est le `load_when`
   * qui le paierait.
   */
  server.registerTool(
    'bootstrap_prompt',
    {
      title: "La consigne pour construire l'arbre",
      description:
        "Rend la consigne complète pour construire l'arbre de contexte de ce projet à partir " +
        'de ses fichiers de consignes existants et du dépôt. À appeler quand ce projet ' +
        "n'a pas encore d'arbre et que l'utilisateur vient d'accepter d'en créer un. " +
        "Suis ensuite ce qu'elle dit : `write_root` en premier, puis `upsert_branch`.",
      annotations: { readOnlyHint: true },
    },
    async () => text(renderBootstrapPrompt(await detectInstructionFiles(cwd))),
  );

  server.registerTool(
    'get_context',
    {
      title: 'Charger le contexte pertinent',
      description:
        "Renvoie les branches de l'arbre de contexte pertinentes pour une demande donnée, " +
        'assemblées en un bloc prêt à lire. Les branches parentes sont incluses d\'office. ' +
        "À appeler dès que tu sais sur quoi porte la tâche : au début avec la demande telle " +
        'quelle, puis à nouveau chaque fois qu\'elle se précise — une carte lue, une trace ' +
        "d'erreur, un fichier ouvert. Rappeler cet outil est le régime normal.",
      inputSchema: {
        query: z.string().describe("La demande de l'utilisateur, en clair."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      // Sans arbre, on répond l'invitation **en texte**, pas une erreur : un
      // outil qui échoue, le modèle l'abandonne et n'y revient pas ; un outil
      // qui répond « voilà ce qu'il y a à faire », il le suit. `list_branches`
      // et `read_branch` gardent l'erreur — on ne liste pas ce qui n'existe pas.
      const found = await findTreeDir(cwd);
      if (!found) return text(await invite());

      const { dir, tree } = await open();

      /**
       * Sous moteur CLI, on **ne route pas devant l'appel** — on diffère, comme
       * le hook le fait depuis le début (11 septembre 2026).
       *
       * Mesuré : un routage CLI met entre 5 et 60 s, et le client MCP abandonne
       * à 60 s. Router en synchrone, c'était choisir entre l'arbre entier (un
       * repli à 45 s) et rien du tout (l'appel expire côté client). Aucune des
       * deux n'est une réponse pour Cursor, Codex ou Copilot — qui n'ont que
       * cette surface, et pour qui `get_context` *est* contextree.
       *
       * Donc : on rend tout de suite la sélection héritée, on lance le routage
       * derrière, et il sert à l'appel suivant. C'est un aveu utile plutôt qu'une
       * attente inutile — et `renderTrace` l'annonce comme « différé ».
       *
       * Sous clé API, rien de tout ça : 2500 ms, pas de file d'attente, on route
       * en synchrone et l'agent a sa réponse juste du premier coup.
       */
      const deferred =
        isCliEngine(pickEngine()) && process.env['CONTEXTREE_ROUTER_BLOCKING'] !== '1';
      const at = Date.now();
      const previous = await readSelection(dir, sessionId);

      const { selected, reason, error } = deferred
        ? { selected: withoutRouting(tree, previous), reason: 'deferred' as const, error: undefined }
        : await route(tree, query, { waiter: 'tool', previousSelection: previous });

      // En différé, c'est le process de fond qui écrira la sélection : l'écraser
      // ici effacerait le routage avant qu'il n'arrive.
      if (deferred) routeInBackground(dir, sessionId, query, at);
      else await writeSelection(dir, sessionId, selected, { at, routed: reason === 'routed' });
      // Le chat de Cursor et les autres clients MCP passent par ici : sans cette
      // ligne, le journal ne verrait que les tours de Claude Code.
      await appendTurn(dir, {
        at,
        prompt: query,
        selected: [...selected],
        reason,
        source: 'mcp',
        ...(error ? { error } : {}),
      });
      const block = renderContext(tree, selected);
      const trace = renderTrace(tree, selected, reason);
      return text(
        [block || '(arbre de contexte vide)', '', `<!-- ${trace}${error ? ` — ${error}` : ''} -->`].join(
          '\n',
        ),
      );
    },
  );

  server.registerTool(
    'list_branches',
    {
      title: "Lister l'arbre de contexte",
      description:
        "Catalogue de toutes les branches : chemin, type, titre et condition de chargement. " +
        "Utile pour savoir ce que le projet sait déjà avant d'en ajouter.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { tree } = await open();
      const branches = allBranches(tree);
      if (!branches.length) return text('Arbre vide.');
      return text(
        `${formatTree(tree)}\n\n${branches.length} branche(s).\nChemins : ${branches
          .map(b => b.path)
          .join(', ')}`,
      );
    },
  );

  server.registerTool(
    'read_branch',
    {
      title: 'Lire une branche',
      description: "Contenu complet d'une branche, par son chemin (voir list_branches).",
      inputSchema: {
        path: z
          .string()
          .describe("Chemin logique, ex. 'archi-store/commandes-npm'. `:root` pour la racine."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path: branchPath }) => {
      const { tree } = await open();
      // La racine n'est pas une branche — elle n'a ni type ni `load_when` —
      // mais elle se relit par le même outil : on ne remplace pas un contenu
      // qu'on n'a pas pu lire.
      if (branchPath === ROOT_PATH) {
        return text(`# Racine\ntoujours injectée, jamais routée\n\n${tree.rootContent}`);
      }
      const branch = tree.branches.get(branchPath);
      if (!branch) throw new Error(`Branche inconnue : ${branchPath}`);
      return text(
        `# ${branch.title}\ntype: ${branch.type}\ncharger quand: ${branch.loadWhen}\n\n${branch.content}`,
      );
    },
  );

  server.registerTool(
    'upsert_branch',
    {
      title: 'Créer ou mettre à jour une branche',
      description:
        "Écrit une branche sur le disque. Utilise-le pour capitaliser un fait durable sur le " +
        "projet. `load_when` est la phrase que lira le routeur : formule-la comme une condition " +
        "(« quand on touche à X », « si la demande parle de Y »), pas comme un résumé.",
      inputSchema: {
        title: z.string().describe('Titre lisible de la branche.'),
        type: branchTypeSchema.describe(
          'identity = qui est l\'IA · rule = contrainte dure · context = connaissance de domaine · reference = API, chemins, commandes · skill = savoir-faire activable (feuille).',
        ),
        load_when: z.string().describe('Condition de chargement, une phrase.'),
        content: z.string().describe('Corps markdown de la branche.'),
        path: z.string().optional().describe('Chemin explicite. Par défaut, dérivé du titre.'),
        parent: z.string().optional().describe("Chemin de la branche parente, si c'est un enfant."),
        why: z
          .string()
          .describe(
            "Pourquoi cette branche mérite d'exister, en une phrase. Elle apparaît dans la vue " +
              "à côté de la branche : c'est ce qui permet à l'utilisateur de relire ce que tu as " +
              'écrit, et de le corriger. Dis la même chose à l\'utilisateur en clair.',
          ),
      },
    },
    async ({ title, type, load_when, content, path: explicit, parent, why }) => {
      const { dir, tree } = await open();
      if (parent && !tree.branches.has(parent)) throw new Error(`Parent inconnu : ${parent}`);
      const slug = explicit ?? slugify(title);
      if (slug.includes('..')) throw new Error(`Chemin refusé : ${slug}`);
      const branchPath = parent && !explicit ? `${parent}/${slug}` : slug;
      const file = await writeBranch(dir, {
        path: branchPath,
        type,
        title,
        loadWhen: load_when,
        content,
      });
      const existed = tree.branches.has(branchPath);
      await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: branchPath, title, why });
      return text(
        `${existed ? 'Branche mise à jour' : 'Branche écrite'} : ${branchPath} (${type})\n` +
          `${path.relative(process.cwd(), file)}\n\n` +
          "Annonce-le maintenant à l'utilisateur : ce que tu viens d'écrire dans l'arbre, et pourquoi.",
      );
    },
  );

  server.registerTool(
    'write_root',
    {
      title: 'Écrire la racine',
      description:
        "Le contenu toujours injecté, jamais routé : qui, quoi, dans quel repo. Court. " +
        "C'est la première chose à poser sur un arbre neuf, et la seule que `upsert_branch` " +
        "ne sait pas écrire. **Crée le dossier `.contextree/` s'il n'existe pas encore** : " +
        "sur un projet sans arbre, c'est par ici qu'on commence, sans aucune commande à " +
        'taper. Relis la racine avec `read_branch` sur `:root` avant de la remplacer.',
      inputSchema: {
        content: z.string().describe('Corps markdown de la racine. Quelques lignes, pas une page.'),
        why: z
          .string()
          .describe(
            'Pourquoi la racine doit dire ça, en une phrase. Elle apparaît dans la vue à côté ' +
              "de la racine : c'est ce qui permet à l'utilisateur de relire ce que tu as écrit. " +
              "Dis la même chose à l'utilisateur en clair.",
          ),
      },
    },
    async ({ content, why }) => {
      // Le seul outil qui a le droit de créer l'arbre.
      //
      // Il pose la racine, donc il pose le contenant : sans ça, l'IA qui vient
      // de proposer l'arbre et d'obtenir un « oui » devait renvoyer l'utilisateur
      // au terminal (`contextree init`) — le geste que tout ceci existe pour
      // supprimer. `upsert_branch` n'a pas ce droit : écrire une branche avant
      // la racine est l'ordre inverse de la consigne `bootstrap`, et donnerait
      // un arbre sans son seul contenu toujours injecté.
      //
      // Le dossier créé est celui d'`initTree` — `.contextree/` sous le `cwd` du
      // serveur — mais **sans le tronc de quatre branches de départ** : l'IA
      // écrit les siennes, et deux entrées pour le même sujet font charger la
      // mauvaise.
      const existing = await findTreeDir(cwd);
      const dir = existing ?? path.join(cwd, DIR_NAME);
      await writeRoot(dir, content);
      // Tracée comme une branche, sous le chemin que les vues emploient déjà
      // pour la racine : la pastille « écrite par l'IA » s'allume au même
      // endroit, sans cas particulier de plus.
      await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: ROOT_PATH, title: 'Racine', why });
      return text(
        `Racine écrite : ${path.relative(process.cwd(), path.join(dir, ROOT_FILE))}\n` +
          // Un dossier vient d'apparaître dans son projet : il doit l'apprendre
          // maintenant, pas en le découvrant dans un `git status`.
          (existing ? '' : `Arbre créé : ${path.relative(process.cwd(), dir)}/\n`) +
          "\nAnnonce-le maintenant à l'utilisateur : ce que tu viens d'écrire dans la racine, et pourquoi." +
          (existing ? '' : " Dis-lui aussi que le dossier `.contextree/` vient d'être créé."),
      );
    },
  );

  server.registerTool(
    'delete_branch',
    {
      title: 'Supprimer une branche',
      description: 'Supprime une branche et toutes ses branches enfants. Irréversible.',
      inputSchema: {
        path: z.string().describe('Chemin de la branche à supprimer.'),
        why: z.string().describe('Pourquoi cette branche ne doit plus exister, en une phrase.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ path: branchPath, why }) => {
      const { dir, tree } = await open();
      const branch = tree.branches.get(branchPath);
      if (!branch) throw new Error(`Branche inconnue : ${branchPath}`);
      await deleteBranch(dir, branchPath);
      const kids = branch.childPaths.length;
      await appendAiWrite(dir, {
        at: Date.now(),
        op: 'delete',
        path: branchPath,
        title: branch.title,
        why,
      });
      return text(
        `Supprimé : ${branchPath}${kids ? ` (+ ${kids} enfant(s))` : ''}\n\n` +
          "Annonce-le maintenant à l'utilisateur : ce que tu viens de retirer de l'arbre, et pourquoi.",
      );
    },
  );

  server.registerTool(
    'move_branch',
    {
      title: 'Déplacer ou renommer une branche',
      description:
        "Change le chemin d'une branche — renommer et reparenter sont la même opération. " +
        'Ses branches enfants suivent. Refusé si le chemin d\'arrivée est déjà occupé ou ' +
        "s'il est sous la branche déplacée.",
      inputSchema: {
        from: z.string().describe('Chemin actuel de la branche.'),
        to: z.string().describe('Nouveau chemin complet (parent inclus).'),
        why: z.string().optional().describe('Pourquoi ce rangement, si ce n\'est pas évident.'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ from, to, why }) => {
      const { dir, tree } = await open();
      const branch = tree.branches.get(from);
      if (!branch) throw new Error(`Branche inconnue : ${from}`);
      // Même garde que `upsert_branch` : un parent inconnu se crée à la main.
      const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
      if (parent && !tree.branches.has(parent)) throw new Error(`Parent inconnu : ${parent}`);
      await moveBranch(dir, from, to);
      const kids = branch.childPaths.length;
      await appendAiWrite(dir, {
        at: Date.now(),
        op: 'move',
        path: to,
        from,
        title: branch.title,
        ...(why ? { why } : {}),
      });
      return text(`${from} → ${to}${kids ? ` (+ ${kids} enfant(s))` : ''}`);
    },
  );

  server.registerTool(
    'export_pack',
    {
      title: "Exporter l'arbre pour le partager",
      description:
        "Sérialise l'arbre complet en un pack autonome. `as_token` renvoie un jeton compressé " +
        "à coller dans une conversation ; sinon, du JSON.",
      inputSchema: {
        as_token: z.boolean().optional().describe('Renvoyer un jeton compressé plutôt que du JSON.'),
        title: z.string().optional().describe('Nom du pack.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ as_token, title }) => {
      const { tree } = await open();
      const pack = extractPack(tree, title);
      return text(as_token ? `contextree:${encodePack(pack)}` : JSON.stringify(pack, null, 2));
    },
  );

  server.registerTool(
    'import_pack',
    {
      title: 'Importer un arbre partagé',
      description:
        "Greffe un pack (jeton `contextree:…`, JSON brut, ou chemin de fichier) dans l'arbre local. " +
        '`prefix` isole les branches importées sous une branche à toi.',
      inputSchema: {
        source: z.string().describe('Jeton, JSON, ou chemin de fichier.'),
        prefix: z.string().optional().describe('Préfixe de chemin pour les branches importées.'),
      },
    },
    async ({ source, prefix }) => {
      const { dir } = await open();
      const pack = await resolvePack(source);
      const written = await applyPack(dir, pack, { prefix, mergeRoot: true });
      return text(`${written.length} branche(s) importée(s)${prefix ? ` sous ${prefix}/` : ''}.`);
    },
  );

  return server;
}

/** Un pack peut arriver sous trois formes ; on les accepte toutes. */
export async function resolvePack(source: string) {
  const trimmed = source.trim();
  if (trimmed.startsWith('{')) return decodePackFromJson(trimmed);
  if (trimmed.startsWith('contextree:') || /^[A-Za-z0-9_-]{40,}$/.test(trimmed)) {
    return decodePack(trimmed);
  }
  return decodePackFromJson(await fs.readFile(trimmed, 'utf8'));
}

function decodePackFromJson(raw: string) {
  const parsed = JSON.parse(raw);
  return decodePack(encodePack(parsed));
}

export async function runStdio(cwd?: string): Promise<void> {
  const server = await createServer(cwd);
  await server.connect(new StdioServerTransport());
}
