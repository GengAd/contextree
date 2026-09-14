import { existsSync, promises as fs, realpathSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findBin } from './core/router.js';
import { currentLang } from './core/i18n.js';
import { cliText } from './messages.js';

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

/** `repaired` : une entrée contextree était là, mais sa commande n'existe pas sur
 *  cette machine — on l'a réécrite. `note` : ce que l'utilisateur doit savoir du
 *  fichier écrit, dit à côté de la ligne. */
export type InstallReport = {
  file: string;
  action: 'created' | 'updated' | 'repaired' | 'unchanged';
  note?: string;
}[];

/** Les agents qu'on sait câbler. */
export type AgentId =
  | 'claude-code'
  | 'vscode'
  | 'cursor'
  | 'codex'
  | 'gemini'
  | 'windsurf'
  | 'claude-desktop';

const PACKAGE = '@gengad/contextree';

/**
 * La commande qui **exécute** contextree, telle qu'on l'inscrit dans la
 * configuration d'un agent.
 *
 * On écrivait `npx -y @gengad/contextree <cmd>` en dur. Tant que le paquet
 * n'est pas publié, ça échoue partout ailleurs que dans ce dépôt — et en
 * silence, puisque le hook sort toujours en code 0. Donc : **on inscrit ce qui
 * tourne** (9 septembre 2026). Le processus qui exécute `install` sait comment
 * il a été lancé.
 *
 * - lancé depuis un cache npx (`/_npx/` dans le chemin) → la forme npx, qui est
 *   la bonne pour cet utilisateur — P6 la pinnera sur une version ;
 * - sinon → `"<node>" "<cli.js>"`, en chemins **absolus**. Couvre `npm i -g .`,
 *   `npm link`, et `node dist/cli.js` lancé depuis le dépôt.
 *
 * Jamais `contextree` nu : le PATH d'un hook est plus pauvre que celui d'un
 * shell (même raison que `findBin`, dans `router.ts`). Et toujours entre
 * guillemets dans la forme shell — un chemin avec une espace casserait le hook.
 */
export function selfCommand(
  cmd: 'hook' | 'mcp',
  host: SelfHost = {
    execPath: process.execPath,
    argv1: process.argv[1],
    electron: process.versions.electron,
    find: findBin,
  },
): { command: string; args: string[]; shell: string } {
  // La langue est inscrite en toutes lettres (14 septembre 2026) : l'agent lance
  // le hook et le serveur avec un environnement appauvri, où ni `LANG` ni la
  // préférence macOS ne sont garantis. Ce qu'on a résolu ici, dans le terminal
  // ou l'extension de l'utilisateur, est ce qui arrivera là-bas.
  const base = baseCommand(cmd, host);
  const lang = ['--lang', currentLang()];
  return { command: base.command, args: [...base.args, ...lang], shell: `${base.shell} ${lang.join(' ')}` };
}

function baseCommand(cmd: 'hook' | 'mcp', host: SelfHost): { command: string; args: string[]; shell: string } {
  // Sous l'hôte d'extensions, « ce qui tourne » n'est pas contextree : voir
  // `installedCommand`.
  if (host.electron) return installedCommand(cmd, host.find ?? findBin);
  const self = host.argv1;
  // `/_npx/` sous Unix, `\_npx\` sous Windows.
  if (!self || /[\\/]_npx[\\/]/.test(self)) {
    const args = ['-y', PACKAGE, cmd];
    return { command: 'npx', args, shell: ['npx', ...args].join(' ') };
  }
  const entry = path.resolve(self);
  return {
    command: host.execPath,
    args: [entry, cmd],
    shell: `"${host.execPath}" "${entry}" ${cmd}`,
  };
}

/** Le process qui demande la commande — simulable en test. */
export type SelfHost = {
  execPath: string;
  argv1?: string;
  /** `process.versions.electron` : présent dans l'hôte d'extensions de VS Code / Cursor. */
  electron?: string;
  find?: (name: string) => string | null;
};

/** Levée quand aucune commande lançable n'existe : mieux vaut ne rien écrire
 *  qu'écrire une commande morte. Le message dit quoi installer. */
export class NoCliError extends Error {}

