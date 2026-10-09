#!/usr/bin/env node
// La carte du contexte : chaque fichier que Claude Code peut charger, et QUAND.
//
//   node carte.mjs                 la carte entière
//   node carte.mjs --fichier X     ce qui s'ajoute en touchant X
//   node carte.mjs --json          la même chose, pour un outil
//
// Sans dépendance. Les règles de chargement suivent la doc de Claude Code
// (code.claude.com/docs/en/memory, /skills, /sub-agents, /hooks).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, posix } from 'node:path';

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};
const RACINE = resolve(opt('--racine') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const FICHIER = opt('--fichier');
const JSON_SORTIE = args.includes('--json');

const LIMITE_RACINE = 80; // lignes conseillées pour CLAUDE.md avec ses imports
const LIMITE_SKILL = 500; // lignes conseillées pour SKILL.md
const LIMITE_DESCRIPTION = 1536; // caractères au-delà desquels la description est tronquée
const CARACTERES_PAR_TOKEN = 2.5; // mesuré contre /context sur des fichiers en français ; l'anglais tourne autour de 3
const IGNORES = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);

// --- lecture -----------------------------------------------------------------

const posixRel = (abs) => relative(RACINE, abs).split(sep).join('/');
const lire = (abs) => readFileSync(abs, 'utf8');
const lignes = (texte) => texte.split('\n').length;
const tokens = (texte) => Math.round(texte.length / CARACTERES_PAR_TOKEN);

function fichiersDu(dir, acc = []) {
  for (const nom of readdirSync(dir)) {
    if (IGNORES.has(nom)) continue;
    const abs = join(dir, nom);
    const st = statSync(abs);
    if (st.isDirectory()) fichiersDu(abs, acc);
    else acc.push(posixRel(abs));
  }
  return acc;
}
const TOUS = fichiersDu(RACINE);

/** Frontmatter YAML, le sous-ensemble qu'emploient rules, skills et agents. */
function frontmatter(texte) {
  const m = texte.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, corps: texte };
  const meta = {};
  let cle = null;
  for (const ligne of m[1].split(/\r?\n/)) {
    const item = ligne.match(/^\s*-\s+(.*)$/);
    const kv = ligne.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      cle = kv[1];
      const v = kv[2].trim();
      meta[cle] = v === '' ? [] : /^[>|]-?$/.test(v) ? '' : valeur(v);
    } else if (item && cle && Array.isArray(meta[cle])) {
      meta[cle].push(sansGuillemets(item[1].trim()));
    } else if (cle && /^\s+\S/.test(ligne)) {
      const prec = Array.isArray(meta[cle]) ? '' : meta[cle];
      meta[cle] = (prec ? prec + ' ' : '') + ligne.trim();
    }
  }
  return { meta, corps: texte.slice(m[0].length) };
}
const sansGuillemets = (s) => s.replace(/^(['"])(.*)\1$/, '$2');
function valeur(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']'))
    return v.slice(1, -1).split(',').map((x) => sansGuillemets(x.trim())).filter(Boolean);
  return sansGuillemets(v);
}
const liste = (v) =>
  v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);

/** Glob → RegExp : `**`, `*`, `?`, `{a,b}`. */
function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const fin = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, fin).split(',').map(echappe).join('|') + ')';
      i = fin;
    } else re += echappe(c);
  }
  return new RegExp('^' + re + '$');
}
const echappe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
const correspond = (globs, chemin) => globs.some((g) => globRegex(g).test(chemin));

/** Les `@chemin` d'un fichier d'instructions, hors blocs et spans de code. */
function imports(abs) {
  const texte = lire(abs).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  return [...texte.matchAll(/(?:^|\s)@([^\s]+)/g)]
    .map((m) => resolve(dirname(abs), m[1].replace(/^~(?=\/)/, process.env.HOME ?? '~')))
    .filter((p) => existsSync(p) && statSync(p).isFile());
}

const avertissements = [];
const avertir = (ou, quoi) => avertissements.push({ ou, quoi });

// --- 1. toujours chargé ----------------------------------------------------------

function instruction(abs, profondeur = 0, vus = new Set()) {
  vus.add(abs);
  const texte = lire(abs);
  const noeud = { chemin: posixRel(abs), lignes: lignes(texte), tokens: tokens(texte), imports: [] };
  if (profondeur < 4)
    for (const imp of imports(abs)) if (!vus.has(imp)) noeud.imports.push(instruction(imp, profondeur + 1, vus));
  return noeud;
}
const poids = (n) => n.tokens + n.imports.reduce((s, i) => s + poids(i), 0);
const lignesTotales = (n) => n.lignes + n.imports.reduce((s, i) => s + lignesTotales(i), 0);

