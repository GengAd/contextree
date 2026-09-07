import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Câblage dans un projet Claude Code.
 *
 * Deux surfaces, volontairement séparées :
 *  - `.mcp.json` → le serveur MCP, portable (Claude Code, Cursor, Windsurf…),
 *  - `.claude/settings.json` → le hook `UserPromptSubmit`, qui rend l'injection
 *    déterministe là où on peut : sa sortie est ajoutée au contexte à chaque
 *    prompt, sans que l'agent ait à décider d'appeler un outil.
 *
 * Les deux fichiers appartiennent à l'utilisateur : on fusionne, on n'écrase
 * jamais, et on ne touche pas à une entrée existante qui ne vient pas de nous.
 */

export type InstallReport = { file: string; action: 'created' | 'updated' | 'unchanged' }[];

const HOOK_COMMAND = 'npx -y @gengad/contextree hook';

export async function installMcp(projectDir: string, report: InstallReport): Promise<void> {
  const file = path.join(projectDir, '.mcp.json');
  const config = (await readJson(file)) ?? {};
  const servers = ((config as any).mcpServers ??= {});
  if (servers.contextree) {
    report.push({ file, action: 'unchanged' });
    return;
  }
  servers.contextree = { command: 'npx', args: ['-y', '@gengad/contextree', 'mcp'] };
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
