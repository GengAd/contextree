// La vue : arbre.js transforme `carte --json` en nœuds, et empaqueter.mjs produit le .vsix.
// La partie vscode (extension.js) n'a pas de logique : elle ne se teste pas ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const depot = join(ici, '..');
const script = join(depot, 'plugin', 'skills', 'carte', 'scripts', 'carte.mjs');
const fixture = join(ici, 'fixture');
const fixtureHome = join(ici, 'fixture-home');
const { arbre, absolu, aRafraichir, problemes } = createRequire(import.meta.url)(join(depot, 'extension', 'arbre.js'));

const vide = mkdtempSync(join(tmpdir(), 'vue-home-'));
const lancer = (racine, args) =>
  execFileSync('node', [script, '--racine', racine, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: vide, CLAUDE_CONFIG_DIR: fixtureHome, NO_COLOR: '1' },
  });
const vue = () => arbre(JSON.parse(lancer(fixture, ['--json'])), vide);
const tous = (noeuds) => noeuds.flatMap((n) => [n, ...tous(n.enfants)]);

test('les sections de la vue sont celles de la carte texte, dans le même ordre', () => {
  const texte = lancer(fixture, []);
  const titres = [...texte.matchAll(/^([A-ZÀ-Ý][A-ZÀ-Ý -]+?)(?:  |$)/gm)].map((m) => m[1]);
  assert.deepEqual(vue().map((s) => s.label), titres);
});

test('chaque ligne de la vue est une ligne de la carte texte', () => {
  const texte = lancer(fixture, []);
  for (const n of tous(vue()).filter((n) => n.icone !== 'info' && n.icone !== 'account'))
    assert.ok(texte.includes(n.label.replace(/^@/, '')), `« ${n.label} » n'est pas dans la carte texte`);
});

test('un clic ouvre un fichier qui existe, perso compris', () => {
  const cliquables = tous(vue()).filter((n) => n.fichier);
  assert.ok(cliquables.length > 10);
  for (const n of cliquables) assert.ok(existsSync(n.fichier), `${n.label} → ${n.fichier}`);
});

test('le perso est un sous-groupe grisé dans chaque section qui en a', () => {
  const sections = vue();
  const toujours = sections.find((s) => s.label === 'TOUJOURS CHARGÉ');
  const groupe = toujours.enfants.find((n) => n.label === 'perso — hors git');
  assert.ok(groupe.perso);
  assert.ok(groupe.enfants.length && groupe.enfants.every((n) => n.perso));
  assert.match(toujours.description, /dont ~\d+ perso/);
  assert.ok(!toujours.enfants.filter((n) => n !== groupe).some((n) => n.perso));
});

test('chaque avertissement est un nœud sous À VÉRIFIER, qui ouvre son fichier', () => {
  const carte = JSON.parse(lancer(fixture, ['--json']));
  const verifier = arbre(carte, vide).find((s) => s.label === 'À VÉRIFIER');
  assert.equal(verifier.enfants.length, carte.avertissements.length);
  assert.ok(verifier.enfants.every((n) => n.icone === 'warning' && n.fichier));
});

test('la carte d’un plugin installé plus ancien s’affiche quand même, et dit de le mettre à jour', () => {
  const carte = JSON.parse(lancer(fixture, ['--json', '--sans-perso']));
  delete carte.poidsToujours;
  delete carte.racinePerso;
  const sections = arbre(carte, vide);
  assert.match(sections[0].description, /mettre à jour le plugin/);
  const pour = arbre({ ...carte, pourFichier: { fichier: 'x.ts' } }, vide)[0];
  assert.deepEqual([pour.label, pour.enfants[0].label], ['POUR CE FICHIER', 'rien de plus']);
  assert.equal(sections.at(-1).enfants.length, carte.avertissements.length);
});

test('POUR CE FICHIER vient en tête et dit ce que la carte texte ajoute pour le fichier actif', () => {
  const fichier = join(fixture, 'src', 'api', 'commandes.ts');
  const sections = arbre(JSON.parse(lancer(fixture, ['--json', '--fichier', fichier])), vide);
  const pour = sections[0];
  assert.deepEqual([pour.label, pour.description], ['POUR CE FICHIER', 'src/api/commandes.ts']);
  assert.equal(pour.enfants[0].label, '.claude/rules/api.md');
  const perso = pour.enfants.find((n) => n.label === 'perso — hors git');
  assert.deepEqual(perso.enfants.map((n) => n.fichier), [join(fixtureHome, 'rules', 'api-perso.md')]);
  const texte = lancer(fixture, ['--fichier', fichier]).split('EN TOUCHANT src/api/commandes.ts')[1];
  for (const n of tous(pour.enfants).filter((n) => n.icone !== 'account')) assert.ok(texte.includes(`+ ${n.label}`), n.label);

  const web = arbre(JSON.parse(lancer(fixture, ['--json', '--fichier', join(fixture, 'web', 'Panier.tsx')])), vide)[0];
  assert.deepEqual(web.enfants.map((n) => [n.label, n.fichier]), [['instructions de web/', join(fixture, 'web', 'CLAUDE.md')]]);
  assert.ok(!vue().some((s) => s.label === 'POUR CE FICHIER'), 'sans fichier actif, pas de section');
});

