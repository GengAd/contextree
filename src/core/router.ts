import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { allBranches, withAncestors } from './tree.js';
import type { ContextTree } from './types.js';

/** Modèle du routeur. Défaut par moteur — voir REFERENCES.md § Routage. */
const ROUTER_MODEL = process.env['CONTEXTREE_ROUTER_MODEL'];
const SDK_MODEL = ROUTER_MODEL ?? 'claude-opus-5';
/** Sous abonnement, le routeur passe par le CLI : un modèle rapide, sinon on
 *  paie un démarrage de process **et** un gros modèle à chaque prompt. */
const CLI_MODEL = ROUTER_MODEL ?? 'haiku';

/**
 * Budget latence, lu à chaque appel (le routage en tâche de fond le relève).
 *
 * L'API répond en une poignée de centaines de ms ; le CLI, lui, démarre un
 * process complet et passe par la file d'un abonnement — mesuré entre 5 et 60 s
 * sur ce repo. D'où deux budgets, et d'où le mode différé du hook : on ne fait
 * pas attendre un prompt derrière une file d'attente.
 */
function timeoutFor(engine: 'sdk' | 'cli'): number {
  const override = Number(process.env['CONTEXTREE_ROUTER_TIMEOUT_MS']);
  if (Number.isFinite(override) && override > 0) return override;
  return engine === 'cli' ? 20_000 : 2500;
}

/** En dessous de ce seuil, un aller-retour de routage coûte plus (latence +
 *  tokens) que d'injecter tout l'arbre. Le routeur ne se rentabilise qu'à
 *  partir du moment où la sélection économise vraiment des tokens. */
const ROUTE_THRESHOLD = 3;

/** `deferred` : rien n'a été routé pour *ce* prompt — le routage tourne en
 *  tâche de fond et servira au tour suivant. Un état à part, parce que ce n'est
 *  ni un routage ni une panne. */
export type RouteReason = 'routed' | 'all' | 'fallback' | 'deferred';
export type RouteResult = { selected: Set<string>; reason: RouteReason; error?: string };

/**
 * Qui fait tourner le routeur.
 *
 * - `sdk` : l'API Anthropic, avec une clé — le chemin le plus rapide ;
 * - `cli` : le binaire `claude` déjà installé et déjà authentifié. C'est le
 *   chemin **abonnement** : personne ne devrait avoir à sortir une clé API pour
 *   router son propre arbre alors que sa machine sait déjà parler au modèle ;
 * - `none` : ni l'un ni l'autre — on injecte tout l'arbre, comme un `CLAUDE.md`.
 *   Dégradé, jamais bloquant, et jamais silencieux (`error` le dit).
 */
export type RouterEngine = 'sdk' | 'cli' | 'none';

const ROUTER_SYSTEM =
  "Tu es un routeur de contexte. On te donne un catalogue de sections de " +
  "documentation, chacune avec sa condition de chargement, et le message d'un " +
  "utilisateur adressé à un assistant IA. Tu renvoies les indices des sections " +
  'à injecter.\n\n' +
  'Règles :\n' +
  "- Retiens une section si elle est pertinente OU si la tâche pourrait toucher à son domaine.\n" +
  '- Dans le doute, retiens-la : du contexte manquant coûte plus cher que du contexte en trop.\n' +
  "- Liste vide uniquement pour la conversation pure (salutations, hors-sujet).";

/** Le CLI n'a pas de sortie structurée gratuite : on la demande en toutes
 *  lettres. (`--json-schema` existe, mais il coûte un tour de plus et double la
 *  latence — mesuré, voir REFERENCES.md § Routage.) */
const CLI_SYSTEM =
  `${ROUTER_SYSTEM}\n\n` +
  "Format de réponse : UNIQUEMENT un tableau JSON d'indices, par exemple [0,3]. " +
  'Aucun autre texte, aucun bloc de code, aucune explication.';

const ROUTER_SCHEMA = {
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
} as const;

/**
 * Décide quelles branches charger pour ce prompt.
 *
 * Un appel IA léger lit le `load_when` de chaque branche (« charge-moi
 * quand… ») et renvoie les indices retenus. Les ancêtres d'une branche retenue
 * sont ajoutés d'office.
 *
 * En cas d'erreur, de timeout ou de réponse illisible : fallback sur la
 * sélection précédente (sticky), sinon l'arbre entier — jamais un ensemble
 * vide, et jamais une sélection décidée par le type des branches.
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

  const fallback = withoutRouting(tree, opts.previousSelection);

  const engine = pickEngine(opts.apiKey);
  if (engine === 'none') {
    return {
      selected: new Set(branches.map(b => b.path)),
      reason: 'all',
      error: "aucun moteur de routage (ni clé API, ni CLI `claude`) — arbre entier injecté",
    };
  }

  const catalogue = branches
    .map((b, i) => `[${i}] (${b.type}) ${b.title} — charger quand : ${b.loadWhen}`)
    .join('\n');
  const message = `Sections :\n${catalogue}\n\nMessage utilisateur :\n${JSON.stringify(
    prompt.slice(0, 2000),
  )}`;

  try {
    const indices =
      engine === 'cli'
        ? await askCli(message, timeoutFor('cli'))
        : await askSdk(message, timeoutFor('sdk'), opts.apiKey);
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

/**
 * Ce qu'on injecte quand on ne route pas : la sélection du tour précédent,
 * sinon l'arbre entier.
 *
 * Jamais un ensemble vide, et jamais une sélection décidée par le *type* des
 * branches — un `identity` n'est pas plus « garanti » qu'un `reference`. C'est
 * le `load_when` qui décide, ou personne.
 */
