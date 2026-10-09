#!/usr/bin/env node
// La carte du contexte : chaque fichier que Claude Code peut charger, et QUAND.
//
//   node carte.mjs                 la carte entière, calque perso compris
//   node carte.mjs --fichier X     ce qui s'ajoute en touchant X
//   node carte.mjs --sans-perso    le projet seul, tel que git le partage
//   node carte.mjs --json          la même chose, pour un outil
//
// Sans dépendance. Les règles de chargement suivent la doc de Claude Code
// (code.claude.com/docs/en/memory, /skills, /sub-agents, /hooks, /settings).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute, sep, posix } from 'node:path';

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};
const RACINE = resolve(opt('--racine') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const FICHIER = opt('--fichier');
const JSON_SORTIE = args.includes('--json');
const SANS_PERSO = args.includes('--sans-perso');
const HOME = process.env.HOME ?? '';
// le calque utilisateur : ~/.claude, ou ce que désigne CLAUDE_CONFIG_DIR ; sans l'un ni l'autre, pas de calque
const DOSSIER_PERSO = process.env.CLAUDE_CONFIG_DIR || (HOME && join(HOME, '.claude'));
const PERSO = SANS_PERSO || !DOSSIER_PERSO ? null : resolve(DOSSIER_PERSO);

const LIMITE_RACINE = 80; // lignes conseillées pour CLAUDE.md avec ses imports
const LIMITE_SKILL = 500; // lignes conseillées pour SKILL.md
const LIMITE_DESCRIPTION = 1536; // caractères au-delà desquels la description est tronquée
const LIMITE_MEMOIRE = 200; // lignes de MEMORY.md que Claude Code charge au démarrage ; la suite reste sur disque
const CARACTERES_PAR_TOKEN = 2.5; // mesuré contre /context sur des fichiers en français ; l'anglais tourne autour de 3
const IGNORES = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);

// --- lecture -----------------------------------------------------------------

const posixRel = (abs, base = RACINE) => relative(base, abs).split(sep).join('/');
const lire = (abs) => readFileSync(abs, 'utf8');
const lignes = (texte) => texte.split('\n').length;
const tokens = (texte) => Math.round(texte.length / CARACTERES_PAR_TOKEN);

/** Le chemin tel qu'on l'affiche : relatif au projet, sinon complet, avec ~ pour le home. */
function affiche(abs) {
  const rel = relative(RACINE, abs);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  if (HOME && abs.startsWith(HOME + sep)) return '~/' + posixRel(abs, HOME);
  return abs.split(sep).join('/');
}

function fichiersDu(dir, base = RACINE, acc = []) {
  for (const nom of readdirSync(dir)) {
    if (IGNORES.has(nom)) continue;
    const abs = join(dir, nom);
    const st = statSync(abs);
    if (st.isDirectory()) fichiersDu(abs, base, acc);
    else acc.push(posixRel(abs, base));
  }
  return acc;
}
const TOUS = fichiersDu(RACINE);

/** Les deux calques de `.claude/` : celui du projet, partagé par git, et celui de l'utilisateur. */
const calques = [{ base: join(RACINE, '.claude'), perso: false, fichiers: TOUS.filter((f) => f.startsWith('.claude/')).map((f) => f.slice(8)) }];
if (PERSO && existsSync(PERSO) && PERSO !== join(RACINE, '.claude'))
  calques.push({
    base: PERSO,
    perso: true,
    // pas tout ~/.claude : seulement ce que Claude Code y lit comme contexte
    fichiers: ['rules', 'skills', 'agents', 'commands'].filter((d) => existsSync(join(PERSO, d))).flatMap((d) => fichiersDu(join(PERSO, d), PERSO)),
  });

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
    .map((m) => resolve(dirname(abs), m[1].replace(/^~(?=\/)/, HOME || '~')))
    .filter((p) => existsSync(p) && statSync(p).isFile());
}

