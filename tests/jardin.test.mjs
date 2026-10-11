// Le jardin, exercé sur une copie de tests/fixture mise sous git, avec des commits datés à la main.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ici = dirname(fileURLToPath(import.meta.url));
const script = join(ici, '..', 'plugin', 'skills', 'jardin', 'scripts', 'jardin.mjs');
const fixture = join(ici, 'fixture');
const projet = mkdtempSync(join(tmpdir(), 'jardin-'));
const IL_Y_A_10_SEMAINES = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();

const git = (date, ...a) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], {
    cwd: projet,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
const jardin = (racine, ...args) => JSON.parse(execFileSync('node', [script, '--racine', racine, ...args], { encoding: 'utf8' }));
let ancien;

before(() => {
  cpSync(fixture, projet, { recursive: true });
  // la règle API cite le fichier de code que la session va changer
  appendFileSync(join(projet, '.claude', 'rules', 'api.md'), '- Exemple : `src/api/commandes.ts`.\n');
  // et une règle qui cite un autre fichier dont le nom finit pareil : ce n'est pas une citation
  appendFileSync(join(projet, '.claude', 'rules', 'style.md'), '- Voir `vieux/src/api/commandes.ts.bak`.\n');
  git(IL_Y_A_10_SEMAINES, 'init', '-q');
  git(IL_Y_A_10_SEMAINES, 'add', '-A');
  git(IL_Y_A_10_SEMAINES, 'commit', '-qm', 'il y a dix semaines');
  ancien = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projet, encoding: 'utf8' }).trim();
  // la session : le code change, et un fichier de contexte est retouché aujourd'hui
  const maintenant = new Date().toISOString();
  appendFileSync(join(projet, 'src', 'api', 'commandes.ts'), '// changé dans la session\n');
  appendFileSync(join(projet, 'web', 'CLAUDE.md'), '- Relu aujourd’hui.\n');
  git(maintenant, 'commit', '-qam', 'la session');
});

test('un fichier de contexte sans commit depuis six semaines est à relire ; un fichier retouché ne l’est pas', () => {
  const j = jardin(projet);
  const vieux = Object.fromEntries(j.vieux.map((v) => [v.chemin, v.semaines]));
  assert.ok(vieux['CLAUDE.md'] >= 9 && vieux['CLAUDE.md'] <= 10, JSON.stringify(j.vieux));
  assert.ok('.claude/rules/style.md' in vieux);
  assert.ok('.claude/skills/domaine-commandes/statuts.md' in vieux, 'les fichiers voisins d’une skill comptent');
  assert.ok(!('web/CLAUDE.md' in vieux), 'retouché dans la session');
  assert.ok(j.contexte.includes('web/CLAUDE.md'));
});

test('le seuil se règle en semaines', () => {
  assert.deepEqual(jardin(projet, '--semaines', '11').vieux, []);
});

test('la session liste ses commits et ses changements, depuis une durée ou une référence git', () => {
  const parDuree = jardin(projet, '--depuis', '1 day ago').session;
  assert.deepEqual(parDuree.commits.map((c) => c.sujet), ['la session']);
  const parRef = jardin(projet, '--depuis', ancien).session;
  assert.deepEqual(parRef.commits.map((c) => c.sujet), ['la session']);
  for (const s of [parDuree, parRef])
    assert.deepEqual(s.changements.map((c) => c.chemin).sort(), ['src/api/commandes.ts', 'web/CLAUDE.md']);
});

test('un fichier de contexte qui cite un chemin changé dans la session est signalé', () => {
  const j = jardin(projet);
  assert.deepEqual(j.cites, [{ contexte: '.claude/rules/api.md', cite: 'src/api/commandes.ts', par: 'texte', statut: 'M' }]);
});

