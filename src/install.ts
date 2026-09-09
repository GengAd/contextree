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

/** Les agents qu'on sait câbler. */
export type AgentId = 'claude-code' | 'cursor' | 'codex' | 'windsurf' | 'claude-desktop';

const HOOK_COMMAND = 'npx -y @gengad/contextree hook';
const MCP_COMMAND = { command: 'npx', args: ['-y', '@gengad/contextree', 'mcp'] };

/** Les bornes du bloc synchronisé dans un fichier de consignes. Ce qui est
 *  dehors appartient à l'utilisateur et n'est jamais touché. */
const MARK_START = '<!-- contextree:start -->';
const MARK_END = '<!-- contextree:end -->';

export function installMcp(projectDir: string, report: InstallReport): Promise<void> {
  return installMcpJson(path.join(projectDir, '.mcp.json'), report);
}

/**
 * Le serveur MCP dans un fichier `{ "mcpServers": … }`.
 *
 * Claude Code, Cursor, Windsurf et Claude Desktop utilisent tous cette forme,
 * seul l'emplacement change — d'où une seule fonction et une table de chemins,
 * plutôt qu'un adaptateur par agent qui divergerait au premier correctif.
 */
export async function installMcpJson(file: string, report: InstallReport): Promise<void> {
  const existed = (await readJson(file)) !== null;
  const config = (await readJson(file)) ?? {};
  const servers = ((config as any).mcpServers ??= {});
  if (servers.contextree) {
    report.push({ file, action: 'unchanged' });
    return;
  }
  servers.contextree = { ...MCP_COMMAND };
  await writeJson(file, config);
  report.push({ file, action: existed ? 'updated' : 'created' });
}

/** Le serveur est-il déjà déclaré dans ce fichier ? */
async function mcpJsonWired(file: string): Promise<boolean> {
  const config = (await readJson(file)) as { mcpServers?: Record<string, unknown> } | null;
  return Boolean(config?.mcpServers?.['contextree']);
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

/**
 * Le registre des agents.
 *
 * Un agent, c'est trois questions : est-il **là** (`detect`), est-il **déjà
 * câblé** (`wired`), et **qu'est-ce qu'on écrirait** (`files`). Les trois se
 * répondent sans rien modifier — c'est ce qui permet à une interface de
 * montrer l'état plutôt que de tenter et d'échouer en silence.
 */
export type AgentSpec = {
  id: AgentId;
  label: string;
  /** Ce qui serait touché. Dit avant d'écrire, montré après. */
  files: (projectDir: string) => string[];
  /** Des chemins dont l'existence prouve que l'agent est installé. */
  marks: (projectDir: string) => string[];
  install: (projectDir: string, report: InstallReport, agentsBlock?: string) => Promise<void>;
};

/** `~`, avec l'échappatoire habituelle pour les tests. */
function home(): string {
  return os.homedir();
}

/** Où Claude Desktop range sa configuration, selon le système. */
function claudeDesktopConfig(): string {
  if (process.platform === 'darwin') {
    return path.join(home(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(home(), 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home(), '.config', 'Claude', 'claude_desktop_config.json');
}

export const AGENTS: AgentSpec[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    // Le seul qui a un hook : les deux fichiers, et le hook d'abord dans la
    // tête du lecteur — c'est lui qui rend l'injection déterministe.
    files: p => [path.join(p, '.claude', 'settings.json'), path.join(p, '.mcp.json')],
    marks: p => [path.join(p, '.claude'), path.join(home(), '.claude')],
    install: async (p, report) => {
      await installHook(p, report);
      await installMcp(p, report);
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    // Le fichier du projet, pas celui du home : un arbre de contexte est
    // attaché à un dépôt, pas à une machine.
    files: p => [path.join(p, '.cursor', 'mcp.json')],
    marks: p => [path.join(p, '.cursor'), path.join(home(), '.cursor')],
    install: (p, report) => installMcpJson(path.join(p, '.cursor', 'mcp.json'), report),
  },
  {
    id: 'codex',
    label: 'Codex',
    files: p => [path.join(codexDir(), 'config.toml'), path.join(p, 'AGENTS.md')],
    marks: () => [codexDir()],
    install: async (p, report, block) => {
      await installCodexMcp(report);
      if (block) await syncAgentsFile(p, block, report);
    },
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    files: () => [path.join(home(), '.codeium', 'windsurf', 'mcp_config.json')],
    marks: () => [path.join(home(), '.codeium', 'windsurf')],
    install: (_p, report) =>
      installMcpJson(path.join(home(), '.codeium', 'windsurf', 'mcp_config.json'), report),
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    files: () => [claudeDesktopConfig()],
    marks: () => [path.dirname(claudeDesktopConfig())],
    install: (_p, report) => installMcpJson(claudeDesktopConfig(), report),
  },
];

export type AgentStatus = {
  id: AgentId;
  label: string;
  /** L'agent est-il installé sur cette machine ? */
  detected: boolean;
  /** contextree y est-il déjà câblé ? */
  wired: boolean;
  files: string[];
};

/**
 * L'état de chaque agent, sans rien écrire.
 *
 * C'est ce que consomme le bouton de l'extension : il montre « câblé » ou
 * « à câbler » au lieu de tenter l'écriture pour découvrir le résultat.
 */
export async function agentStatus(projectDir: string): Promise<AgentStatus[]> {
  return Promise.all(
    AGENTS.map(async spec => {
      const files = spec.files(projectDir);
      const [detected, wired] = await Promise.all([
        anyExists(spec.marks(projectDir)),
        isWired(spec, projectDir),
      ]);
      return { id: spec.id, label: spec.label, detected, wired, files };
    }),
  );
}

/** Câblé = **tous** ses fichiers le sont. Un hook posé sans serveur MCP est un
 *  câblage à moitié fait, et l'annoncer comme terminé serait mentir. */
async function isWired(spec: AgentSpec, projectDir: string): Promise<boolean> {
  const checks = spec.files(projectDir).map(async file => {
    if (file.endsWith('.toml')) return /^\s*\[mcp_servers\.contextree\]/m.test(await readText(file));
    if (file.endsWith('AGENTS.md')) return (await readText(file)).includes(MARK_START);
    if (path.basename(file) === 'settings.json') {
      const settings = (await readJson(file)) as { hooks?: { UserPromptSubmit?: unknown[] } } | null;
      return (settings?.hooks?.UserPromptSubmit ?? []).some((entry: any) =>
        (entry?.hooks ?? []).some(
          (h: any) => typeof h?.command === 'string' && h.command.includes('contextree'),
        ),
      );
    }
    return mcpJsonWired(file);
  });
  const results = await Promise.all(checks);
  return results.length > 0 && results.every(Boolean);
}

/** Câble un agent nommé. Rend ce qui a été écrit — jamais rien en silence. */
export async function installAgent(
  id: AgentId,
  projectDir: string,
  agentsBlock?: string,
): Promise<InstallReport> {
  const spec = AGENTS.find(a => a.id === id);
  if (!spec) throw new Error(`Agent inconnu : ${id}`);
  const report: InstallReport = [];
  await spec.install(projectDir, report, agentsBlock);
  return report;
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    try {
      await fs.stat(p);
      return true;
    } catch {
      // Chemin suivant.
    }
  }
  return false;
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
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
