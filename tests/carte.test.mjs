// La carte, exercée sur tests/fixture : un faux projet avec un défaut de chaque sorte,
// et sur tests/fixture-home : un faux calque utilisateur (~/.claude).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
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

/**
 * Une copie de la fixture avec un journal fabriqué : `sessions` sessions, la plus vieille il y a `jours` jours,
 * la dernière il y a 2 h. Règles et skills datent d'il y a 60 jours : la copie, elle, les crée à l'instant.
 */
function avecJournal(jours, sessions) {
  const projet = mkdtempSync(join(tmpdir(), 'carte-journal-'));
  cpSync(fixture, projet, { recursive: true });
  const il_y_a_60_jours = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  for (const f of ['rules/api.md', 'rules/morte.md', 'rules/style.md', 'skills/domaine-commandes/SKILL.md', 'skills/muette/SKILL.md'])
    utimesSync(join(projet, '.claude', f), il_y_a_60_jours, il_y_a_60_jours);
  mkdirSync(join(projet, '.claude', 'contextree'));
  const lignes = [];
  for (let i = 0; i < sessions; i++) {
    const heures = i === sessions - 1 ? 2 : (jours - (i * jours) / sessions) * 24;
    const quand = new Date(Date.now() - heures * 3600 * 1000).toISOString();
    const session = `s${i}`;
    lignes.push(
      { quand, session, fichier: 'CLAUDE.md', genre: 'instruction', raison: 'session_start', declencheur: null },
      { quand, session, fichier: 'AGENTS.md', genre: 'instruction', raison: 'include', declencheur: 'CLAUDE.md' },
      { quand, session, fichier: '.claude/rules/style.md', genre: 'instruction', raison: 'session_start', declencheur: null },
    );
  }
  lignes.push({ quand: new Date().toISOString(), session: 'x', fichier: null, genre: 'skill', nom: 'muette', raison: 'commande', declencheur: null });
  writeFileSync(join(projet, '.claude', 'contextree', 'journal.jsonl'), lignes.map((l) => JSON.stringify(l) + '\n').join('') + 'ligne abîmée\n');
  return projet;
}

test('avec un journal, chaque fichier dit combien de fois il a vraiment été chargé, et quand', () => {
  const projet = avecJournal(20, 5);
  const c = carte(projet);
  assert.equal(c.journal.sessions, 6);
  assert.deepEqual([c.toujours[0].charges.fois, c.toujours[0].imports[0].charges.fois], [5, 5]);
  assert.deepEqual(c.regles.find((r) => r.chemin === '.claude/rules/api.md').charges, { fois: 0, dernier: null });
  assert.equal(c.skills.find((s) => s.nom === 'muette').charges.fois, 1);
  const texte = lancer(projet, []);
  assert.match(texte, /^ {2}CLAUDE\.md {2}\d+ lignes, chargé 5 fois, dernier il y a 2 h$/m);
  assert.match(texte, /\.claude\/rules\/api\.md {2}.*, jamais chargé$/m);
  assert.match(texte, /Chargements réels : journal de 20 jour\(s\), 6 session\(s\)/);
  // le journal est propre à la machine : --sans-perso ne le lit pas
  const seul = carte(projet, '--sans-perso');
  assert.equal(seul.journal, null);
  assert.ok(!('charges' in seul.regles[0]));
});

test('avec --fichier, pourFichier.charges ne compte que ce que ce fichier a déclenché', () => {
  const projet = avecJournal(20, 5);
  const quand = new Date().toISOString();
  const ligne = (fichier, declencheur) => JSON.stringify({ quand, session: 'z', fichier, genre: 'instruction', raison: 'path_glob_match', declencheur });
  const journal = join(projet, '.claude', 'contextree', 'journal.jsonl');
  writeFileSync(journal, readFileSync(journal, 'utf8') + ligne('.claude/rules/api.md', 'src/api/commandes.ts') + '\n' + ligne('.claude/rules/api.md', 'src/api/autre.ts') + '\n');
  const pour = carte(projet, '--fichier', join(projet, 'src', 'api', 'commandes.ts')).pourFichier;
  assert.deepEqual(pour.charges, { '.claude/rules/api.md': { fois: 1, dernier: quand } });
  assert.match(lancer(projet, ['--fichier', join(projet, 'web', 'Panier.tsx')]), /\+ instructions de web\/ {2}se chargerait$/m);
  // sans journal, ou sans le perso, le champ n'existe pas : rien à dire
  assert.ok(!('charges' in carte(fixture, '--fichier', join(fixture, 'src', 'api', 'commandes.ts')).pourFichier));
  assert.ok(!('charges' in carte(projet, '--sans-perso', '--fichier', join(projet, 'src', 'api', 'commandes.ts')).pourFichier));
});