const CLAUDES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
const racineClaude = CLAUDES.filter((f) => existsSync(join(RACINE, f)));
const racineFichiers = racineClaude.length
  ? racineClaude
  : ['AGENTS.md', '.claude/AGENTS.md'].filter((f) => existsSync(join(RACINE, f)));
const vus = new Set();
const toujours = racineFichiers.map((f) => instruction(join(RACINE, f), 0, vus));
if (racineClaude.length && existsSync(join(RACINE, 'AGENTS.md')) && !vus.has(join(RACINE, 'AGENTS.md')))
  avertir('AGENTS.md', "ignoré par Claude Code : un CLAUDE.md existe et ne l'importe pas — ajouter `@AGENTS.md` dans CLAUDE.md");
for (const n of toujours)
  if (lignesTotales(n) > LIMITE_RACINE)
    avertir(n.chemin, `${lignesTotales(n)} lignes avec ses imports (conseillé : < ${LIMITE_RACINE}) — déplacer vers une règle à paths ou une skill`);

// --- 2. règles ---------------------------------------------------------------------

const regles = TOUS.filter((f) => f.startsWith('.claude/rules/') && f.endsWith('.md')).map((f) => {
  const texte = lire(join(RACINE, f));
  const { meta } = frontmatter(texte);
  const paths = liste(meta.paths);
  const cibles = paths.length ? TOUS.filter((x) => !x.startsWith('.claude/') && correspond(paths, x)) : [];
  if (paths.length && cibles.length === 0)
    avertir(f, `aucun fichier ne correspond à ${paths.join(', ')} : cette règle ne se chargera jamais — corriger le glob ou retirer \`paths\``);
  return { chemin: f, paths, cibles, lignes: lignes(texte), tokens: tokens(texte) };
});

// --- 3. instructions de sous-dossier (chargées en touchant le dossier) ---------------

const parDossier = new Map();
for (const f of TOUS) {
  const nom = posix.basename(f);
  const dir = posix.dirname(f);
  if (dir === '.' || dir === '.claude' || f.startsWith('.claude/')) continue;
  if (nom === 'CLAUDE.md' || nom === 'CLAUDE.local.md' || nom === 'AGENTS.md')
    (parDossier.get(dir) ?? parDossier.set(dir, []).get(dir)).push(nom);
}
const dossiers = [...parDossier].map(([dir, noms]) => {
  const charges = noms.some((n) => n.startsWith('CLAUDE')) ? noms.filter((n) => n !== 'AGENTS.md') : noms;
  return { dossier: dir + '/', fichiers: charges.map((n) => instruction(join(RACINE, dir, n))) };
});

// --- 4. skills -------------------------------------------------------------------------

