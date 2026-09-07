import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from '../dist/core/frontmatter.js';
import { loadTree, writeBranch, writeRoot, deleteBranch, moveBranch, slugify, findTreeDir } from '../dist/core/store.js';
import { withAncestors, guaranteedBranches, allBranches } from '../dist/core/tree.js';
import { renderContext } from '../dist/core/render.js';
import { extractPack, applyPack, encodePack, decodePack } from '../dist/core/pack.js';
import { appendTurn, readJournal, journalFile, appendAiWrite, readAiWrites } from '../dist/core/journal.js';

process.env.CONTEXTREE_STATE_DIR = await fs.mkdtemp(
  path.join(os.tmpdir(), 'contextree-journal-'),
);

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextree-test-'));
  return path.join(dir, '.contextree');
}

test('frontmatter : aller-retour, valeurs citées, corps intact', () => {
  const raw = serializeFrontmatter(
    { type: 'rule', title: 'Titre: avec deux-points', load_when: 'quand X' },
    '# Corps\n\n---\npas une clôture\n',
  );
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.type, 'rule');
  assert.equal(data.title, 'Titre: avec deux-points');
  assert.equal(data.load_when, 'quand X');
  assert.match(body, /pas une clôture/);
});

test('frontmatter : fichier sans frontmatter reste lisible', () => {
  const { data, body } = parseFrontmatter('juste du markdown');
  assert.deepEqual(data, {});
  assert.equal(body, 'juste du markdown');
});

test('store : le parent vient de l\'arborescence, le type du frontmatter', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, { path: 'archi', type: 'context', title: 'Archi', loadWhen: 'a', content: 'A' });
  await writeBranch(dir, { path: 'archi/cmds', type: 'reference', title: 'Cmds', loadWhen: 'b', content: 'B' });

  const tree = await loadTree(dir);
  assert.equal(tree.rootContent, 'racine');
  assert.equal(tree.branches.get('archi').parentPath, null);
  assert.equal(tree.branches.get('archi/cmds').parentPath, 'archi');
  assert.equal(tree.branches.get('archi/cmds').type, 'reference');
  assert.deepEqual(tree.branches.get('archi').childPaths, ['archi/cmds']);
});

test('store : un dossier sans .md frère devient un hub implicite', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'equipe/regle', type: 'rule', title: 'R', loadWhen: 'x', content: 'C' });
  await fs.rm(path.join(dir, 'equipe.md'), { force: true });

  const tree = await loadTree(dir);
  assert.ok(tree.branches.has('equipe'), 'le hub implicite existe');
  assert.equal(tree.branches.get('equipe').content, '');
  assert.equal(tree.branches.get('equipe/regle').parentPath, 'equipe');
});

test('store : delete emporte les enfants', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b', type: 'context', title: 'B', loadWhen: 'x', content: '' });
  await deleteBranch(dir, 'a');
  assert.equal((await loadTree(dir)).order.length, 0);
});

test('store : findTreeDir remonte comme .git', async () => {
  const dir = await scratch();
  const deep = path.join(path.dirname(dir), 'src', 'nested');
  await fs.mkdir(deep, { recursive: true });
  await writeRoot(dir, 'r');
  assert.equal(await findTreeDir(deep), dir);
});

test('tree : sélectionner un enfant remonte tous ses parents', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b', type: 'context', title: 'B', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'a/b/c', type: 'skill', title: 'C', loadWhen: 'x', content: '' });
  const tree = await loadTree(dir);
  assert.deepEqual([...withAncestors(tree, ['a/b/c'])].sort(), ['a', 'a/b', 'a/b/c']);
});

test('tree : le filet du routeur, ce sont identity + rule (avec leurs parents)', async () => {
  const dir = await scratch();
  await writeBranch(dir, { path: 'zone', type: 'context', title: 'Zone', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'zone/r', type: 'rule', title: 'R', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'i', type: 'identity', title: 'I', loadWhen: 'x', content: '' });
  await writeBranch(dir, { path: 'doc', type: 'reference', title: 'D', loadWhen: 'x', content: '' });
  const tree = await loadTree(dir);
  assert.deepEqual([...guaranteedBranches(tree)].sort(), ['i', 'zone', 'zone/r']);
});

test('render : racine toujours là, Rules avant Context, non sélectionné exclu', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'RACINE');
  await writeBranch(dir, { path: 'r', type: 'rule', title: 'R', loadWhen: 'x', content: 'REGLE' });
  await writeBranch(dir, { path: 'd', type: 'reference', title: 'D', loadWhen: 'x', content: 'DOC' });
  await writeBranch(dir, { path: 'z', type: 'context', title: 'Z', loadWhen: 'x', content: 'EXCLU' });
  const tree = await loadTree(dir);
  const out = renderContext(tree, new Set(['r', 'd']));
  assert.ok(out.indexOf('RACINE') < out.indexOf('## Rules'));
  assert.ok(out.indexOf('## Rules') < out.indexOf('## Context'));
  assert.ok(!out.includes('EXCLU'));
});

test('render : arbre vide → chaîne vide (rien à injecter)', async () => {
  const dir = await scratch();
  const tree = await loadTree(dir);
  assert.equal(renderContext(tree, new Set()), '');
});

