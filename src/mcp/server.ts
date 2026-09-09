import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { findTreeDir, loadTree, slugify, writeBranch, writeRoot, deleteBranch, moveBranch, ROOT_FILE } from '../core/store.js';
import { allBranches, formatTree } from '../core/tree.js';
import { renderContext, renderTrace } from '../core/render.js';
import { route } from '../core/router.js';
import { appendTurn, appendAiWrite } from '../core/journal.js';
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
injecté, et aucune branche ne le remplace.

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
        "À appeler dès que tu sais sur quoi porte la tâche : au début avec la demande telle " +
        'quelle, puis à nouveau chaque fois qu\'elle se précise — une carte lue, une trace ' +
        "d'erreur, un fichier ouvert. Rappeler cet outil est le régime normal.",
      inputSchema: {
        query: z.string().describe("La demande de l'utilisateur, en clair."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const { dir, tree } = await open();
      const { selected, reason, error } = await route(tree, query);
      // Le chat de Cursor et les autres clients MCP passent par ici : sans cette
      // ligne, le journal ne verrait que les tours de Claude Code.
      await appendTurn(dir, {
        at: Date.now(),
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
        'ne sait pas écrire. Relis-la avec `read_branch` sur `:root` avant de la remplacer.',
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
      const { dir } = await open();
      await writeRoot(dir, content);
      // Tracée comme une branche, sous le chemin que les vues emploient déjà
      // pour la racine : la pastille « écrite par l'IA » s'allume au même
      // endroit, sans cas particulier de plus.
      await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: ROOT_PATH, title: 'Racine', why });
      return text(
        `Racine écrite : ${path.relative(process.cwd(), path.join(dir, ROOT_FILE))}\n\n` +
          "Annonce-le maintenant à l'utilisateur : ce que tu viens d'écrire dans la racine, et pourquoi.",
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
