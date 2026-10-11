// Le journal de chargement : le hook du plugin, nourri d'événements fabriqués comme ceux de Claude Code,
// puis la carte qui le relit. Chaque test a son projet temporaire : rien n'écrit dans tests/fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const hook = join(ici, '..', 'plugin', 'hooks', 'journal.mjs');
const carte = join(ici, '..', 'plugin', 'skills', 'carte', 'scripts', 'carte.mjs');
const fixture = join(ici, 'fixture');

/** Un projet sous git, une skill de projet, et un home avec son calque ~/.claude. */
function projet() {
  const racine = mkdtempSync(join(tmpdir(), 'journal-'));
  const home = mkdtempSync(join(tmpdir(), 'journal-home-'));
  mkdirSync(join(racine, '.claude', 'skills', 'tache'), { recursive: true });
  writeFileSync(join(racine, '.claude', 'skills', 'tache', 'SKILL.md'), '---\nname: tache\ndescription: d\n---\n');
  mkdirSync(join(home, '.claude', 'skills', 'brouillon'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'brouillon', 'SKILL.md'), '---\nname: brouillon\n---\n');
  execFileSync('git', ['init', '-q'], { cwd: racine });
  return { racine, home };
}
const lancer = ({ racine, home }, entree) =>
  spawnSync('node', [hook], {
    input: typeof entree === 'string' ? entree : JSON.stringify({ session_id: 's1', cwd: racine, ...entree }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: racine, HOME: home, CLAUDE_CONFIG_DIR: '' },
  });
const lignes = ({ racine }) => {
  const f = join(racine, '.claude', 'contextree', 'journal.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const charge = (p, fichier, load_reason, plus = {}) =>
  lancer(p, { hook_event_name: 'InstructionsLoaded', file_path: join(p.racine, fichier), memory_type: 'Project', load_reason, ...plus });

test('chaque chargement d’instructions devient une ligne : fichier relatif, raison, et ce qui l’a déclenché', () => {
  const p = projet();
  charge(p, 'CLAUDE.md', 'session_start');
  charge(p, 'web/CLAUDE.md', 'nested_traversal', { trigger_file_path: join(p.racine, 'web', 'Panier.tsx') });
  charge(p, '.claude/rules/api.md', 'path_glob_match', { globs: ['src/api/**'], trigger_file_path: join(p.racine, 'src', 'api', 'a.ts') });
  charge(p, 'AGENTS.md', 'include', { parent_file_path: join(p.racine, 'CLAUDE.md') });
  const r = charge(p, 'CLAUDE.md', 'compact');
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '', 'le hook ne dit rien à la session');
  assert.deepEqual(
    lignes(p).map((l) => [l.fichier, l.genre, l.raison, l.declencheur, l.session]),
    [
      ['CLAUDE.md', 'instruction', 'session_start', null, 's1'],
      ['web/CLAUDE.md', 'instruction', 'nested_traversal', 'web/Panier.tsx', 's1'],
      ['.claude/rules/api.md', 'instruction', 'path_glob_match', 'src/api/a.ts', 's1'],
      ['AGENTS.md', 'instruction', 'include', 'CLAUDE.md', 's1'],
      ['CLAUDE.md', 'instruction', 'compact', null, 's1'],
    ],
  );
  for (const l of lignes(p)) assert.ok(Math.abs(Date.now() - Date.parse(l.quand)) < 60_000, l.quand);
});

test('un fichier du calque perso s’écrit ~/…, comme dans la carte', () => {
  const p = projet();
  lancer(p, { hook_event_name: 'InstructionsLoaded', file_path: join(p.home, '.claude', 'CLAUDE.md'), memory_type: 'User', load_reason: 'session_start' });
  assert.equal(lignes(p)[0].fichier, '~/.claude/CLAUDE.md');
});

test('une skill compte, que Claude la lance ou qu’on la tape ; son fichier est retrouvé, perso compris', () => {
  const p = projet();
  lancer(p, { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'tache' }, tool_response: {} });
  lancer(p, { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'brouillon', command_args: '', prompt: '/brouillon' });
  lancer(p, { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'contextree:carte' } });
  assert.deepEqual(
    lignes(p).map((l) => [l.genre, l.nom, l.fichier, l.raison]),
    [
      ['skill', 'tache', '.claude/skills/tache/SKILL.md', 'claude'],
      ['skill', 'brouillon', '~/.claude/skills/brouillon/SKILL.md', 'commande'],
      ['skill', 'contextree:carte', null, 'claude'],
    ],
  );
});