test('chaque avertissement va dans Problèmes, sur un fichier qui existe, avec sa correction', () => {
  const carte = JSON.parse(lancer(fixture, ['--json']));
  const liste = problemes(carte, vide);
  assert.equal(liste.length, carte.avertissements.length);
  for (const p of liste) {
    assert.ok(existsSync(p.fichier), p.fichier);
    assert.match(p.message, / — \S/);
  }
});

test('« Demander à Claude » a un prompt prêt pour chaque avertissement et chaque fichier', () => {
  const noeuds = tous(vue());
  const avertissements = noeuds.filter((n) => n.icone === 'warning' && n.fichier);
  assert.ok(avertissements.length);
  for (const n of avertissements) assert.equal(n.invite, `Corrige cet avertissement de /contextree:carte : ${n.label} — ${n.description}`);
  const regle = noeuds.find((n) => n.label === '.claude/rules/api.md');
  assert.match(regle.invite, /^Relis le fichier de contexte \.claude\/rules\/api\.md : /);
  const perso = noeuds.find((n) => n.fichier === join(fixtureHome, 'CLAUDE.md'));
  assert.ok(perso.invite.includes(join(fixtureHome, 'CLAUDE.md')), 'un fichier hors du projet garde son chemin complet');
  assert.ok(noeuds.filter((n) => n.fichier).every((n) => n.invite));
});

test('extension.js tourne avec un faux vscode : la vue, Problèmes et « Demander à Claude » sur la fixture', () => {
  const sortie = execFileSync('node', [join(depot, 'extension', 'fumee.cjs'), fixture, join(fixture, 'src', 'api', 'commandes.ts')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: vide, CLAUDE_CONFIG_DIR: fixtureHome },
  });
  assert.match(sortie, /^POUR CE FICHIER {2}· {2}src\/api\/commandes\.ts\n {2}\.claude\/rules\/api\.md/);
  const problemes = sortie.split('PROBLÈMES\n')[1].split('\n\n')[0].split('\n');
  assert.equal(problemes.length, 6, sortie);
  assert.ok(problemes.some((l) => l.startsWith('  .claude/rules/morte.md — aucun fichier ne correspond')));
  assert.match(sortie, /DEMANDER À CLAUDE\n {2}Corrige cet avertissement de \/contextree:carte : \.claude\/rules\/morte\.md — /);
});

test('les chemins de la carte deviennent absolus : projet, ~/ ou déjà complets', () => {
  assert.equal(absolu('CLAUDE.md', '/p', '/h'), join('/p', 'CLAUDE.md'));
  assert.equal(absolu('~/.claude/CLAUDE.md', '/p', '/h'), join('/h', '.claude', 'CLAUDE.md'));
  assert.equal(absolu('/ailleurs/x.md', '/p', '/h'), '/ailleurs/x.md');
});

test('une sauvegarde rafraîchit la vue seulement si elle touche le contexte', () => {
  const r = (f) => aRafraichir(f, '/p', '/h', null);
  assert.ok(r('/p/CLAUDE.md'));
  assert.ok(r('/p/web/AGENTS.md'));
  assert.ok(r('/p/.claude/rules/api.md'));
  assert.ok(r('/p/plugin/skills/carte/scripts/carte.mjs'));
  assert.ok(r('/h/.claude/CLAUDE.md'));
  assert.ok(!r('/p/src/api/commandes.ts'));
  assert.ok(!r('/autre/CLAUDE.md'));
  assert.ok(aRafraichir('/conf/rules/x.md', '/p', '/h', '/conf'));
});

test('le .vsix est un zip qui contient le manifeste et les fichiers de l’extension', () => {
  const sortie = join(mkdtempSync(join(tmpdir(), 'vsix-')), 'contextree.vsix');
  execFileSync('node', [join(depot, 'extension', 'empaqueter.mjs'), '--sortie', sortie]);
  const zip = readFileSync(sortie);
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const entrees = {};
  for (let k = 0; k < total; k++) {
    const nom = zip.toString('utf8', p + 46, p + 46 + zip.readUInt16LE(p + 28));
    const local = zip.readUInt32LE(p + 42);
    const debut = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entrees[nom] = inflateRawSync(zip.subarray(debut, debut + zip.readUInt32LE(p + 20)));
    p += 46 + nom.length + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  assert.deepEqual(Object.keys(entrees), [
    '[Content_Types].xml',
    'extension.vsixmanifest',
    'extension/package.json',
    'extension/extension.js',
    'extension/arbre.js',
    'extension/README.md',
  ]);
  assert.equal(entrees['extension/arbre.js'].toString(), readFileSync(join(depot, 'extension', 'arbre.js'), 'utf8'));
  assert.match(entrees['extension.vsixmanifest'].toString(), /Id="contextree" Version="2\.0\.0" Publisher="gengad"/);
});
