// La carte, exercée sur tests/fixture : un faux projet avec un défaut de chaque sorte,
// et sur tests/fixture-home : un faux calque utilisateur (~/.claude).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const depot = join(ici, '..');
const script = join(depot, 'plugin', 'skills', 'carte', 'scripts', 'carte.mjs');
const fixture = join(ici, 'fixture');
const fixtureHome = join(ici, 'fixture-home');
// par défaut, un calque perso vide : la carte ne dépend pas de la machine qui lance les tests
const vide = mkdtempSync(join(tmpdir(), 'carte-home-'));
const lancer = (racine, args, perso = vide) =>
  execFileSync('node', [script, '--racine', racine, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: vide, CLAUDE_CONFIG_DIR: perso, NO_COLOR: '1' },
  });
const carte = (racine, ...args) => JSON.parse(lancer(racine, ['--json', ...args]));
const cartePerso = (racine, ...args) => JSON.parse(lancer(racine, ['--json', ...args], fixtureHome));
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
  const projet = mkdtempSync(join(tmpdir(), 'carte-'));
  const texte = lancer(projet, []);
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

test('le calque perso apparaît à part, marqué perso, et compte dans le poids toujours chargé', () => {
  const c = cartePerso(fixture);
  const claude = c.toujours.find((n) => n.chemin === join(fixtureHome, 'CLAUDE.md'));
  assert.equal(claude.perso, true);
  assert.equal(c.toujours.find((n) => n.chemin === 'CLAUDE.md').perso, false);
  const ton = c.regles.find((r) => r.chemin === join(fixtureHome, 'rules', 'ton.md'));
  assert.deepEqual([ton.perso, ton.paths], [true, []]);
  assert.equal(c.regles.find((r) => r.chemin === '.claude/rules/style.md').perso, false);
  assert.equal(c.skills.find((s) => s.nom === 'brouillon').perso, true);
  assert.ok(c.gardeFous.some((g) => g.perso && g.quoi === 'Bash(rm -rf *)'));
  const seul = carte(fixture);
  assert.equal(c.poidsToujours.total, seul.poidsToujours.total + c.poidsToujours.perso);
  assert.ok(c.poidsToujours.perso > 0);
  const texte = lancer(fixture, [], fixtureHome);
  const toujours = texte.split('TOUJOURS CHARGÉ')[1].split('\n\n')[0];
  assert.match(toujours, /dont ~\d+ perso/);
  assert.ok(toujours.indexOf('perso —') < toujours.indexOf('fixture-home/CLAUDE.md'), 'le perso vient après, sous sa marque');
});

test('--sans-perso montre le projet seul', () => {
  const c = cartePerso(fixture, '--sans-perso');
  assert.equal(c.racinePerso, null);
  assert.deepEqual(c, { ...carte(fixture), racinePerso: null });
});

test('une règle perso à paths vise les fichiers du projet ; si elle ne vise rien ici, elle sert ailleurs', () => {
  const c = cartePerso(fixture, '--fichier', join(fixture, 'src', 'api', 'commandes.ts'));
  assert.deepEqual(c.pourFichier.regles, ['.claude/rules/api.md', join(fixtureHome, 'rules', 'api-perso.md')]);
  const python = c.regles.find((r) => r.chemin.endsWith('python.md'));
  assert.deepEqual(python.cibles, []);
  assert.ok(!c.avertissements.some((a) => a.ou.endsWith('python.md')));
});

test('un défaut du calque perso est signalé avec son chemin complet', () => {
  const c = cartePerso(fixture);
  assert.ok(avertissement(c, join(fixtureHome, 'agents', 'sans-description.md'), 'sans `description`'));
  assert.equal(c.avertissements.length, 6, JSON.stringify(c.avertissements));
});

test('la mémoire automatique du projet compte, ses 200 premières lignes seulement', () => {
  const perso = mkdtempSync(join(tmpdir(), 'carte-memoire-'));
  const dossier = join(perso, 'projects', fixture.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'MEMORY.md'), Array.from({ length: 250 }, (_, i) => `- fait ${i}`).join('\n'));
  const c = JSON.parse(lancer(fixture, ['--json'], perso));
  const memoire = c.toujours.find((n) => n.memoire);
  assert.deepEqual([memoire.perso, memoire.lignes], [true, 200]);
  writeFileSync(join(perso, 'settings.json'), '{ "autoMemoryEnabled": false }');
  assert.ok(!JSON.parse(lancer(fixture, ['--json'], perso)).toujours.some((n) => n.memoire));
});
