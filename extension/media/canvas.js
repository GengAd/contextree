// Toile 2D de l'arbre de contexte. Aucune dépendance : la mise en page, le
// zoom et le déplacement tiennent en une page — les arbres sont petits.
(function () {
  const vscode = acquireVsCodeApi();

  const NODE_W = 220;
  const NODE_W_ACTIVE = 540;
  const NODE_H = 92;
  const GAP_X = 28;
  const GAP_Y = 56;
  const ROOT_ID = ':root';

  const COLORS = {
    root: '#94a3b8',
    identity: '#c084fc',
    rule: '#f87171',
    context: '#60a5fa',
    reference: '#34d399',
    skill: '#fbbf24',
  };

  const viewport = document.getElementById('viewport');
  const scene = document.getElementById('scene');
  const layerNodes = document.getElementById('nodes');
  const layerEdges = document.getElementById('edges');
  const count = document.getElementById('count');
  const legend = document.getElementById('legend');

  const promptInput = document.getElementById('prompt');
  const trace = document.getElementById('trace');
  const excerpt = document.getElementById('excerpt');
  const clearBtn = document.getElementById('clear');

  let roots = [];
  let all = [];
  let selected = null;
  // Deux surlignages possibles, jamais mélangés :
  //  - `turn`  : ce qui a réellement été chargé au dernier tour (le journal) ;
  //  - `probe` : une question posée à la main (« que chargerait le routeur… »).
  // La sonde l'emporte tant qu'elle est active ; ✕ ou Échap rend la toile au
  // dernier vrai tour. Sans ça on ne saurait plus si on regarde le réel ou un
  // « et si », ce qui est exactement l'erreur à ne pas faire ici.
  let turn = null;
  let probe = null;
  let view = { x: 0, y: 0, k: 1 };

  function overlay() {
    return probe ?? turn;
  }

  // ── Données ───────────────────────────────────────────────────────────────

  function build(tree) {
    const byId = new Map();
    const root = {
      id: ROOT_ID,
      type: 'root',
      title: 'Racine',
      loadWhen: 'toujours injectée, jamais routée',
      content: tree.rootContent || '',
      children: [],
    };
    byId.set(ROOT_ID, root);

    for (const b of tree.branches) {
      byId.set(b.path, {
        id: b.path,
        type: b.type,
        title: b.title,
        loadWhen: b.loadWhen,
        content: b.content || '',
        write: b.write || null,
        children: [],
      });
    }
    for (const b of tree.branches) {
      const parent = byId.get(b.parent === null ? ROOT_ID : b.parent);
      if (parent) parent.children.push(byId.get(b.path));
    }

    all = [...byId.values()];
    roots = [root];
    if (selected && !byId.has(selected)) selected = null;
    for (const o of [turn, probe]) {
      if (o) o.selected = new Set([...o.selected].filter(p => byId.has(p)));
    }
    count.textContent = `${tree.branches.length} branche(s)`;
  }

  // ── Mise en page ──────────────────────────────────────────────────────────

  function widthOf(n) {
    return n.id === selected ? NODE_W_ACTIVE : NODE_W;
  }

  function heightOf(n) {
    if (n.id !== selected) return NODE_H;
    const body = (n.content || '').trim();
    const lines = body ? Math.max(body.split('\n').length, Math.ceil(body.length / 62)) : 0;
    return Math.max(210, Math.min(560, 172 + lines * 19));
  }

  function rowWidth(children) {
    return children.reduce((sum, c, i) => sum + subtreeWidth(c) + (i ? GAP_X : 0), 0);
  }

  function subtreeWidth(n) {
    return n.children.length ? Math.max(widthOf(n), rowWidth(n.children)) : widthOf(n);
  }

  function place(n, left, top) {
    const span = subtreeWidth(n);
    n.w = widthOf(n);
    n.h = heightOf(n);
    n.x = left + (span - n.w) / 2;
    n.y = top;
    let childLeft = left + (span - rowWidth(n.children)) / 2;
    for (const c of n.children) {
      place(c, childLeft, top + n.h + GAP_Y);
      childLeft += subtreeWidth(c) + GAP_X;
    }
  }

  function layout() {
    let left = 0;
    for (const r of roots) {
      place(r, left, 0);
      left += subtreeWidth(r) + GAP_X;
    }
  }

  /** Coude orthogonal à angles arrondis — le `smoothstep` de Lacis. */
  function edgePath(p, c) {
    const x1 = p.x + p.w / 2;
    const y1 = p.y + p.h;
    const x2 = c.x + c.w / 2;
    const y2 = c.y;
    const my = y1 + (y2 - y1) / 2;
    if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} L${x2},${y2}`;
    const dir = x2 > x1 ? 1 : -1;
    const r = Math.min(12, Math.abs(x2 - x1) / 2, Math.abs(my - y1));
    return (
      `M${x1},${y1} L${x1},${my - r} Q${x1},${my} ${x1 + dir * r},${my} ` +
      `L${x2 - dir * r},${my} Q${x2},${my} ${x2},${my + r} L${x2},${y2}`
    );
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  // ── Markdown ──────────────────────────────────────────────────────────────
  //
  // Un rendu minimal, fait main : les branches sont de courts `.md`, et le vrai
  // rendu reste celui de l'éditeur, à un clic. Il s'agit juste de relire une
  // branche sans lire ses dièses. Tout passe par le DOM, jamais par `innerHTML`.

  const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

  function inline(target, text) {
    let last = 0;
    let m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text)) !== null) {
      if (m.index > last) target.append(document.createTextNode(text.slice(last, m.index)));
      const tag = m[1] ? 'code' : m[2] ? 'strong' : m[3] ? 'em' : 'span';
      const el = document.createElement(tag);
      // Pas de navigation depuis la webview : le lien se lit, il ne se suit pas.
      if (m[4] !== undefined) {
        el.className = 'link';
        el.title = m[5];
      }
      el.textContent = m[1] ?? m[2] ?? m[3] ?? m[4];
      target.append(el);
      last = m.index + m[0].length;
    }
    if (last < text.length) target.append(document.createTextNode(text.slice(last)));
    return target;
  }

  function markdown(root, text) {
    const lines = text.split('\n');
    let list = null;
    let para = null;

    const flush = () => {
      list = null;
      para = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const buf = [];
        while (++i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i]);
        const pre = document.createElement('pre');
        pre.textContent = buf.join('\n');
        root.append(pre);
        flush();
        continue;
      }

      if (!line.trim()) {
        flush();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const h = document.createElement('div');
        h.className = `md-h md-h${heading[1].length}`;
        inline(h, heading[2]);
        root.append(h);
        flush();
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        root.append(document.createElement('hr'));
        flush();
        continue;
      }

      const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (item) {
        if (!list) {
          list = document.createElement('ul');
          root.append(list);
        }
        const li = document.createElement('li');
        li.style.marginLeft = `${Math.floor(item[1].length / 2) * 14}px`;
        inline(li, item[2]);
        list.append(li);
        para = null;
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        const q = document.createElement('blockquote');
        inline(q, quote[1]);
        root.append(q);
        flush();
        continue;
      }

      // Lignes contiguës = un seul paragraphe : les retours doux du markdown ne
      // sont pas des sauts de ligne.
      if (para) {
        para.append(document.createTextNode(' '));
        inline(para, line);
        continue;
      }
      para = document.createElement('p');
      inline(para, line);
      root.append(para);
      list = null;
    }
  }

  /** La racine est toujours injectée, jamais routée : elle reste allumée. */
  function kept(id) {
    const o = overlay();
    return !o || id === ROOT_ID || o.selected.has(id);
  }

  function ago(at) {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    return seconds < 60 ? "à l'instant" : `il y a ${Math.round(seconds / 60)} min`;
  }

  /** Les boutons de la carte ouverte. La structure s'édite ici ; le contenu
   *  s'édite dans le `.md`, qui s'ouvre à côté. */
  function actions(n) {
    const row = document.createElement('div');
    row.className = 'actions';

    const button = (label, title, onClick) => {
      const b = document.createElement('button');
      b.className = 'act';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', e => {
        e.stopPropagation();
        onClick();
      });
      row.append(b);
      return b;
    };

    button('ouvrir le .md', "Éditer le contenu dans l'éditeur", () =>
      vscode.postMessage({ type: 'open', path: n.id }),
    );
    const edit = op => vscode.postMessage({ type: 'edit', op, path: n.id });
    button('+ enfant', 'Créer une branche sous celle-ci', () => edit('child'));
    if (n.id !== ROOT_ID) {
      button('renommer', 'Changer le titre', () => edit('rename'));
      button('type', 'Changer le type de branche', () => edit('type'));
      button('déplacer', 'Changer de parent', () => edit('move'));
      button('supprimer', 'Supprimer la branche et ses enfants', () => edit('delete')).classList.add(
        'danger',
      );
    }
    return row;
  }

  function card(n) {
    const el = document.createElement('div');
    const o = overlay();
    const lu = Boolean(o) && kept(n.id);
    el.className = `node${n.id === selected ? ' selected' : ''}${
      lu && o.reason === 'fallback' ? ' fallback' : ''
    }`;
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    el.style.width = `${n.w}px`;
    el.style.height = `${n.h}px`;
    el.style.setProperty('--ribbon', COLORS[n.type] || COLORS.root);

    const ribbon = document.createElement('div');
    ribbon.className = 'ribbon';

    const body = document.createElement('div');
    body.className = 'body';

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = n.title;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = n.type;
    head.append(title);
    // Le point de lecture, avant le badge de type : c'est la marque la plus
    // discrète qui se remarque quand même, et elle emprunte la couleur du type
    // plutôt que d'en ajouter une.
    if (lu) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = "lue par l'IA au dernier tour";
      head.append(dot);
    }
    head.append(badge);

    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = n.loadWhen;

    body.append(head, when);

    // La trace d'une écriture de l'IA, tant qu'elle est fraîche. L'arbre lui est
    // réinjecté ensuite : ce qu'elle y met doit se voir, sinon personne ne peut
    // corriger le bruit qu'elle produit.
    if (n.write) {
      el.classList.add('written');
      const mark = document.createElement('div');
      mark.className = 'written-mark';
      const verb = { upsert: 'écrite', delete: 'supprimée', move: 'déplacée' }[n.write.op] || 'touchée';
      mark.textContent = `✎ ${verb} par l'IA ${ago(n.write.at)}`;
      if (n.write.why) mark.title = n.write.why;
      body.append(mark);
      if (n.id === selected && n.write.why) {
        const why = document.createElement('div');
        why.className = 'written-why';
        why.textContent = n.write.why;
        body.append(why);
      }
    }

    if (n.id === selected) {
      const content = document.createElement('div');
      content.className = 'content';
      const md = (n.content || '').trim();
      if (md) markdown(content, md);
      else content.textContent = '(vide)';
      body.append(content, actions(n));
    }

    el.append(ribbon, body);
    el.addEventListener('click', e => {
      e.stopPropagation();
      select(n.id === selected ? null : n.id, n);
    });
    return el;
  }

  function render() {
    layout();
    layerNodes.textContent = '';
    layerEdges.textContent = '';

    let maxX = 0;
    let maxY = 0;
    for (const n of all) {
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
      for (const c of n.children) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', edgePath(n, c));
        if (c.id === selected || n.id === selected) {
          path.classList.add('lit');
          path.style.setProperty('--ribbon', COLORS[selected === n.id ? n.type : c.type]);
        }
        layerEdges.append(path);
      }
      layerNodes.append(card(n));
    }
    layerEdges.setAttribute('width', String(maxX + 40));
    layerEdges.setAttribute('height', String(maxY + 40));
    apply();
  }

  function apply() {
    scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  // ── Interactions ──────────────────────────────────────────────────────────

  /** Sélectionner agrandit la carte, donc décale tout : on compense pour que
   *  la carte cliquée ne saute pas sous le curseur. */
  function select(id, node) {
    const before = node ? { x: node.x + node.w / 2, y: node.y } : null;
    selected = id;
    layout();
    if (before && node) {
      view.x += (before.x - (node.x + node.w / 2)) * view.k;
      view.y += (before.y - node.y) * view.k;
    }
    render();
  }

  function bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of all) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }

  function fit() {
    if (!all.length) return;
    layout();
    const b = bounds();
    const pad = 48;
    const k = Math.min(1.2, (viewport.clientWidth - pad * 2) / b.w, (viewport.clientHeight - pad * 2) / b.h);
    view.k = Math.max(0.15, k);
    view.x = (viewport.clientWidth - b.w * view.k) / 2 - b.minX * view.k;
    view.y = (viewport.clientHeight - b.h * view.k) / 2 - b.minY * view.k;
    apply();
  }

  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(2.5, Math.max(0.15, view.k * factor));
    // Zoom centré sur le curseur : le point sous la souris ne bouge pas.
    view.x = e.clientX - ((e.clientX - view.x) * k) / view.k;
    view.y = e.clientY - ((e.clientY - view.y) * k) / view.k;
    view.k = k;
    apply();
  }, { passive: false });

  let panning = null;
  viewport.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    panning = { x: e.clientX - view.x, y: e.clientY - view.y };
    viewport.classList.add('panning');
  });
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    view.x = e.clientX - panning.x;
    view.y = e.clientY - panning.y;
    apply();
  });
  window.addEventListener('mouseup', () => {
    panning = null;
    viewport.classList.remove('panning');
  });
  viewport.addEventListener('dblclick', fit);
  viewport.addEventListener('click', () => {
    if (selected !== null) select(null, null);
  });
  document.getElementById('fit').addEventListener('click', fit);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (selected !== null) return select(null, null);
    if (probe) clearProbe();
  });

  // ── Routage ───────────────────────────────────────────────────────────────
  //
  // Deux questions différentes, un seul affichage :
  //  - « qu'est-ce qui a été chargé ? » — le journal, allumé en permanence ;
  //  - « qu'est-ce qui serait chargé pour ce prompt ? » — la sonde ci-dessous.
  // Un `load_when` ne se vérifie qu'en le confrontant à un prompt ; le bandeau
  // dit toujours laquelle des deux on regarde.

  const LABELS = {
    routed: 'routé',
    all: 'tout chargé',
    fallback: 'repli',
    deferred: 'différé — routage en tâche de fond',
  };

  function askProbe() {
    const prompt = promptInput.value.trim();
    if (!prompt) return clearProbe();
    trace.textContent = 'routage…';
    trace.className = '';
    excerpt.textContent = '';
    clearBtn.hidden = false;
    vscode.postMessage({ type: 'route', prompt });
  }

  function clearProbe() {
    probe = null;
    promptInput.value = '';
    clearBtn.hidden = true;
    paint();
    render();
  }

  /** Le bandeau : quelle question, quelle réponse, et surtout — repli ou pas. */
  function paint() {
    const o = overlay();
    if (!o) {
      trace.textContent = all.length ? 'aucun tour routé pour l\'instant' : '';
      trace.className = '';
      excerpt.textContent = '';
      return;
    }
    const total = Math.max(0, all.length - 1);
    const head = probe ? 'sonde' : `dernier tour · ${o.source}`;
    const bits = [head, `${o.selected.size}/${total}`, LABELS[o.reason] ?? o.reason];
    if (o.ms) bits.push(`${o.ms} ms`);
    trace.textContent = bits.join(' · ');
    // Un repli n'est pas un routage : il doit se voir sans être lu.
    trace.className = o.reason === 'fallback' ? 'warn' : '';
    excerpt.textContent =
      o.reason === 'fallback'
        ? `repli sur la sélection précédente${o.error ? ` — ${o.error}` : ''}`
        : o.reason === 'deferred'
          ? `sélection du tour précédent — le routage de « ${(o.prompt || '').slice(0, 60)} » tourne derrière`
          : o.prompt || '';
    excerpt.className = o.reason === 'fallback' ? 'warn' : '';
  }

  document.getElementById('go').addEventListener('click', askProbe);
  clearBtn.addEventListener('click', clearProbe);
  promptInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') askProbe();
  });

  // ── Cycle de vie ──────────────────────────────────────────────────────────

  for (const [type, color] of Object.entries(COLORS)) {
    if (type === 'root') continue;
    const chip = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = color;
    chip.append(swatch, document.createTextNode(type));
    legend.append(chip);
  }
  const readChip = document.createElement('span');
  const mark = document.createElement('i');
  mark.className = 'mark';
  readChip.append(mark, document.createTextNode('lu au dernier tour'));
  legend.append(readChip);

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'routed') {
      probe = msg.selected
        ? {
            selected: new Set(msg.selected),
            reason: msg.reason,
            prompt: promptInput.value.trim(),
            source: 'sonde',
            ms: msg.ms,
            error: msg.error,
          }
        : null;
      clearBtn.hidden = !promptInput.value.trim();
      if (!probe && msg.error) {
        trace.textContent = msg.error;
        trace.className = 'warn';
        excerpt.textContent = '';
      } else {
        paint();
      }
      render();
      return;
    }
    if (msg.type === 'turn') {
      const t = msg.turn;
      turn = t
        ? {
            selected: new Set(t.turn.selected),
            reason: t.turn.reason,
            prompt: t.turn.prompt,
            source: t.turn.source,
            error: t.turn.error,
          }
        : null;
      paint();
      render();
      return;
    }
    if (msg.type !== 'tree') return;
    if (!msg.tree) {
      all = [];
      roots = [];
      layerNodes.textContent = '';
      layerEdges.textContent = '';
      count.textContent = 'aucun arbre';
      paint();
      return;
    }
    const first = all.length === 0;
    build(msg.tree);
    paint();
    render();
    if (first) fit();
  });

  vscode.postMessage({ type: 'ready' });
})();