/**
 * La commande d'un contextree **installé**, pour qui n'est pas contextree.
 *
 * Le bouton « Ajouter à une IA » tourne dans l'hôte d'extensions (14 septembre
 * 2026) : `process.execPath` y est le binaire Electron — constaté,
 * `/Applications/Cursor.app/…/Cursor Helper (Plugin)` — et `argv[1]` son
 * amorce. Inscrire « ce qui tourne » écrivait donc une commande qui ne lance pas
 * contextree ; le hook sortant toujours en 0 et un serveur MCP muet ne disant
 * rien dans le chat, l'agent travaillait sans arbre, en silence.
 *
 * Tranché, dans cet ordre :
 *
 * 1. un `contextree` trouvé comme le routeur trouve ses CLI (`findBin`), inscrit
 *    en chemins absolus `node` + `cli.js` — le lien de `npm i -g` résolu, ou,
 *    sous Windows, le `cli.js` à côté du shim `.cmd` ;
 * 2. sinon **rien** : `NoCliError`, et le bouton dit quoi installer.
 *
 * La forme `npx -y @gengad/contextree` n'est pas proposée tant que le paquet
 * n'est pas publié — elle échouerait exactement comme l'hôte d'extensions. Elle
 * viendra avec la carte de publication.
 */
function installedCommand(
  cmd: 'hook' | 'mcp',
  find: (name: string) => string | null,
): { command: string; args: string[]; shell: string } {
  const bin = find('contextree');
  let entry: string | null = null;
  if (bin) {
    try {
      entry = /\.(cmd|bat)$/i.test(bin)
        ? path.join(path.dirname(bin), 'node_modules', '@gengad', 'contextree', 'dist', 'cli.js')
        : realpathSync(bin);
    } catch {
      entry = null;
    }
  }
  const node = find('node');
  if (!entry || !existsSync(entry) || !node) {
    throw new NoCliError(cliText().noCli(Boolean(entry && !node)));
  }
  return { command: node, args: [entry, cmd], shell: `"${node}" "${entry}" ${cmd}` };
}

/** Les bornes du bloc synchronisé dans un fichier de consignes. Ce qui est
 *  dehors appartient à l'utilisateur et n'est jamais touché. */
const MARK_START = '<!-- contextree:start -->';
const MARK_END = '<!-- contextree:end -->';

export function installMcp(projectDir: string, report: InstallReport): Promise<void> {
  return installMcpJson(path.join(projectDir, '.mcp.json'), report, true);
}

/**
 * Le serveur MCP dans un fichier `{ "mcpServers": … }`.
 *
 * Claude Code, Cursor, Windsurf et Claude Desktop utilisent tous cette forme,
 * seul l'emplacement change — d'où une seule fonction et une table de chemins,
 * plutôt qu'un adaptateur par agent qui divergerait au premier correctif.
 */
export async function installMcpJson(file: string, report: InstallReport, inProject = false): Promise<void> {
  const existed = (await readJson(file)) !== null;
  const config = (await readJson(file)) ?? {};
  const servers = ((config as any).mcpServers ??= {});
  const broken = servers.contextree && !runnableHere(servers.contextree);
  if (servers.contextree && !broken) {
    report.push({ file, action: 'unchanged' });
    return;
  }
  const { command, args } = selfCommand('mcp');
  servers.contextree = { command, args };
  await writeJson(file, config);
  report.push({ file, action: broken ? 'repaired' : existed ? 'updated' : 'created', ...(inProject ? machineNote() : {}) });
}

/** Le serveur est-il déjà déclaré dans ce fichier — et lançable ici ? */
async function mcpJsonWired(file: string): Promise<boolean> {
  const config = (await readJson(file)) as { mcpServers?: Record<string, unknown> } | null;
  return runnableHere(config?.mcpServers?.['contextree']);
}

/**
 * Une entrée contextree peut-elle démarrer **sur cette machine** ?
 *
 * Tant que le paquet n'est pas publié, `selfCommand` inscrit des chemins
 * absolus — `/Users/<quelqu'un>/…/node`. Un `.vscode/mcp.json` se commite
 * volontiers : chez le collègue qui pull, le serveur ne démarre pas, et
 * `install` répondait « déjà câblé » parce que la clé existait (14 septembre
 * 2026). Une entrée qui ne peut pas démarrer n'est pas un câblage.
 *
 * On ne vérifie que ce qui se vérifie sans rien lancer : un chemin **absolu**
 * (la commande, ou un script en argument) qui n'existe pas. `npx` ou `node` nus
 * passent — le PATH n'est pas le nôtre à juger.
 */