test('une règle à paths ou une skill jamais chargée en deux semaines et cinq sessions est signalée', () => {
  const c = carte(avecJournal(20, 5));
  assert.ok(avertissement(c, '.claude/rules/api.md', 'jamais chargée en 20 jours (6 sessions) : les `paths`'));
  assert.ok(avertissement(c, '.claude/skills/domaine-commandes/SKILL.md', 'jamais chargée en 20 jours (6 sessions) : la description'));
  // morte.md ne vise rien, muette n'a pas de description : déjà signalées, pas deux fois
  assert.equal(c.avertissements.length, 7, JSON.stringify(c.avertissements));
  for (const a of c.avertissements) assert.match(a.quoi, / — \S/, `${a.ou} ne dit pas quoi faire`);
  // le perso sert peut-être ailleurs : jamais chargé ici n'est pas un défaut
  assert.ok(!cartePerso(avecJournal(20, 5)).avertissements.some((a) => a.ou.startsWith(fixtureHome) && a.quoi.includes('jamais chargée')));
});

test('un journal trop court ne juge rien : moins de 14 jours, ou moins de 5 sessions', () => {
  for (const [jours, sessions] of [[13, 8], [30, 3]]) {
    const c = carte(avecJournal(jours, sessions));
    assert.ok(!c.avertissements.some((a) => a.quoi.includes('jamais chargée')), `${jours} jours, ${sessions} sessions`);
  }
});

test('une règle modifiée depuis peu n’a rien raté : on ne compte que depuis sa dernière modification', () => {
  const projet = avecJournal(20, 5);
  const hier = new Date(Date.now() - 24 * 3600 * 1000);
  utimesSync(join(projet, '.claude', 'rules', 'api.md'), hier, hier);
  const c = carte(projet);
  assert.ok(!c.avertissements.some((a) => a.ou === '.claude/rules/api.md' && a.quoi.includes('jamais chargée')));
  assert.ok(avertissement(c, '.claude/skills/domaine-commandes/SKILL.md', 'jamais chargée'));
});

test('ce que le hook ne voit pas ne se dit pas « jamais chargé » : la mémoire automatique, un AGENTS.md lu sans import', () => {
  const projet = avecJournal(20, 5);
  const perso = mkdtempSync(join(tmpdir(), 'carte-memoire-'));
  const memoire = join(perso, 'projects', projet.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
  mkdirSync(memoire, { recursive: true });
  writeFileSync(join(memoire, 'MEMORY.md'), '- un fait\n');
  const c = JSON.parse(lancer(projet, ['--json'], perso));
  assert.ok(!('charges' in c.toujours.find((n) => n.memoire)));
  assert.match(lancer(projet, [], perso), /MEMORY\.md {2}\d+ lignes, mémoire automatique$/m);
  // sans CLAUDE.md, AGENTS.md est lu directement : InstructionsLoaded ne part pas
  const seul = mkdtempSync(join(tmpdir(), 'carte-agents-'));
  writeFileSync(join(seul, 'AGENTS.md'), '# Projet\n');
  mkdirSync(join(seul, '.claude', 'contextree'), { recursive: true });
  writeFileSync(join(seul, '.claude', 'contextree', 'journal.jsonl'), JSON.stringify({ quand: new Date().toISOString(), session: 's', fichier: 'x.md', genre: 'instruction' }) + '\n');
  assert.ok(!('charges' in carte(seul).toujours[0]));
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
  // le dépôt tel que git le partage : le journal et le calque local de la machine qui lance les tests n'y sont pas
  const c = carte(depot, '--sans-perso');
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