const skills = [];
for (const f of TOUS) {
  const skillDir = f.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
  const commande = f.match(/^\.claude\/commands\/(.+)\.md$/);
  if (!skillDir && !commande) continue;
  const texte = lire(join(RACINE, f));
  const { meta, corps } = frontmatter(texte);
  const nom = meta.name || (skillDir ? skillDir[1] : commande[1].replace(/\//g, ':'));
  const description = [meta.description, meta.when_to_use].filter(Boolean).join(' ');
  const manuel = meta['disable-model-invocation'] === true;
  const cache = meta['user-invocable'] === false;
  const paths = liste(meta.paths);
  const dossier = posix.dirname(f);
  const annexes = skillDir ? TOUS.filter((x) => x.startsWith(dossier + '/') && x !== f).map((x) => x.slice(dossier.length + 1)) : [];

  if (!description && !manuel)
    avertir(f, 'sans description : Claude ne sait pas quand la charger — ajouter `description:` (quoi, et quand)');
  if (description.length > LIMITE_DESCRIPTION)
    avertir(f, `description de ${description.length} caractères, tronquée à ${LIMITE_DESCRIPTION} — la raccourcir, le détail va dans le corps`);
  if (lignes(corps) > LIMITE_SKILL) avertir(f, `${lignes(corps)} lignes (conseillé : < ${LIMITE_SKILL}) — déplacer le détail dans des fichiers voisins`);
  if (manuel && cache)
    avertir(f, 'ni Claude ni toi ne pouvez la lancer (disable-model-invocation + user-invocable: false) — retirer l\'un des deux');
  for (const [, lien] of corps.matchAll(/\]\(([^)#\s]+)\)/g))
    if (!/^[a-z]+:/.test(lien) && !existsSync(join(RACINE, dossier, lien)))
      avertir(f, `lien mort : ${lien} — corriger le chemin ou créer le fichier`);

  skills.push({
    chemin: f,
    nom,
    description,
    mode: manuel ? 'manuel' : cache ? 'claude' : 'les deux',
    paths,
    contexte: meta.context === 'fork' ? `sous-agent ${meta.agent ?? 'general-purpose'}` : null,
    corpsLignes: lignes(corps),
    annexes,
  });
}

// --- 5. sous-agents ----------------------------------------------------------------------

const agents = TOUS.filter((f) => /^\.claude\/agents\/.+\.md$/.test(f)).map((f) => {
  const { meta } = frontmatter(lire(join(RACINE, f)));
  if (!meta.name) avertir(f, 'sous-agent sans `name` — ajouter `name:` dans le frontmatter');
  if (!meta.description) avertir(f, 'sous-agent sans `description` : Claude ne sait pas quand déléguer — ajouter `description:`');
  const description = meta.description ?? '';
  return { chemin: f, nom: meta.name ?? posix.basename(f, '.md'), description, outils: meta.tools ?? 'tous', modele: meta.model ?? 'inherit', tokens: tokens(description) };
});

// --- 6. garde-fous (settings) --------------------------------------------------------------

const gardeFous = [];
for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
  const abs = join(RACINE, f);
  if (!existsSync(abs)) continue;
  let s;
  try {
    s = JSON.parse(lire(abs));
  } catch (e) {
    avertir(f, `JSON invalide : ${e.message}`);
    continue;
  }
  for (const [evenement, groupes] of Object.entries(s.hooks ?? {}))
    for (const g of groupes)
      for (const h of g.hooks ?? [])
        gardeFous.push({ source: f, genre: 'hook', quoi: `${evenement}${g.matcher ? ` [${g.matcher}]` : ''}`, detail: h.command ?? h.prompt ?? h.type });
  for (const d of s.permissions?.deny ?? []) gardeFous.push({ source: f, genre: 'refus', quoi: d });
  for (const a of s.permissions?.ask ?? []) gardeFous.push({ source: f, genre: 'demande', quoi: a });
  // un hook qui pointe vers un script absent ne fait rien — sans prévenir
  for (const g of gardeFous.filter((x) => x.genre === 'hook' && x.source === f))
    for (const script of scriptsDu(String(g.detail)))
      if (!existsSync(script.abs)) avertir(f, `hook ${g.quoi} : ${script.vu} n'existe pas — corriger le chemin ou retirer le hook`);
}

/** Les scripts qu'une commande de hook lance : sous $CLAUDE_PROJECT_DIR, ou par chemin absolu. */
function scriptsDu(commande) {
  const scripts = [];
  for (const [, rel] of commande.matchAll(/\$\{?CLAUDE_PROJECT_DIR\}?\/([^"'\s]+)/g))
    scripts.push({ vu: rel, abs: join(RACINE, rel) });
  const home = process.env.HOME ?? '~';
  for (const [, chemin] of commande.matchAll(/(?:^|[\s"'=])((?:~|\$\{?HOME\}?)?\/[^"'\s]*\.(?:m?js|cjs|ts|sh|py|rb))(?=$|[\s"'])/g))
    scripts.push({ vu: chemin, abs: chemin.replace(/^(?:~|\$\{?HOME\}?)(?=\/)/, home) });
  return scripts;
}

// --- 7. pour un fichier donné ---------------------------------------------------------------

let pourFichier = null;
if (FICHIER) {
  const cible = posixRel(resolve(FICHIER));
  pourFichier = {
    fichier: cible,
    dossiers: dossiers.filter((d) => cible.startsWith(d.dossier)).map((d) => d.dossier),
    regles: regles.filter((r) => r.paths.length && correspond(r.paths, cible)).map((r) => r.chemin),
    skills: skills.filter((s) => s.paths.length && correspond(s.paths, cible)).map((s) => s.nom),
  };
}

// --- sortie ----------------------------------------------------------------------------------

// ce que /context range sous Memory files, Skills et Custom agents, pour ce projet
const regleToujours = regles.filter((r) => !r.paths.length);
const skillsVisibles = skills.filter((s) => s.mode !== 'manuel');
const poidsToujours = {
  instructions: toujours.reduce((s, n) => s + poids(n), 0) + regleToujours.reduce((s, r) => s + r.tokens, 0),
  skills: skillsVisibles.reduce((s, k) => s + tokens(k.description), 0),
  agents: agents.reduce((s, a) => s + a.tokens, 0),
};
poidsToujours.total = poidsToujours.instructions + poidsToujours.skills + poidsToujours.agents;

const carte = { racine: RACINE, toujours, regles, dossiers, skills, agents, gardeFous, pourFichier, avertissements, poidsToujours };
if (JSON_SORTIE) {
  console.log(JSON.stringify(carte, null, 2));
  process.exit(0);
}

const couleur = process.stdout.isTTY && !process.env.NO_COLOR;
const ton = (code) => (s) => (couleur ? `\x1b[${code}m${s}\x1b[0m` : s);
const [gras, pale, jaune, vert] = [ton('1'), ton('2'), ton('33'), ton('32')];
const court = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const out = [];
const titre = (t, sous) => out.push('', gras(t) + (sous ? pale('  ' + sous) : ''));

out.push(gras(`Carte du contexte — ${posix.basename(RACINE)}`) + pale(`   (1 token ≈ ${String(CARACTERES_PAR_TOKEN).replace('.', ',')} caractères, estimation)`));

titre('TOUJOURS CHARGÉ', `~${poidsToujours.total} tokens à chaque session`);
const arbre = (n, niveau = 0) => {
  out.push(`  ${'   '.repeat(niveau)}${niveau ? '└─ @' : ''}${n.chemin}  ${pale(`${n.lignes} lignes`)}`);
  n.imports.forEach((i) => arbre(i, niveau + 1));
};
toujours.forEach((n) => arbre(n));
regleToujours.forEach((r) => out.push(`  ${r.chemin}  ${pale(`${r.lignes} lignes, règle sans paths`)}`));
if (skillsVisibles.length) out.push(`  ${pale(`+ les descriptions de ${skillsVisibles.length} skill(s), ~${poidsToujours.skills} tokens`)}`);
if (agents.length) out.push(`  ${pale(`+ les descriptions de ${agents.length} sous-agent(s), ~${poidsToujours.agents} tokens`)}`);
if (!toujours.length) out.push(`  ${jaune('aucun CLAUDE.md ni AGENTS.md')}`);

titre('EN TOUCHANT UN FICHIER', 'lecture ou écriture qui correspond');
for (const d of dossiers)
  out.push(`  ${d.dossier.padEnd(24)} → ${d.fichiers.map((f) => f.chemin).join(', ')}  ${pale(`${d.fichiers.reduce((s, f) => s + f.lignes, 0)} lignes`)}`);
for (const r of regles.filter((r) => r.paths.length))
  out.push(`  ${r.paths.join(', ').padEnd(24)} → ${r.chemin}  ${pale(`${r.lignes} lignes, ${r.cibles.length} fichier(s) visé(s)`)}`);
for (const s of skills.filter((s) => s.paths.length))
  out.push(`  ${s.paths.join(', ').padEnd(24)} → skill ${s.nom} devient disponible`);
if (!dossiers.length && !regles.some((r) => r.paths.length)) out.push(pale('  (rien)'));

titre('QUAND LA TÂCHE EN PARLE', 'Claude lit la description et décide');
if (!skillsVisibles.length) out.push(pale('  (rien)'));
for (const s of skillsVisibles) {
  const qui = s.mode === 'claude' ? 'Claude seul' : `Claude ou /${s.nom}`;
  const extra = [`corps ${s.corpsLignes} lignes`, s.annexes.length && `+ ${s.annexes.join(', ')}`, s.contexte].filter(Boolean).join(', ');
  out.push(`  ${gras(s.nom)} ${pale(`(${qui} ; ${extra})`)}`, `    « ${court(s.description)} »`);
}

const manuels = skills.filter((s) => s.mode === 'manuel');
if (manuels.length) {
  titre('À LA MAIN', 'seulement si tu tapes la commande');
  for (const s of manuels) out.push(`  /${s.nom}  ${pale(court(s.description, 70))}`);
}

if (agents.length) {
  titre('SOUS-AGENTS', 'contexte séparé, Claude délègue sur la description');
  for (const a of agents)
    out.push(`  ${gras(a.nom)} ${pale(`(outils : ${a.outils} ; modèle : ${a.modele})`)}`, `    « ${court(a.description)} »`);
}

if (gardeFous.length) {
  titre('HOOKS ET PERMISSIONS', 'exécutés par le client, quoi que décide Claude');
  for (const g of gardeFous)
    out.push(g.genre === 'hook' ? `  hook ${g.quoi}  ${pale(court(String(g.detail), 70))}` : `  ${g.genre} : ${g.quoi}`);
}

if (pourFichier) {
  const p = pourFichier;
  titre(`EN TOUCHANT ${p.fichier}`, 'en plus de ce qui est toujours chargé');
  const tout = [...p.dossiers.map((d) => `instructions de ${d}`), ...p.regles, ...p.skills.map((s) => `skill ${s} (disponible)`)];
  out.push(...(tout.length ? tout.map((t) => `  ${vert('+')} ${t}`) : [pale('  rien de plus')]));
}

titre('À VÉRIFIER');
out.push(...(avertissements.length ? avertissements.map((a) => `  ${jaune('⚠')} ${a.ou} — ${a.quoi}`) : [`  ${vert('✓')} rien`]));
console.log(out.join('\n'));
