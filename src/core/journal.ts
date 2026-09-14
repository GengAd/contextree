import { promises as fs, realpathSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { RouteReason, RouterEngine } from './router.js';
import { VERSION } from './version.js';

/**
 * Ce que l'arbre a vécu : les tours de routage, et les écritures de l'IA.
 *
 * Deux journaux bornés, deux fichiers, la même mécanique. Le premier existait
 * déjà et partait sur `stderr`, où personne ne le lit : à chaque tour on sait ce
 * qui a été chargé et pourquoi. On le garde pour que la vue montre ce qui a
 * *réellement* servi, pas seulement ce que le routeur ferait d'un prompt
 * hypothétique. Le second trace ce que l'IA écrit dans l'arbre — voir
 * `AiWrite` pour ce qui le justifie.
 *
 * Trois choix qui portent tout le reste :
 *
 * - **Séparé du cache sticky.** `session.ts` a un contrat — le fallback du tour
 *   suivant en dépend. Un journal corrompu ne doit jamais pouvoir abîmer le
 *   routage, donc il ne partage pas son fichier.
 * - **Clé par dossier d'arbre, pas par session.** Le cache est haché sur
 *   `treeDir:sessionId` ; la vue ne connaît pas le `sessionId` et n'a pas à
 *   deviner quel fichier est le bon. Un arbre, un journal, toutes sessions
 *   confondues — le champ `source` dit d'où vient chaque tour.
 *   Les deux journaux ne partagent pas non plus leur fichier, pour la même
 *   raison : ce sont deux histoires, et l'une ne doit pas abîmer l'autre.
 * - **Hors du repo, borné.** C'est de l'état, jamais du contenu : sa disparition
 *   ne coûte rien, et il ne doit pas grossir sans fin.
 *
 * Il vit sous `stateDir()` et non dans `os.tmpdir()`, et c'est le seul
 * endroit qui marche : le transport stdio du SDK MCP lance le serveur avec un
 * environnement nettoyé (`HOME`, `PATH`, `SHELL`, `USER`… mais pas `TMPDIR`).
 * Le serveur retombe donc sur `/tmp` pendant que le hook écrit dans le
 * `/var/folders/…` de la session — deux journaux, et une vue qui n'en voit que
 * la moitié. `HOME`, lui, est hérité des deux côtés.
 */

/** Au-delà, les tours les plus anciens tombent. De quoi couvrir une séance de
 *  travail, pas de quoi tenir un historique. */
const MAX_TURNS = 50;
/** Le prompt est là pour reconnaître le tour, pas pour le relire. */
const PROMPT_MAX = 200;
/** Les écritures de l'IA sont plus rares que les tours, et on veut pouvoir
 *  remonter plus loin : c'est en regardant la série qu'on voit un arbre qui
 *  se remplit de bruit. */
const MAX_WRITES = 100;

/**
 * Qui a routé : le hook Claude Code, un client MCP (le chat de Cursor et les
 * autres), ou le routage de fond.
 *
 * `bg` est celui qui manquait. Sous un moteur CLI, le hook ne route pas — il
 * injecte la sélection du tour précédent (`deferred`) et lance le routage
 * derrière. Sans un tour écrit par ce process, le journal ne contenait *que*
 * des `deferred` (mesuré le 9 septembre 2026 : 25 tours, 0 `routed`) et la vue
 * affichait « différé » à vie. On ne voyait jamais ce que le routeur avait
 * choisi — donc on ne corrigeait jamais un `load_when` sur du réel.
 *
 * Un prompt produit alors **deux** entrées, le `deferred` du hook puis le
 * `routed`/`bg` du fond. C'est la vérité de ce qui s'est passé : on ne les
 * fusionne pas.
 */
export type TurnSource = 'hook' | 'mcp' | 'bg';

/**
 * La raison d'un tour : celle du routeur, ou `read` — un tour qui n'a pas été
 * routé du tout, seulement fait de lectures de l'agent (`read_branch`) sans
 * `get_context` récent de la même session auquel les rattacher.
 */
export type TurnReason = RouteReason | 'read';

export type RoutingTurn = {
  /** Horodatage du tour, en ms epoch. */
  at: number;
  /** Extrait du prompt, tronqué — de quoi reconnaître le tour. */
  prompt: string;
  /** Chemins des branches parties à l'agent, ancêtres compris — y compris
   *  celles qu'il a lues lui-même (`read`), pour que les vues les allument
   *  sans cas particulier. */
  selected: string[];
  /** `fallback` est l'indicateur de repli : pas de booléen en double, il
   *  finirait par contredire la raison. */
  reason: TurnReason;
  source: TurnSource;
  /** Les branches que l'agent a lues lui-même avec `read_branch`, pendant ce
   *  tour. Sans elles, un tour `catalogue` affichait « catalogue seul » alors
   *  que Copilot avait bien lu deux branches (14 septembre 2026). */
  read?: string[];
  /** La session MCP qui a écrit le tour : c'est elle qui décide à quel tour une
   *  lecture se rattache. Absente des tours du hook, qui ne lit pas. */
  session?: string;
  /** La version de contextree qui a écrit le tour — posée par `appendTurn`. */
  version?: string;
  /** Le message d'erreur du routeur, quand il y en a eu un. */
  error?: string;
  /** Le moteur essayé, quand le tour a vraiment demandé à un modèle. Absent
   *  d'un `deferred` ou d'un court-circuit : personne n'a été appelé. */
  engine?: RouterEngine;
};

/**
 * La clé d'affichage d'un tour : sa raison, sauf s'il vient du routage de fond.
 *
 * Un même `reason: 'routed'` raconte deux choses selon sa source — « voici ce
 * qui vient d'être lu » pour le hook, « voici ce qui partira au prochain
 * prompt » pour le fond. C'est une clé et non un booléen de plus : un drapeau
 * à côté de `reason` finirait par la contredire.
 *
 * La règle vit ici, avec le journal, et pas dans une vue : la barre latérale et
 * la toile doivent dire la même chose du même tour, et c'est du cœur que vient
 * ce genre d'accord.
 */
export function turnLabelKey(turn: Pick<RoutingTurn, 'reason' | 'source' | 'read'>): string {
  if (turn.source === 'bg' && turn.reason === 'routed') return 'routed-bg';
  // Rien n'a été routé, mais l'agent a lu : c'est ce qu'on veut lire dans la
  // vue, pas « catalogue seul ».
  if ((turn.reason === 'catalogue' || turn.reason === 'read') && turn.read?.length) return 'read';
  return turn.reason;
}

/** Au-delà, une lecture n'appartient plus au dernier `get_context` : l'agent
 *  est passé à autre chose, elle ouvre un tour à elle. */
export const READ_WINDOW_MS = 5 * 60_000;

/**
 * Une écriture de l'IA dans l'arbre.
 *
 * L'IA écrit directement, sans validation préalable : le garde-fou est la
 * visibilité, pas l'interdiction. Et il en faut un, parce que la boucle est
 * fermée — l'IA écrit dans l'arbre qui lui est ensuite injecté. Si l'arbre se
 * remplit de branches approximatives, le routeur en charge trop et le contexte
 * devient du bruit auto-produit. Cette trace est ce qui permet de s'en
 * apercevoir.
 */
export type AiWrite = {
  at: number;
  op: 'upsert' | 'delete' | 'move';
  /** Chemin touché — après coup, pour un déplacement. */
  path: string;
  title?: string;
  /** Chemin d'origine d'un déplacement. */
  from?: string;
  /** La raison donnée par l'IA. C'est le champ qui rend l'écriture relisable. */
  why?: string;
};

/**
 * Où vit l'état de contextree : journaux, session, configuration du backend.
 * Hors du repo — c'est de l'état, jamais du contenu.
 *
 * Surchargeable, surtout pour les tests : ils n'ont pas à écrire dans le home de
 * qui lance la suite.
 *
 * **Jamais `~/.contextree`** (14 septembre 2026). C'était son nom, le même que
 * l'arbre d'un projet : `findTreeDir` remontait jusqu'au dossier utilisateur et
 * prenait le cache pour un arbre — tous les projets sans arbre à eux lisaient
 * le même, et `write_root` y écrivait. L'emplacement du système, donc, et pas
 * un cache purgeable (`~/Library/Caches`) : `config.json` et `session.json`
 * du backend vivent ici aussi. L'ancien dossier n'est pas migré — ce n'était
 * que du cache ; un arbre écrit là par erreur se récupère avec `rescue`.
 */
export function stateDir(): string {
  const forced = process.env['CONTEXTREE_STATE_DIR'];
  if (forced) return forced;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'), 'contextree');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'contextree');
  return path.join(process.env['XDG_STATE_HOME'] ?? path.join(home, '.local', 'state'), 'contextree');
}

export function journalDir(): string {
  return path.join(stateDir(), 'journal');
}

/**
 * La clé d'un arbre : son chemin **réel**, liens symboliques résolus, haché.
 *
 * Partagée par tout ce qui range de l'état par arbre — le journal, les
 * écritures de l'IA, le cache de sélection. Deux clés différentes pour le même
 * arbre, et les surfaces cessent de se parler.
 *
 * Sans ça, deux écrivains du même arbre écrivent dans deux fichiers : la vue
 * reçoit de VS Code le chemin tel qu'ouvert, alors qu'un serveur MCP lancé avec
 * un `cwd` voit le chemin résolu par le système (`/var` → `/private/var` sur
 * macOS, tout projet rangé derrière un lien symbolique ailleurs). Mesuré : le
 * même arbre donnait deux journaux.
 */
export function treeKey(treeDir: string, platform: NodeJS.Platform = process.platform): string {
  const windows = platform === 'win32';
  let resolved = (windows ? path.win32 : path).resolve(treeDir);
  try {
    // `.native` : la casse que le système rend, pas celle qu'on lui a donnée.
    resolved = realpathSync.native(resolved);
  } catch {
    // Pas encore sur le disque : le chemin littéral fera l'affaire.
  }
  // **Sous Windows, la casse ne compte pas** (14 septembre 2026). VS Code donne
  // la lettre de lecteur en minuscule (`c:\…`), un process lancé ailleurs en
  // majuscule, et le système de fichiers les confond : deux clés, deux
  // journaux, et une vue qui lit celui où personne n'écrit. L'ancien journal
  // n'est pas migré — ce n'est que de l'état.
  if (windows) resolved = resolved.toLowerCase();
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

export function journalFile(treeDir: string): string {
  return path.join(journalDir(), `${treeKey(treeDir)}.json`);
}

/** Les écritures de l'IA dans l'arbre. Fichier distinct du journal de routage :
 *  ce sont deux histoires différentes, et l'une ne doit pas pouvoir abîmer
 *  l'autre. */
export function writesFile(treeDir: string): string {
  return path.join(journalDir(), `${treeKey(treeDir)}-writes.json`);
}

/** Les tours du plus ancien au plus récent. Un journal absent ou illisible est
 *  un journal vide : on ne fait jamais échouer un appel pour ça. */
export async function readJournal(treeDir: string): Promise<RoutingTurn[]> {
  return readLog(journalFile(treeDir), isTurn);
}

/**
 * Ajoute un tour, en gardant les `MAX_TURNS` derniers.
 *
 * Ne rejette jamais : écrire le journal ne doit pas pouvoir bloquer un prompt,
 * c'est le même invariant que le reste du hook.
 */
export async function appendTurn(treeDir: string, turn: RoutingTurn): Promise<void> {
  const entry = { ...turn, prompt: excerpt(turn.prompt), version: VERSION };
  await updateLog(journalFile(treeDir), isTurn, MAX_TURNS, turns => [...turns, entry]);
}

/**
 * Une branche lue par l'agent (`read_branch`), rattachée au tour qui l'a
 * amenée à la lire.
 *
 * En mode catalogue, `get_context` ne rend aucune branche : c'est l'agent qui
 * lit les siennes ensuite. Sans cette trace, la vue affichait « catalogue
 * seul » et n'allumait rien, alors que des branches étaient bien parties.
 *
 * Rattachée au **dernier tour du journal** s'il vient de la même session MCP
 * depuis moins de `READ_WINDOW_MS` — c'est le tour que la vue montre. Sinon
 * (un tour du hook ou du routage de fond s'est intercalé, ou l'agent lit sans
 * avoir demandé de contexte), un tour `read` à elle : la vue montre le dernier
 * tour, et une lecture accrochée plus haut ne s'y verrait pas.
 */
export async function recordRead(
  treeDir: string,
  read: { at: number; session: string; path: string },
): Promise<void> {
  await updateLog(journalFile(treeDir), isTurn, MAX_TURNS, (turns): RoutingTurn[] => {
    const last = turns.at(-1);
    if (last && last.source === 'mcp' && last.session === read.session && read.at - last.at < READ_WINDOW_MS) {
      const merged: RoutingTurn = {
        ...last,
        selected: unique([...last.selected, read.path]),
        read: unique([...(last.read ?? []), read.path]),
      };
      return [...turns.slice(0, -1), merged];
    }
    return [
      ...turns,
      {
        at: read.at,
        prompt: '',
        selected: [read.path],
        read: [read.path],
        reason: 'read',
        source: 'mcp',
        session: read.session,
        version: VERSION,
      },
    ];
  });
}

/**
 * Le journal qu'écrivait un contextree d'avant le 14 septembre 2026, sous
 * `~/.contextree/journal/`. L'extension le regarde : s'il bouge encore, c'est
 * qu'un serveur MCP ou un hook d'une autre version écrit là où elle ne lit plus.
 */
export function legacyJournalFile(treeDir: string): string {
  return path.join(os.homedir(), '.contextree', 'journal', `${treeKey(treeDir)}.json`);
}

/** Les écritures de l'IA, de la plus ancienne à la plus récente. */
export async function readAiWrites(treeDir: string): Promise<AiWrite[]> {
  return readLog(writesFile(treeDir), isWrite);
}

/** Trace une écriture de l'IA. Ne rejette jamais : la trace ne doit pas pouvoir
 *  faire échouer l'écriture qu'elle raconte. */
export async function appendAiWrite(treeDir: string, write: AiWrite): Promise<void> {
  const entry = { ...write, why: excerpt(write.why ?? '') };
  await updateLog(writesFile(treeDir), isWrite, MAX_WRITES, writes => [...writes, entry]);
}

// ── Le journal, mécaniquement ────────────────────────────────────────────────

async function readLog<T>(file: string, guard: (v: unknown) => v is T): Promise<T[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

/** Les mises à jour en vol, par fichier. */
const pending = new Map<string, Promise<void>>();

/**
 * Relit, transforme, réécrit. L'écriture passe par un fichier temporaire
 * renommé, pour qu'un lecteur ne tombe jamais sur un JSON à moitié écrit.
 *
 * **À la file, par fichier, dans un même process.** Un agent lance volontiers
 * plusieurs `read_branch` en parallèle : sans file, chacun relisait le journal
 * d'avant les autres et la dernière écriture effaçait les précédentes. Entre
 * deux process, la fenêtre reste ouverte — elle coûte au pire une lecture non
 * affichée, pas un journal cassé.
 */
function updateLog<T>(
  file: string,
  guard: (v: unknown) => v is T,
  max: number,
  change: (entries: T[]) => T[],
): Promise<void> {
  const run = (pending.get(file) ?? Promise.resolve()).then(async () => {
    try {
      const entries = change(await readLog(file, guard));
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(entries.slice(-max)), 'utf8');
      await fs.rename(tmp, file);
    } catch {
      // Le journal est un confort, pas une dépendance.
    }
  });
  pending.set(file, run);
  void run.then(() => {
    if (pending.get(file) === run) pending.delete(file);
  });
  return run;
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

function excerpt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > PROMPT_MAX ? `${flat.slice(0, PROMPT_MAX - 1)}…` : flat;
}

function isWrite(v: unknown): v is AiWrite {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w['at'] === 'number' &&
    typeof w['path'] === 'string' &&
    (w['op'] === 'upsert' || w['op'] === 'delete' || w['op'] === 'move')
  );
}

function isTurn(v: unknown): v is RoutingTurn {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t['at'] === 'number' &&
    typeof t['prompt'] === 'string' &&
    Array.isArray(t['selected']) &&
    typeof t['reason'] === 'string' &&
    (t['source'] === 'hook' || t['source'] === 'mcp' || t['source'] === 'bg')
  );
}