function runnableHere(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const { command, args } = entry as { command?: unknown; args?: unknown };
  const paths = [command, ...(Array.isArray(args) ? args : [])].filter(
    (a): a is string => typeof a === 'string' && path.isAbsolute(a) && !a.includes('${'),
  );
  return paths.every(p => existsSync(p));
}

/**
 * L'avertissement qui va avec un fichier **du projet** écrit en chemins absolus.
 *
 * Tant qu'il n'y a pas de forme portable (le paquet publié et pinné, voir
 * `selfCommand`), la commande inscrite ne vaut que sur cette machine. Un
 * fichier du home ne se commite pas ; un `.vscode/mcp.json` ou un `.mcp.json`,
 * si — et c'est là qu'il faut le dire.
 */
function machineNote(): { note?: string } {
  if (selfCommand('mcp').command === 'npx') return {};
  return { note: cliText().machinePathsNote };
}

/**
 * VS Code : `.vscode/mcp.json`, et **ce n'est pas la même forme**.
 *
 * Clé racine `servers` et non `mcpServers`, avec un `type: "stdio"` explicite
 * (vérifié le 11 septembre 2026 sur la doc VS Code). Écrire la forme des autres
 * ici donnerait un fichier valide en JSON que VS Code ignore en silence — la
 * panne la plus coûteuse de ce projet, parce qu'elle ressemble à une réussite.
 *
 * D'où une fonction à part plutôt qu'un paramètre de plus sur `installMcpJson` :
 * deux formats, deux fonctions courtes, et aucun risque de servir l'un pour
 * l'autre.
 */
export async function installVscodeMcp(projectDir: string, report: InstallReport): Promise<void> {
  const file = path.join(projectDir, '.vscode', 'mcp.json');
  const existed = (await readJson(file)) !== null;
  const config = (await readJson(file)) ?? {};
  const servers = ((config as any).servers ??= {});
  const current = servers.contextree;
  const broken = current && !runnableHere(current);
  if (current && !broken) {
    if (current.cwd) {
      report.push({ file, action: 'unchanged' });
      return;
    }
    // Une entrée d'avant le `cwd` : on ajoute le seul champ qui manque, sans
    // toucher à une commande qui marche.
    current.cwd = VSCODE_CWD;
    await writeJson(file, config);
    report.push({ file, action: 'updated' });
    return;
  }
  const { command, args } = selfCommand('mcp');
  servers.contextree = { type: 'stdio', command, args, cwd: VSCODE_CWD };
  await writeJson(file, config);
  report.push({ file, action: broken ? 'repaired' : existed ? 'updated' : 'created', ...machineNote() });
}

/**
 * Le dossier où VS Code lance le serveur.
 *
 * Le serveur cherche `.contextree/` depuis son `cwd`. Lancé ailleurs que dans
 * le projet, il répondrait « pas d'arbre » et Copilot n'aurait **aucune**
 * branche. `${workspaceFolder}` est la variable de `mcp.json` pour ça ; son
 * expansion dans `cwd` a eu des ratés selon les versions (issues VS Code
 * #251263, #290325) — d'où le filet côté serveur, qui demande ses *roots* au
 * client quand son `cwd` n'a pas d'arbre (voir `createServer`).
 */
const VSCODE_CWD = '${workspaceFolder}';

/**
 * Gemini CLI : `.gemini/settings.json` porte **les deux** surfaces à la fois —
 * le serveur MCP (`mcpServers`, la forme commune) et un hook par prompt.
 *
 * `BeforeAgent` est le seul équivalent de `UserPromptSubmit` en dehors de Claude
 * Code : son `hookSpecificOutput.additionalContext` est ajouté au prompt du tour
 * (vérifié le 11 septembre 2026). La structure est imbriquée comme celle de
 * Claude Code — une liste de matchers, chacun portant sa liste de hooks — et pas
 * une simple commande, ce qui se devine mal.
 *
 * Le hook appelle `hook --agent gemini` : le cœur est le même, seule l'enveloppe
 * change (Gemini veut du JSON sur stdout, Claude Code du texte brut). Cette
 * enveloppe est la carte suivante ; ici on n'écrit que la config qui l'appelle.
 */
