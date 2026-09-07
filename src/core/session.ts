import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/** Mémoire courte du routage : la sélection du tour précédent sert de fallback
 *  « sticky », pour qu'un échec transitoire ne retire pas d'un coup le contexte
 *  que le tour d'avant avait. Hors du repo — c'est de l'état, pas du contenu. */

function cacheFile(treeDir: string, sessionId: string): string {
  const key = createHash('sha256').update(`${treeDir}:${sessionId}`).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'contextree', `${key}.json`);
}

export async function readSelection(treeDir: string, sessionId: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(cacheFile(treeDir, sessionId), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeSelection(
  treeDir: string,
  sessionId: string,
  selection: Iterable<string>,
): Promise<void> {
  const file = cacheFile(treeDir, sessionId);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify([...selection]), 'utf8');
  } catch {
    // Le cache est un confort, pas une dépendance.
  }
}
