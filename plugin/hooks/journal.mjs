#!/usr/bin/env node
// Le journal de chargement : ce que Claude Code a vraiment chargé dans ce projet, que la carte lit.
//
//   InstructionsLoaded     un CLAUDE.md, un import ou une règle entre dans le contexte
//   PostToolUse [Skill]    Claude lance une skill
//   UserPromptExpansion    l'utilisateur tape /une-skill : ce chemin ne passe pas par l'outil Skill
//
// Une ligne JSON par chargement dans .claude/contextree/journal.jsonl. Le journal est propre à la
// machine : un .gitignore `*` à côté le garde hors de git. Toute erreur sort en 0 : le journal ne
// gêne jamais la session.
import { readFileSync, appendFileSync, writeFileSync, renameSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';

const JOURS = 90; // au-delà, un chargement ne dit plus rien du travail actuel
const LIGNES = 5000; // ~1 Mo, que la carte relit à chaque lancement
// on taille sous le plafond, pas au plafond : sinon le fichier est réécrit à chaque événement, et les
// hooks parallèles du démarrage se marchent dessus
const GARDE = 0.9;
const JOUR = 24 * 3600 * 1000;

try {
  const e = JSON.parse(readFileSync(0, 'utf8'));
  const projet = process.env.CLAUDE_PROJECT_DIR || e.cwd;
  const ligne = projet && entree(e, projet);
  if (ligne) {
    const dossier = join(projet, '.claude', 'contextree');
    mkdirSync(dossier, { recursive: true });
    if (!existsSync(join(dossier, '.gitignore'))) writeFileSync(join(dossier, '.gitignore'), '*\n');
    const journal = join(dossier, 'journal.jsonl');
    appendFileSync(journal, JSON.stringify(ligne) + '\n');
    tailler(journal);
  }
} catch {
  // silence : voir l'en-tête
}
process.exit(0);

/** L'événement du hook devenu une ligne du journal, ou null s'il ne charge rien. */
function entree(e, projet) {
  const base = { quand: new Date().toISOString(), session: e.session_id ?? null };
  const chemin = (p) => (p ? affiche(resolve(e.cwd ?? projet, p), projet) : null);
  if (e.hook_event_name === 'InstructionsLoaded' && e.file_path)
    return {
      ...base,
      fichier: chemin(e.file_path),
      genre: 'instruction',
      raison: e.load_reason ?? null,
      // pour un import, ce qui l'a déclenché est le fichier qui l'importe
      declencheur: chemin(e.trigger_file_path ?? e.parent_file_path),
    };
  const skill =
    e.hook_event_name === 'PostToolUse' && e.tool_name === 'Skill'
      ? { nom: e.tool_input?.skill, raison: 'claude' }
      : e.hook_event_name === 'UserPromptExpansion' && e.expansion_type === 'slash_command'
        ? { nom: e.command_name, raison: 'commande' }
        : null;
  if (!skill?.nom) return null;
  const nom = String(skill.nom).replace(/^\//, '');
  return { ...base, fichier: skillFichier(nom, projet), genre: 'skill', nom, raison: skill.raison, declencheur: null };
}

/** Le SKILL.md ou la commande de ce nom, perso d'abord comme Claude Code ; null pour une skill de plugin. */
function skillFichier(nom, projet) {
  if (/[\\/]|\.\./.test(nom)) return null;
  const perso = process.env.CLAUDE_CONFIG_DIR || (process.env.HOME && join(process.env.HOME, '.claude'));
  for (const base of [perso, join(projet, '.claude')].filter(Boolean))
    for (const f of [join(base, 'skills', nom, 'SKILL.md'), join(base, 'commands', nom.replace(/:/g, sep) + '.md')])
      if (existsSync(f)) return affiche(f, projet);
  return null;
}

/** Comme la carte : relatif au projet, sinon ~/… sous le home, sinon complet. */
function affiche(abs, projet) {
  for (const [a, p] of [[abs, projet], [vrai(abs), vrai(projet)]]) {
    const rel = relative(p, a);
    if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  }
  const home = process.env.HOME;
  if (home && abs.startsWith(home + sep)) return '~/' + relative(home, abs).split(sep).join('/');
  return abs.split(sep).join('/');
}
function vrai(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 90 jours ou 5 000 lignes, le plus court. Réécrit à part puis renommé : un lecteur ne voit jamais un fichier à moitié. */
function tailler(journal) {
  const lignes = readFileSync(journal, 'utf8').split('\n').filter(Boolean);
  const quand = (l) => {
    try {
      return JSON.parse(l).quand ?? '';
    } catch {
      return '';
    }
  };
  const limite = new Date(Date.now() - JOURS * JOUR).toISOString();
  const tropVieux = quand(lignes[0]) < new Date(Date.now() - (JOURS + 1) * JOUR).toISOString();
  if (lignes.length <= LIGNES && !tropVieux) return;
  const gardees = lignes.filter((l) => quand(l) >= limite).slice(-Math.floor(LIGNES * GARDE));
  const tmp = `${journal}.${process.pid}`;
  writeFileSync(tmp, gardees.map((l) => l + '\n').join(''));
  renameSync(tmp, journal);
}
