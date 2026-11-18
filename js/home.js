'use strict';
/* Úvodní stránka: vlevo strom složek, vpravo obsah vybrané složky. */
const App = { folders: [], notebooks: [], cur: null, sort: 'name', search: '', selMode: false, sel: new Set(), settings: { pressure: true, folderOrder: 'name' }, theme: { side: '#1e222b', main: '#0b0d12', accent: '#4a9eea' } };

const Home = (() => {
  const THEMES = [
    ['Tmavý', '#1e222b', '#0b0d12', '#4a9eea'], ['Světlý', '#e7eaf0', '#ffffff', '#2f7de1'], ['Grafit', '#2b2b2f', '#17171a', '#f0a23a'],
    ['Les', '#1f2b25', '#0d1411', '#4fc38a'], ['Půlnoc', '#1b2040', '#0b0e22', '#8b7bff'], ['Písek', '#e6ddcd', '#f8f4ec', '#c2632d'],
  ];
  const kids = id => App.folders.filter(f => (f.parent || null) === id);
  const nbsIn = id => App.notebooks.filter(n => (n.folder || null) === id);
  const folder = id => App.folders.find(f => f.id === id);
  const countDeep = id => nbsIn(id).length + kids(id).reduce((a, f) => a + countDeep(f.id), 0);
  const byName = (a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true });
  const customOrder = () => App.settings.folderOrder === 'custom';
  const treeSort = (a, b) => customOrder() ? ((a.order ?? 1e9) - (b.order ?? 1e9)) || byName(a, b) : byName(a, b);
  const sorter = (a, b) => App.sort === 'name' ? byName(a, b) : App.sort === 'created' ? b.created - a.created : (b.modified || 0) - (a.modified || 0);
  const plural = (n, a, b, c) => `${n} ${n === 1 ? a : n > 1 && n < 5 ? b : c}`;
  function descendants(id) { return kids(id).flatMap(f => [f, ...descendants(f.id)]); }

  function applyTheme() {
    const t = App.theme, st = document.documentElement.style;
    const fg = lum(t.main) > 0.55 ? '#12161d' : '#ffffff', sfg = lum(t.side) > 0.55 ? '#12161d' : '#ffffff';
    const set = (k, v) => st.setProperty(k, v);
    set('--side', t.side); set('--main', t.main); set('--accent', t.accent);
    set('--fg', fg); set('--fg2', mix(fg, t.main, 0.42)); set('--line', mix(t.main, fg, 0.16)); set('--card', mix(t.main, fg, 0.05));
    set('--sfg', sfg); set('--sfg2', mix(sfg, t.side, 0.4)); set('--shi', mix(t.side, sfg, 0.13)); set('--sdim', mix(t.side, sfg, 0.07));
    set('--afg', lum(t.accent) > 0.62 ? '#10141a' : '#ffffff');
    const m = $('meta[name=theme-color]'); if (m) m.content = t.side;
  }

  function go(id) { App.cur = id; App.selMode = false; App.sel.clear(); if (App.search) { App.search = ''; $('#search').value = ''; } render(); }

  /* ---------- strom ---------- */
  function treeRows(parent, depth) {
    return kids(parent).sort(treeSort).flatMap(f => {
      const ch = kids(f.id), n = countDeep(f.id);
      const row = el('div', { class: 'trow' + (App.cur === f.id && !App.search ? ' on' : ''), style: { marginLeft: depth * 22 + 'px' }, dataset: { id: f.id }, onpointerdown: e => lpStart(e, f), onclick: () => { if (!noClick) go(f.id); } },
        el('span', { class: 'tdot' }, el('i', { style: { background: f.color } })),
        el('span', { class: 'tname', text: f.name }),
        n ? el('span', { class: 'tcount', text: n }) : null,
        ch.length ? el('button', { class: 'tchev' + (f.collapsed ? ' col' : ''), title: f.collapsed ? 'Rozbalit' : 'Sbalit', html: icon('chevD', 18), onclick: e => { e.stopPropagation(); f.collapsed = !f.collapsed; DB.put('folders', f); renderTree(); } }) : null);
      return f.collapsed ? [row] : [row, ...treeRows(f.id, depth + 1)];
    });
  }
  function renderTree() {
    $('#tree').replaceChildren(
      el('div', { class: 'trow root' + (App.cur === null && !App.search ? ' on' : ''), onclick: () => go(null) }, el('span', { class: 'tdot', html: icon('note', 18) }), el('span', { class: 'tname', text: 'Všechny sešity' }), el('span', { class: 'tcount', text: App.notebooks.length || '' })),
      ...treeRows(null, 0),
      el('button', { class: 'tadd', html: icon('plus', 18) + '<span>Nová složka</span>', onclick: () => newFolder(null) }));
  }

  /* ---------- podržení složky: nabídka, a když se prst pohne, přesouvání ---------- */
  let lp = null, noClick = false;
  function lpClear() {
    if (!lp) return;
    clearTimeout(lp.timer);
    document.removeEventListener('pointermove', lpMove); document.removeEventListener('pointerup', lpUp); document.removeEventListener('pointercancel', lpCancel);
    if (lp.ghost) lp.ghost.remove();
    $('#dropline').hidden = true;
    $$('#tree .trow').forEach(r => r.classList.remove('held', 'drop', 'dragging'));
    lp = null;
  }
  function lpStart(e, f) {
    if (e.button || e.target.closest('.tchev')) return;
    lpClear();
    const row = e.currentTarget;
    lp = { f, row, x: e.clientX, y: e.clientY, id: e.pointerId, armed: false, drag: false, target: null };
    lp.timer = setTimeout(() => {
      if (!lp) return;
      lp.armed = true; noClick = true; row.classList.add('held');
      showMenu(row, [{ icon: 'edit', label: 'Přejmenovat', action: () => renameFolder(f) }, { icon: 'trash', label: 'Smazat', danger: true, action: () => deleteItems([f], []) }], { above: true });
    }, 480);
    document.addEventListener('pointermove', lpMove); document.addEventListener('pointerup', lpUp); document.addEventListener('pointercancel', lpCancel);
  }
  function lpMove(e) {
    if (!lp || e.pointerId !== lp.id) return;
    const d = Math.hypot(e.clientX - lp.x, e.clientY - lp.y);
    if (!lp.armed) { if (d > 9) lpClear(); return; }
    if (!lp.drag) {
      if (d < 10) return;
      lp.drag = true; closePop();
      lp.row.classList.remove('held'); lp.row.classList.add('dragging');
      lp.ghost = el('div', { class: 'dragghost' }, el('i', { class: 'mvdot', style: { background: lp.f.color } }), lp.f.name);
      document.body.append(lp.ghost);
      lp.banned = new Set([lp.f.id, ...descendants(lp.f.id).map(x => x.id)]);
    }
    lp.ghost.style.transform = `translate(${e.clientX + 14}px,${e.clientY - 22}px)`;
    const tree = $('#tree'), tr = tree.getBoundingClientRect();
    if (e.clientY < tr.top + 44) tree.scrollTop -= 12; else if (e.clientY > tr.bottom - 44) tree.scrollTop += 12;
    lpTarget(e.clientX, e.clientY);
  }
  function lpTarget(x, y) {
    const rows = $$('#tree .trow'), line = $('#dropline'), sr = $('#side').getBoundingClientRect();
    rows.forEach(r => r.classList.remove('drop'));
    line.hidden = true; lp.target = null;
    if (x < sr.left || x > sr.right) return;
    const lineAt = (yy, left) => { line.hidden = false; line.style.top = yy - 1.5 + 'px'; line.style.left = left + 'px'; line.style.width = Math.max(40, sr.right - left - 16) + 'px'; };
    let hit = null;
    for (const r of rows) { const b = r.getBoundingClientRect(); if (y >= b.top - 2 && y <= b.bottom + 2) { hit = [r, b]; break; } }
    if (!hit) { // pod posledním řádkem = hlavní úroveň
      const last = rows[rows.length - 1].getBoundingClientRect();
      if (y > last.bottom) { lp.target = { mode: 'root' }; lineAt(last.bottom + 3, rows[0].getBoundingClientRect().left); }
      return;
    }
    const [r, b] = hit, id = r.dataset.id;
    if (!id) { lp.target = { mode: 'root' }; r.classList.add('drop'); return; }
    if (lp.banned.has(id)) return;
    const fr = (y - b.top) / b.height, tf = folder(id), open = !tf.collapsed && kids(id).some(k => !lp.banned.has(k.id));
    if (fr < 0.26) { lp.target = { mode: 'before', id }; lineAt(b.top - 2, b.left); }
    else if (fr > 0.74 && !open) { lp.target = { mode: 'after', id }; lineAt(b.bottom + 2, b.left); }
    else { lp.target = { mode: 'into', id }; r.classList.add('drop'); }
  }
  function lpUp(e) {
    if (!lp || e.pointerId !== lp.id) return;
    const { f, target, drag } = lp;
    lpClear();
    setTimeout(() => { noClick = false; }, 350);
    if (drag && target) dropFolder(f, target);
  }
  function lpCancel(e) { if (lp && e.pointerId === lp.id) { lpClear(); setTimeout(() => { noClick = false; }, 350); } }
  async function dropFolder(f, t) {
    const ref = t.mode === 'before' || t.mode === 'after' ? folder(t.id) : null;
    const parent = t.mode === 'into' ? t.id : ref ? (ref.parent || null) : null;
    f.parent = parent; f.modified = Date.now();
    if (customOrder()) {
      const sibs = kids(parent).filter(x => x !== f).sort(treeSort);
      sibs.splice(ref ? sibs.indexOf(ref) + (t.mode === 'after' ? 1 : 0) : sibs.length, 0, f);
      sibs.forEach((x, i) => { x.order = i; });
      await DB.putMany('folders', sibs);
    } else await DB.put('folders', f);
    const p = parent && folder(parent);
    if (p && p.collapsed) { p.collapsed = false; await DB.put('folders', p); }
    render();
  }
  async function setFolderOrder(k) {
    if (k === 'custom' && !customOrder()) { // vlastní pořadí začne ze současného abecedního
      const groups = new Map();
      for (const f of App.folders) { const key = f.parent || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f); }
      for (const g of groups.values()) g.sort(byName).forEach((f, i) => { f.order = i; });
      await DB.putMany('folders', App.folders);
    }
    App.settings.folderOrder = k;
    await DB.kvSet('settings', App.settings);
    render();
  }

  /* ---------- obsah ---------- */
  const key = (t, o) => t + ':' + o.id;
  function toggleSel(k) { App.sel.has(k) ? App.sel.delete(k) : App.sel.add(k); render(); }
  function folderCard(f) {
    const k = key('f', f), n = countDeep(f.id), sub = kids(f.id).length;
    return el('div', { class: 'fcard' + (App.sel.has(k) ? ' sel' : ''), onclick: e => { if (e.target.closest('button')) return; App.selMode ? toggleSel(k) : go(f.id); } },
      App.selMode ? el('span', { class: 'ck', html: App.sel.has(k) ? icon('check', 16) : '' }) : null,
      el('button', { class: 'fdot', title: 'Změnit barvu', style: { background: f.color }, onclick: e => pickColor(e.currentTarget, f) }),
      el('div', { class: 'fmeta' }, el('div', { class: 'fname', text: f.name }), el('div', { class: 'fsub', text: plural(n, 'sešit', 'sešity', 'sešitů') + (sub ? ' · ' + plural(sub, 'složka', 'složky', 'složek') : '') })),
      el('button', { class: 'more', html: icon('dots', 20), title: 'Možnosti', onclick: e => folderMenu(e.currentTarget, f) }));
  }
  function nbRow(nb) {
    const k = key('n', nb);
    return el('div', { class: 'nrow' + (App.sel.has(k) ? ' sel' : ''), onclick: e => { if (e.target.closest('button')) return; App.selMode ? toggleSel(k) : Editor.open(nb.id); } },
      App.selMode ? el('span', { class: 'ck', html: App.sel.has(k) ? icon('check', 16) : '' }) : null,
      el('div', { class: 'nthumb' }, nb.thumb ? el('img', { src: nb.thumb, alt: '' }) : null),
      el('div', { class: 'nmeta' }, el('div', { class: 'nname' }, nb.important ? el('span', { class: 'star', html: icon('star', 16), title: 'Důležité' }) : null, nb.name),
        App.search ? el('div', { class: 'fsub', text: nb.folder && folder(nb.folder) ? folder(nb.folder).name : 'Bez složky' }) : el('div', { class: 'fsub', text: plural((nb.pageIds || []).length, 'stránka', 'stránky', 'stránek') })),
      el('div', { class: 'ndate', text: fmtDate(nb.modified || nb.created) }),
      el('button', { class: 'more', html: icon('dots', 20), title: 'Možnosti', onclick: e => nbMenu(e.currentTarget, nb) }));
  }
  function renderMain() {
    const f = App.cur ? folder(App.cur) : null;
    if (App.cur && !f) App.cur = null;
    let fs, ns, title;
    if (App.search) {
      const q = App.search.toLowerCase();
      fs = App.folders.filter(x => x.name.toLowerCase().includes(q)); ns = App.notebooks.filter(x => x.name.toLowerCase().includes(q));
      title = 'Hledání';
    } else { fs = kids(App.cur); ns = nbsIn(App.cur); title = f ? f.name : 'Všechny sešity'; }
    fs = fs.slice().sort(sorter);
    ns = ns.slice().sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || sorter(a, b));
    const path = [];
    for (let x = f; x; x = folder(x.parent)) path.unshift(x);
    $('#crumbs').replaceChildren(...(f && !App.search ? [el('button', { class: 'crumb', text: 'Všechny sešity', onclick: () => go(null) }), ...path.slice(0, -1).flatMap(p => [el('span', { class: 'csep', text: '›' }), el('button', { class: 'crumb', text: p.name, onclick: () => go(p.id) })])] : []));
    const td = $('#title-dot');
    td.hidden = !f || !!App.search; if (f) { td.style.background = f.color; td.onclick = e => pickColor(e.currentTarget, f); }
    const h = $('#title');
    h.textContent = title; h.classList.toggle('editable', !!f && !App.search);
    h.onclick = f && !App.search ? () => renameFolder(f) : null;
    $('#b-sort span').textContent = { name: 'Název', created: 'Vytvořeno', modified: 'Upraveno' }[App.sort];
    $('#b-select').classList.toggle('on', App.selMode);
    $('#b-select span').textContent = App.selMode ? 'Hotovo' : 'Vybrat';
    const list = $('#list');
    list.replaceChildren(...[
      fs.length ? el('div', { class: 'fgrid' }, fs.map(folderCard)) : null,
      ns.length ? el('div', { class: 'nlist' }, ns.map(nbRow)) : null,
      !fs.length && !ns.length ? el('div', { class: 'empty' }, el('div', { class: 'empty-ic', html: icon(App.search ? 'search' : 'note', 44) }),
        el('p', { text: App.search ? 'Nic nenalezeno.' : 'Tady zatím nic není.' }), App.search ? null : el('p', { class: 'hint', text: 'Tlačítkem „Nový“ vpravo nahoře vytvoříš sešit, podsložku nebo naimportuješ PDF.' })) : null].filter(Boolean));
    renderSelBar();
  }
  function selected() {
    return { fs: App.folders.filter(f => App.sel.has('f:' + f.id)), ns: App.notebooks.filter(n => App.sel.has('n:' + n.id)) };
  }
  function renderSelBar() {
    const bar = $('#selbar');
    bar.hidden = !App.selMode;
    if (!App.selMode) return;
    const { fs, ns } = selected(), n = fs.length + ns.length;
    const b = (ic, label, fn, dis, cls = '') => el('button', { class: 'sbb ' + cls, disabled: dis, html: icon(ic, 20) + `<span>${label}</span>`, onclick: fn });
    bar.replaceChildren(el('span', { class: 'selinfo', text: n ? `Vybráno: ${n}` : 'Vyber složky nebo sešity' }),
      b('move', 'Přesunout', () => moveItems(fs, ns), !n),
      b('dup', 'Duplikovat', async () => { for (const x of ns) await dupNotebook(x); endSel(); }, !ns.length || !!fs.length),
      b('star', 'Důležité', async () => { const v = !ns.every(x => x.important); for (const x of ns) { x.important = v; await DB.put('notebooks', x); } endSel(); }, !ns.length || !!fs.length),
      b('share', 'Sdílet', () => shareNb(ns[0]), ns.length !== 1 || !!fs.length),
      b('edit', 'Přejmenovat', () => fs.length ? renameFolder(fs[0]) : renameNb(ns[0]), n !== 1),
      b('trash', 'Smazat', () => deleteItems(fs, ns), !n, 'red'));
  }
  function endSel() { App.selMode = false; App.sel.clear(); render(); }
  function render() { renderTree(); renderMain(); }

  /* ---------- akce ---------- */
  function pickColor(anchor, f) { showPop(anchor, colorGrid(f.color, async c => { closePop(); f.color = c; await DB.put('folders', f); render(); })); }
  async function newFolder(parent) {
    const name = await dlgPrompt(parent ? 'Nová podsložka' : 'Nová složka', '', 'Vytvořit');
    if (!name) return;
    const f = { id: uid(), parent: parent || null, name, color: PALETTE20[5 + (App.folders.length * 3) % 14], created: Date.now(), modified: Date.now(), collapsed: false, order: kids(parent || null).length };
    await DB.put('folders', f); App.folders.push(f);
    if (parent) { const p = folder(parent); if (p && p.collapsed) { p.collapsed = false; DB.put('folders', p); } }
    render();
  }
  async function renameFolder(f) { const n = await dlgPrompt('Přejmenovat složku', f.name); if (!n) return; f.name = n; f.modified = Date.now(); await DB.put('folders', f); endSel(); }
  async function renameNb(nb) { const n = await dlgPrompt('Přejmenovat sešit', nb.name); if (!n) return; nb.name = n; await DB.put('notebooks', nb); endSel(); }
  async function createNb(name, pages, paper) {
    const nb = { id: uid(), folder: App.cur, name, created: Date.now(), modified: Date.now(), important: false, paper: paper || Book.defPaper(), pageIds: [], thumb: null };
    const ps = pages ? pages(nb) : [Book.newPage(nb)];
    nb.pageIds = ps.map(p => p.id);
    await DB.savePages(ps); await DB.put('notebooks', nb);
    App.notebooks.push(nb);
    return nb;
  }
  async function newNotebook() {
    const name = await dlgPrompt('Nový sešit', '', 'Vytvořit');
    if (!name) return;
    const nb = await createNb(name);
    Editor.open(nb.id);
  }
  async function importPdf() {
    const [f] = await pickFiles('application/pdf,.pdf');
    if (!f) return;
    toast('Načítám PDF…', 6000);
    try {
      const id = uid(), ps = await IO.importPdf(f, id);
      const nb = { id, folder: App.cur, name: f.name.replace(/\.pdf$/i, ''), created: Date.now(), modified: Date.now(), important: false, paper: Book.defPaper(), pageIds: ps.map(p => p.id), thumb: null };
      await DB.savePages(ps); await DB.put('notebooks', nb); App.notebooks.push(nb);
      Editor.open(nb.id);
    } catch (e) { console.error(e); toast('PDF se nepodařilo načíst: ' + e.message); }
  }
  async function dupNotebook(nb) {
    const pages = await DB.loadPages(nb), id = uid();
    const ps = pages.map(p => ({ ...p, id: uid(), nb: id, items: p.items.map(it => ({ ...it, id: uid() })) }));
    const n = { ...nb, id, name: nb.name + ' (kopie)', created: Date.now(), modified: Date.now(), pageIds: ps.map(p => p.id) };
    await DB.savePages(ps); await DB.put('notebooks', n); App.notebooks.push(n);
  }
  async function shareNb(nb) { IO.exportDialog(nb, await DB.loadPages(nb), null); }
  async function deleteItems(fs, ns) {
    const allF = fs.flatMap(f => [f, ...descendants(f.id)]), fset = new Set(allF.map(f => f.id));
    const allN = App.notebooks.filter(n => fset.has(n.folder) || ns.includes(n));
    const what = [fs.length ? plural(fs.length, 'složku', 'složky', 'složek') : '', allN.length ? plural(allN.length, 'sešit', 'sešity', 'sešitů') : ''].filter(Boolean).join(' a ');
    if (!await dlgConfirm('Smazat?', `Opravdu smazat ${what}? Tohle nejde vrátit zpět.`)) return;
    for (const n of allN) await DB.deleteNotebook(n.id);
    await DB.delMany('folders', Array.from(fset));
    App.notebooks = App.notebooks.filter(n => !allN.includes(n)); App.folders = App.folders.filter(f => !fset.has(f.id));
    if (!Editor.hasClip()) DB.gc();
    endSel();
  }
  async function moveItems(fs, ns) {
    const banned = new Set(fs.flatMap(f => [f.id, ...descendants(f.id).map(d => d.id)]));
    let target;
    const rows = (parent, depth) => kids(parent).filter(f => !banned.has(f.id)).sort(byName).flatMap(f => [
      el('button', { class: 'mvrow', style: { paddingLeft: 14 + depth * 22 + 'px' }, onclick: e => pick(e, f.id) }, el('i', { class: 'mvdot', style: { background: f.color } }), f.name), ...rows(f.id, depth + 1)]);
    const pick = (e, id) => { target = id; $$('.mvrow').forEach(r => r.classList.remove('on')); e.currentTarget.classList.add('on'); };
    const body = el('div', { class: 'mvlist' }, el('button', { class: 'mvrow', onclick: e => pick(e, null), html: icon('note', 18) + '<span>Hlavní úroveň (bez složky)</span>' }), ...rows(null, 0));
    const ok = await modal('Přesunout do…', body, [{ label: 'Zrušit', value: null }, { label: 'Přesunout', cls: 'primary', value: () => target === undefined ? false : true }]);
    if (!ok) return;
    for (const f of fs) { f.parent = target; await DB.put('folders', f); }
    for (const n of ns) { n.folder = target; await DB.put('notebooks', n); }
    endSel();
  }
  function folderMenu(anchor, f) {
    showMenu(anchor, [
      { icon: 'edit', label: 'Přejmenovat', action: () => renameFolder(f) },
      { icon: 'folder', label: 'Nová podsložka', action: () => newFolder(f.id) },
      { icon: 'move', label: 'Přesunout', action: () => moveItems([f], []) },
      '-', { icon: 'trash', label: 'Smazat', danger: true, action: () => deleteItems([f], []) }], { align: 'right' });
  }
  function nbMenu(anchor, nb) {
    showMenu(anchor, [
      { icon: 'edit', label: 'Přejmenovat', action: () => renameNb(nb) },
      { icon: 'star', label: nb.important ? 'Zrušit důležité' : 'Označit jako důležité', action: async () => { nb.important = !nb.important; await DB.put('notebooks', nb); render(); } },
      { icon: 'dup', label: 'Duplikovat', action: async () => { await dupNotebook(nb); render(); } },
      { icon: 'move', label: 'Přesunout', action: () => moveItems([], [nb]) },
      { icon: 'share', label: 'Sdílet / export PDF', action: () => shareNb(nb) },
      '-', { icon: 'trash', label: 'Smazat', danger: true, action: () => deleteItems([], [nb]) }], { align: 'right' });
  }

  /* ---------- nastavení ---------- */
  async function settings() {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const pers = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const saveTheme = () => { applyTheme(); DB.kvSet('theme', App.theme); };
    const cin = (label, k) => {
      const i = el('input', { type: 'color', value: App.theme[k] });
      i.addEventListener('input', () => { App.theme[k] = i.value; saveTheme(); });
      return el('label', { class: 'crow' }, el('span', { text: label }), i);
    };
    const stat = el('p', { class: 'hint', text: est ? `Využito ${fmtSize(est.usage || 0)} z dostupných ${fmtSize(est.quota || 0)}. Trvalé úložiště: ${pers ? 'zapnuto' : 'zatím ne'}.` : 'Velikost úložiště nejde zjistit.' });
    const prog = el('p', { class: 'hint' });
    const segF = el('div', { class: 'seg' });
    const paintSeg = () => segF.replaceChildren(...[['name', 'Podle abecedy'], ['custom', 'Vlastní pořadí']].map(([k, label]) =>
      el('button', { class: 'segb' + ((App.settings.folderOrder || 'name') === k ? ' on' : ''), text: label, onclick: async () => { await setFolderOrder(k); paintSeg(); } })));
    paintSeg();
    const body = el('div', { class: 'settings' },
      el('h4', { text: 'Vzhled' }),
      el('div', { class: 'themes' }, THEMES.map(([n, s, m, a]) => el('button', { class: 'theme', onclick: () => { App.theme = { side: s, main: m, accent: a }; saveTheme(); $$('.crow input').forEach((x, i) => x.value = [s, m, a][i]); } },
        el('span', { class: 'tprev', style: { background: `linear-gradient(90deg, ${s} 0 38%, ${m} 38%)` } }, el('i', { style: { background: a } })), el('span', { text: n })))),
      cin('Boční panel a pozadí za papírem', 'side'), cin('Hlavní plocha', 'main'), cin('Zvýraznění (tlačítka)', 'accent'),
      el('h4', { text: 'Složky v levém panelu' }), segF,
      el('p', { class: 'hint', text: 'Podrž prst na složce: objeví se Přejmenovat a Smazat. Když prst nepustíš a potáhneš, složku přesuneš do jiné složky nebo ven. Při vlastním pořadí si tažením určíš i pořadí složek.' }),
      el('h4', { text: 'Pero' }),
      el('label', { class: 'crow' }, el('span', { text: 'Tloušťka čáry podle přítlaku tužky' }), el('input', { type: 'checkbox', class: 'sw-check', checked: App.settings.pressure, onchange: e => { App.settings.pressure = e.target.checked; DB.kvSet('settings', App.settings); } })),
      el('h4', { text: 'Úložiště' }), stat,
      pers ? null : el('button', { class: 'btn', text: 'Zapnout trvalé úložiště', onclick: async e => { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; toast(ok ? 'Trvalé úložiště je zapnuté' : 'iPad ho zatím nepovolil – přidej aplikaci na plochu a zkus to znovu'); if (ok) e.target.remove(); } }),
      el('h4', { text: 'Záloha' }),
      el('p', { class: 'hint', text: 'Záloha uloží všechny složky, sešity, fotky i PDF do jednoho souboru. Obnova data doplní a přepíše stejné sešity novější verzí ze zálohy.' }),
      el('div', { class: 'brow' },
        el('button', { class: 'btn', html: icon('download', 18) + '<span>Vytvořit zálohu</span>', onclick: async () => {
          try { prog.textContent = 'Připravuji zálohu…'; const b = await IO.backup((i, n) => prog.textContent = `Připravuji zálohu… ${i} / ${n}`); prog.textContent = `Záloha je hotová (${fmtSize(b.size)}).`;
            const d = new Date(), name = `zapisnik-zaloha-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zapisnik`;
            body.querySelector('.bshare')?.remove();
            prog.after(el('button', { class: 'btn primary bshare', html: icon('share', 18) + '<span>Uložit / sdílet soubor zálohy</span>', onclick: () => shareFile(b, name, 'application/octet-stream') }));
          } catch (e) { console.error(e); prog.textContent = 'Zálohu se nepodařilo vytvořit: ' + e.message; }
        } }),
        el('button', { class: 'btn', html: icon('upload', 18) + '<span>Obnovit ze zálohy</span>', onclick: async () => {
          const [f] = await pickFiles('');
          if (!f) return;
          try { prog.textContent = 'Obnovuji…'; await IO.restore(f, (a, b) => prog.textContent = `Obnovuji… ${Math.round(a / b * 100)} %`); await load(); applyTheme(); render(); prog.textContent = 'Obnova je hotová.'; toast('Data ze zálohy jsou obnovená'); }
          catch (e) { console.error(e); prog.textContent = 'Obnova se nepovedla: ' + e.message; }
        } })), prog);
    modal('Nastavení', body, [{ label: 'Hotovo', cls: 'primary', value: null }], { cls: 'wide' });
  }

  async function load() {
    App.folders = await DB.all('folders'); App.notebooks = await DB.all('notebooks');
    App.theme = Object.assign({}, App.theme, await DB.kvGet('theme', {}));
    App.settings = Object.assign({ pressure: true, folderOrder: 'name' }, await DB.kvGet('settings', {}));
    App.sort = await DB.kvGet('sort', 'name');
  }
  async function refresh() { App.notebooks = await DB.all('notebooks'); render(); }
  function init() {
    $('#b-settings').onclick = settings;
    $('#tree').addEventListener('touchmove', e => { if (lp && lp.armed && e.cancelable) e.preventDefault(); }, { passive: false }); // při tažení složky se panel neposouvá
    $('#tree').addEventListener('contextmenu', e => e.preventDefault());
    $('#search').addEventListener('input', e => { App.search = e.target.value.trim(); render(); });
    $('#b-sort').onclick = e => showMenu(e.currentTarget, [['name', 'Podle názvu'], ['created', 'Podle data vytvoření'], ['modified', 'Podle poslední úpravy']].map(([k, label]) =>
      ({ icon: App.sort === k ? 'check' : null, label, action: () => { App.sort = k; DB.kvSet('sort', k); render(); } })), { align: 'right' });
    $('#b-select').onclick = () => { App.selMode = !App.selMode; App.sel.clear(); render(); };
    $('#b-new').onclick = e => showMenu(e.currentTarget, [
      { icon: 'note', label: 'Nový sešit', action: newNotebook },
      { icon: 'folder', label: App.cur ? 'Nová podsložka' : 'Nová složka', action: () => newFolder(App.cur) },
      { icon: 'pdf', label: 'Importovat PDF ze Souborů', action: importPdf }], { align: 'right' });
  }
  return { init, load, render, refresh, applyTheme };
})();