export function withoutRouting(tree: ContextTree, previousSelection?: string[]): Set<string> {
  const previous = (previousSelection ?? []).filter(p => tree.branches.has(p));
  return previous.length ? withAncestors(tree, previous) : new Set(tree.order);
}

/**
 * Le moteur retenu pour cette machine.
 *
 * Une clé explicite gagne toujours — c'est le chemin le plus court. Sinon on
 * cherche le CLI : la plupart des utilisateurs de contextree ont déjà `claude`
 * installé et authentifié par abonnement, et leur demander une clé API en plus
 * n'a aucun sens. `CONTEXTREE_ROUTER=sdk|cli|off` force la main.
 */
export function pickEngine(apiKey?: string): RouterEngine {
  const forced = process.env['CONTEXTREE_ROUTER'];
  if (forced === 'off') return 'none';
  if (forced === 'sdk' || forced === 'cli') return forced;
  if (apiKey || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']) {
    return 'sdk';
  }
  return claudeBin() ? 'cli' : 'none';
}

async function askSdk(
  message: string,
  timeout: number,
  apiKey?: string,
): Promise<number[] | null> {
  const client = new Anthropic({ maxRetries: 0, ...(apiKey ? { apiKey } : {}) });
  const response = await client.messages.create(
    {
      model: SDK_MODEL,
      max_tokens: 512,
      system: ROUTER_SYSTEM,
      // Pas de thinking : le routeur doit répondre dans son budget latence.
      // Les deux pièges connus du mode thinking-off ne s'appliquent pas ici —
      // aucun outil déclaré, et la sortie est contrainte par un schéma, donc
      // rien ne peut fuiter dans le champ qu'on lit.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ROUTER_SCHEMA },
      },
      messages: [{ role: 'user', content: message }],
    },
    { timeout },
  );

  if (response.stop_reason === 'refusal') throw new Error('refus');
  return parseIndices(response.content.find(b => b.type === 'text')?.text ?? '');
}

/**
 * Le routeur par le CLI `claude` — l'abonnement de l'utilisateur, pas une clé.
 *
 * Le process est réduit au strict nécessaire : aucun outil, aucun serveur MCP,
 * aucune source de réglages (donc **aucun hook** : le routage ne doit surtout
 * pas relancer le hook qui l'a appelé), pas de session sauvegardée. Le prompt
 * passe par stdin — un catalogue d'arbre n'a rien à faire dans un `argv`.
 */
async function askCli(message: string, timeout: number): Promise<number[] | null> {
  const bin = claudeBin();
  if (!bin) throw new Error('CLI `claude` introuvable');

  const out = await run(
    bin,
    [
      '-p',
      '--model', CLI_MODEL,
      '--effort', 'low',
      '--output-format', 'text',
      '--system-prompt', CLI_SYSTEM,
      '--tools', '',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '',
      '--disable-slash-commands',
      '--no-session-persistence',
    ],
    message,
    timeout,
  );

  return parseIndices(out);
}

/** Un `spawn` qui rend stdout, ou lève — avec un timeout dur. */
function run(bin: string, args: string[], stdin: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Le garde-fou anti-récursion, en plus de `--setting-sources ''` : si un
      // jour ce process relance un hook contextree, le hook se tait.
      env: { ...cleanEnv(), CONTEXTREE_ROUTING: '1' },
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout ${timeout} ms`));
    }, timeout);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => (out += chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => (err += chunk));
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude -p : code ${code}${err.trim() ? ` — ${err.trim().split('\n')[0]}` : ''}`));
    });

    child.stdin.on('error', () => {
      // Un process mort avant d'avoir lu stdin remonte déjà par 'close'.
    });
    child.stdin.end(stdin, 'utf8');
  });
}

/**
 * L'environnement du routeur, débarrassé de la session qui l'appelle.
 *
 * Le hook tourne *dans* Claude Code : sans ça, le routeur hérite du `CLAUDE_*`
 * de la session parente — dont `CLAUDE_EFFORT`, qui ferait réfléchir un routeur
 * qui n'a rien à réfléchir. `CLAUDE_CONFIG_DIR` reste : c'est là que vivent les
 * identifiants de l'abonnement, et sans lui il n'y a plus de routage du tout.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDE_CONFIG_DIR' || !/^CLAUDE/.test(key)) env[key] = value;
  }
  return env;
}

/**
 * Où trouver `claude`.
 *
 * Le `PATH` d'un hook est souvent plus pauvre que celui d'un shell interactif :
 * on regarde aussi les emplacements d'installation habituels, sinon le routage
 * tomberait en « aucun moteur » sur une machine qui a pourtant tout ce qu'il
 * faut. `CONTEXTREE_CLAUDE_BIN` tranche.
 */
let cachedBin: string | null | undefined;

export function claudeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  const explicit = process.env['CONTEXTREE_CLAUDE_BIN'];
  if (explicit) return (cachedBin = explicit);

  const exe = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  const home = os.homedir();
  const dirs = [
    ...(process.env['PATH'] ?? '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    try {
      accessSync(candidate, constants.X_OK);
      return (cachedBin = candidate);
    } catch {
      // Candidat suivant.
    }
  }
  return (cachedBin = null);
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
  // Un tableau qui n'est pas fait d'entiers n'est pas une réponse de routeur :
  // c'est du texte qui contient des crochets. Mieux vaut le repli qu'une
  // sélection vide obtenue en filtrant des chaînes.
  const indices = (value: unknown): number[] | null =>
    Array.isArray(value) && value.every(n => typeof n === 'number') ? (value as number[]) : null;

  const direct = tryParse(text);
  const asArray = indices(direct);
  if (asArray) return asArray;
  if (direct && typeof direct === 'object') return indices((direct as any).indices);
  const match = text.match(/\[[\s\S]*?\]/);
  return match ? indices(tryParse(match[0])) : null;
}
