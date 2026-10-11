#!/usr/bin/env node
// Le jardin : ce qu'une fin de session doit relire dans le contexte du projet. Il ne touche pas au
// contexte : la skill jardin en tire des propositions, appliquées sur accord.
//
//   node jardin.mjs                          depuis le dernier jardin (12 heures sans marque, 30 jours au plus)
//   node jardin.mjs --depuis "2 days ago"    ou une référence git : --depuis main~5
//   node jardin.mjs --semaines 8             un fichier de contexte plus vieux que ça est à relire
//   node jardin.mjs --racine X
//   node jardin.mjs --bref                   une ligne de texte, vide s'il n'y a rien à relire
//   node jardin.mjs --bref --hook            la même, pour le hook SessionStart du plugin ; rien si rien
//   node jardin.mjs --marquer                le jardin est passé : la suite part d'ici
//
// Sortie JSON. Sans dépendance : git et la carte (../../carte/scripts/carte.mjs), rien d'autre.
// La seule écriture est la marque (--marquer), dans .claude/contextree/, hors git comme le journal.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};
const HOOK = args.includes('--hook');
const BREF = HOOK || args.includes('--bref');
// un hook ne gêne jamais la session : la moindre erreur, il se tait
if (HOOK) process.on('uncaughtException', () => process.exit(0));
const RACINE = resolve(opt('--racine') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const SEMAINES = Number(opt('--semaines') ?? 6); // au-delà, un fichier de contexte a pu dériver du code
const CARTE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'carte', 'scripts', 'carte.mjs');
const JOUR = 24 * 3600 * 1000;
const SEMAINE = 7 * JOUR;
const SESSION_JOURS = 0.5; // sans marque, une session de travail, à peu près
const MARQUE_JOURS = 30; // une marque plus vieille ne borne plus rien d'utile : au-delà, tout est à relire
const ARBRE_VIDE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // l'arbre vide de git : la base d'un premier commit

// --- la marque du dernier jardin -----------------------------------------------------------------

const DOSSIER = join(RACINE, '.claude', 'contextree');
const FICHIER_MARQUE = join(DOSSIER, 'jardin.dernier');
if (args.includes('--marquer')) {
  mkdirSync(DOSSIER, { recursive: true });
  if (!existsSync(join(DOSSIER, '.gitignore'))) writeFileSync(join(DOSSIER, '.gitignore'), '*\n');
  const iso = new Date().toISOString();
  writeFileSync(FICHIER_MARQUE, iso + '\n');
  console.log(`jardin marqué : ${iso}`);
  process.exit(0);
}
const marque = (() => {
  try {
    const t = Date.parse(readFileSync(FICHIER_MARQUE, 'utf8').trim());
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
})();
/** Une date que git comprend, et que la vérification plus bas reconnaît ; arrondie à la seconde suivante,
 *  comme les dates de commit : un commit de la seconde de la marque est d'avant elle. */
const pourGit = (t) => new Date(Math.ceil(t / 1000) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' +0000';
const maintenant = Date.now();
// le début de la session : --depuis, sinon la marque (bornée), sinon 12 heures ; `debut` en ms quand on le connaît
const borne = maintenant - MARQUE_JOURS * JOUR;
const debut = opt('--depuis') ? null : marque ? Math.max(marque, borne) : maintenant - SESSION_JOURS * JOUR;
const DEPUIS = opt('--depuis') ?? (marque ? pourGit(debut) : '12 hours ago');
const depuisDit = opt('--depuis') ? `« ${DEPUIS} »` : !marque ? 'les 12 dernières heures' : marque < borne ? `les ${MARQUE_JOURS} derniers jours` : 'le dernier jardin';

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
  execFileSync(process.execPath, [CARTE, '--json', '--sans-perso', '--racine', RACINE], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', HOOK ? 'ignore' : 'inherit'],
  }),
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
  // ce qui n'est pas commité ne date que par son fichier : touché avant le début (le dernier jardin), il
  // a déjà été relu. Une suppression n'a plus de date : elle reste.
  if (debut !== null) {
    const commites = new Set(commits.length ? lignes(git('diff', '--name-only', '--relative', base, 'HEAD')) : []);
    for (const [chemin, c] of changements) {
      const abs = join(RACINE, chemin);
      if (!commites.has(chemin) && !commites.has(c.ancien) && existsSync(abs) && statSync(abs).mtimeMs < debut) changements.delete(chemin);
    }
  }
  session = { depuis: DEPUIS, base, commits: commits.map(({ hash, sujet }) => ({ hash, sujet })), changements: [...changements.values()] };
  if (!estRef && !estDate)
    session.erreur = `« ${DEPUIS} » n'est ni une référence git ni une durée que git comprend — essayer « 2 days ago » ou un hash`;
}

