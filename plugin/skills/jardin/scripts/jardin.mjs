#!/usr/bin/env node
// Le jardin : ce qu'une fin de session doit relire dans le contexte du projet. Rien n'est écrit ici ;
// la skill jardin en tire des propositions, appliquées sur accord.
//
//   node jardin.mjs                          la session : les 12 dernières heures, seuil de 6 semaines
//   node jardin.mjs --depuis "2 days ago"    ou une référence git : --depuis main~5
//   node jardin.mjs --semaines 8             un fichier de contexte plus vieux que ça est à relire
//   node jardin.mjs --racine X
//
// Sortie JSON. Sans dépendance : git et la carte (../../carte/scripts/carte.mjs), rien d'autre.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};
const RACINE = resolve(opt('--racine') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const DEPUIS = opt('--depuis') ?? '12 hours ago'; // une session de travail, à peu près
const SEMAINES = Number(opt('--semaines') ?? 6); // au-delà, un fichier de contexte a pu dériver du code
const CARTE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'carte', 'scripts', 'carte.mjs');
const SEMAINE = 7 * 24 * 3600 * 1000;
const ARBRE_VIDE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // l'arbre vide de git : la base d'un premier commit

const git = (...a) => {
  try {
    // quotePath=false : un chemin accentué ou avec espace sort tel quel, pas entre guillemets
    return execFileSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  } catch {
    return null;
  }
};
const lignes = (s) => (s ? s.split('\n').filter(Boolean) : []);

// --- les fichiers de contexte du projet, partagés par git, d'après la carte --------------------

const carte = JSON.parse(
  execFileSync(process.execPath, [CARTE, '--json', '--sans-perso', '--racine', RACINE], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
);
const contexte = new Set();
const instruction = (n) => {
  if (!isAbsolute(n.chemin) && !n.chemin.startsWith('~')) contexte.add(n.chemin);
  n.imports.forEach(instruction);
};
carte.toujours.forEach(instruction);
carte.dossiers.forEach((d) => d.fichiers.forEach(instruction));
carte.regles.forEach((r) => contexte.add(r.chemin));
for (const s of carte.skills) {
  contexte.add(s.chemin);
  for (const a of s.annexes) contexte.add(`${dirname(s.chemin)}/${a}`);
}
carte.agents.forEach((a) => contexte.add(a.chemin));

// --- la session : commits et changements depuis --depuis ---------------------------------------

const depot = git('rev-parse', '--is-inside-work-tree') === 'true';
let session = null;
if (depot) {
  const estRef = git('rev-parse', '--verify', '--quiet', `${DEPUIS}^{commit}`) !== null;
  // git avale n'importe quelle chaîne après --since et rend zéro commit : on n'accepte qu'une vraie date
  const estDate = /^\d{4}-\d{2}-\d{2}\b/.test(DEPUIS) || /\b(ago|yesterday|today|midnight|noon)\b/.test(DEPUIS);
  const journal = estRef
    ? git('log', '--format=%H%x09%s', `${DEPUIS}..HEAD`)
    : estDate
      ? git('log', `--since=${DEPUIS}`, '--format=%H%x09%s')
      : null;
  const commits = lignes(journal).map((l) => {
    const [hash, ...sujet] = l.split('\t');
    return { hash: hash.slice(0, 7), sujet: sujet.join('\t'), complet: hash };
  });
  // la base : la référence donnée, ou le parent du plus ancien commit de la session, ou HEAD
  const plusAncien = commits.at(-1)?.complet;
  const base = estRef ? DEPUIS : plusAncien ? (git('rev-parse', '--verify', '--quiet', `${plusAncien}^`) ?? ARBRE_VIDE) : git('rev-parse', '--verify', '--quiet', 'HEAD');
  const changements = new Map();
  // --relative et ls-files : des chemins relatifs à la racine du projet, même dans un sous-dossier du dépôt
  for (const l of lignes(base ? git('diff', '--name-status', '-M', '--relative', base) : null)) {
    const [statut, a, b] = l.split('\t');
    if (statut.startsWith('R')) changements.set(b, { statut: 'R', chemin: b, ancien: a });
    else changements.set(a, { statut: statut[0], chemin: a });
  }
  for (const chemin of (git('ls-files', '--others', '--exclude-standard', '-z') ?? '').split('\0').filter(Boolean))
    changements.set(chemin, { statut: 'A', chemin });
  session = { depuis: DEPUIS, commits: commits.map(({ hash, sujet }) => ({ hash, sujet })), changements: [...changements.values()] };
  if (!estRef && !estDate)
    session.erreur = `« ${DEPUIS} » n'est ni une référence git ni une durée que git comprend — essayer « 2 days ago » ou un hash`;
}

// --- à relire : vieux fichiers, et fichiers qui citent un chemin changé ----------------------------

const maintenant = Date.now();
const vieux = [];
if (depot)
  for (const chemin of contexte) {
    const date = git('log', '-1', '--format=%cI', '--', chemin);
    if (!date) continue; // jamais commité : il vient d'être écrit
    const semaines = Math.floor((maintenant - Date.parse(date)) / SEMAINE);
    if (semaines >= SEMAINES) vieux.push({ chemin, dernierCommit: date.slice(0, 10), semaines });
  }
vieux.sort((a, b) => b.semaines - a.semaines);

/** Le texte cite-t-il ce chemin, en entier ? `package.json` ne doit pas répondre pour `extension/package.json`. */
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const citeLeChemin = (texte, chemin) => new RegExp(`(?<![\\w./-])${echappe(chemin)}(?![\\w/-])`).test(texte);

const cites = [];
if (session)
  for (const chemin of contexte) {
    const abs = join(RACINE, chemin);
    if (!existsSync(abs)) continue;
    const texte = readFileSync(abs, 'utf8');
    for (const c of session.changements) {
      if (contexte.has(c.chemin)) continue; // un fichier de contexte changé se relit par lui-même
      const cite = [c.chemin, c.ancien].filter(Boolean).find((p) => citeLeChemin(texte, p));
      if (cite) cites.push({ contexte: chemin, cite, statut: c.statut, ...(c.ancien ? { devenu: c.chemin } : {}) });
    }
  }

console.log(
  JSON.stringify(
    {
      racine: RACINE,
      git: depot,
      semaines: SEMAINES,
      session,
      contexte: [...contexte].sort(),
      vieux,
      cites,
      avertissements: carte.avertissements,
      poidsToujours: carte.poidsToujours,
    },
    null,
    2,
  ),
);