export async function installGemini(projectDir: string, report: InstallReport): Promise<void> {
  const file = path.join(projectDir, '.gemini', 'settings.json');
  const existed = (await readJson(file)) !== null;
  const config = (await readJson(file)) ?? {};

  let changed = false;
  const servers = ((config as any).mcpServers ??= {});
  // Même réparation que les autres fichiers MCP : une entrée venue d'une autre
  // machine n'est pas un câblage.
  if (!runnableHere(servers.contextree)) {
    const { command, args } = selfCommand('mcp');
    servers.contextree = { command, args };
    changed = true;
  }

  const hooks = ((config as any).hooks ??= {});
  const before: any[] = (hooks.BeforeAgent ??= []);
  const already = before.some(entry =>
    (entry?.hooks ?? []).some((h: any) => typeof h?.command === 'string' && h.command.includes('contextree')),
  );
  if (!already) {
    before.push({
      hooks: [
        {
          type: 'command',
          name: 'contextree',
          command: `${selfCommand('hook').shell} --agent gemini`,
          timeout: 15,
        },
      ],
    });
    changed = true;
  }

  if (!changed) {
    report.push({ file, action: 'unchanged' });
    return;
  }
  await writeJson(file, config);
  report.push({ file, action: existed ? 'updated' : 'created' });
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

  list.push({ hooks: [{ type: 'command', command: selfCommand('hook').shell, timeout: 15 }] });
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

  const self = selfCommand('mcp');
  const table =
    '[mcp_servers.contextree]\n' +
    `command = ${JSON.stringify(self.command)}\n` +
    `args = [${self.args.map(a => JSON.stringify(a)).join(', ')}]\n`;
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

  // `copilot-instructions.md` vit sous `.github/`, qui peut ne pas exister.
  await fs.mkdir(path.dirname(file), { recursive: true });

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
    id: 'vscode',
    label: 'VS Code + Copilot',
    // Deux fichiers de consignes et non un : `copilot-instructions.md` est
    // toujours lu par Copilot, `AGENTS.md` l'est aussi et sert à tout ce qui
    // ouvre le dépôt ensuite. Le même bloc dans les deux — une seule source.
    //
    // Pas de hook : Copilot en a (préversion), mais la sortie de son
    // `UserPromptSubmit` est **ignorée**. Un hook qu'on poserait là n'injecterait
    // rien, en silence. Le fichier de consignes fait le travail sans process.
    files: p => [
      path.join(p, '.vscode', 'mcp.json'),
      path.join(p, '.github', 'copilot-instructions.md'),
      path.join(p, 'AGENTS.md'),
    ],
    marks: p => [
      path.join(p, '.vscode'),
      path.join(home(), '.vscode'),
      path.join(home(), 'Library', 'Application Support', 'Code'),
      path.join(home(), '.config', 'Code'),
    ],
    install: async (p, report, block) => {
      await installVscodeMcp(p, report);
      if (block) {
        await syncAgentsFile(p, block, report, path.join('.github', 'copilot-instructions.md'));
        await syncAgentsFile(p, block, report);
      }
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    // Le fichier du projet, pas celui du home : un arbre de contexte est
    // attaché à un dépôt, pas à une machine.
    //
    // `AGENTS.md` en plus du MCP (11 septembre 2026) : Cursor le lit, et ses
    // hooks ne savent pas injecter par prompt — `beforeSubmitPrompt` ne peut que
    // bloquer. Sans le fichier, un agent qui n'appelle pas `get_context` de
    // lui-même ne reçoit rien du tout.
    files: p => [path.join(p, '.cursor', 'mcp.json'), path.join(p, 'AGENTS.md')],
    marks: p => [path.join(p, '.cursor'), path.join(home(), '.cursor')],
    install: async (p, report, block) => {
      await installMcpJson(path.join(p, '.cursor', 'mcp.json'), report, true);
      if (block) await syncAgentsFile(p, block, report);
    },
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
    id: 'gemini',
    label: 'Gemini CLI',
    // Le deuxième agent à avoir un vrai hook par prompt, après Claude Code :
    // `BeforeAgent` ajoute son `additionalContext` au tour en cours. Les deux
    // surfaces vivent dans le même fichier, et « câblé » exige les deux.
    files: p => [path.join(p, '.gemini', 'settings.json'), path.join(p, 'GEMINI.md')],
    marks: p => [path.join(p, '.gemini'), path.join(home(), '.gemini')],
    install: async (p, report, block) => {
      await installGemini(p, report);
      if (block) await syncAgentsFile(p, block, report, 'GEMINI.md');
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

/**
 * Câblé = **tous** ses fichiers le sont. Un hook posé sans serveur MCP est un
 * câblage à moitié fait, et l'annoncer comme terminé serait mentir.
 *
 * Chaque fichier se vérifie selon **son format**, reconnu par son chemin et non
 * par son seul nom (11 septembre 2026). Deux agents rangent leur configuration
 * dans un fichier qui s'appelle `settings.json`, et deux formats de MCP
 * cohabitent : tester `basename === 'settings.json'` faisait passer le
 * `.gemini/` pour un `.claude/`, et le `.vscode/mcp.json` pour la forme
 * `mcpServers` qu'il n'a pas. Un `--status` qui se trompe est pire qu'absent —
 * il dit « câblé » sur un agent qui ne reçoit rien.
 */
async function isWired(spec: AgentSpec, projectDir: string): Promise<boolean> {
  const checks = spec.files(projectDir).map(file => wiredIn(file));
  const results = await Promise.all(checks);
  return results.length > 0 && results.every(Boolean);
}

/** contextree est-il présent dans ce fichier-là, au format de ce fichier-là ? */
async function wiredIn(file: string): Promise<boolean> {
  const parts = file.split(path.sep);
  const dir = parts[parts.length - 2];
  const name = path.basename(file);

  // Un fichier de consignes : le bloc borné. `AGENTS.md`, `GEMINI.md`,
  // `copilot-instructions.md` — tous le même bloc, tous la même vérification.
  if (name.endsWith('.md')) return (await readText(file)).includes(MARK_START);
  if (name.endsWith('.toml')) return /^\s*\[mcp_servers\.contextree\]/m.test(await readText(file));

  // VS Code : clé `servers`, pas `mcpServers`.
  if (dir === '.vscode' && name === 'mcp.json') {
    const config = (await readJson(file)) as { servers?: Record<string, unknown> } | null;
    return runnableHere(config?.servers?.['contextree']);
  }

  // Gemini : les **deux** surfaces dans le même fichier. L'une sans l'autre
  // n'est pas un câblage terminé.
  if (dir === '.gemini' && name === 'settings.json') {
    const config = (await readJson(file)) as {
      mcpServers?: Record<string, unknown>;
      hooks?: { BeforeAgent?: unknown[] };
    } | null;
    return runnableHere(config?.mcpServers?.['contextree']) && hasHook(config?.hooks?.BeforeAgent);
  }

  if (dir === '.claude' && name === 'settings.json') {
    const settings = (await readJson(file)) as { hooks?: { UserPromptSubmit?: unknown[] } } | null;
    return hasHook(settings?.hooks?.UserPromptSubmit);
  }

  return mcpJsonWired(file);
}

/** La forme imbriquée que partagent Claude Code et Gemini : une liste de
 *  matchers, chacun portant sa liste de commandes. */
function hasHook(list: unknown[] | undefined): boolean {
  return (list ?? []).some((entry: any) =>
    (entry?.hooks ?? []).some(
      (h: any) => typeof h?.command === 'string' && h.command.includes('contextree'),
    ),
  );
}

/** Câble un agent nommé. Rend ce qui a été écrit — jamais rien en silence. */
export async function installAgent(
  id: AgentId,
  projectDir: string,
  agentsBlock?: string,
): Promise<InstallReport> {
  const spec = AGENTS.find(a => a.id === id);
  if (!spec) throw new Error(cliText().unknownAgentId(id));
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