// --- à relire : vieux fichiers, et fichiers qui citent un chemin changé ----------------------------

let vieux = [];
if (depot)
  for (const chemin of contexte) {
    const date = git('log', '-1', '--format=%cI', '--', chemin);
    if (!date) continue; // jamais commité : il vient d'être écrit
    const semaines = Math.floor((maintenant - Date.parse(date)) / SEMAINE);
    if (semaines >= SEMAINES) vieux.push({ chemin, dernierCommit: date.slice(0, 10), semaines, devenuVieux: Date.parse(date) + SEMAINES * SEMAINE });
  }
vieux.sort((a, b) => b.semaines - a.semaines);
// en bref : seulement ceux qui ont passé le seuil depuis le début de la session — les autres ont déjà été relus
if (BREF) vieux = debut === null ? [] : vieux.filter((v) => v.devenuVieux >= debut);
vieux = vieux.map(({ devenuVieux, ...v }) => v);

/** Le texte cite-t-il ce chemin, en entier ? `package.json` ne doit pas répondre pour `extension/package.json`. */
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const motifDe = (chemin) => new RegExp(`(?<![\\w./-])${echappe(chemin)}(?![\\w/-])`);

// un fichier de contexte parle d'un chemin changé : son texte le cite, ses `paths` le visent, ou il
// est le CLAUDE.md du dossier qui le contient. Les `cibles` de la carte sont les fichiers présents :
// un fichier supprimé n'est relevé que si un texte le cite.
const textes = new Map([...contexte].filter((c) => existsSync(join(RACINE, c))).map((c) => [c, readFileSync(join(RACINE, c), 'utf8')]));
const visePar = new Map();
for (const r of carte.regles) for (const cible of r.cibles) (visePar.get(cible) ?? visePar.set(cible, []).get(cible)).push([r.chemin, 'paths']);
const dossierDe = (chemin) => carte.dossiers.filter((d) => chemin.startsWith(d.dossier)).flatMap((d) => d.fichiers.map((f) => [f.chemin, 'dossier']));
const cites = [];
if (session)
  for (const c of session.changements) {
    if (contexte.has(c.chemin)) continue; // un fichier de contexte changé se relit par lui-même
    const vus = new Set();
    const motifs = [c.chemin, c.ancien].filter(Boolean).map((p) => [p, motifDe(p)]);
    for (const [chemin, texte] of textes) {
      const cite = motifs.find(([, motif]) => motif.test(texte))?.[0];
      if (!cite) continue;
      vus.add(chemin);
      cites.push({ contexte: chemin, cite, par: 'texte', statut: c.statut, ...(c.ancien ? { devenu: c.chemin } : {}) });
    }
    for (const [chemin, par] of [...(visePar.get(c.chemin) ?? []), ...dossierDe(c.chemin)]) {
      if (vus.has(chemin)) continue;
      vus.add(chemin);
      cites.push({ contexte: chemin, cite: c.chemin, par, statut: c.statut });
    }
  }

// --- en bref : une ligne, pour le début de la session suivante ---------------------------------------

if (BREF) {
  const quelques = (xs) => xs.slice(0, 3).map((x) => `\`${x}\``).join(', ') + (xs.length > 3 ? ', …' : '');
  const parles = [...new Set(cites.map((c) => c.contexte))];
  const morceaux = [
    parles.length && `${parles.length} fichier(s) de contexte parlent de code modifié depuis ${depuisDit} (${quelques(parles)})`,
    vieux.length && `${vieux.length} fichier(s) de contexte n'ont pas bougé depuis ${SEMAINES} semaines (${quelques(vieux.map((v) => v.chemin))})`,
  ].filter(Boolean);
  const ligne = morceaux.length ? morceaux.join(' ; ') + '.' : '';
  if (!HOOK) console.log(ligne);
  else if (ligne) {
    // une consigne avec son moment : « quand la tâche sera finie, pas avant » se lit comme une permission de se taire
    const additionalContext = `contextree : ${ligne} À la fin de ta réponse qui termine la première tâche de l'utilisateur, propose-lui en une phrase de lancer \`/contextree:jardin\` pour les relire ; une seule fois dans la session.`;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
  }
} else {
  const sortie = {
    racine: RACINE,
    git: depot,
    marque: marque && new Date(marque).toISOString(),
    semaines: SEMAINES,
    session,
    contexte: [...contexte].sort(),
    vieux,
    cites,
    avertissements: carte.avertissements,
    poidsToujours: carte.poidsToujours,
  };
  console.log(JSON.stringify(sortie, null, 2));
}