test('ce qui ne charge rien n’écrit rien, et une entrée illisible ne gêne jamais', () => {
  const p = projet();
  for (const e of [
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    { hook_event_name: 'UserPromptExpansion', expansion_type: 'mcp_prompt', command_name: 'serveur:prompt' },
    'pas du json',
  ])
    assert.equal(lancer(p, e).status, 0);
  assert.ok(!existsSync(join(p.racine, '.claude', 'contextree')), 'rien de créé');
});

test('le journal reste hors de git : un .gitignore à côté, git status propre', () => {
  const p = projet();
  charge(p, 'CLAUDE.md', 'session_start');
  assert.equal(readFileSync(join(p.racine, '.claude', 'contextree', '.gitignore'), 'utf8'), '*\n');
  const statut = execFileSync('git', ['status', '--porcelain', '-uall', '--', '.claude/contextree'], { cwd: p.racine, encoding: 'utf8' });
  assert.equal(statut, '');
});

test('le journal se taille seul : rien de plus vieux que 90 jours, jamais plus de 5 000 lignes', () => {
  const p = projet();
  const dossier = join(p.racine, '.claude', 'contextree');
  mkdirSync(dossier, { recursive: true });
  const il_y_a = (jours) => new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString();
  const vieilles = Array.from({ length: 10 }, () => ({ quand: il_y_a(100), fichier: 'vieux.md', genre: 'instruction' }));
  const recentes = Array.from({ length: 5000 }, (_, i) => ({ quand: il_y_a(30), fichier: `r${i}.md`, genre: 'instruction' }));
  writeFileSync(join(dossier, 'journal.jsonl'), [...vieilles, ...recentes].map((l) => JSON.stringify(l) + '\n').join(''));
  charge(p, 'CLAUDE.md', 'session_start');
  const apres = lignes(p);
  assert.ok(apres.length <= 5000, `${apres.length} lignes`);
  assert.ok(!apres.some((l) => l.fichier === 'vieux.md'), 'les lignes de plus de 90 jours partent');
  assert.equal(apres.at(-1).fichier, 'CLAUDE.md', 'la ligne du jour reste');
});

test('un journal court mais vieux se taille aussi : rien de plus de 90 jours', () => {
  const p = projet();
  const dossier = join(p.racine, '.claude', 'contextree');
  mkdirSync(dossier, { recursive: true });
  const il_y_a = (jours) => new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString();
  const lignesAvant = [...Array.from({ length: 10 }, () => ({ quand: il_y_a(100), fichier: 'vieux.md' })), { quand: il_y_a(1), fichier: 'hier.md' }];
  writeFileSync(join(dossier, 'journal.jsonl'), lignesAvant.map((l) => JSON.stringify(l) + '\n').join(''));
  charge(p, 'CLAUDE.md', 'session_start');
  assert.deepEqual(lignes(p).map((l) => l.fichier), ['hier.md', 'CLAUDE.md']);
});

test('de bout en bout : le hook écrit, la carte dit « chargé 1 fois, à l’instant »', () => {
  const p = { racine: mkdtempSync(join(tmpdir(), 'journal-carte-')), home: mkdtempSync(join(tmpdir(), 'journal-home-')) };
  cpSync(fixture, p.racine, { recursive: true });
  charge(p, '.claude/rules/api.md', 'path_glob_match', { trigger_file_path: join(p.racine, 'src', 'api', 'commandes.ts') });
  lancer(p, { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'domaine-commandes' } });
  const env = { ...process.env, HOME: p.home, CLAUDE_CONFIG_DIR: p.home, NO_COLOR: '1' };
  const texte = execFileSync('node', [carte, '--racine', p.racine], { encoding: 'utf8', env });
  assert.match(texte, /\.claude\/rules\/api\.md {2}.*chargé 1 fois, à l'instant/);
  assert.match(texte, /domaine-commandes .*chargé 1 fois, à l'instant/);
  assert.match(texte, /Chargements réels : journal d'aujourd'hui, 1 session/);
  const json = JSON.parse(execFileSync('node', [carte, '--racine', p.racine, '--json'], { encoding: 'utf8', env }));
  assert.equal(json.regles.find((r) => r.chemin === '.claude/rules/api.md').charges.fois, 1);
  assert.equal(json.regles.find((r) => r.chemin === '.claude/rules/style.md').charges.fois, 0);
  assert.equal(json.journal.sessions, 1);
});