test('pack : aller-retour jeton, hiérarchie préservée', async () => {
  const src = await scratch();
  await writeRoot(src, 'RACINE');
  await writeBranch(src, { path: 'a', type: 'context', title: 'A', loadWhen: 'x', content: 'CA' });
  await writeBranch(src, { path: 'a/b', type: 'skill', title: 'B', loadWhen: 'y', content: 'CB' });

  const token = encodePack(extractPack(await loadTree(src), 'demo'));
  const dst = await scratch();
  await applyPack(dst, decodePack(`contextree:${token}`));

  const tree = await loadTree(dst);
  assert.equal(tree.rootContent, 'RACINE');
  assert.equal(tree.branches.get('a/b').parentPath, 'a');
  assert.equal(tree.branches.get('a/b').type, 'skill');
  assert.equal(tree.branches.get('a/b').content, 'CB');
});

test('pack : --prefix isole les branches importées sous un hub', async () => {
  const src = await scratch();
  await writeBranch(src, { path: 'r', type: 'rule', title: 'R', loadWhen: 'x', content: 'C' });
  const dst = await scratch();
  await applyPack(dst, extractPack(await loadTree(src)), { prefix: 'equipe', mergeRoot: true });
  const tree = await loadTree(dst);
  assert.equal(tree.branches.get('equipe/r').parentPath, 'equipe');
  assert.deepEqual([...withAncestors(tree, ['equipe/r'])].sort(), ['equipe', 'equipe/r']);
});

test('pack : un chemin qui remonte hors du dossier est refusé', async () => {
  const dst = await scratch();
  await assert.rejects(
    () => applyPack(dst, { v: 1, rootContent: '', branches: [{ path: '../evade', parent: null, type: 'rule', title: 'X', loadWhen: 'x', content: '' }] }),
    /refusé/,
  );
});

test('slugify : accents, ponctuation, cas vide', () => {
  assert.equal(slugify('Règles du Projet !'), 'regles-du-projet');
  assert.equal(slugify('!!!'), 'branche');
});

const turn = (over = {}) => ({
  at: Date.now(),
  prompt: 'un prompt',
  selected: ['identite'],
  reason: 'routed',
  source: 'hook',
  ...over,
});

test('journal : les tours s\'empilent, du plus ancien au plus récent', async () => {
  const dir = await scratch();
  assert.deepEqual(await readJournal(dir), []);
  await appendTurn(dir, turn({ prompt: 'premier' }));
  await appendTurn(dir, turn({ prompt: 'second', reason: 'fallback', source: 'mcp', error: 'timeout' }));
  const turns = await readJournal(dir);
  assert.deepEqual(turns.map(t => t.prompt), ['premier', 'second']);
  assert.equal(turns[1].reason, 'fallback');
  assert.equal(turns[1].source, 'mcp');
  assert.equal(turns[1].error, 'timeout');
});

test('journal : borné aux 50 derniers tours', async () => {
  const dir = await scratch();
  for (let i = 0; i < 55; i++) await appendTurn(dir, turn({ prompt: `tour ${i}` }));
  const turns = await readJournal(dir);
  assert.equal(turns.length, 50);
  assert.equal(turns[0].prompt, 'tour 5');
  assert.equal(turns.at(-1).prompt, 'tour 54');
});

test('journal : le prompt est tronqué et mis à plat', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: `  deux\n\nlignes  ` }));
  await appendTurn(dir, turn({ prompt: 'x'.repeat(500) }));
  const turns = await readJournal(dir);
  assert.equal(turns[0].prompt, 'deux lignes');
  assert.equal(turns[1].prompt.length, 200);
  assert.match(turns[1].prompt, /…$/);
});

test('journal : un journal illisible est un journal vide, jamais une erreur', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn());
  await fs.writeFile(journalFile(dir), '{ pas du JSON', 'utf8');
  assert.deepEqual(await readJournal(dir), []);
  // et on repart proprement : écrire par-dessus ne rejette pas
  await appendTurn(dir, turn({ prompt: 'après' }));
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['après']);
});

test('journal : les entrées mal formées sont écartées à la lecture', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: 'bon' }));
  const file = journalFile(dir);
  const kept = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify([...kept, { at: 'hier' }, null, { source: 'ailleurs' }]), 'utf8');
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['bon']);
});

test('journal : un arbre, un journal — deux arbres ne se mélangent pas', async () => {
  const a = await scratch();
  const b = await scratch();
  await appendTurn(a, turn({ prompt: 'chez A' }));
  await appendTurn(b, turn({ prompt: 'chez B' }));
  assert.deepEqual((await readJournal(a)).map(t => t.prompt), ['chez A']);
  assert.deepEqual((await readJournal(b)).map(t => t.prompt), ['chez B']);
});

const branch = (p, over = {}) => ({
  path: p, type: 'context', title: p, loadWhen: `quand ${p}`, content: `corps de ${p}`, ...over,
});

