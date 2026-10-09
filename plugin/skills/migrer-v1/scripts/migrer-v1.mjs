#!/usr/bin/env node
// migrer-v1.mjs <projet> [--appliquer] [--agents] [--paths=regle=glob;glob,…] [--regle-skill=a,b] [--arbre=<dossier>]
// .contextree/ (v1) → fichiers natifs Claude Code. Sans --appliquer : affiche le plan.
// --agents : la racine va dans AGENTS.md, CLAUDE.md l'importe (projets lus aussi par Cursor/Copilot).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';

const args = process.argv.slice(2);
const PROJET = resolve(args.find((a) => !a.startsWith('--')));
const APPLIQUER = args.includes('--appliquer');
const AGENTS = args.includes('--agents');
const opt = (n) => (args.find((a) => a.startsWith(n + '=')) ?? '').slice(n.length + 1);
const REGLES_SKILLS = new Set(opt('--regle-skill').split(',').filter(Boolean));
const ARBRE = opt('--arbre') ? resolve(opt('--arbre')) : join(PROJET, '.contextree');
const PATHS = Object.fromEntries(opt('--paths').split(',').filter(Boolean).map((e) => { const [c, g] = e.split('='); return [c, g.split(';')]; }));

const lire = (p) => readFileSync(p, 'utf8');
const ecrits = [];
const ecrire = (rel, contenu) => {
  ecrits.push([rel, contenu.length]);
  if (!APPLIQUER) return;
  mkdirSync(dirname(join(PROJET, rel)), { recursive: true });
  writeFileSync(join(PROJET, rel), contenu);
};
const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function fm(texte) {
  const m = texte.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, corps: texte.trim() };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const kv = l.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, corps: texte.slice(m[0].length).trim() };
}
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (n.endsWith('.md')) acc.push(p);
  }
  return acc;
}

// --- lecture de l'arbre ---------------------------------------------------------------
const SANS_ARBRE = !existsSync(ARBRE);
const racine = !SANS_ARBRE && existsSync(join(ARBRE, 'root.md')) ? lire(join(ARBRE, 'root.md')).trim() : '';
const branches = (SANS_ARBRE ? [] : walk(ARBRE))
  .filter((p) => basename(p) !== 'root.md')
  .map((p) => {
    const chemin = relative(ARBRE, p).replace(/\\/g, '/').replace(/\.md$/, '');
    const { meta, corps } = fm(lire(p));
    const parts = chemin.split('/');
    return { chemin, parent: parts.length > 1 ? parts.slice(0, -1).join('/') : null, nom: parts.at(-1), type: meta.type ?? 'context', titre: meta.title ?? parts.at(-1), quand: meta.load_when ?? '', corps };
  });
const par = new Map(branches.map((b) => [b.chemin, b]));
// un enfant dont le parent n'est pas une branche remonte au premier ancêtre qui en est une, sinon devient racine
for (const b of branches) {
  let p = b.parent;
  while (p && !par.has(p)) p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
  b.parent = p;
}
const enfantsDe = (c) => branches.filter((b) => b.parent === c);
const ancetreRacine = (b) => (b.parent ? ancetreRacine(par.get(b.parent)) : b);

// --- CLAUDE.md / AGENTS.md ----------------------------------------------------------------
const identites = branches.filter((b) => b.type === 'identity');
const regles = branches.filter((b) => b.type === 'rule' && !REGLES_SKILLS.has(b.chemin));
const estRegle = (b) => b && b.type === 'rule' && !REGLES_SKILLS.has(b.chemin);
// un sommet : sans parent, ou enfant d'une règle (une règle n'a pas de fichiers voisins) ; identités et règles à part
const sommets = branches.filter((b) => (!b.parent || estRegle(par.get(b.parent))) && b.type !== 'identity' && !estRegle(b));

let root = racine;
if (identites.length) root += `\n\n## Rôle\n\n` + identites.map((i) => i.corps).join('\n\n');
root += `\n\n## Où est le contexte\n\nPas de doc parallèle : ce fichier, \`.claude/rules/\` (toujours chargées) et \`.claude/skills/\` (chargées quand la tâche correspond à leur description). Quand tu découvres un fait durable que ces fichiers ne disent pas, écris-le au bon endroit avec la skill \`contextree:retenir\` et dis-le en une phrase. \`/contextree:carte\` montre tout ce qui peut se charger, et quand.\n`;

