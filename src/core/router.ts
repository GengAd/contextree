import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { allBranches, withAncestors } from './tree.js';
import type { ContextTree } from './types.js';

/** Modèle du routeur. Défaut par moteur — voir REFERENCES.md § Routage. */
const ROUTER_MODEL = process.env['CONTEXTREE_ROUTER_MODEL'];
const ANTHROPIC_MODEL = ROUTER_MODEL ?? 'claude-opus-5';
/** Endpoint compatible OpenAI : le modèle n'a pas de défaut universel (Groq,
 *  OpenRouter, Ollama, LM Studio ont chacun leur nommage), mais il en faut un
 *  dans le corps de la requête. Celui d'OpenAI, petit et bon marché. */
const OPENAI_MODEL = ROUTER_MODEL ?? 'gpt-4o-mini';

/**
 * Budget latence, lu à chaque appel (le routage en tâche de fond le relève).
 *
 * Une API répond en une poignée de centaines de ms ; un CLI, lui, démarre un
 * process complet et passe par la file d'un abonnement — mesuré entre 5 et 60 s
 * sur ce repo. D'où deux budgets, et d'où le mode différé du hook : on ne fait
 * pas attendre un prompt derrière une file d'attente.
 */
function timeoutFor(kind: 'api' | 'cli'): number {
  const override = Number(process.env['CONTEXTREE_ROUTER_TIMEOUT_MS']);
  if (Number.isFinite(override) && override > 0) return override;
  return kind === 'cli' ? 20_000 : 2500;
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
 * Deux familles, et un ordre : une **clé explicite** gagne (le chemin le plus
 * court), sinon un **CLI déjà authentifié** sur la machine — personne ne
 * devrait avoir à sortir une clé API pour router son propre arbre alors que sa
 * machine sait déjà parler à un modèle. Aucun des deux : arbre entier injecté,
 * dégradé mais jamais bloquant, et jamais silencieux (`error` le dit).
 *
 * Le routeur ne demande qu'un tableau d'entiers : n'importe quel modèle
 * correct sait le rendre, donc rien ici n'est propre à Claude.
 */
export type RouterEngine = 'anthropic' | 'openai' | 'claude' | 'codex' | 'gemini' | 'none';

/** Les moteurs qui passent par un binaire local : lents (démarrage de process
 *  + file d'attente d'un abonnement), donc jamais devant un prompt. */
export function isCliEngine(engine: RouterEngine): boolean {
  return CLIS.some(spec => spec.engine === engine);
}

const ROUTER_SYSTEM =
  "Tu es un routeur de contexte. On te donne un catalogue de sections de " +
  "documentation, chacune avec sa condition de chargement, et le message d'un " +
  "utilisateur adressé à un assistant IA. Tu renvoies les indices des sections " +
  'à injecter.\n\n' +
  'Règles :\n' +
  "- Retiens une section si elle est pertinente OU si la tâche pourrait toucher à son domaine.\n" +
  '- Dans le doute, retiens-la : du contexte manquant coûte plus cher que du contexte en trop.\n' +
  "- Liste vide uniquement pour la conversation pure (salutations, hors-sujet).";

/** Hors SDK Anthropic, la sortie structurée n'est pas gratuite (et pas
 *  garantie partout) : on la demande en toutes lettres. (`--json-schema` existe
 *  côté CLI, mais il coûte un tour de plus et double la latence — mesuré, voir
 *  REFERENCES.md § Routage.) */
const PLAIN_SYSTEM =
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
 * Un CLI d'agent utilisable comme routeur.
 *
 * Même mécanique pour les trois : le prompt part sur stdin (un catalogue
 * d'arbre n'a rien à faire dans un `argv`), la sortie est lue comme un tableau
 * d'indices. Le process est réduit au strict nécessaire — aucun outil, aucun
 * serveur MCP, aucune source de réglages (donc **aucun hook** : le routage ne
 * doit surtout pas relancer le hook qui l'a appelé).
 *
 * `model` n'est passé que si l'utilisateur l'a demandé, sauf pour `claude` où
 * le défaut est mesuré : on ne devine pas le nom du modèle d'un CLI qu'on ne
 * maîtrise pas — c'est le défaut de l'utilisateur qui décide.
 */
type CliSpec = {
  engine: RouterEngine;
  bin: string;
  /** Le modèle imposé faute de mieux, quand il y en a un de sûr. */
  defaultModel?: string;
  args: (model: string | undefined) => string[];
  /** Le CLI sait-il prendre une consigne système à part ? Sinon on la préfixe
   *  au message, ce qui marche partout. */
  systemArgs?: (system: string) => string[];
};

const CLIS: CliSpec[] = [
  {
    engine: 'claude',
    bin: 'claude',
    // Sous abonnement, un modèle rapide : sinon on paie un démarrage de process
    // **et** un gros modèle à chaque prompt.
    defaultModel: 'haiku',
    systemArgs: system => ['--system-prompt', system],
    args: model => [
      '-p',
      ...(model ? ['--model', model] : []),
      '--effort', 'low',
      '--output-format', 'text',
      '--tools', '',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '',
      '--disable-slash-commands',
      '--no-session-persistence',
    ],
  },
  {
    engine: 'codex',
    bin: 'codex',
    // `-` : le prompt vient de stdin. Lecture seule et sans vérification de
    // repo — un routeur n'écrit rien et tourne parfois hors d'un dépôt.
    args: model => [
      'exec',
      ...(model ? ['--model', model] : []),
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '-',
    ],
  },
  {
    engine: 'gemini',
    bin: 'gemini',
    // Sans TTY, `gemini` lit son prompt sur stdin et rend la main.
    args: model => (model ? ['-m', model] : []),
  },
];

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
      error:
        'aucun moteur de routage (ni clé API, ni CLI `claude`/`codex`/`gemini`) — arbre entier injecté',
    };
  }

  const catalogue = branches
    .map((b, i) => `[${i}] (${b.type}) ${b.title} — charger quand : ${b.loadWhen}`)
    .join('\n');
  const message = `Sections :\n${catalogue}\n\nMessage utilisateur :\n${JSON.stringify(
    prompt.slice(0, 2000),
  )}`;

  try {
    const indices = await ask(engine, message, opts.apiKey);
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

/** L'aiguillage vers le moteur retenu — le seul endroit qui sait qu'il y en a
 *  plusieurs. Tous rendent la même chose : un tableau d'indices, ou rien. */
function ask(
  engine: RouterEngine,
  message: string,
  apiKey?: string,
): Promise<number[] | null> {
  const spec = CLIS.find(c => c.engine === engine);
  if (spec) return askCli(spec, message, timeoutFor('cli'));
  if (engine === 'openai') return askOpenAI(message, timeoutFor('api'));
  return askAnthropic(message, timeoutFor('api'), apiKey);
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

/** Les anciens noms de `CONTEXTREE_ROUTER`, quand il n'y avait que Claude. */
const LEGACY: Record<string, RouterEngine> = { sdk: 'anthropic', cli: 'claude' };

/**
 * Le moteur retenu pour cette machine.
 *
 * Une clé explicite gagne toujours — c'est le chemin le plus court. Sinon on
 * cherche un CLI d'agent : la plupart des utilisateurs de contextree en ont
 * déjà un, installé et authentifié par abonnement, et leur demander une clé API
 * en plus n'a aucun sens.
 *
 * `CONTEXTREE_ROUTER=auto|anthropic|openai|claude|codex|gemini|off` force la
 * main (`sdk` et `cli` restent compris). Forcé, un moteur n'est pas vérifié :
 * s'il manque, l'appel échoue et le fallback fait son travail — mieux vaut ça
 * qu'un repli silencieux sur un moteur que l'utilisateur n'a pas demandé.
 */
export function pickEngine(apiKey?: string): RouterEngine {
  const forced = process.env['CONTEXTREE_ROUTER'];
  if (forced === 'off') return 'none';
  if (forced && forced !== 'auto') {
    const engine = LEGACY[forced] ?? (forced as RouterEngine);
    if (engine === 'anthropic' || engine === 'openai' || isCliEngine(engine)) return engine;
  }
  const key = apiKey || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN'];
  if (key && hasSdk()) return 'anthropic';
  if (process.env['OPENAI_API_KEY']) return 'openai';
  for (const spec of CLIS) if (findBin(spec.bin)) return spec.engine;
  return 'none';
}

/**
 * Le SDK Anthropic est-il installé à côté ?
 *
 * Deux raisons de le demander plutôt que de l'importer en haut de fichier :
 * le hook le chargeait à **chaque prompt** même quand il route par le CLI, et
 * la copie du cœur embarquée dans l'extension n'a pas de `node_modules` du
 * tout. Une clé qui ne peut mener nulle part n'est pas un moteur.
 */
let sdkThere: boolean | undefined;

function hasSdk(): boolean {
  if (sdkThere === undefined) {
    try {
      createRequire(import.meta.url).resolve('@anthropic-ai/sdk');
      sdkThere = true;
    } catch {
      sdkThere = false;
    }
  }
  return sdkThere;
}

async function askAnthropic(
  message: string,
  timeout: number,
  apiKey?: string,
): Promise<number[] | null> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ maxRetries: 0, ...(apiKey ? { apiKey } : {}) });
  const response = await client.messages.create(
    {
      model: ANTHROPIC_MODEL,
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
 * Le routeur par un endpoint compatible OpenAI.
 *
 * Un `fetch` et rien d'autre : OpenAI, Groq, OpenRouter, Ollama, LM Studio
 * parlent tous ce dialecte, et un SDK de plus serait la quatrième dépendance
 * du projet pour trois lignes de POST.
 *
 * Le corps est volontairement minimal — modèle et messages. `temperature`,
 * `max_tokens`, `response_format` sont refusés par une partie de ces
 * endpoints (modèles de raisonnement, serveurs locaux) : c'est le timeout qui
 * borne l'appel, pas un champ que la moitié du monde rejette.
 */
async function askOpenAI(message: string, timeout: number): Promise<number[] | null> {
  const base = (process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = process.env['OPENAI_API_KEY'] ?? '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: PLAIN_SYSTEM },
          { role: 'user', content: message },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${base}`);
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' ? parseIndices(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Le routeur par un CLI d'agent — l'abonnement de l'utilisateur, pas une clé.
 *
 * Le prompt passe par stdin. Faute de consigne système dédiée (`codex`,
 * `gemini`), on la préfixe au message : le contrat est le même partout, un
 * tableau d'entiers en sortie.
 */
async function askCli(spec: CliSpec, message: string, timeout: number): Promise<number[] | null> {
  const bin = findBin(spec.bin);
  if (!bin) throw new Error(`CLI \`${spec.bin}\` introuvable`);

  const model = ROUTER_MODEL ?? spec.defaultModel;
  const system = spec.systemArgs?.(PLAIN_SYSTEM);
  const stdin = system ? message : `${PLAIN_SYSTEM}\n\n${message}`;

  return parseIndices(await run(bin, [...spec.args(model), ...(system ?? [])], stdin, timeout));
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
      else
        reject(
          new Error(
            `${path.basename(bin)} : code ${code}${err.trim() ? ` — ${err.trim().split('\n')[0]}` : ''}`,
          ),
        );
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
 * Où trouver un binaire d'agent.
 *
 * Le `PATH` d'un hook est souvent plus pauvre que celui d'un shell interactif :
 * on regarde aussi les emplacements d'installation habituels, sinon le routage
 * tomberait en « aucun moteur » sur une machine qui a pourtant tout ce qu'il
 * faut. `CONTEXTREE_CLAUDE_BIN` tranche pour `claude`.
 */
const cachedBins = new Map<string, string | null>();

export function findBin(name: string): string | null {
  const cached = cachedBins.get(name);
  if (cached !== undefined) return cached;

  const explicit = name === 'claude' ? process.env['CONTEXTREE_CLAUDE_BIN'] : undefined;
  if (explicit) {
    cachedBins.set(name, explicit);
    return explicit;
  }

  const exe = process.platform === 'win32' ? `${name}.cmd` : name;
  const home = os.homedir();
  const dirs = [
    ...(process.env['PATH'] ?? '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    try {
      accessSync(candidate, constants.X_OK);
      cachedBins.set(name, candidate);
      return candidate;
    } catch {
      // Candidat suivant.
    }
  }
  cachedBins.set(name, null);
  return null;
}

/** Le binaire d'un moteur CLI, pour le dire à l'utilisateur. */
export function engineBin(engine: RouterEngine): string | null {
  const spec = CLIS.find(c => c.engine === engine);
  return spec ? findBin(spec.bin) : null;
}

/**
 * Tolérant sur la forme, strict sur le contenu.
 *
 * La sortie structurée garantit le JSON côté SDK, mais un CLI d'agent préfixe
 * volontiers sa réponse (bannière, horodatage, session) : on prend donc le
 * **dernier** tableau d'entiers de la sortie — la réponse est à la fin, le
 * bruit est devant. Trois formes passent : le tableau nu, l'objet
 * `{ "indices": [...] }`, et le tableau noyé dans du texte ou une clôture
 * ```json.
 *
 * Deux réponses se ressemblent et n'ont rien à voir :
 *
 * - `[]` est une **sélection vide** — le routeur a lu le catalogue et n'a rien
 *   retenu (une question de pure conversation). On la respecte.
 * - `null` est un **repli** : ce qui est revenu n'est pas une réponse de
 *   routeur. Un tableau qui n'est pas fait d'entiers, par exemple, est du texte
 *   qui contient des crochets — mieux vaut l'arbre précédent qu'une sélection
 *   vide obtenue en filtrant des chaînes.
 *
 * **Limite connue** : dans `voir [1] et [2] plus haut`, c'est `[2]` qui est
 * retenu — la règle « le dernier gagne » ne distingue pas un tableau cité d'une
 * réponse. Le cas reste théorique : le catalogue n'est jamais recopié dans la
 * réponse, et la consigne ne demande qu'un tableau.
 */
export function parseIndices(text: string): number[] | null {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const indices = (value: unknown): number[] | null =>
    Array.isArray(value) && value.every(n => typeof n === 'number') ? (value as number[]) : null;

  const direct = tryParse(text);
  const asArray = indices(direct);
  if (asArray) return asArray;
  if (direct && typeof direct === 'object') {
    const fromField = indices((direct as { indices?: unknown }).indices);
    if (fromField) return fromField;
  }

  const matches = text.match(/\[[^[\]]*\]/g) ?? [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const parsed = indices(tryParse(matches[i]!));
    if (parsed) return parsed;
  }
  return null;
}
