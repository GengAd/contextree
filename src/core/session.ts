import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { stateDir, treeKey } from './journal.js';

/**
 * Mémoire courte du routage : ce qui a été retenu, pour que le tour suivant
 * parte de là plutôt que de l'arbre entier.
 *
 * **Deux niveaux, et pas trois** (9 septembre 2026) :
 *
 *  1. la sélection de *cette* session — la plus juste, c'est la conversation
 *     en cours ;
 *  2. sinon la dernière sélection **routée** de cet arbre, toutes sessions
 *     confondues.
 *
 * Le second niveau existe parce qu'une session neuve repartait de l'arbre
 * entier (12/12 mesuré sur ce dépôt) : sous un moteur CLI le premier tour
 * n'est jamais routé, donc le premier prompt d'une session coûtait tout
 * l'arbre, chaque fois. Le routeur de la session précédente avait pourtant
 * déjà répondu à la question « qu'est-ce qui compte dans cet arbre ». Après ce
 * niveau, c'est l'arbre entier : mieux vaut trop de contexte qu'un contexte
 * vide, et on ne cherche pas plus loin.
 *
 * Le cache vit sous `stateDir()` et non dans `os.tmpdir()`, pour la raison qui
 * y avait déjà déplacé le journal : le transport stdio du SDK MCP lance le
 * serveur avec un environnement nettoyé, sans `TMPDIR`. Le serveur écrivait
 * dans `/tmp` pendant que le hook écrivait dans le `/var/folders/…` de la
 * session — deux caches, et une sélection qui ne se transmettait pas. `HOME`,
 * lui, est hérité des deux côtés. Bonus : `CONTEXTREE_STATE_DIR` rend le cache
 * isolable en test.
 */

/** Ce qu'un fichier de cache contient. L'ancien format — un tableau nu — reste
 *  lu : un cache est jetable, mais le jeter au passage d'une version se paierait
 *  en un tour à l'arbre entier pour chaque session ouverte. */
type Cached = { at: number; selected: string[] };

function selectionDir(): string {
  return path.join(stateDir(), 'selection');
}

function sessionFile(treeDir: string, sessionId: string): string {
  const key = createHash('sha256')
    .update(`${treeKey(treeDir)}:${sessionId}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(selectionDir(), `${key}.json`);
}

/** Le niveau arbre : une seule sélection, la dernière routée, toutes sessions
 *  confondues. */
function lastFile(treeDir: string): string {
  return path.join(selectionDir(), `${treeKey(treeDir)}-last.json`);
}

/**
 * La sélection dont hérite ce tour : celle de la session, sinon la dernière
 * routée de l'arbre. Vide si les deux manquent — l'appelant injecte alors tout.
 */
export async function readSelection(treeDir: string, sessionId: string): Promise<string[]> {
  const own = await readCache(sessionFile(treeDir, sessionId));
  if (own.selected.length) return own.selected;
  return (await readCache(lastFile(treeDir))).selected;
}

/**
 * Écrit la sélection de la session, et le niveau arbre si elle vient d'un vrai
 * routage.
 *
 * `at` est l'horodatage du **prompt**, pas celui de l'écriture : le routage de
 * fond finit après le tour suivant, et sans cet ordre c'est le dernier à
 * *finir* qui gagnait, pas le dernier *lancé*. Une sélection plus ancienne
 * n'écrase donc jamais une plus récente.
 *
 * `routed` gouverne le second niveau : un repli n'y a rien à dire — il
 * recopierait ce qui s'y trouve déjà, ou y figerait l'arbre entier.
 */
export async function writeSelection(
  treeDir: string,
  sessionId: string,
  selection: Iterable<string>,
  opts: { at?: number; routed?: boolean } = {},
): Promise<void> {
  const entry: Cached = { at: opts.at ?? Date.now(), selected: [...selection] };
  await writeCache(sessionFile(treeDir, sessionId), entry);
  if (opts.routed) await writeCache(lastFile(treeDir), entry);
}

async function readCache(file: string): Promise<Cached> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    // Ancien format : le tableau nu. Pas d'horodatage, donc pas de priorité —
    // il perd contre n'importe quelle écriture datée.
    if (Array.isArray(parsed)) return { at: 0, selected: parsed.filter(isString) };
    if (parsed && typeof parsed === 'object') {
      const c = parsed as Record<string, unknown>;
      if (Array.isArray(c['selected'])) {
        return {
          at: typeof c['at'] === 'number' ? c['at'] : 0,
          selected: c['selected'].filter(isString),
        };
      }
    }
    return { at: 0, selected: [] };
  } catch {
    // Absent, tronqué, illisible : un cache vide. Jamais une exception — le
    // fallback est précisément ce qui tient quand le reste lâche.
    return { at: 0, selected: [] };
  }
}

/** Fichier temporaire puis `rename` : deux `route-bg` qui se chevauchent ne
 *  peuvent pas laisser un JSON à moitié écrit, que le lecteur suivant
 *  interpréterait comme « rien en cache » — donc comme l'arbre entier. */
async function writeCache(file: string, entry: Cached): Promise<void> {
  try {
    if ((await readCache(file)).at > entry.at) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf8');
    await fs.rename(tmp, file);
  } catch {
    // Le cache est un confort, pas une dépendance.
  }
}

function isString(x: unknown): x is string {
  return typeof x === 'string';
}