if (SANS_ARBRE) {
  // rien à convertir : seulement le câblage plus bas
} else if (AGENTS) {
  ecrire('AGENTS.md', root.replace(/^(# .*)$/m, '$1'));
  ecrire('CLAUDE.md', `@AGENTS.md\n`);
} else {
  ecrire('CLAUDE.md', root);
}

// --- règles --------------------------------------------------------------------------------
for (const r of regles) {
  const rel = `.claude/rules/${slug(r.chemin.replace(/\//g, '-'))}.md`;
  const globs = PATHS[r.chemin];
  const fmp = globs ? `---\npaths:\n${globs.map((g) => `  - "${g}"`).join('\n')}\n---\n\n` : '';
  const quand = globs ? `Chargée en touchant : ${globs.join(', ')}.` : `Toujours chargée.`;
  ecrire(rel, `${fmp}# ${r.titre}\n\n*${quand}*\n\n${r.corps}\n`);
}

// --- skills : un sommet = un dossier, ses descendants = fichiers voisins -------------------
const descendants = (b) => enfantsDe(b.chemin).flatMap((e) => [e, ...descendants(e)]);
const court = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
for (const s of sommets) {
  const nom = slug(s.titre.startsWith('Skill') ? s.chemin : s.chemin);
  const dossier = `.claude/skills/${nom}`;
  const desc = descendants(s);
  let description = `${s.titre} — ${s.quand}`.replace(/\s+/g, ' ');
  if (desc.length) description += ` Couvre aussi : ${desc.map((d) => d.titre).join(', ')}.`;
  description = court(description, 1400);
  const invocable = s.type === 'skill';
  const entete = `---\nname: ${nom}\ndescription: ${description.replace(/"/g, '\\"').includes(':') ? JSON.stringify(description) : description}\n${invocable ? '' : 'user-invocable: false\n'}---\n`;
  let corps = `# ${s.titre}\n\n${s.corps}\n`;
  if (desc.length) {
    corps += `\n## Fichiers voisins — à lire seulement quand la demande les concerne\n\n`;
    for (const d of desc) {
      const f = slug(relative(s.chemin, d.chemin).replace(/\\/g, '/').replace(/\//g, '-')) + '.md';
      corps += `- [${f}](${f}) — ${d.titre}${d.quand ? ` : ${d.quand}` : ''}\n`;
      const parentTxt = d.parent !== s.chemin ? `*Contexte commun : [${slug(relative(s.chemin, par.get(d.parent).chemin).replace(/\//g, '-'))}.md](${slug(relative(s.chemin, par.get(d.parent).chemin).replace(/\//g, '-'))}.md), puis [SKILL.md](SKILL.md).*` : `*Contexte commun : [SKILL.md](SKILL.md).*`;
      ecrire(`${dossier}/${f}`, `# ${d.titre}\n\n${d.quand ? `*À lire quand : ${d.quand}.*\n` : ''}${parentTxt}\n\n${d.corps}\n`);
    }
  }
  ecrire(`${dossier}/SKILL.md`, entete + '\n' + corps);
}

// --- câblage v1 à retirer ---------------------------------------------------------------------
const retraits = [];
function json(rel) {
  const p = join(PROJET, rel);
  return existsSync(p) ? JSON.parse(lire(p)) : null;
}
function sauverJson(rel, obj, vide) {
  retraits.push(rel + (vide ? ' (supprimé)' : ' (entrée contextree retirée)'));
  if (!APPLIQUER) return;
  if (vide) unlinkSync(join(PROJET, rel));
  else writeFileSync(join(PROJET, rel), JSON.stringify(obj, null, 2) + '\n');
}
const s = json('.claude/settings.json');
if (s?.hooks) {
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev].filter((g) => !(g.hooks ?? []).some((h) => /contextree/.test(h.command ?? '')));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  sauverJson('.claude/settings.json', s, !Object.keys(s).length);
}
for (const [rel, cle] of [['.mcp.json', 'mcpServers'], ['.cursor/mcp.json', 'mcpServers'], ['.vscode/mcp.json', 'servers']]) {
  const o = json(rel);
  if (o?.[cle]?.contextree) {
    delete o[cle].contextree;
    sauverJson(rel, o, !Object.keys(o[cle]).length);
  }
}
for (const rel of ['AGENTS.md', '.github/copilot-instructions.md']) {
  const p = join(PROJET, rel);
  if (!existsSync(p) || !/<!-- contextree:start -->/.test(lire(p))) continue;
  const reste = lire(p).replace(/<!-- contextree:start -->[\s\S]*?<!-- contextree:end -->\n?/, '').trim();
  if (rel === 'AGENTS.md' && AGENTS) continue; // réécrit plus haut
  if (reste) ecrire(rel, reste + '\n');
  else if (rel === '.github/copilot-instructions.md') ecrire(rel, `Les consignes du projet sont dans \`AGENTS.md\` à la racine : lis-le avant de répondre.\n`);
  else { retraits.push(rel + ' (supprimé, ne contenait que le bloc contextree)'); if (APPLIQUER) unlinkSync(p); }
}
const gi = join(PROJET, '.gitignore');
if (existsSync(gi)) {
  let g = lire(gi).replace(/\n?# contextree:[^\n]*\n\.contextree\.local\/\n?/g, '\n').replace(/\n\.contextree\.local\/\n/g, '\n');
  if (!/CLAUDE\.local\.md/.test(g)) g = g.trimEnd() + `\n\n# Le calque personnel : à soi, jamais poussé.\nCLAUDE.local.md\n.claude/settings.local.json\n`;
  ecrire('.gitignore', g);
}

// --- plan ---------------------------------------------------------------------------------------
console.log(`${APPLIQUER ? 'APPLIQUÉ' : 'PLAN'} — ${basename(PROJET)} : ${branches.length} branches → ${ecrits.length} fichiers`);
for (const [rel, n] of ecrits) console.log(`  ${rel}  (${n} car.)`);
for (const r of retraits) console.log(`  retiré : ${r}`);
console.log(`  à faire ensuite : git rm -r .contextree`);
