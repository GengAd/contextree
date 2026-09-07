import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { findTreeDir, loadTree, slugify, writeBranch, deleteBranch } from '../core/store.js';
import { allBranches, formatTree } from '../core/tree.js';
import { renderContext, renderTrace } from '../core/render.js';
import { route } from '../core/router.js';
import { decodePack, encodePack, extractPack, applyPack } from '../core/pack.js';
import { BRANCH_TYPES } from '../core/types.js';
import type { ContextTree } from '../core/types.js';

const INSTRUCTIONS = `contextree expose l'arbre de contexte du projet courant : identité, règles,
contexte de domaine, références et skills, sous forme de petites branches typées.

Avant de travailler sur une tâche non triviale, appelle \`get_context\` avec la demande de
l'utilisateur : tu récupères uniquement les branches pertinentes. Quand tu découvres un fait
durable sur ce projet (une convention, une contrainte, un chemin qui compte), propose-le avec
\`upsert_branch\` — l'arbre est fait pour être enrichi à l'usage.

Sous Claude Code, l'injection est déjà automatique via un hook : ne rappelle pas \`get_context\`
si le contexte est déjà présent dans ta conversation.`;

const branchTypeSchema = z.enum(BRANCH_TYPES);

export async function createServer(cwd: string = process.cwd()): Promise<McpServer> {
  const server = new McpServer(
    { name: 'contextree', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  /** L'arbre est relu à chaque appel : les fichiers sont la source de vérité et
   *  l'utilisateur peut les éditer pendant que le serveur tourne. */
  const open = async (): Promise<{ dir: string; tree: ContextTree }> => {
    const dir = await findTreeDir(cwd);
    if (!dir) throw new Error(`Aucun dossier .contextree trouvé depuis ${cwd}. Lance : contextree init`);
    return { dir, tree: await loadTree(dir) };
  };

  const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

  server.registerTool(
    'get_context',
    {
      title: 'Charger le contexte pertinent',
      description:
        "Renvoie les branches de l'arbre de contexte pertinentes pour une demande donnée, " +
        'assemblées en un bloc prêt à lire. Les branches parentes sont incluses d\'office. ' +
        "À appeler en début de tâche, avec la demande de l'utilisateur telle quelle.",
      inputSchema: {
        query: z.string().describe("La demande de l'utilisateur, en clair."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const { tree } = await open();
      const { selected, reason, error } = await route(tree, query);
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
      inputSchema: { path: z.string().describe("Chemin logique, ex. 'archi-store/commandes-npm'.") },
      annotations: { readOnlyHint: true },
    },
    async ({ path: branchPath }) => {
      const { tree } = await open();
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
      },
    },
    async ({ title, type, load_when, content, path: explicit, parent }) => {
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
      return text(`Branche écrite : ${branchPath}\n${path.relative(process.cwd(), file)}`);
    },
  );

  server.registerTool(
    'delete_branch',
    {
      title: 'Supprimer une branche',
      description: 'Supprime une branche et toutes ses branches enfants. Irréversible.',
      inputSchema: { path: z.string().describe('Chemin de la branche à supprimer.') },
      annotations: { destructiveHint: true },
    },
    async ({ path: branchPath }) => {
      const { dir, tree } = await open();
      const branch = tree.branches.get(branchPath);
      if (!branch) throw new Error(`Branche inconnue : ${branchPath}`);
      await deleteBranch(dir, branchPath);
      const kids = branch.childPaths.length;
      return text(`Supprimé : ${branchPath}${kids ? ` (+ ${kids} enfant(s))` : ''}`);
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
