// Le hook de forme : après une écriture dans le contexte, il relance la carte et ne parle que s'il y a à dire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ici = dirname(fileURLToPath(import.meta.url));
const depot = join(ici, '..');
const hook = join(depot, '.claude', 'hooks', 'forme.mjs');
const fixture = join(ici, 'fixture');
const lancer = (projet, file_path) =>
  spawnSync('node', [hook], {
    input: JSON.stringify({ cwd: projet, tool_input: { file_path } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projet },
  });

test('une écriture hors du contexte ne relance rien', () => {
  const r = lancer(fixture, 'src/api/commandes.ts');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('une écriture dans le contexte d’un projet à défauts rend les avertissements à Claude', () => {
  const r = lancer(fixture, '.claude/rules/morte.md');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /4 avertissement/);
  assert.match(r.stderr, /morte\.md — aucun fichier ne correspond/);
  assert.match(r.stderr, /Corrige avant de continuer/);
});

test('sur ce dépôt, le hook se tait', () => {
  const r = lancer(depot, 'CLAUDE.md');
  assert.equal(r.status, 0);
});

test('une entrée illisible ne bloque jamais', () => {
  const r = spawnSync('node', [hook], { input: 'pas du json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});
