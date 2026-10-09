// @ts-check
// La carte en arbre : la sortie de `carte.mjs --json` devient des nœuds, sans rien calculer.
// Aucun import de vscode ici : tests/extension.test.mjs l'exerce avec Node seul.
'use strict';
const { join, isAbsolute, relative, sep } = require('node:path');

/**
 * @typedef {object} Noeud
 * @property {string} label
 * @property {string} [description]
 * @property {string} [tooltip]
 * @property {string} [fichier]  chemin absolu ouvert au clic
 * @property {string} [icone]    nom d'une ThemeIcon
 * @property {boolean} [perso]   hors git : affiché grisé
 * @property {Noeud[]} enfants
 */

/** Le chemin d'une ligne de la carte, rendu absolu : relatif au projet, ~/… ou déjà complet. */
function absolu(chemin, racine, home) {
  if (chemin.startsWith('~/')) return join(home, chemin.slice(2));
  return isAbsolute(chemin) ? chemin : join(racine, chemin);
}

/** Une sauvegarde de ce fichier change-t-elle la carte ? */
function aRafraichir(fichier, racine, home, racinePerso) {
  const dans = (dossier) => {
    const rel = relative(dossier, fichier);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
  };
  const perso = racinePerso ?? (home && join(home, '.claude'));
  if (perso && dans(perso) !== null) return true;
  const rel = dans(racine);
  if (rel === null) return false;
  // plugin/ : dans le clone de contextree, la carte elle-même change — comme pour le hook de forme
  return /^(\.claude|plugin)\//.test(rel) || /(^|\/)(CLAUDE(\.local)?|AGENTS)\.md$/.test(rel);
}

