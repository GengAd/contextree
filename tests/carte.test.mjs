// La carte, exercée sur tests/fixture : un faux projet avec un défaut de chaque sorte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const depot = join(ici, '..');
const script = join(depot, 'plugin', 'skills', 'carte', 'scripts', 'carte.mjs');
const fixture = join(ici, 'fixture');
const carte = (racine, ...args) =>
  JSON.parse(execFileSync('node', [script, '--json', '--racine', racine, ...args], { encoding: 'utf8' }));
const avertissement = (c, ou, mot) =>
  c.avertissements.some((a) => a.ou === ou && a.quoi.includes(mot));

test('la racine est CLAUDE.md, et son import AGENTS.md compte dans son poids', () => {
  const c = carte(fixture);
  assert.equal(c.toujours.length, 1);
  assert.equal(c.toujours[0].chemin, 'CLAUDE.md');
  assert.equal(c.toujours[0].imports[0].chemin, 'AGENTS.md');
});

test('une règle à paths vise des fichiers ; une règle sans paths est toujours chargée', () => {
  const c = carte(fixture);
  const api = c.regles.find((r) => r.chemin === '.claude/rules/api.md');
  assert.deepEqual(api.cibles, ['src/api/commandes.ts']);
  const style = c.regles.find((r) => r.chemin === '.claude/rules/style.md');
  assert.deepEqual(style.paths, []);
});

test('les skills disent qui peut les lancer, et leurs fichiers voisins', () => {
  const c = carte(fixture);
  const domaine = c.skills.find((s) => s.nom === 'domaine-commandes');
  assert.equal(domaine.mode, 'claude');
  assert.deepEqual(domaine.annexes, ['statuts.md']);
  assert.equal(c.agents[0].nom, 'relecteur');
  assert.equal(c.dossiers[0].dossier, 'web/');
});

test('chaque défaut de la fixture produit un avertissement qui dit quoi faire', () => {
  const c = carte(fixture);
  assert.ok(avertissement(c, '.claude/rules/morte.md', 'ne se chargera jamais'));
  assert.ok(avertissement(c, '.claude/skills/muette/SKILL.md', 'sans description'));
  assert.ok(avertissement(c, '.claude/skills/domaine-commandes/SKILL.md', 'lien mort : absent.md'));
  assert.ok(avertissement(c, '.claude/settings.json', "absent.mjs n'existe pas"));
  // le même défaut, lu deux fois : un script sous $CLAUDE_PROJECT_DIR, un autre par chemin absolu
  assert.ok(avertissement(c, '.claude/settings.json', "/nexiste/plus/demarrage.sh n'existe pas"));
  assert.equal(c.avertissements.length, 5, JSON.stringify(c.avertissements));
  for (const a of c.avertissements) assert.match(a.quoi, / — \S/, `${a.ou} ne dit pas quoi faire`);
});

test('le poids toujours chargé compte ce que /context compte : instructions, descriptions de skills et de sous-agents', () => {
  const c = carte(fixture);
  const { instructions, skills, agents, total } = c.poidsToujours;
  assert.equal(agents, c.agents[0].tokens);
  assert.ok(agents > 0);
  assert.equal(total, instructions + skills + agents);
  // ~2,5 caractères par token, calé sur /context pour du français
  const claude = readFileSync(join(fixture, 'CLAUDE.md'), 'utf8');
  assert.equal(c.toujours[0].tokens, Math.round(claude.length / 2.5));
});

test('sur un projet sans skill, QUAND LA TÂCHE EN PARLE dit « rien » plutôt qu’un titre seul', () => {
  const vide = mkdtempSync(join(tmpdir(), 'carte-'));
  const texte = execFileSync('node', [script, '--racine', vide], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const section = texte.split('QUAND LA TÂCHE EN PARLE')[1].split('\n\n')[0];
  assert.match(section, /\(rien\)/);
});

test('--fichier dit ce qui se charge en plus pour ce fichier', () => {
  const c = carte(fixture, '--fichier', join(fixture, 'src', 'api', 'commandes.ts'));
  assert.deepEqual(c.pourFichier.regles, ['.claude/rules/api.md']);
  const w = carte(fixture, '--fichier', join(fixture, 'web', 'Panier.tsx'));
  assert.deepEqual(w.pourFichier.dossiers, ['web/']);
});

test('la carte de ce dépôt est sans avertissement', () => {
  const c = carte(depot);
  assert.deepEqual(c.avertissements, []);
});
