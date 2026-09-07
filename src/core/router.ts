import Anthropic from '@anthropic-ai/sdk';
import { allBranches, guaranteedBranches, withAncestors } from './tree.js';
import type { ContextTree } from './types.js';

/** Modèle du routeur. Surchargeable — voir REFERENCES.md § Routage. */
const ROUTER_MODEL = process.env['CONTEXTREE_ROUTER_MODEL'] ?? 'claude-opus-5';
/** Budget latence du routeur. Au-delà, on tombe en fallback : l'appel principal
 *  ne doit jamais attendre après nous. */
const ROUTER_TIMEOUT_MS = Number(process.env['CONTEXTREE_ROUTER_TIMEOUT_MS'] ?? 2500);
/** En dessous de ce seuil, un aller-retour de routage coûte plus (latence +
 *  tokens) que d'injecter tout l'arbre. Le routeur ne se rentabilise qu'à
 *  partir du moment où la sélection économise vraiment des tokens. */
const ROUTE_THRESHOLD = 3;

export type RouteReason = 'routed' | 'all' | 'fallback';
export type RouteResult = { selected: Set<string>; reason: RouteReason; error?: string };

/**
 * Décide quelles branches charger pour ce prompt.
 *
 * Un appel IA léger lit le `load_when` de chaque branche (« charge-moi
 * quand… ») et renvoie les indices retenus. Les ancêtres d'une branche retenue
 * sont ajoutés d'office.
 *
 * En cas d'erreur, de timeout ou de réponse illisible : fallback sur la
 * sélection précédente (sticky) + identity/rule — jamais un ensemble vide.
 */
export async function route(
  tree: ContextTree,
  prompt: string,
  opts: { previousSelection?: string[]; apiKey?: string } = {},
): Promise<RouteResult> {
  const branches = allBranches(tree);
  if (branches.length === 0) return { selected: new Set(), reason: 'all' };
  if (branches.length <= ROUTE_THRESHOLD) {
    return { selected: new Set(branches.map(b => b.path)), reason: 'all' };
  }

  const previous = (opts.previousSelection ?? []).filter(p => tree.branches.has(p));
  const fallback = previous.length
    ? withAncestors(tree, [...previous, ...guaranteedBranches(tree)])
    : guaranteedBranches(tree);

  const catalogue = branches
    .map((b, i) => `[${i}] (${b.type}) ${b.title} — charger quand : ${b.loadWhen}`)
    .join('\n');

  const system =
    "Tu es un routeur de contexte. On te donne un catalogue de sections de " +
    "documentation, chacune avec sa condition de chargement, et le message d'un " +
    "utilisateur adressé à un assistant IA. Tu renvoies les indices des sections " +
    'à injecter.\n\n' +
    'Règles :\n' +
    "- Retiens une section si elle est pertinente OU si la tâche pourrait toucher à son domaine.\n" +
    '- Dans le doute, retiens-la : du contexte manquant coûte plus cher que du contexte en trop.\n' +
    "- Liste vide uniquement pour la conversation pure (salutations, hors-sujet).";

  // Pas de garde sur ANTHROPIC_API_KEY : le SDK résout aussi ANTHROPIC_AUTH_TOKEN
  // et les profils `ant auth login`. Une absence d'identifiants remonte comme
  // n'importe quelle autre erreur — et tombe dans le même fallback.
  const client = new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) });

  try {
    const response = await client.messages.create(
      {
        model: ROUTER_MODEL,
        max_tokens: 512,
        system,
        // Pas de thinking : le routeur doit répondre dans son budget latence.
        // Les deux pièges connus du mode thinking-off ne s'appliquent pas ici —
        // aucun outil déclaré, et la sortie est contrainte par un schéma, donc
        // rien ne peut fuiter dans le champ qu'on lit.
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                indices: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: 'Indices des sections à charger.',
                },
              },
              required: ['indices'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'user',
            content: `Sections :\n${catalogue}\n\nMessage utilisateur :\n${JSON.stringify(
              prompt.slice(0, 2000),
            )}`,
          },
        ],
      },
      { timeout: ROUTER_TIMEOUT_MS },
    );

    if (response.stop_reason === 'refusal') {
      return { selected: fallback, reason: 'fallback', error: 'routeur : refus' };
    }

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const indices = parseIndices(text);
    if (!indices) {
      return { selected: fallback, reason: 'fallback', error: 'routeur : réponse illisible' };
    }

    const picked = indices
      .filter(n => Number.isInteger(n) && n >= 0 && n < branches.length)
      .map(n => branches[n]!.path);

    return { selected: withAncestors(tree, picked), reason: 'routed' };
  } catch (err) {
    return {
      selected: fallback,
      reason: 'fallback',
      error: `routeur : ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Tolérant : la sortie structurée garantit le JSON, mais on accepte aussi un
 *  tableau nu si le schéma n'a pas été appliqué (ancien modèle, proxy…). */
function parseIndices(text: string): number[] | null {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(text);
  if (Array.isArray(direct)) return direct as number[];
  if (direct && typeof direct === 'object' && Array.isArray((direct as any).indices)) {
    return (direct as any).indices;
  }
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    const arr = tryParse(match[0]);
    if (Array.isArray(arr)) return arr as number[];
  }
  return null;
}