test('une règle dont les paths visent un fichier changé, ou le CLAUDE.md de son dossier, est signalé aussi', () => {
  writeFileSync(join(projet, 'src', 'api', 'remboursement.ts'), '// nouveau\n');
  writeFileSync(join(projet, 'web', 'Paiement.tsx'), '// nouveau\n');
  try {
    const cites = jardin(projet).cites.filter((c) => c.par !== 'texte');
    assert.deepEqual(cites, [
      { contexte: '.claude/rules/api.md', cite: 'src/api/remboursement.ts', par: 'paths', statut: 'A' },
      { contexte: 'web/CLAUDE.md', cite: 'web/Paiement.tsx', par: 'dossier', statut: 'A' },
    ]);
  } finally {
    rmSync(join(projet, 'src', 'api', 'remboursement.ts'));
    rmSync(join(projet, 'web', 'Paiement.tsx'));
  }
});

test('un fichier non commité compte dans la session, pas dans les vieux', () => {
  appendFileSync(join(projet, '.claude', 'rules', 'nouvelle.md'), '# Nouvelle\n');
  try {
    const j = jardin(projet);
    assert.ok(j.session.changements.some((c) => c.chemin === '.claude/rules/nouvelle.md' && c.statut === 'A'));
    assert.ok(!j.vieux.some((v) => v.chemin === '.claude/rules/nouvelle.md'));
  } finally {
    rmSync(join(projet, '.claude', 'rules', 'nouvelle.md'));
  }
});

test('un projet dans un sous-dossier du dépôt voit ses chemins relatifs à lui-même', () => {
  const depot = mkdtempSync(join(tmpdir(), 'jardin-depot-'));
  const sous = join(depot, 'appli');
  mkdirSync(sous);
  writeFileSync(join(sous, 'CLAUDE.md'), '# Appli\n\nLe point d’entrée est `serveur.js`.\n');
  writeFileSync(join(sous, 'serveur.js'), '// v1\n');
  const g = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: depot, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q');
  g('add', '-A');
  g('commit', '-qm', 'début');
  writeFileSync(join(sous, 'serveur.js'), '// v2\n');
  writeFileSync(join(sous, 'été à faire.md'), 'non suivi\n');
  const j = jardin(sous, '--depuis', 'HEAD');
  assert.deepEqual(j.session.changements.map((c) => c.chemin).sort(), ['serveur.js', 'été à faire.md']);
  assert.deepEqual(j.cites, [{ contexte: 'CLAUDE.md', cite: 'serveur.js', par: 'texte', statut: 'M' }]);
});

test('une référence ou une durée inconnue est dite, avec la correction', () => {
  const j = jardin(projet, '--depuis', 'brnache-inconnue');
  assert.match(j.session.erreur, /ni une référence git ni une durée/);
});

test('hors d’un dépôt git, le jardin rend la carte sans session', () => {
  const nu = mkdtempSync(join(tmpdir(), 'jardin-nu-'));
  cpSync(fixture, nu, { recursive: true });
  const j = jardin(nu);
  assert.deepEqual([j.git, j.session, j.vieux, j.cites], [false, null, [], []]);
  assert.ok(j.avertissements.length > 0);
});

// --- le jardin se propose seul : --bref, --hook et la marque du dernier jardin ---------------------

const brut = (...args) => execFileSync('node', [script, '--racine', projet, ...args], { encoding: 'utf8' });
const marque = join(projet, '.claude', 'contextree', 'jardin.dernier');
const il_y_a = (jours) => new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString();
/** Une marque posée à la main le temps d'un test, puis retirée : les autres tests partent sans marque. */
const avecMarque = (iso, f) => {
  mkdirSync(join(projet, '.claude', 'contextree'), { recursive: true });
  writeFileSync(marque, iso + '\n');
  try {
    return f();
  } finally {
    rmSync(join(projet, '.claude', 'contextree'), { recursive: true });
  }
};

test('--bref dit en une ligne quels fichiers de contexte parlent de code modifié ; rien s’il n’y a rien', () => {
  assert.match(brut('--bref'), /^1 fichier\(s\) de contexte parlent de code modifié depuis les 12 dernières heures \(`\.claude\/rules\/api\.md`\)\.\n$/);
  assert.equal(brut('--bref', '--depuis', 'HEAD'), '\n');
});