test('store : déplacer une branche emporte ses enfants', async () => {
  const dir = await scratch();
  await writeRoot(dir, 'racine');
  await writeBranch(dir, branch('archi', { type: 'reference', title: 'Archi' }));
  await writeBranch(dir, branch('archi/store'));
  await writeBranch(dir, branch('archi/store/format'));
  await writeBranch(dir, branch('vues'));

  await moveBranch(dir, 'archi/store', 'vues/store');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['archi', 'vues', 'vues/store', 'vues/store/format']);
  const moved = tree.branches.get('vues/store');
  assert.equal(moved.parentPath, 'vues');
  assert.equal(moved.content.trim(), 'corps de archi/store');
  assert.equal(tree.branches.get('vues/store/format').parentPath, 'vues/store');
});

test('store : renommer, c\'est déplacer — le frontmatter suit', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('regles', { type: 'rule', title: 'Règles', loadWhen: 'toujours' }));
  await moveBranch(dir, 'regles', 'regles-du-projet');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order, ['regles-du-projet']);
  const b = tree.branches.get('regles-du-projet');
  assert.equal(b.type, 'rule');
  assert.equal(b.title, 'Règles');
  assert.equal(b.loadWhen, 'toujours');
});

test('store : pas de dossier fantôme laissé derrière', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('archi'));
  await writeBranch(dir, branch('archi/store'));
  await moveBranch(dir, 'archi/store', 'store');

  // `archi/` vidé deviendrait un hub implicite : il doit avoir disparu.
  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['archi', 'store']);
  assert.deepEqual(tree.branches.get('archi').childPaths, []);
  await assert.rejects(fs.stat(path.join(dir, 'archi')));
});

test('store : une arrivée occupée est refusée, rien ne bouge', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await writeBranch(dir, branch('b'));
  await assert.rejects(moveBranch(dir, 'a', 'b'), /occupe déjà/);

  const tree = await loadTree(dir);
  assert.equal(tree.branches.get('a').content.trim(), 'corps de a');
  assert.equal(tree.branches.get('b').content.trim(), 'corps de b');
});

test('store : déplacer une branche sous son propre descendant est refusé', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('archi'));
  await writeBranch(dir, branch('archi/store'));
  await assert.rejects(moveBranch(dir, 'archi', 'archi/store/archi'), /est sous archi/);
  assert.deepEqual((await loadTree(dir)).order.sort(), ['archi', 'archi/store']);
});

test('store : branche introuvable, et chemin qui sort du dossier', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a'));
  await assert.rejects(moveBranch(dir, 'absente', 'b'), /introuvable/);
  await assert.rejects(moveBranch(dir, 'a', '../dehors'), /refusé/);
  await assert.rejects(moveBranch(dir, 'a', '/etc/passwd'), /refusé/);
  await assert.rejects(moveBranch(dir, 'a', '  '), /refusé/);
});

test('store : déplacer un hub implicite (dossier sans .md frère)', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('groupe/enfant'));
  // `groupe` n'a pas de `.md` : c'est un hub implicite, il doit se déplacer quand même.
  await moveBranch(dir, 'groupe', 'rangé');

  const tree = await loadTree(dir);
  assert.deepEqual(tree.order.sort(), ['rangé', 'rangé/enfant']);
  assert.equal(tree.branches.get('rangé/enfant').content.trim(), 'corps de groupe/enfant');
});

test('store : un chemin périmé disparaît du fallback sticky, il ne casse rien', async () => {
  const dir = await scratch();
  await writeBranch(dir, branch('a', { type: 'context' }));
  await writeBranch(dir, branch('b', { type: 'context' }));
  await moveBranch(dir, 'a', 'c');

  const tree = await loadTree(dir);
  // C'est le filtre que fait le routeur sur la sélection précédente.
  const previous = ['a', 'b'].filter(p => tree.branches.has(p));
  assert.deepEqual(previous, ['b']);
  assert.deepEqual([...withAncestors(tree, previous)], ['b']);
});

test('journal : les écritures de l\'IA vivent dans leur propre fichier', async () => {
  const dir = await scratch();
  await appendTurn(dir, turn({ prompt: 'un tour' }));
  await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: 'archi', title: 'Archi', why: 'convention découverte' });
  await appendAiWrite(dir, { at: Date.now(), op: 'move', path: 'x/archi', from: 'archi' });

  const writes = await readAiWrites(dir);
  assert.deepEqual(writes.map(w => w.op), ['upsert', 'move']);
  assert.equal(writes[0].why, 'convention découverte');
  assert.equal(writes[1].from, 'archi');
  // Le journal de routage n'a pas bougé : deux histoires, deux fichiers.
  assert.deepEqual((await readJournal(dir)).map(t => t.prompt), ['un tour']);
});

test('journal : une écriture mal formée est écartée, le fichier reste lisible', async () => {
  const dir = await scratch();
  await appendAiWrite(dir, { at: Date.now(), op: 'upsert', path: 'bon' });
  const file = journalFile(dir).replace(/\.json$/, '-writes.json');
  const kept = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify([...kept, { op: 'upsert' }, { at: 1, op: 'inconnu', path: 'x' }]), 'utf8');
  assert.deepEqual((await readAiWrites(dir)).map(w => w.path), ['bon']);
});
