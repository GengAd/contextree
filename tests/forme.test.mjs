// Le hook de forme : après une écriture dans le contexte, il relance la carte et ne parle que s'il y a à dire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const depot = join(ici, '..');
const hook = join(depot, '.claude', 'hooks', 'forme.mjs');
const fixture = join(ici, 'fixture');
// un calque perso vide : le hook ne dépend pas de la machine qui lance les tests
const vide = mkdtempSync(join(tmpdir(), 'forme-home-'));
const lancer = (projet, file_path, perso = vide) =>
  spawnSync('node', [hook], {
    input: JSON.stringify({ cwd: projet, tool_input: { file_path } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projet, CLAUDE_CONFIG_DIR: perso },
  });

test('une écriture hors du contexte ne relance rien', () => {
  const r = lancer(fixture, 'src/api/commandes.ts');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('une écriture dans le contexte d’un projet à défauts rend les avertissements à Claude', () => {
  const r = lancer(fixture, '.claude/rules/morte.md');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /5 avertissement/);
  assert.match(r.stderr, /morte\.md — aucun fichier ne correspond/);
  assert.match(r.stderr, /Corrige avant de continuer/);
});

test('sur ce dépôt, le hook se tait', () => {
  const r = lancer(depot, 'CLAUDE.md');
  assert.equal(r.status, 0);
});

test('un défaut du calque perso ne bloque pas : il n’est pas dans le dépôt', () => {
  const r = lancer(depot, 'CLAUDE.md', join(ici, 'fixture-home'));
  assert.equal(r.status, 0, r.stderr);
});

test('une entrée illisible ne bloque jamais', () => {
  const r = spawnSync('node', [hook], { input: 'pas du json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});