const avertissements = [];
const avertir = (ou, quoi) => avertissements.push({ ou, quoi });

/** Les réglages, du plus prioritaire au moins : local du projet, projet, utilisateur. */
const reglages = [
  !SANS_PERSO && { abs: join(RACINE, '.claude', 'settings.local.json'), perso: true },
  { abs: join(RACINE, '.claude', 'settings.json'), perso: false },
  PERSO && { abs: join(PERSO, 'settings.json'), perso: true },
]
  .filter((r) => r && existsSync(r.abs))
  .map((r) => {
    try {
      return { ...r, json: JSON.parse(lire(r.abs)) };
    } catch (e) {
      avertir(affiche(r.abs), `JSON invalide : ${e.message} — le corriger, Claude Code ignore ce fichier`);
      return null;
    }
  })
  .filter(Boolean);

// --- 1. toujours chargé ----------------------------------------------------------

function instruction(abs, profondeur = 0, vus = new Set()) {
  vus.add(abs);
  const texte = lire(abs);
  const noeud = { chemin: affiche(abs), lignes: lignes(texte), tokens: tokens(texte), imports: [] };
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
const toujours = racineFichiers
  .filter((f) => !(SANS_PERSO && f === 'CLAUDE.local.md'))
  .map((f) => ({ ...instruction(join(RACINE, f), 0, vus), perso: f === 'CLAUDE.local.md' }));
if (racineClaude.length && existsSync(join(RACINE, 'AGENTS.md')) && !vus.has(join(RACINE, 'AGENTS.md')))
  avertir('AGENTS.md', "ignoré par Claude Code : un CLAUDE.md existe et ne l'importe pas — ajouter `@AGENTS.md` dans CLAUDE.md");
if (PERSO && existsSync(join(PERSO, 'CLAUDE.md'))) toujours.push({ ...instruction(join(PERSO, 'CLAUDE.md')), perso: true });
for (const n of toujours)
  if (lignesTotales(n) > LIMITE_RACINE)
    avertir(n.chemin, `${lignesTotales(n)} lignes avec ses imports (conseillé : < ${LIMITE_RACINE}) — déplacer vers une règle à paths ou une skill`);

// la mémoire automatique : l'index MEMORY.md du projet, tenu par Claude, propre à l'utilisateur
const memoireActive = reglages.find((r) => typeof r.json.autoMemoryEnabled === 'boolean')?.json.autoMemoryEnabled ?? true;
const memoire = PERSO && join(PERSO, 'projects', RACINE.replace(/[^a-zA-Z0-9]/g, '-'), 'memory', 'MEMORY.md');
if (memoire && memoireActive && !process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY && existsSync(memoire)) {
  const charge = lire(memoire).split('\n').slice(0, LIMITE_MEMOIRE).join('\n');
  toujours.push({ chemin: affiche(memoire), lignes: lignes(charge), tokens: tokens(charge), imports: [], perso: true, memoire: true });
}

// --- 2. règles ---------------------------------------------------------------------

const regles = calques.flatMap(({ base, perso, fichiers }) =>
  fichiers
    .filter((f) => /^rules\/.+\.md$/.test(f))
    .map((f) => {
      const chemin = affiche(join(base, f));
      const texte = lire(join(base, f));
      const { meta } = frontmatter(texte);
      const paths = liste(meta.paths);
      const cibles = paths.length ? TOUS.filter((x) => !x.startsWith('.claude/') && correspond(paths, x)) : [];
      // une règle perso qui ne vise rien ici sert sans doute un autre projet : ce n'est pas un défaut
      if (paths.length && cibles.length === 0 && !perso)
        avertir(chemin, `aucun fichier ne correspond à ${paths.join(', ')} : cette règle ne se chargera jamais — corriger le glob ou retirer \`paths\``);
      return { chemin, perso, paths, cibles, lignes: lignes(texte), tokens: tokens(texte) };
    }),
);

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
for (const { base, perso, fichiers } of calques)
  for (const f of fichiers) {
    const skillDir = f.match(/^skills\/([^/]+)\/SKILL\.md$/);
    const commande = f.match(/^commands\/(.+)\.md$/);
    if (!skillDir && !commande) continue;
    const abs = join(base, f);
    const chemin = affiche(abs);
    const { meta, corps } = frontmatter(lire(abs));
    const nom = meta.name || (skillDir ? skillDir[1] : commande[1].replace(/\//g, ':'));
    const description = [meta.description, meta.when_to_use].filter(Boolean).join(' ');
    const manuel = meta['disable-model-invocation'] === true;
    const cache = meta['user-invocable'] === false;
    const paths = liste(meta.paths);
    const dossier = posix.dirname(f);
    const annexes = skillDir ? fichiers.filter((x) => x.startsWith(dossier + '/') && x !== f).map((x) => x.slice(dossier.length + 1)) : [];

    if (!description && !manuel)
      avertir(chemin, 'sans description : Claude ne sait pas quand la charger — ajouter `description:` (quoi, et quand)');
    if (description.length > LIMITE_DESCRIPTION)
      avertir(chemin, `description de ${description.length} caractères, tronquée à ${LIMITE_DESCRIPTION} — la raccourcir, le détail va dans le corps`);
    if (lignes(corps) > LIMITE_SKILL) avertir(chemin, `${lignes(corps)} lignes (conseillé : < ${LIMITE_SKILL}) — déplacer le détail dans des fichiers voisins`);
    if (manuel && cache)
      avertir(chemin, 'ni Claude ni toi ne pouvez la lancer (disable-model-invocation + user-invocable: false) — retirer l\'un des deux');
    for (const [, lien] of corps.matchAll(/\]\(([^)#\s]+)\)/g))
      if (!/^[a-z]+:/.test(lien) && !existsSync(join(dirname(abs), lien)))
        avertir(chemin, `lien mort : ${lien} — corriger le chemin ou créer le fichier`);

    skills.push({
      chemin,
      perso,
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

const agents = calques.flatMap(({ base, perso, fichiers }) =>
  fichiers
    .filter((f) => /^agents\/.+\.md$/.test(f))
    .map((f) => {
      const chemin = affiche(join(base, f));
      const { meta } = frontmatter(lire(join(base, f)));
      if (!meta.name) avertir(chemin, 'sous-agent sans `name` — ajouter `name:` dans le frontmatter');
      if (!meta.description) avertir(chemin, 'sous-agent sans `description` : Claude ne sait pas quand déléguer — ajouter `description:`');
      const description = meta.description ?? '';
      return { chemin, perso, nom: meta.name ?? posix.basename(f, '.md'), description, outils: meta.tools ?? 'tous', modele: meta.model ?? 'inherit', tokens: tokens(description) };
    }),
);

// --- 6. garde-fous (settings) --------------------------------------------------------------

const gardeFous = [];
for (const { abs, perso, json: s } of [...reglages].reverse()) {
  const source = affiche(abs);
  const avant = gardeFous.length;
  for (const [evenement, groupes] of Object.entries(s.hooks ?? {}))
    for (const g of groupes)
      for (const h of g.hooks ?? [])
        gardeFous.push({ source, perso, genre: 'hook', quoi: `${evenement}${g.matcher ? ` [${g.matcher}]` : ''}`, detail: h.command ?? h.prompt ?? h.type });
  for (const d of s.permissions?.deny ?? []) gardeFous.push({ source, perso, genre: 'refus', quoi: d });
  for (const a of s.permissions?.ask ?? []) gardeFous.push({ source, perso, genre: 'demande', quoi: a });
  // un hook qui pointe vers un script absent ne fait rien — sans prévenir
  for (const g of gardeFous.slice(avant).filter((x) => x.genre === 'hook'))
    for (const script of scriptsDu(String(g.detail)))
      if (!existsSync(script.abs)) avertir(source, `hook ${g.quoi} : ${script.vu} n'existe pas — corriger le chemin ou retirer le hook`);
}

/** Les scripts qu'une commande de hook lance : sous $CLAUDE_PROJECT_DIR, ou par chemin absolu. */
function scriptsDu(commande) {
  const scripts = [];
  for (const [, rel] of commande.matchAll(/\$\{?CLAUDE_PROJECT_DIR\}?\/([^"'\s]+)/g))
    scripts.push({ vu: rel, abs: join(RACINE, rel) });
  for (const [, chemin] of commande.matchAll(/(?:^|[\s"'=])((?:~|\$\{?HOME\}?)?\/[^"'\s]*\.(?:m?js|cjs|ts|sh|py|rb))(?=$|[\s"'])/g))
    scripts.push({ vu: chemin, abs: chemin.replace(/^(?:~|\$\{?HOME\}?)(?=\/)/, HOME || '~') });
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
const somme = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const pesee = (garde) => {
  const instructions = somme(toujours.filter(garde), poids) + somme(regleToujours.filter(garde), (r) => r.tokens);
  const descSkills = somme(skillsVisibles.filter(garde), (k) => tokens(k.description));
  const descAgents = somme(agents.filter(garde), (a) => a.tokens);
  return { instructions, skills: descSkills, agents: descAgents, total: instructions + descSkills + descAgents };
};
const poidsToujours = { ...pesee(() => true), perso: pesee((x) => x.perso).total };

const carte = { racine: RACINE, racinePerso: PERSO, toujours, regles, dossiers, skills, agents, gardeFous, pourFichier, avertissements, poidsToujours };
if (JSON_SORTIE) {
  console.log(JSON.stringify(carte, null, 2));
  process.exit(0);
}

const couleur = process.stdout.isTTY && !process.env.NO_COLOR;
const ton = (code) => (s) => (couleur ? `\x1b[${code}m${s}\x1b[0m` : s);
const [gras, pale, jaune, vert, cyan] = [ton('1'), ton('2'), ton('33'), ton('32'), ton('36')];
const court = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const out = [];
const titre = (t, sous) => out.push('', gras(t) + (sous ? pale('  ' + sous) : ''));
/** Ce qui est partagé par git d'abord, puis le perso, à part et marqué. */
const rendre = (elements, ligne) => {
  elements.filter((x) => !x.perso).forEach(ligne);
  const perso = elements.filter((x) => x.perso);
  if (perso.length) {
    out.push(`  ${cyan('perso')} ${pale('— hors git, sur cette machine seulement')}`);
    perso.forEach(ligne);
  }
};

out.push(gras(`Carte du contexte — ${posix.basename(RACINE)}`) + pale(`   (1 token ≈ ${String(CARACTERES_PAR_TOKEN).replace('.', ',')} caractères, estimation)`));

titre(
  'TOUJOURS CHARGÉ',
  `~${poidsToujours.total} tokens à chaque session` + (poidsToujours.perso ? `, dont ~${poidsToujours.perso} perso` : '') + (SANS_PERSO ? ' (sans le perso)' : ''),
);
const arbre = (n, niveau = 0) => {
  const note = n.memoire ? `${n.lignes} lignes, mémoire automatique` : `${n.lignes} lignes`;
  out.push(`  ${'   '.repeat(niveau)}${niveau ? '└─ @' : ''}${n.chemin}  ${pale(note)}`);
  n.imports.forEach((i) => arbre(i, niveau + 1));
};
rendre([...toujours, ...regleToujours.map((r) => ({ ...r, regle: true }))], (x) =>
  x.regle ? out.push(`  ${x.chemin}  ${pale(`${x.lignes} lignes, règle sans paths`)}`) : arbre(x),
);
if (skillsVisibles.length) out.push(`  ${pale(`+ les descriptions de ${skillsVisibles.length} skill(s), ~${poidsToujours.skills} tokens`)}`);
if (agents.length) out.push(`  ${pale(`+ les descriptions de ${agents.length} sous-agent(s), ~${poidsToujours.agents} tokens`)}`);
if (!toujours.some((n) => !n.perso)) out.push(`  ${jaune('aucun CLAUDE.md ni AGENTS.md')}`);

titre('EN TOUCHANT UN FICHIER', 'lecture ou écriture qui correspond');
for (const d of dossiers)
  out.push(`  ${d.dossier.padEnd(24)} → ${d.fichiers.map((f) => f.chemin).join(', ')}  ${pale(`${d.fichiers.reduce((s, f) => s + f.lignes, 0)} lignes`)}`);
rendre(
  [...regles.filter((r) => r.paths.length), ...skills.filter((s) => s.paths.length).map((s) => ({ ...s, skill: true }))],
  (x) =>
    out.push(
      x.skill
        ? `  ${x.paths.join(', ').padEnd(24)} → skill ${x.nom} devient disponible`
        : `  ${x.paths.join(', ').padEnd(24)} → ${x.chemin}  ${pale(`${x.lignes} lignes, ${x.cibles.length} fichier(s) visé(s)`)}`,
    ),
);
if (!dossiers.length && !regles.some((r) => r.paths.length) && !skills.some((s) => s.paths.length)) out.push(pale('  (rien)'));

titre('QUAND LA TÂCHE EN PARLE', 'Claude lit la description et décide');
if (!skillsVisibles.length) out.push(pale('  (rien)'));
rendre(skillsVisibles, (s) => {
  const qui = s.mode === 'claude' ? 'Claude seul' : `Claude ou /${s.nom}`;
  const extra = [`corps ${s.corpsLignes} lignes`, s.annexes.length && `+ ${s.annexes.join(', ')}`, s.contexte].filter(Boolean).join(', ');
  out.push(`  ${gras(s.nom)} ${pale(`(${qui} ; ${extra})`)}`, `    « ${court(s.description)} »`);
});

const manuels = skills.filter((s) => s.mode === 'manuel');
if (manuels.length) {
  titre('À LA MAIN', 'seulement si tu tapes la commande');
  rendre(manuels, (s) => out.push(`  /${s.nom}  ${pale(court(s.description, 70))}`));
}

if (agents.length) {
  titre('SOUS-AGENTS', 'contexte séparé, Claude délègue sur la description');
  rendre(agents, (a) =>
    out.push(`  ${gras(a.nom)} ${pale(`(outils : ${a.outils} ; modèle : ${a.modele})`)}`, `    « ${court(a.description)} »`),
  );
}

if (gardeFous.length) {
  titre('HOOKS ET PERMISSIONS', 'exécutés par le client, quoi que décide Claude');
  rendre(gardeFous, (g) =>
    out.push(g.genre === 'hook' ? `  hook ${g.quoi}  ${pale(court(String(g.detail), 70))}` : `  ${g.genre} : ${g.quoi}`),
  );
}

if (pourFichier) {
  const p = pourFichier;
  titre(`EN TOUCHANT ${p.fichier}`, 'en plus de ce qui est toujours chargé');
  const estPerso = (chemin) => regles.find((r) => r.chemin === chemin)?.perso;
  const tout = [
    ...p.dossiers.map((d) => `instructions de ${d}`),
    ...p.regles.map((r) => (estPerso(r) ? `${r}  ${cyan('perso')}` : r)),
    ...p.skills.map((s) => `skill ${s} (disponible)`),
  ];
  out.push(...(tout.length ? tout.map((t) => `  ${vert('+')} ${t}`) : [pale('  rien de plus')]));
}

titre('À VÉRIFIER');
out.push(...(avertissements.length ? avertissements.map((a) => `  ${jaune('⚠')} ${a.ou} — ${a.quoi}`) : [`  ${vert('✓')} rien`]));
console.log(out.join('\n'));
