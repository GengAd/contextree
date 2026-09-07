import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from '../dist/core/frontmatter.js';
import { loadTree, writeBranch, writeRoot, deleteBranch, slugify, findTreeDir } from '../dist/core/store.js';
import { withAncestors, guaranteedBranches, allBranches } from '../dist/core/tree.js';
import { renderContext } from '../dist/core/render.js';
import { extractPack, applyPack, encodePack, decodePack } from '../dist/core/pack.js';

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