test('après --marquer, la session part du dernier jardin, et il n’y a plus rien à dire', () => {
  const sortie = brut('--marquer');
  try {
    assert.match(sortie, /^jardin marqué : \d{4}-/);
    assert.equal(readFileSync(join(projet, '.claude', 'contextree', '.gitignore'), 'utf8'), '*\n');
    assert.equal(brut('--bref'), '\n');
    assert.deepEqual(jardin(projet).session.commits, []);
  } finally {
    rmSync(join(projet, '.claude', 'contextree'), { recursive: true });
  }
});

test('une marque de plus de 30 jours ne remonte pas plus loin que 30 jours', () => {
  avecMarque(il_y_a(80), () => {
    const j = jardin(projet);
    assert.equal(j.marque.slice(0, 10), il_y_a(80).slice(0, 10));
    assert.deepEqual(j.session.commits.map((c) => c.sujet), ['la session'], 'le commit d’il y a dix semaines reste hors de la session');
    // les fichiers devenus vieux dans ces 30 jours sont à relire ; en bref, eux seuls
    assert.match(brut('--bref'), /depuis les 30 derniers jours .* ; \d+ fichier\(s\) de contexte n'ont pas bougé depuis 6 semaines/);
  });
  avecMarque(il_y_a(1), () => assert.deepEqual(jardin(projet).session.commits.map((c) => c.sujet), ['la session']));
});

test('--hook rend le JSON de SessionStart, ou rien du tout, et ne sort jamais en erreur', () => {
  const hook = (env = {}) => spawnSync('node', [script, '--bref', '--hook'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projet, ...env } });
  const r = hook();
  assert.equal(r.status, 0);
  const { hookSpecificOutput } = JSON.parse(r.stdout);
  assert.equal(hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(hookSpecificOutput.additionalContext, /^contextree : 1 fichier\(s\) .*`\.claude\/rules\/api\.md`.* À la fin de ta réponse qui termine la première tâche de l'utilisateur, propose-lui en une phrase de lancer `\/contextree:jardin` pour les relire ; une seule fois dans la session\.$/);
  avecMarque(new Date().toISOString(), () => assert.deepEqual([hook().status, hook().stdout], [0, '']));
  const ailleurs = hook({ CLAUDE_PROJECT_DIR: join(projet, 'nexiste-pas') });
  assert.deepEqual([ailleurs.status, ailleurs.stdout, ailleurs.stderr], [0, '', '']);
});

test('du travail non commité d’avant le dernier jardin ne se repropose pas ; celui d’après, si', () => {
  const code = join(projet, 'src', 'api', 'commandes.ts');
  appendFileSync(code, '// pas encore commité\n');
  const avant = new Date(Date.now() - 60_000);
  utimesSync(code, avant, avant);
  try {
    avecMarque(new Date().toISOString(), () => {
      assert.equal(brut('--bref'), '\n');
      const apres = new Date(Date.now() + 60_000);
      utimesSync(code, apres, apres);
      assert.match(brut('--bref'), /depuis le dernier jardin \(`\.claude\/rules\/api\.md`\)/);
    });
  } finally {
    execFileSync('git', ['checkout', '--', 'src/api/commandes.ts'], { cwd: projet });
  }
});

test('la commande SessionStart de hooks.json est celle qui rend le JSON du jardin', () => {
  const plugin = join(ici, '..', 'plugin');
  const { hooks } = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  const [groupe] = hooks.SessionStart;
  assert.equal(groupe.matcher, 'startup|resume');
  const r = spawnSync('sh', ['-c', groupe.hooks[0].command], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_PROJECT_DIR: projet } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('--marquer garde un .gitignore déjà écrit', () => {
  mkdirSync(join(projet, '.claude', 'contextree'), { recursive: true });
  writeFileSync(join(projet, '.claude', 'contextree', '.gitignore'), '*\n# à moi\n');
  try {
    brut('--marquer');
    assert.equal(readFileSync(join(projet, '.claude', 'contextree', '.gitignore'), 'utf8'), '*\n# à moi\n');
  } finally {
    rmSync(join(projet, '.claude', 'contextree'), { recursive: true });
  }
});
