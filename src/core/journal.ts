import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { RouteReason } from './router.js';

/**
 * Journal des tours de routage.
 *
 * La donnée existait déjà et partait sur `stderr`, où personne ne la lit : à
 * chaque tour on sait ce qui a été chargé et pourquoi. On la garde ici pour que
 * la vue puisse montrer ce qui a *réellement* servi, et pas seulement ce que le
 * routeur ferait d'un prompt hypothétique.
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
 * - **Hors du repo, borné.** C'est de l'état, jamais du contenu : sa disparition
 *   ne coûte rien, et il ne doit pas grossir sans fin.
 *
 * Il vit sous `~/.contextree/` et non dans `os.tmpdir()`, et c'est le seul
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

/** Qui a routé : le hook Claude Code, ou un client MCP (le chat de Cursor et
 *  les autres). Sans les deux, la vue est aveugle la moitié du temps. */
export type TurnSource = 'hook' | 'mcp';

export type RoutingTurn = {
  /** Horodatage du tour, en ms epoch. */
  at: number;
  /** Extrait du prompt, tronqué — de quoi reconnaître le tour. */
  prompt: string;
  /** Chemins des branches retenues, ancêtres compris. */
  selected: string[];
  /** `fallback` est l'indicateur de repli : pas de booléen en double, il
   *  finirait par contredire la raison. */
  reason: RouteReason;
  source: TurnSource;
  /** Le message d'erreur du routeur, quand il y en a eu un. */
  error?: string;
};

/** Surchargeable — surtout pour les tests, qui n'ont pas à écrire dans le home
 *  de qui lance la suite. */
export function journalDir(): string {
  return process.env['CONTEXTREE_STATE_DIR'] ?? path.join(os.homedir(), '.contextree', 'journal');
}

export function journalFile(treeDir: string): string {
  const key = createHash('sha256').update(treeDir).digest('hex').slice(0, 16);
  return path.join(journalDir(), `${key}.json`);
}

/** Les tours du plus ancien au plus récent. Un journal absent ou illisible est
 *  un journal vide : on ne fait jamais échouer un appel pour ça. */
export async function readJournal(treeDir: string): Promise<RoutingTurn[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(journalFile(treeDir), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isTurn) : [];
  } catch {
    return [];
  }
}

/**
 * Ajoute un tour, en gardant les `MAX_TURNS` derniers.
 *
 * Ne rejette jamais : écrire le journal ne doit pas pouvoir bloquer un prompt,
 * c'est le même invariant que le reste du hook. L'écriture passe par un fichier
 * temporaire renommé, pour qu'un lecteur ne tombe jamais sur un JSON à moitié
 * écrit.
 */
export async function appendTurn(treeDir: string, turn: RoutingTurn): Promise<void> {
  const file = journalFile(treeDir);
  try {
    const turns = [...(await readJournal(treeDir)), { ...turn, prompt: excerpt(turn.prompt) }];
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(turns.slice(-MAX_TURNS)), 'utf8');
    await fs.rename(tmp, file);
  } catch {
    // Le journal est un confort, pas une dépendance.
  }
}

function excerpt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > PROMPT_MAX ? `${flat.slice(0, PROMPT_MAX - 1)}…` : flat;
}

function isTurn(v: unknown): v is RoutingTurn {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t['at'] === 'number' &&
    typeof t['prompt'] === 'string' &&
    Array.isArray(t['selected']) &&
    typeof t['reason'] === 'string' &&
    (t['source'] === 'hook' || t['source'] === 'mcp')
  );
}
