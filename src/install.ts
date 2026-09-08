import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Câblage de l'injection, un agent à la fois.
 *
 * Trois surfaces, par ordre de qualité — c'est aussi l'ordre dans lequel on
 * préfère les câbler :
 *
 *  1. **un hook par prompt** (`.claude/settings.json`) — le seul chemin
 *     *déterministe* : sa sortie est ajoutée au contexte à chaque tour, sans
 *     que l'agent ait à décider d'appeler un outil ;
 *  2. **le serveur MCP** (`.mcp.json`, `~/.codex/config.toml`) — portable, mais
 *     l'agent doit vouloir appeler `get_context` ;
 *  3. **un fichier de consignes** (`AGENTS.md`) — le dernier recours, pour les
 *     agents qui n'ont ni l'un ni l'autre. On n'y met jamais l'arbre entier :
 *     la racine et le catalogue, et l'agent route lui-même.
 *
 * Tous ces fichiers appartiennent à l'utilisateur : on fusionne, on n'écrase
 * jamais, et on ne touche pas à une entrée existante qui ne vient pas de nous.
 */

export type InstallReport = { file: string; action: 'created' | 'updated' | 'unchanged' }[];

/** Les agents qu'on sait câbler. `claude` est toujours tenté (le projet
 *  courant lui appartient) ; les autres seulement s'ils sont détectés. */
export type Agent = 'claude' | 'codex';

const HOOK_COMMAND = 'npx -y @gengad/contextree hook';
const MCP_COMMAND = { command: 'npx', args: ['-y', '@gengad/contextree', 'mcp'] };

/** Les bornes du bloc synchronisé dans un fichier de consignes. Ce qui est
 *  dehors appartient à l'utilisateur et n'est jamais touché. */
const MARK_START = '<!-- contextree:start -->';
const MARK_END = '<!-- contextree:end -->';

export async function installMcp(projectDir: string, report: InstallReport): Promise<void> {
  const file = path.join(projectDir, '.mcp.json');
  const config = (await readJson(file)) ?? {};
  const servers = ((config as any).mcpServers ??= {});
  if (servers.contextree) {
    report.push({ file, action: 'unchanged' });
    return;
  }
  servers.contextree = { ...MCP_COMMAND };
  await writeJson(file, config);
  report.push({ file, action: 'updated' });
}

export async function installHook(projectDir: string, report: InstallReport): Promise<void> {
  const file = path.join(projectDir, '.claude', 'settings.json');
  const existed = (await readJson(file)) !== null;
  const settings = (await readJson(file)) ?? {};
  const hooks = ((settings as any).hooks ??= {});
  const list: any[] = (hooks.UserPromptSubmit ??= []);

  const already = list.some(entry =>
    (entry?.hooks ?? []).some((h: any) => typeof h?.command === 'string' && h.command.includes('contextree')),
  );
  if (already) {
    report.push({ file, action: 'unchanged' });
    return;
  }

  list.push({ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 15 }] });
  await writeJson(file, settings);
  report.push({ file, action: existed ? 'updated' : 'created' });
}

/** Le dossier de configuration de Codex, s'il est là. */
export function codexDir(): string {
  return process.env['CODEX_HOME'] ?? path.join(os.homedir(), '.codex');
}

/**
 * Codex : le serveur MCP dans `~/.codex/config.toml`.
 *
 * Pas de parseur TOML — ce serait la quatrième dépendance du projet pour
 * ajouter six lignes. On **ajoute une table à la fin**, ce qu'aucune table
 * précédente ne peut avaler, et on ne réécrit jamais ce qui est déjà là. Si
 * `[mcp_servers.contextree]` existe, on n'y touche pas : la corriger à la main
 * doit rester possible.
 */
export async function installCodexMcp(report: InstallReport): Promise<void> {
  const file = path.join(codexDir(), 'config.toml');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    // Fichier absent : on le crée.
  }

  if (/^\s*\[mcp_servers\.contextree\]/m.test(existing)) {
    report.push({ file, action: 'unchanged' });
    return;
  }

  const table =
    '[mcp_servers.contextree]\n' +
    `command = ${JSON.stringify(MCP_COMMAND.command)}\n` +
    `args = [${MCP_COMMAND.args.map(a => JSON.stringify(a)).join(', ')}]\n`;
  const body = existing.trim() ? `${existing.replace(/\n*$/, '')}\n\n${table}` : table;

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, 'utf8');
  report.push({ file, action: existing ? 'updated' : 'created' });
}

/**
 * Le fichier de consignes d'un agent sans hook (`AGENTS.md`).
 *
 * Le bloc est **borné** et remplacé à l'identique d'une fois sur l'autre : le
 * fichier reste celui de l'utilisateur, et une resynchronisation ne duplique
 * rien. Inchangé si le contenu n'a pas bougé — un `install` répété ne doit pas
 * salir un diff.
 */
export async function syncAgentsFile(
  projectDir: string,
  block: string,
  report: InstallReport,
  fileName = 'AGENTS.md',
): Promise<void> {
  const file = path.join(projectDir, fileName);
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    // Fichier absent : on le crée.
  }

  const marked = `${MARK_START}\n${block.trim()}\n${MARK_END}`;
  const start = existing.indexOf(MARK_START);
  const end = existing.indexOf(MARK_END);

  let body: string;
  if (start !== -1 && end > start) {
    body = existing.slice(0, start) + marked + existing.slice(end + MARK_END.length);
  } else if (existing.trim()) {
    body = `${existing.replace(/\n*$/, '')}\n\n${marked}\n`;
  } else {
    body = `${marked}\n`;
  }

  if (body === existing) {
    report.push({ file, action: 'unchanged' });
    return;
  }

  await fs.writeFile(file, body, 'utf8');
  report.push({ file, action: existing ? 'updated' : 'created' });
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
