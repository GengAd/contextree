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
  // « Aucune branche » (une question sur l'outil, un « reprends ») ne s'hérite
  // pas : lu au tour suivant, un cache vide vaut « rien en cache », donc
  // l'arbre entier. Le tour garde ce que la conversation avait retenu avant.
  if (!entry.selected.length) return;
  await writeCache(sessionFile(treeDir, sessionId), entry);
  if (opts.routed) await writeCache(lastFile(treeDir), entry);
}

/**
 * L'invitation à créer un arbre : une fois par session, pour ce dossier.
 *
 * Renvoie `true` la première fois, `false` ensuite. Le marqueur est un fichier
 * vide sous `stateDir()/session/`, à côté du cache de sélection : c'est le même
 * genre d'état — jetable, par session, hors du dépôt.
 *
 * **Une fois, et pas à chaque prompt.** L'invitation vaut pour la session
 * entière : la répéter à chaque tour reviendrait à harceler quelqu'un qui a
 * déjà dit non, avec le contexte du modèle pour facture.
 *
 * On hache `cwd` avec `treeKey` — il n'y a pas d'arbre ici, mais c'est la même
 * question : le même dossier vu par deux chemins (un lien symbolique, `/var`
 * contre `/private/var` sur macOS) doit donner le même marqueur, sinon
 * l'invitation revient une seconde fois dans la même session.
 */
export async function claimBootstrapInvite(cwd: string, sessionId: string): Promise<boolean> {
  return claimOnce(cwd, sessionId, 'invited');
}

/** Même marqueur, pour l'avertissement d'un arbre égaré dans `~/.contextree`. */
export async function claimStrayWarning(cwd: string, sessionId: string): Promise<boolean> {
  return claimOnce(cwd, sessionId, 'stray');
}

async function claimOnce(cwd: string, sessionId: string, what: string): Promise<boolean> {
  const file = path.join(stateDir(), 'session', `${treeKey(cwd)}-${safe(sessionId)}.${what}`);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // `wx` échoue si le fichier existe : tester puis écrire laisserait une
    // fenêtre entre les deux, et deux hooks lancés coup sur coup injecteraient
    // l'invitation deux fois.
    await fs.writeFile(file, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    // Déjà posé, ou disque récalcitrant. Dans le doute on se tait : une
    // invitation manquée est un désagrément, une invitation en boucle est une
    // nuisance.
    return false;
  }
}

/** Un identifiant de session vient d'un payload JSON : il n'a pas le droit de
 *  choisir où on écrit. */
function safe(sessionId: string): string {
  return (sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'default').slice(0, 64);
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