/** @param {any} carte  la sortie de `carte.mjs --json` */
function arbre(carte, home) {
  const ouvrir = (chemin) => absolu(chemin, carte.racine, home);
  const feuille = (label, extra = {}) => ({ label, enfants: [], ...extra });
  const info = (label) => feuille(label, { icone: 'info' });

  /** Le partagé par git d'abord, puis le perso dans un sous-groupe, comme la carte texte. */
  const rendre = (elements, faire) => {
    const noeuds = elements.filter((x) => !x.perso).map(faire);
    const perso = elements.filter((x) => x.perso);
    if (perso.length)
      noeuds.push({
        label: 'perso — hors git',
        description: 'sur cette machine seulement',
        icone: 'account',
        perso: true,
        enfants: perso.map((x) => griser(faire(x))),
      });
    return noeuds;
  };
  const griser = (n) => ({ ...n, perso: true, enfants: n.enfants.map(griser) });

  const instruction = (n, niveau = 0) =>
    feuille((niveau ? '@' : '') + n.chemin, {
      description: n.memoire ? `${n.lignes} lignes, mémoire automatique` : `${n.lignes} lignes`,
      fichier: ouvrir(n.chemin),
      icone: n.memoire ? 'database' : 'file',
      enfants: n.imports.map((i) => instruction(i, niveau + 1)),
    });

  const sections = [];
  const section = (label, description, enfants, icone) => sections.push({ label, description, icone, enfants });

  // TOUJOURS CHARGÉ — un plugin installé plus ancien que la vue ne donne pas encore le poids
  const p = carte.poidsToujours ?? { total: '?', perso: 0, skills: '?', agents: '?' };
  const regleToujours = carte.regles.filter((r) => !r.paths.length);
  const skillsVisibles = carte.skills.filter((s) => s.mode !== 'manuel');
  const toujours = rendre([...carte.toujours, ...regleToujours.map((r) => ({ ...r, regle: true }))], (x) =>
    x.regle ? feuille(x.chemin, { description: `${x.lignes} lignes, règle sans paths`, fichier: ouvrir(x.chemin), icone: 'law' }) : instruction(x),
  );
  if (skillsVisibles.length) toujours.push(info(`+ les descriptions de ${skillsVisibles.length} skill(s), ~${p.skills} tokens`));
  if (carte.agents.length) toujours.push(info(`+ les descriptions de ${carte.agents.length} sous-agent(s), ~${p.agents} tokens`));
  if (!carte.toujours.some((n) => !n.perso)) toujours.push(feuille('aucun CLAUDE.md ni AGENTS.md', { icone: 'warning' }));
  section(
    'TOUJOURS CHARGÉ',
    carte.poidsToujours
      ? `~${p.total} tokens à chaque session` + (p.perso ? `, dont ~${p.perso} perso` : '') + (carte.racinePerso === null ? ' (sans le perso)' : '')
      : 'poids inconnu : mettre à jour le plugin contextree',
    toujours,
    'pinned',
  );

  // EN TOUCHANT UN FICHIER
  const touchant = carte.dossiers.map((d) =>
    feuille(d.dossier, {
      description: `→ ${d.fichiers.map((f) => f.chemin).join(', ')}  ${d.fichiers.reduce((s, f) => s + f.lignes, 0)} lignes`,
      icone: 'folder',
      fichier: ouvrir(d.fichiers[0].chemin),
      enfants: d.fichiers.map((f) => instruction(f)),
    }),
  );
  touchant.push(
    ...rendre(
      [...carte.regles.filter((r) => r.paths.length), ...carte.skills.filter((s) => s.paths.length).map((s) => ({ ...s, skill: true }))],
      (x) =>
        x.skill
          ? feuille(`skill ${x.nom}`, { description: `${x.paths.join(', ')} → devient disponible`, fichier: ouvrir(x.chemin), icone: 'tools' })
          : feuille(x.chemin, {
              description: `${x.paths.join(', ')} · ${x.lignes} lignes, ${x.cibles.length} fichier(s) visé(s)`,
              tooltip: x.cibles.length ? x.cibles.join('\n') : 'aucun fichier visé',
              fichier: ouvrir(x.chemin),
              icone: 'law',
            }),
    ),
  );
  if (!touchant.length) touchant.push(feuille('(rien)'));
  section('EN TOUCHANT UN FICHIER', 'lecture ou écriture qui correspond', touchant, 'go-to-file');

  // QUAND LA TÂCHE EN PARLE
  const quand = rendre(skillsVisibles, (s) => {
    const qui = s.mode === 'claude' ? 'Claude seul' : `Claude ou /${s.nom}`;
    const extra = [`corps ${s.corpsLignes} lignes`, s.annexes.length && `+ ${s.annexes.join(', ')}`, s.contexte].filter(Boolean).join(', ');
    return feuille(s.nom, { description: `(${qui} ; ${extra})`, tooltip: s.description, fichier: ouvrir(s.chemin), icone: 'tools' });
  });
  if (!quand.length) quand.push(feuille('(rien)'));
  section('QUAND LA TÂCHE EN PARLE', 'Claude lit la description et décide', quand, 'comment-discussion');

  // À LA MAIN
  const manuels = carte.skills.filter((s) => s.mode === 'manuel');
  if (manuels.length)
    section(
      'À LA MAIN',
      'seulement si tu tapes la commande',
      rendre(manuels, (s) => feuille(`/${s.nom}`, { description: s.description, tooltip: s.description, fichier: ouvrir(s.chemin), icone: 'terminal' })),
      'keyboard',
    );

  // SOUS-AGENTS
  if (carte.agents.length)
    section(
      'SOUS-AGENTS',
      'contexte séparé, Claude délègue sur la description',
      rendre(carte.agents, (a) =>
        feuille(a.nom, { description: `(outils : ${a.outils} ; modèle : ${a.modele})`, tooltip: a.description, fichier: ouvrir(a.chemin), icone: 'hubot' }),
      ),
      'organization',
    );

  // HOOKS ET PERMISSIONS
  if (carte.gardeFous.length)
    section(
      'HOOKS ET PERMISSIONS',
      'exécutés par le client, quoi que décide Claude',
      rendre(carte.gardeFous, (g) =>
        g.genre === 'hook'
          ? feuille(`hook ${g.quoi}`, { description: String(g.detail), tooltip: `${g.source}\n${g.detail}`, fichier: ouvrir(g.source), icone: 'zap' })
          : feuille(`${g.genre} : ${g.quoi}`, { tooltip: g.source, fichier: ouvrir(g.source), icone: 'shield' }),
      ),
      'shield',
    );

  // À VÉRIFIER
  const verifier = carte.avertissements.map((a) =>
    feuille(a.ou, { description: a.quoi, tooltip: `${a.ou} — ${a.quoi}`, fichier: ouvrir(a.ou), icone: 'warning' }),
  );
  section(
    'À VÉRIFIER',
    verifier.length ? `${verifier.length} avertissement(s)` : undefined,
    verifier.length ? verifier : [feuille('rien', { icone: 'check' })],
    verifier.length ? 'warning' : 'pass',
  );

  return sections;
}

module.exports = { arbre, absolu, aRafraichir };
