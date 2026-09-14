import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { findTreeDir, findStrayHomeTree, isHomeDir, loadTree, slugify, writeBranch, writeRoot, deleteBranch, moveBranch, detectInstructionFiles, ensureLocalIgnored, DIR_NAME, ROOT_FILE } from '../core/store.js';
import { coreText } from '../core/messages.js';
import { syncInstructionFiles } from '../install.js';
import { allBranches, formatTree } from '../core/tree.js';
import { renderContext, renderTrace, renderBootstrapPrompt, renderBootstrapInvite, renderCatalogueOnly, TREE_METHOD } from '../core/render.js';
import { lintTree, renderShapeWarnings } from '../core/lint.js';
import { currentLang } from '../core/i18n.js';
import { route, pickEngine, isCliEngine, withoutRouting, routeInBackground, ROUTE_THRESHOLD } from '../core/router.js';
import type { Complete } from '../core/router.js';
import { appendTurn, appendAiWrite, recordRead } from '../core/journal.js';
import { VERSION } from '../core/version.js';
import { readSelection, writeSelection } from '../core/session.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePack, encodePack, extractPack, applyPack } from '../core/pack.js';
import { BRANCH_TYPES } from '../core/types.js';
import type { ContextTree } from '../core/types.js';
import { serverText } from './messages.js';


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
  // La langue est celle du process : l'agent lance le serveur avec `--lang`,
  // inscrit par `install`. Lue une fois — les descriptions d'outils sont figées
  // à l'enregistrement, et une session ne change pas de langue en route.
  const t = serverText();
  /** Ce que l'IA doit faire ici quand il n'y a rien : proposer l'arbre.
   *
   *  Une seule copie pour les deux surfaces du serveur — les `instructions` et
   *  la réponse de `get_context`. Le dossier est relu à chaque appel : celui
   *  qui crée son arbre en cours de session n'a pas à relancer le serveur pour
   *  que les outils le voient. */
  const invite = async (): Promise<string> => renderBootstrapInvite(await detectInstructionFiles(await projectDir()));

  /** Les `instructions` sont lues **une fois**, à la connexion — l'agent relance
   *  le serveur à chaque session, donc l'invitation arrive une fois par session
   *  et pas à chaque tour. C'est le seul endroit où un projet sans arbre peut
   *  encore parler à une IA qui n'a ni hook ni terminal. */
  // Un arbre égaré dans `~/.contextree` se signale dans les `instructions` :
  // lues une fois par session, c'est le « une fois » qu'on veut.
  const stray = await findStrayHomeTree();
  const strayNote = stray.length ? `\n\n${coreText().strayTree(path.join(os.homedir(), DIR_NAME), stray.length)}` : '';
  const server = new McpServer(
    { name: 'contextree', version: VERSION },
    // Le `cwd` seul ici : les roots du client ne se demandent qu'une fois
    // connecté, et le serveur n'existe pas encore.
    // Sans arbre, les **deux** consignes : l'invitation, et ce qui vaut dès que
    // l'arbre existe. Elles ne sont lues qu'une fois, et l'arbre peut naître en
    // cours de session — un Copilot qui n'avait reçu que l'invitation savait
    // construire l'arbre et ignorait qu'il fallait le lire (14 septembre 2026).
    {
      instructions:
        ((await findTreeDir(cwd))
          ? t.instructions
          : `${renderBootstrapInvite(await detectInstructionFiles(cwd))}\n\n${t.instructionsOnceTree}\n\n${t.instructions}`) + strayNote,
    },
  );

  /**
   * Le bloc de consignes suit l'arbre — voir `syncInstructionFiles`.
   *
   * Au premier `get_context` d'une session, puis après chaque écriture. Pour
   * VS Code, `copilot-instructions.md` est créé s'il n'existe pas : que VS Code
   * lance ce serveur dans ce projet tient lieu de câblage. Chaque fichier
   * touché est **annoncé** dans la réponse de l'outil — on ne modifie pas un
   * fichier du dépôt en silence. Un échec n'échoue pas l'outil : l'écriture
   * dans l'arbre, elle, a eu lieu.
   */
  let instructionsSynced = false;
  const syncInstructions = async (dir: string): Promise<string> => {
    instructionsSynced = true;
    try {
      const vscodeClient = /^visual studio code/i.test(server.server.getClientVersion()?.name ?? '');
      const touched = (await syncInstructionFiles(dir, { vscodeClient })).filter(r => r.action !== 'unchanged');
      if (!touched.length) return '';
      return `\n\n${t.instructionsSynced(touched.map(r => path.relative(path.dirname(dir), r.file)).join(', '))}`;
    } catch {
      return '';
    }
  };

  /**
   * Le dossier du projet, pour ce serveur.
   *
   * D'abord le `cwd` du process — c'est ce que tous les agents font. Mais
   * VS Code peut lancer le serveur ailleurs que dans le workspace (l'expansion
   * de `${workspaceFolder}` dans `cwd` a eu des ratés selon les versions), et
   * un serveur qui ne trouve pas `.contextree/` répond « pas d'arbre » : Copilot
   * n'aurait **aucune** branche, sans que rien ne le signale (14 septembre 2026).
   *
   * Filet : si le `cwd` n'a pas d'arbre et que le client annonce la capacité
   * `roots`, on lui demande ses dossiers — c'est exactement ce qu'elle dit, où
   * l'utilisateur travaille. Le premier root qui a un arbre gagne ; sinon le
   * premier root tout court, pour que `write_root` crée l'arbre dans le
   * workspace et pas dans le `cwd` hasardeux. Demandé une fois par session.
   */
  let fromRoots: Promise<string | null> | undefined;
  const projectDir = async (): Promise<string> => {
    if (await findTreeDir(cwd)) return cwd;
    fromRoots ??= treeFromRoots();
    return (await fromRoots) ?? cwd;
  };
  const treeFromRoots = async (): Promise<string | null> => {
    if (!server.server.getClientCapabilities()?.roots) return null;
    try {
      const { roots } = await server.server.listRoots(undefined, { timeout: 5000 });
      const dirs = roots.filter(r => r.uri.startsWith('file:')).map(r => fileURLToPath(r.uri));
      for (const d of dirs) if (await findTreeDir(d)) return d;
      return dirs[0] ?? null;
    } catch {
      // Un client qui annonce `roots` sans savoir y répondre : on reste sur le `cwd`.
      return null;
    }
  };

  /** L'arbre est relu à chaque appel : les fichiers sont la source de vérité et
   *  l'utilisateur peut les éditer pendant que le serveur tourne. */
  const open = async (): Promise<{ dir: string; tree: ContextTree }> => {
    const base = await projectDir();
    const dir = await findTreeDir(base);
    // Le message nomme `write_root` avant le terminal : c'est le seul outil qui
    // sait créer l'arbre, et un agent à qui on répond « lance une commande »
    // s'arrête pour la demander (constaté le 10 septembre 2026, scénario
    // « depuis zéro »).
    if (!dir) {
      throw new Error(t.noTree(DIR_NAME, base));
    }
    return { dir, tree: await loadTree(dir) };
  };

  const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

  /**
   * Les défauts de forme de l'arbre, dans la réponse de chaque outil qui le
   * change (14 septembre 2026) : c'est l'instant où l'agent peut encore les
   * corriger, et le seul canal qu'il lit à coup sûr. Rien s'il n'y en a pas.
   */
  const shape = async (dir: string): Promise<string> => {
    const warnings = renderShapeWarnings(lintTree(await loadTree(dir)));
    return warnings ? `\n\n${warnings}` : '';
  };

  /**
   * Le routage par le modèle **du client** — `sampling/createMessage`
   * (14 septembre 2026).
   *
   * C'est ce qui fait router Copilot sur un poste qui n'a ni clé API ni CLI
   * d'agent : sans lui, `get_context` y rendait l'arbre entier à chaque appel.
   * Le serveur fabrique la complétion et la passe au routeur, qui ne sait rien
   * de MCP.
   *
   * **Une seule tentative par session quand le client refuse** : consentement
   * décliné, aucun modèle autorisé, délai dépassé. Redemander à chaque appel
   * reviendrait à rouvrir la même invite de consentement à chaque tâche, ou à
   * repayer 45 s d'attente pour le même refus. Le process est la session :
   * relancer le serveur, c'est redemander. Une réponse **illisible** n'est pas
   * un refus — le client a répondu, le modèle s'est trompé — et ne coupe rien.
   */
  let samplingRefused: string | undefined;
  const sampler = (): Complete | undefined => {
    if (samplingRefused || !server.server.getClientCapabilities()?.sampling) return undefined;
    return async (system, message, timeout) => {
      try {
        const res = await server.server.createMessage(
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: { type: 'text', text: message } }],
            // Un tableau d'entiers : quelques tokens suffisent, et un plafond
            // bas dit au client qu'on ne lui demande pas une rédaction.
            maxTokens: 256,
            includeContext: 'none',
            // Trier un catalogue ne demande pas de réflexion : on demande le
            // modèle rapide et bon marché, et le client reste libre d'ignorer.
            modelPreferences: {
              speedPriority: 1,
              costPriority: 0.8,
              intelligencePriority: 0.2,
              hints: [{ name: 'haiku' }, { name: 'mini' }, { name: 'flash' }],
            },
          },
          { timeout },
        );
        if (res.content.type !== 'text') throw new Error(t.samplingNotText(res.content.type));
        return res.content.text;
      } catch (err) {
        samplingRefused = err instanceof Error ? err.message : String(err);
        throw new Error(t.samplingRefused(samplingRefused));
      }
    };
  };

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
      title: t.bootstrapPromptTitle,
      description: t.bootstrapPromptDescription,
    },
    async () => {
      const found = await detectInstructionFiles(await projectDir());
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
      title: t.bootstrapToolTitle,
      description: t.bootstrapToolDescription,
      annotations: { readOnlyHint: true },
    },
    async () => text(renderBootstrapPrompt(await detectInstructionFiles(await projectDir()))),
  );

  server.registerTool(
    'get_context',
    {
      title: t.getContextTitle,
      description: t.getContextDescription,
      inputSchema: {
        query: z.string().describe(t.getContextQuery),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      // Sans arbre, on répond l'invitation **en texte**, pas une erreur : un
      // outil qui échoue, le modèle l'abandonne et n'y revient pas ; un outil
      // qui répond « voilà ce qu'il y a à faire », il le suit. `list_branches`
      // et `read_branch` gardent l'erreur — on ne liste pas ce qui n'existe pas.
      const found = await findTreeDir(await projectDir());
      if (!found) return text(await invite());

      const { dir, tree } = await open();
      const synced = instructionsSynced ? '' : await syncInstructions(dir);

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
       * en synchrone et l'agent a sa réponse juste du premier coup. Pareil sous
       * `sampling` : le client répond comme une API, sans process à lancer.
       */
      const sample = sampler();
      const deferred =
        isCliEngine(pickEngine(undefined, { sampling: Boolean(sample) })) &&
        process.env['CONTEXTREE_ROUTER_BLOCKING'] !== '1';
      const at = Date.now();
      const previous = await readSelection(dir, sessionId);

      const { selected, reason, error, engine } = deferred
        ? { selected: withoutRouting(tree, previous), reason: 'deferred' as const, error: undefined, engine: undefined }
        : await route(tree, query, { waiter: 'tool', previousSelection: previous, ...(sample ? { sampler: sample } : {}) });

      /**
       * **Jamais l'arbre entier à un agent** (14 septembre 2026). Quand ce qui
       * sortirait est l'arbre complet faute de routage — démarrage à froid en
       * différé, aucun moteur, repli sans sélection antérieure —, on rend la
       * racine et le catalogue, et l'agent trie lui-même avec `read_branch`.
       * Voir `renderCatalogueOnly` pour le pourquoi.
       *
       * Une sélection héritée partielle reste servie telle quelle : elle vient
       * d'un vrai routage. Un petit arbre (≤ seuil) aussi : le tout y coûte
       * moins qu'un aller-retour. `CONTEXTREE_MCP_FALLBACK=full` rend l'ancien
       * comportement, pour l'éval et la démo.
       */
      const unrouted = reason === 'deferred' || reason === 'fallback' || (reason === 'all' && Boolean(error));
      const catalogueOnly =
        unrouted &&
        tree.branches.size > ROUTE_THRESHOLD &&
        selected.size >= tree.branches.size &&
        process.env['CONTEXTREE_MCP_FALLBACK'] !== 'full';

      // En différé, c'est le process de fond qui écrira la sélection : l'écraser
      // ici effacerait le routage avant qu'il n'arrive. Un catalogue n'écrit rien
      // non plus : l'arbre entier en cache de session reviendrait au tour suivant
      // comme une « sélection héritée ».
      if (deferred) routeInBackground(dir, sessionId, query, at);
      else if (!catalogueOnly) await writeSelection(dir, sessionId, selected, { at, routed: reason === 'routed' });
      // Le chat de Cursor et les autres clients MCP passent par ici : sans cette
      // ligne, le journal ne verrait que les tours de Claude Code.
      await appendTurn(dir, {
        at,
        prompt: query,
        selected: catalogueOnly ? [] : [...selected],
        reason: catalogueOnly ? 'catalogue' : reason,
        source: 'mcp',
        session: sessionId,
        ...(error ? { error } : {}),
        ...(engine ? { engine } : {}),
      });

      /**
       * La trace est la **première ligne**, en texte (14 septembre 2026). Elle
       * fermait la réponse dans un commentaire HTML, que le chat de VS Code
       * masque : qui dépliait l'appel d'outil ne voyait pas quelles branches
       * étaient parties. En tête, elle se lit sans rien faire défiler.
       */
      if (catalogueOnly) {
        const cause =
          reason === 'deferred' ? t.causeCold : reason === 'all' ? t.causeNoEngine : t.causeFallback(error);
        const trace = renderTrace(tree, new Set(), 'catalogue');
        return text([`${trace} — ${cause}`, '', renderCatalogueOnly(tree, cause)].join('\n') + synced);
      }

      const block = renderContext(tree, selected);
      const trace = renderTrace(tree, selected, reason);
      return text([`${trace}${error ? ` — ${error}` : ''}`, '', block || t.emptyTree].join('\n') + synced);
    },
  );

  server.registerTool(
    'list_branches',
    {
      title: t.listTitle,
      description: t.listDescription,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { tree } = await open();
      const branches = allBranches(tree);
      if (!branches.length) return text(t.listEmpty);
      return text(`${formatTree(tree)}\n\n${t.listCount(branches.length, branches.map(b => b.path).join(', '))}`);
    },
  );

  server.registerTool(
    'read_branch',
    {
      title: t.readTitle,
      description: t.readDescription,
      inputSchema: {
        path: z.string().describe(t.readPath),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path: branchPath }) => {
      const { dir, tree } = await open();
      // La racine n'est pas une branche — elle n'a ni type ni `load_when` —
      // mais elle se relit par le même outil : on ne remplace pas un contenu
      // qu'on n'a pas pu lire. Elle n'est pas journalisée : les vues la
      // comptent déjà comme lue à chaque tour.
      if (branchPath === ROOT_PATH) {
        return text(t.readRoot(tree.rootContent));
      }
      const branch = tree.branches.get(branchPath);
      if (!branch) throw new Error(t.unknownBranch(branchPath));
      // Une lecture est une branche partie à l'agent, comme une branche routée :
      // sans cette trace, un tour en catalogue n'allumait rien dans les vues.
      await recordRead(dir, { at: Date.now(), session: sessionId, path: branchPath });
      return text(
        `${t.readTrace(branch.title, branchPath)}\n\n${t.readBranch(branch.title, branch.type, branch.loadWhen, branch.content)}`,
      );
    },
  );

  server.registerTool(
    'upsert_branch',
    {
      title: t.upsertTitle,
      description: t.upsertDescription,
      inputSchema: {
        title: z.string().describe(t.upsertTitleParam),
        type: branchTypeSchema.describe(t.upsertTypeParam),
        load_when: z.string().describe(t.upsertLoadWhenParam),
        content: z.string().describe(t.upsertContentParam),
        path: z.string().optional().describe(t.upsertPathParam),
        parent: z.string().optional().describe(t.upsertParentParam),
        why: z.string().describe(t.upsertWhyParam),
      },
    },
    async ({ title, type, load_when, content, path: explicit, parent, why }) => {
      const { dir, tree } = await open();
      if (parent && !tree.branches.has(parent)) throw new Error(t.unknownParent(parent));
      const slug = explicit ?? slugify(title);
      if (slug.includes('..')) throw new Error(t.pathRefused(slug));
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
      return text(t.upsertDone(existed, branchPath, type, path.relative(process.cwd(), file)) + (await shape(dir)) + (await syncInstructions(dir)));
    },
  );

  server.registerTool(
    'write_root',
    {
      title: t.rootTitle,
      description: t.rootDescription,
      inputSchema: {
        content: z.string().describe(t.rootContentParam),
        why: z.string().describe(t.rootWhyParam),
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
      const base = await projectDir();
      const existing = await findTreeDir(base);
      // Un serveur lancé dans le dossier utilisateur — sans `cwd` ni roots —
      // aurait posé là un arbre lu par tous les projets qu'il contient.
      if (!existing && isHomeDir(base)) throw new Error(coreText().homeRefused(base));
      const dir = existing ?? path.join(base, DIR_NAME);
      // L'arbre naît ici aussi, donc le garde-fou du calque personnel aussi.
      if (!existing) await ensureLocalIgnored(base);
      await writeRoot(dir, content);
      // Tracée comme une branche, sous le chemin que les vues emploient déjà
      // pour la racine : la pastille « écrite par l'IA » s'allume au même
      // endroit, sans cas particulier de plus.
      await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: ROOT_PATH, title: t.rootAiWriteTitle, why });
      // Un dossier vient d'apparaître dans son projet : il doit l'apprendre
      // maintenant, pas en le découvrant dans un `git status`.
      return text(
        t.rootDone(
          path.relative(process.cwd(), path.join(dir, ROOT_FILE)),
          existing ? null : path.relative(process.cwd(), dir),
        ) +
          // L'arbre naît : c'est le seul instant garanti où l'agent construit un
          // arbre, qu'il ait appelé `bootstrap_prompt` ou non. Le plan d'abord
          // et la méthode arrivent donc ici, dans la réponse.
          (existing ? '' : `\n\n${t.rootCreatedGuide}\n\n${TREE_METHOD[currentLang()]}`) +
          (await syncInstructions(dir)),
      );
    },
  );

  server.registerTool(
    'delete_branch',
    {
      title: t.deleteTitle,
      description: t.deleteDescription,
      inputSchema: {
        path: z.string().describe(t.deletePathParam),
        why: z.string().describe(t.deleteWhyParam),
      },
      annotations: { destructiveHint: true },
    },
    async ({ path: branchPath, why }) => {
      const { dir, tree } = await open();
      const branch = tree.branches.get(branchPath);
      if (!branch) throw new Error(t.unknownBranch(branchPath));
      await deleteBranch(dir, branchPath);
      const kids = branch.childPaths.length;
      await appendAiWrite(dir, {
        at: Date.now(),
        op: 'delete',
        path: branchPath,
        title: branch.title,
        why,
      });
      return text(t.deleteDone(branchPath, kids) + (await shape(dir)) + (await syncInstructions(dir)));
    },
  );

  server.registerTool(
    'move_branch',
    {
      title: t.moveTitle,
      description: t.moveDescription,
      inputSchema: {
        from: z.string().describe(t.moveFromParam),
        to: z.string().describe(t.moveToParam),
        why: z.string().optional().describe(t.moveWhyParam),
      },
      annotations: { destructiveHint: false },
    },
    async ({ from, to, why }) => {
      const { dir, tree } = await open();
      const branch = tree.branches.get(from);
      if (!branch) throw new Error(t.unknownBranch(from));
      // Même garde que `upsert_branch` : un parent inconnu se crée à la main.
      const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
      if (parent && !tree.branches.has(parent)) throw new Error(t.unknownParent(parent));
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
      return text(`${from} → ${to}${kids ? t.moveChildren(kids) : ''}` + (await shape(dir)) + (await syncInstructions(dir)));
    },
  );

  server.registerTool(
    'export_pack',
    {
      title: t.exportTitle,
      description: t.exportDescription,
      inputSchema: {
        as_token: z.boolean().optional().describe(t.exportTokenParam),
        title: z.string().optional().describe(t.exportNameParam),
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
      title: t.importTitle,
      description: t.importDescription,
      inputSchema: {
        source: z.string().describe(t.importSourceParam),
        prefix: z.string().optional().describe(t.importPrefixParam),
      },
    },
    async ({ source, prefix }) => {
      const { dir } = await open();
      const pack = await resolvePack(source);
      const written = await applyPack(dir, pack, { prefix, mergeRoot: true });
      return text(t.importDone(written.length, prefix) + (await syncInstructions(dir)));
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

export async function runStdio(cwd: string = process.cwd()): Promise<void> {
  const server = await createServer(cwd);
  await server.connect(new StdioServerTransport());
  // Une ligne sur stderr au démarrage : VS Code l'affiche dans la sortie du
  // serveur MCP, et c'est là qu'on lit, sans rien installer, dans quel dossier
  // il a été lancé et s'il y a trouvé un arbre.
  const tree = await findTreeDir(cwd);
  process.stderr.write(`${serverText().startup(cwd, tree)}\n`);
}
