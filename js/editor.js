'use strict';
/* Sešit: papír, nástroje, výběr, text, obrázky, stránky. Prst jen posouvá a přibližuje, kreslí tužka (nebo myš). */
const Editor = (() => {
  const E = { open: false, pages: [], view: { s: 1, tx: 0, ty: 0 }, hide: new Set(), undo: [], redo: [], sel: null, act: null, txt: null, crop: null, tx: null };
  let stage, cv, ctx, live, lctx, overlay, T, clip = null, pclip = null;
  let TOP_M = 124; const BOT_M = 110;
  const DEF_TOOLS = {
    pen: { colors: ['#00783a', '#ee3524', '#f5c60e', '#5f2c91', '#111111', '#0a6cf5', '#8a8a8a', '#f08a24'], ci: 4, custom: null, widths: [0.8, 1.4, 2.2, 3.5], wi: 1, dash: 0 },
    hl: { colors: ['#fff176', '#b9f6a5', '#ffb3d1', '#a5d8ff', '#ffd08a', '#d9b8ff', '#a7f3ee', '#d9d9d9'], ci: 0, custom: null, widths: [6, 12, 18, 26], wi: 1, dash: 0 },
    er: { sizes: [6, 14, 30], si: 1, auto: false, whole: false },
    sel: { mode: 'box' },
    txt: { font: Txt.FONTS[0][1], size: 14, color: '#111111' },
  };
  const saveTools = () => DB.kvSet('tools', T);
  const curColor = t => t.custom || t.colors[t.ci];

  /* ================= souřadnice a pohled ================= */
  const s2w = (x, y) => [(x - E.view.tx) / E.view.s, (y - E.view.ty) / E.view.s];
  const origin = p => [-p._w / 2, p._y];
  function layoutPages() {
    let y = 0; E.maxW = 0;
    for (const p of E.pages) { const z = Book.pageSize(p, E.nb); p._y = y; p._w = z.w; p._h = z.h; y += z.h; E.maxW = Math.max(E.maxW, z.w); }
    E.totalH = y;
  }
  function pageAt(wx, wy, loose) {
    for (const p of E.pages) if (wy >= p._y && wy < p._y + p._h && (loose || Math.abs(wx) <= p._w / 2)) return p;
    return loose ? (wy < 0 ? E.pages[0] : E.pages[E.pages.length - 1]) : null;
  }
  const fitS = () => Math.max(0.05, (E.vw - 32) / E.maxW);
  function clampView() {
    const v = E.view, f = fitS();
    v.s = clamp(v.s, f * 0.3, f * 6);
    const cw = E.maxW * v.s, ch = E.totalH * v.s;
    v.tx = cw <= E.vw ? E.vw / 2 : clamp(v.tx, E.vw - cw / 2 - 40, cw / 2 + 40);
    v.ty = ch + TOP_M + BOT_M <= E.vh ? Math.max(TOP_M, (E.vh - ch) / 2) : clamp(v.ty, E.vh - ch - BOT_M, TOP_M);
  }
  function zoomAt(sx, sy, ns) {
    const v = E.view, f = fitS();
    ns = clamp(ns, f * 0.3, f * 6);
    const [wx, wy] = s2w(sx, sy);
    v.s = ns; v.tx = sx - wx * ns; v.ty = sy - wy * ns;
  }
  function curIdx() {
    const wy = (E.vh * 0.45 - E.view.ty) / E.view.s;
    for (let i = 0; i < E.pages.length; i++) if (wy < E.pages[i]._y + E.pages[i]._h) return i;
    return E.pages.length - 1;
  }
  function gotoPage(p) { E.view.ty = TOP_M - p._y * E.view.s; viewChanged(); }

  /* ================= kreslení ================= */
  let rafId = 0, idleT = 0;
  function requestRender() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
  function viewChanged(interactive) {
    clampView();
    if (E.slow && interactive && E.rv) {
      const v = E.view, k = v.s / E.rv.s;
      cv.style.transform = `translate(${v.tx - E.rv.tx * k}px,${v.ty - E.rv.ty * k}px) scale(${k})`;
      clearTimeout(idleT); idleT = setTimeout(requestRender, 110);
    } else requestRender();
    updateOverlay();
  }
  function pageTf(c, p) {
    const v = E.view, d = E.dpr;
    c.setTransform(d * v.s, 0, 0, d * v.s, d * (v.tx - p._w / 2 * v.s), d * (v.ty + p._y * v.s));
  }
  function clipPages(c, list) {
    const v = E.view;
    c.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    c.beginPath();
    for (const p of list) c.rect(v.tx - p._w / 2 * v.s, v.ty + p._y * v.s, p._w * v.s, p._h * v.s);
    c.clip();
  }
  function visible() {
    const y0 = -E.view.ty / E.view.s, y1 = (E.vh - E.view.ty) / E.view.s, out = [];
    E.pages.forEach((p, i) => { if (p._y + p._h > y0 && p._y < y1) out.push(i); });
    return out;
  }
  const isDark = p => !p.bg && Render.paperDark(E.nb.paper);
  function render() {
    if (!E.open) return;
    const t0 = performance.now(), v = E.view, d = E.dpr;
    cv.style.transform = '';
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = E.backdrop; ctx.fillRect(0, 0, E.vw, E.vh);
    const vi = visible(), vis = vi.map(i => E.pages[i]);
    for (const p of vis) {
      pageTf(ctx, p);
      const bgc = p.bg ? Render.bg(p, v.s * d) : null;
      if (p.bg && !bgc) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p._w, p._h); }
      else Render.drawPaper(ctx, p._w, p._h, E.nb.paper, bgc);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.strokeStyle = 'rgba(96,120,160,.75)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
    ctx.beginPath();
    for (const p of vis) if (p !== E.pages[E.pages.length - 1]) {
      const y = Math.round(v.ty + (p._y + p._h) * v.s) + 0.5;
      ctx.moveTo(v.tx - p._w / 2 * v.s, y); ctx.lineTo(v.tx + p._w / 2 * v.s, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (vi.length) {
      const ext = [];
      for (let i = Math.max(0, vi[0] - 1); i <= Math.min(E.pages.length - 1, vi[vi.length - 1] + 1); i++) ext.push(E.pages[i]);
      ctx.save();
      clipPages(ctx, vis);
      const x0 = -v.tx / v.s, x1 = (E.vw - v.tx) / v.s, y0 = -v.ty / v.s, y1 = (E.vh - v.ty) / v.s;
      for (const p of ext) {
        pageTf(ctx, p);
        Render.drawItems(ctx, p.items, isDark(p), E.hide, [x0 + p._w / 2, y0 - p._y, x1 + p._w / 2, y1 - p._y]);
      }
      ctx.restore();
    }
    E.rv = { ...v };
    E.slow = performance.now() - t0 > 14;
    drawLive();
    updateIndicator();
  }
  function drawOne(p, it) { // nový tah se jen přikreslí, nepřekresluje se celá stránka
    if (cv.style.transform) return requestRender();
    ctx.save();
    clipPages(ctx, visible().map(i => E.pages[i]));
    pageTf(ctx, p);
    Render.drawItem(ctx, it, isDark(p));
    ctx.restore();
  }
  let liveRaf = 0;
  function requestLive() { if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; drawLive(); }); }
  function drawLive() {
    const d = E.dpr, a = E.act, v = E.view;
    lctx.setTransform(d, 0, 0, d, 0, 0);
    lctx.clearRect(0, 0, E.vw, E.vh);
    live.style.mixBlendMode = 'normal';
    if (E.crop) drawCrop();
    if (!a) return;
    if (a.type === 'stroke') {
      const dark = isDark(a.page);
      if (a.k === 'h' && !dark) live.style.mixBlendMode = 'multiply';
      lctx.save();
      clipPages(lctx, visible().map(i => E.pages[i]));
      pageTf(lctx, a.page);
      Render.drawItem(lctx, a.shape ? shapeItem(a) : { t: 's', k: a.k, c: a.c, w: a.w, d: a.d, pr: a.pr, pts: encPts(a.raw) }, dark);
      lctx.restore();
    } else if (a.type === 'erase') {
      lctx.beginPath(); lctx.arc(a.sx, a.sy, Math.max(3, a.R * v.s), 0, 7);
      lctx.fillStyle = 'rgba(255,255,255,.55)'; lctx.fill();
      lctx.strokeStyle = 'rgba(40,50,70,.8)'; lctx.lineWidth = 1.2; lctx.stroke();
    } else if (a.type === 'region' || a.type === 'textbox') {
      lctx.strokeStyle = '#3d8fe6'; lctx.lineWidth = 1.5; lctx.setLineDash([6, 5]);
      lctx.fillStyle = 'rgba(61,143,230,.07)';
      lctx.beginPath();
      if (a.type === 'textbox' || a.mode === 'box') { lctx.rect(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1), Math.abs(a.x1 - a.x0), Math.abs(a.y1 - a.y0)); lctx.fill(); }
      else a.pts.forEach((p, i) => i ? lctx.lineTo(p[0], p[1]) : lctx.moveTo(p[0], p[1])); // volný výběr: jen čára, uzavře se až po zvednutí
      lctx.stroke(); lctx.setLineDash([]);
    } else if (a.type === 'xform' && a.moved) {
      lctx.save();
      clipPages(lctx, E.pages);
      const M = a.M;
      for (const { page, it } of a.items) {
        if (a.preview) { pageTf(lctx, page); Render.drawItem(lctx, a.preview, isDark(page)); continue; }
        lctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.tx, d * v.ty);
        lctx.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
        lctx.translate(-page._w / 2, page._y);
        Render.drawItem(lctx, it, isDark(page));
      }
      lctx.restore();
    }
  }

  /* ================= historie (zpět / vpřed) a ukládání ================= */
  const dirty = new Set();
  let saveT = 0;
  function flushSave() {
    clearTimeout(saveT); saveT = 0; firstDirty = 0;
    const ps = Array.from(dirty).filter(p => E.pages.includes(p));
    dirty.clear();
    const jobs = [DB.savePages(ps)];
    if (E.nbDirty) { E.nbDirty = false; E.nb.pageIds = E.pages.map(p => p.id); jobs.push(DB.put('notebooks', E.nb)); }
    return Promise.all(jobs).catch(e => { console.error(e); toast('Pozor: uložení se nepovedlo (' + e.message + ')'); });
  }
  let firstDirty = 0;
  function saveTick() { if (penId != null) { saveT = setTimeout(saveTick, 400); return; } flushSave(); }
  function markDirty(p) {
    if (p) dirty.add(p);
    E.changed = true; E.nbDirty = true; E.nb.modified = Date.now();
    const now = performance.now();
    if (!firstDirty) firstDirty = now;
    clearTimeout(saveT);
    saveT = setTimeout(saveTick, now - firstDirty > 6000 ? 250 : 1000);
  }
  function txBegin() { if (E.tx) txCommit(); E.tx = { order: E.pages.slice(), pages: new Map() }; }
  function touch(p) { if (!E.tx.pages.has(p)) E.tx.pages.set(p, p.items); }
  function txCommit() {
    const tx = E.tx; E.tx = null;
    if (!tx) return;
    const sameOrder = tx.order.length === E.pages.length && tx.order.every((p, i) => p === E.pages[i]);
    const ch = Array.from(tx.pages).filter(([p, items]) => p.items !== items);
    if (sameOrder && !ch.length) return;
    E.undo.push({ o0: tx.order, o1: E.pages.slice(), items: ch.map(([p, i0]) => [p, i0, p.items]) });
    if (E.undo.length > 150) E.undo.shift();
    E.redo = [];
    persist(tx.order, ch.map(c => c[0]));
  }
  function persist(prevOrder, touched) {
    const now = new Set(E.pages), before = new Set(prevOrder);
    const gone = prevOrder.filter(p => !now.has(p));
    if (gone.length) DB.delMany('pages', gone.map(p => p.id));
    E.pages.forEach(p => { if (!before.has(p)) dirty.add(p); });
    touched.forEach(p => dirty.add(p));
    markDirty(null);
    layoutPages();
    updateHist(); Pages.refresh();
  }
  function stepHistory(from, to, fwd) {
    if (E.act) return;
    commitText(); setSel(null); exitCrop(false);
    if (E.tx) txCommit();
    const e = from.pop();
    if (!e) return;
    to.push(e);
    const prev = E.pages;
    E.pages = (fwd ? e.o1 : e.o0).slice();
    for (const [p, i0, i1] of e.items) p.items = fwd ? i1 : i0;
    persist(prev, e.items.map(x => x[0]));
    viewChanged();
  }
  const undo = () => stepHistory(E.undo, E.redo, false);
  const redo = () => stepHistory(E.redo, E.undo, true);
  function updateHist() { $('#b-undo').disabled = !E.undo.length; $('#b-redo').disabled = !E.redo.length; }

  /* ================= nástroje a lišta ================= */
  function setTool(t) {
    commitText();
    if (t !== 'select' && E.sel) setSel(null);
    if (E.tool !== t && E.tool !== 'eraser') E.prevTool = E.tool;
    E.tool = t;
    $$('#tools .tbtn').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    renderSub();
  }
  const sep = () => el('span', { class: 'vsep' });
  function sliderPop(anchor, val, min, max, step, onInput, onDone) {
    const lab = el('span', { class: 'sl-val', text: String(val) });
    const inp = el('input', { type: 'range', min, max, step, value: val, class: 'slider' });
    inp.addEventListener('input', () => { lab.textContent = inp.value; onInput(+inp.value); });
    inp.addEventListener('change', () => onDone(+inp.value));
    showPop(anchor, el('div', { class: 'sl-pop' }, inp, lab), { cls: 'dark', align: 'center' });
  }
  function subStroke(t, hl) {
    const row = [];
    t.colors.forEach((c, i) => row.push(el('button', {
      class: 'sw' + (!t.custom && t.ci === i ? ' on' : ''), style: { background: c }, title: 'Barva (druhé ťuknutí barvu změní)',
      onclick: ev => {
        if (!t.custom && t.ci === i) showPop(ev.currentTarget, colorGrid(c, nc => { t.colors[i] = nc; closePop(); saveTools(); renderSub(); }), { cls: 'dark', align: 'center' });
        else { t.ci = i; t.custom = null; saveTools(); renderSub(); }
      }
    })));
    const inp = el('input', { type: 'color', class: 'cinput', value: t.custom || '#ff00aa' });
    inp.addEventListener('input', () => { t.custom = inp.value; });
    inp.addEventListener('change', () => { t.custom = inp.value; saveTools(); renderSub(); });
    row.push(el('label', { class: 'sw rainbow' + (t.custom ? ' on' : ''), title: 'Libovolná barva', onclick: () => { if (!t.custom) { t.custom = inp.value; saveTools(); } } }, inp));
    row.push(sep());
    const [mn, mx, st] = hl ? [4, 40, 1] : [0.3, 10, 0.1];
    t.widths.forEach((w, i) => {
      const dot = el('i', { style: { width: clamp(hl ? w * 0.55 : 2.5 + w * 1.6, 3, 20) + 'px', height: clamp(hl ? w * 0.55 : 2.5 + w * 1.6, 3, 20) + 'px' } });
      row.push(el('button', {
        class: 'wdot' + (t.wi === i ? ' on' : ''), title: 'Tloušťka (druhé ťuknutí otevře posuvník)', onclick: ev => {
          if (t.wi === i) sliderPop(ev.currentTarget, w, mn, mx, st, v => { t.widths[i] = v; const z = clamp(hl ? v * 0.55 : 2.5 + v * 1.6, 3, 20) + 'px'; dot.style.width = dot.style.height = z; }, () => saveTools());
          else { t.wi = i; saveTools(); renderSub(); }
        }
      }, dot));
    });
    row.push(sep());
    [0, 1, 2].forEach(d => row.push(el('button', { class: 'sbtn' + (t.dash === d ? ' on' : ''), title: ['Plná čára', 'Čárkovaná', 'Tečkovaná'][d], html: icon('line' + d, 22), onclick: () => { t.dash = d; saveTools(); renderSub(); } })));
    return row;
  }
  function subEraser() {
    const t = T.er, row = [];
    t.sizes.forEach((z, i) => {
      const dot = el('i', { style: { width: clamp(3 + z * 0.5, 4, 24) + 'px', height: clamp(3 + z * 0.5, 4, 24) + 'px' } });
      row.push(el('button', {
        class: 'edot' + (t.si === i ? ' on' : ''), title: 'Velikost gumy (druhé ťuknutí otevře posuvník)', onclick: ev => {
          if (t.si === i) sliderPop(ev.currentTarget, z, 3, 80, 1, v => { t.sizes[i] = v; dot.style.width = dot.style.height = clamp(3 + v * 0.5, 4, 24) + 'px'; }, () => saveTools());
          else { t.si = i; saveTools(); renderSub(); }
        }
      }, dot));
    });
    row.push(sep());
    row.push(el('button', { class: 'chip' + (t.auto ? ' on' : ''), html: icon('ret', 18) + '<span>Jednou</span>', title: 'Po zvednutí tužky se vrátí předchozí nástroj', onclick: () => { t.auto = true; saveTools(); renderSub(); } }));
    row.push(el('button', { class: 'chip' + (!t.auto ? ' on' : ''), html: icon('lock', 18) + '<span>Držet</span>', title: 'Guma zůstane, dokud nezvolíš jiný nástroj', onclick: () => { t.auto = false; saveTools(); renderSub(); } }));
    row.push(sep());
    row.push(el('button', { class: 'sbtn tog' + (t.whole ? ' on' : ''), title: 'Mazat celý tah najednou', 'aria-label': 'Mazat celý tah najednou', html: icon('erWhole', 24), onclick: () => { t.whole = !t.whole; saveTools(); renderSub(); } }));
    return row;
  }
  function subSelect() {
    return [['free', 'lasso', 'Volný tvar'], ['box', 'box', 'Obdélník']].map(([m, ic, label]) =>
      el('button', { class: 'chip' + (T.sel.mode === m ? ' on' : ''), html: icon(ic, 20) + `<span>${label}</span>`, onclick: () => { T.sel.mode = m; saveTools(); renderSub(); } }));
  }
  function setTxt(patch) {
    Object.assign(T.txt, patch); saveTools();
    if (E.txt) { Object.assign(E.txt.it, patch); Txt.styleBox(E.txt.el, E.txt.it); E.txt.el.focus(); }
    renderSub();
  }
  function subText() {
    const t = T.txt, st = E.txt ? Txt.state(E.txt.el) : {};
    const keep = e => e.preventDefault();
    const b = (c, inner, title, on) => el('button', { class: 'sbtn' + (on ? ' on' : ''), title, html: inner, onpointerdown: keep, onclick: () => { if (!E.txt) return toast('Nejdřív tužkou označ na papíře místo pro text'); E.txt.el.focus(); Txt.cmd(E.txt.el, c); renderSub(); } });
    const font = el('select', { class: 'tsel', title: 'Písmo', onchange: e => setTxt({ font: e.target.value }) }, Txt.FONTS.map(([n, f]) => el('option', { value: f, text: n, selected: f === t.font })));
    return [font,
      el('button', { class: 'sbtn', text: '−', title: 'Menší písmo', onpointerdown: keep, onclick: () => setTxt({ size: clamp(t.size - 1, 6, 96) }) }),
      el('span', { class: 'tsize', text: t.size }),
      el('button', { class: 'sbtn', text: '+', title: 'Větší písmo', onpointerdown: keep, onclick: () => setTxt({ size: clamp(t.size + 1, 6, 96) }) }),
      el('button', { class: 'sw', style: { background: t.color }, title: 'Barva textu', onpointerdown: keep, onclick: ev => showPop(ev.currentTarget, colorGrid(t.color, c => { closePop(); setTxt({ color: c }); }), { cls: 'dark', align: 'center' }) }),
      sep(),
      b('bold', '<b>B</b>', 'Tučně', st.bold), b('italic', '<i>I</i>', 'Kurzíva', st.italic), b('underline', '<u>U</u>', 'Podtržení', st.underline),
      sep(),
      b('ul', icon('ul', 20), 'Odrážky', st.ul), b('ol', icon('ol', 20), 'Číslování', st.ol),
      b('left', icon('alignL', 20), 'Zarovnat vlevo', st.align === 'left'), b('center', icon('alignC', 20), 'Na střed', st.align === 'center'), b('right', icon('alignR', 20), 'Zarovnat vpravo', st.align === 'right'),
      b('outdent', icon('outdent', 20), 'Menší odsazení'), b('indent', icon('indent', 20), 'Odsadit (tabulátor)')];
  }
  function renderSub() {
    const sub = $('#sub');
    sub.replaceChildren(...(E.tool === 'pen' ? subStroke(T.pen, false) : E.tool === 'hl' ? subStroke(T.hl, true) : E.tool === 'eraser' ? subEraser() : E.tool === 'select' ? subSelect() : subText()));
  }

  /* ================= výběr ================= */
  function selItems() {
    const out = [];
    if (E.sel) for (const e of E.sel.list) { const it = e.page.items.find(i => i.id === e.id); if (it && E.pages.includes(e.page)) out.push({ page: e.page, it }); }
    return out;
  }
  function calcFrame() {
    const L = selItems();
    if (!L.length) { E.sel = null; return; }
    const s = E.sel;
    s.list = L.map(x => ({ page: x.page, id: x.it.id }));
    s.single = null; s.shape = null; s.line = null; s.mid = false; s.locked = false;
    if (L.length === 1 && L[0].it.t !== 's') {
      const { page, it } = L[0], [ox, oy] = origin(page), [w, h] = boxSize(it), c = Math.cos(it.r || 0), sn = Math.sin(it.r || 0);
      s.frame = { cx: ox + it.x + w / 2 * c - h / 2 * sn, cy: oy + it.y + w / 2 * sn + h / 2 * c, w, h, r: it.r || 0 };
      s.single = it; s.locked = !!it.locked;
    } else {
      let b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const { page, it } of L) { const [ox, oy] = origin(page), q = itemBBox(it); b = [Math.min(b[0], q[0] + ox), Math.min(b[1], q[1] + oy), Math.max(b[2], q[2] + ox), Math.max(b[3], q[3] + oy)]; }
      s.frame = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1], r: 0 };
      if (L.length === 1 && L[0].it.sp) { // rozpoznaný tvar: chová se jako obrázek
        const { page, it } = L[0], [ox, oy] = origin(page), p = it.pts;
        s.shape = it; s.locked = !!it.locked; s.mid = it.sp === 'ell';
        if ((it.sp === 'line' || it.sp === 'arrow') && p.length >= 6) s.line = [[p[0] / PQ + ox, p[1] / PQ + oy], [p[3] / PQ + ox, p[4] / PQ + oy]];
      }
    }
  }
  function setSel(list, menu) {
    closePop();
    E.sel = list && list.length ? { list, menu: !!menu } : null;
    if (E.sel) calcFrame();
    updateOverlay();
  }
  function frameWith(f, M) {
    const k = Math.hypot(M[0], M[1]);
    return { cx: M[0] * f.cx + M[2] * f.cy + M[4], cy: M[1] * f.cx + M[3] * f.cy + M[5], w: f.w * k, h: f.h * k, r: f.r + Math.atan2(M[1], M[0]) };
  }
  const PAD = 7;
  function selHit(sx, sy) {
    if (!E.sel) return null;
    const s = E.sel, f = s.frame, v = E.view;
    if (s.line) { // přímka a šipka: bod na každém konci
      const [a, b] = s.line.map(p => [p[0] * v.s + v.tx, p[1] * v.s + v.ty]);
      if (!s.locked) {
        if (Math.hypot(sx - b[0], sy - b[1]) < 22) return { type: 'end', i: 1 };
        if (Math.hypot(sx - a[0], sy - a[1]) < 22) return { type: 'end', i: 0 };
      }
      return distSeg(sx, sy, a[0], a[1], b[0], b[1]) < 20 ? { type: 'move' } : null;
    }
    const dx = sx - (f.cx * v.s + v.tx), dy = sy - (f.cy * v.s + v.ty);
    const c = Math.cos(-f.r), sn = Math.sin(-f.r), lx = dx * c - dy * sn, ly = dx * sn + dy * c;
    const hw = f.w * v.s / 2 + PAD, hh = f.h * v.s / 2 + PAD;
    if (!s.locked) {
      if (Math.hypot(lx - (hw + 34), ly) < 22) return { type: 'rotate' };
      for (const [ax, ay] of s.mid ? [[0, -1], [1, 0], [0, 1], [-1, 0]] : [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (Math.hypot(lx - ax * hw, ly - ay * hh) < 20) return { type: 'scale', ax, ay };
    }
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh ? { type: 'move' } : null;
  }
  function xformStart(hit, sx, sy, ptr) {
    const f = E.sel.frame, [wx, wy] = s2w(sx, sy);
    E.act = { type: 'xform', hit, ptr, sx, sy, wx, wy, f0: { ...f }, items: selItems(), M: [1, 0, 0, 1, 0, 0], moved: false };
    if (hit.type === 'scale') {
      const c = Math.cos(f.r), s = Math.sin(f.r), lx = -hit.ax * f.w / 2, ly = -hit.ay * f.h / 2;
      E.act.ax = f.cx + lx * c - ly * s; E.act.ay = f.cy + lx * s + ly * c;
    }
  }
  function xformMove(sx, sy) {
    const a = E.act, [wx, wy] = s2w(sx, sy), f = a.f0;
    if (!a.moved) {
      if (Math.hypot(sx - a.sx, sy - a.sy) < 4 || E.sel.locked) return;
      a.moved = true; closePop();
      a.items.forEach(x => E.hide.add(x.it.id));
      render();
    }
    if (a.hit.type === 'end') { // tažení za konec přímky: druhý konec zůstává na místě
      const { page, it } = a.items[0], [ox, oy] = origin(page), p = it.pts;
      const fix = a.hit.i ? [p[0] / PQ, p[1] / PQ] : [p[3] / PQ, p[4] / PQ], mv = Shapes.snapHV(fix, [wx - ox, wy - oy]);
      a.preview = { ...it, pts: encPts(Shapes.points({ kind: it.sp, a: a.hit.i ? fix : mv, b: a.hit.i ? mv : fix, w: it.w })) };
      requestLive(); updateOverlay();
      return;
    }
    if (a.hit.type === 'move') a.M = matT(wx - a.wx, wy - a.wy);
    else if (a.hit.type === 'scale') a.M = matAbout(a.ax, a.ay, clamp(Math.hypot(wx - a.ax, wy - a.ay) / Math.max(1e-3, Math.hypot(a.wx - a.ax, a.wy - a.ay)), 0.05, 30), 0);
    else a.M = matAbout(f.cx, f.cy, 1, Math.atan2(wy - f.cy, wx - f.cx) - Math.atan2(a.wy - f.cy, a.wx - f.cx));
    E.sel.frame = frameWith(f, a.M);
    requestLive(); updateOverlay();
  }
  function applyToSel(fn) { // fn(it, page) → nová položka | null (smazat) | pole
    txBegin();
    const ids = new Map();
    for (const e of E.sel.list) { if (!ids.has(e.page)) ids.set(e.page, new Set()); ids.get(e.page).add(e.id); }
    for (const [p, set] of ids) {
      touch(p);
      p.items = p.items.flatMap(it => { if (!set.has(it.id)) return [it]; const r = fn(it, p); return r == null ? [] : Array.isArray(r) ? r : [r]; });
    }
  }
  function xformEnd() {
    const a = E.act; E.act = null;
    if (!a.moved) { if (E.sel) { E.sel.menu = !E.sel.menu; updateOverlay(); } return; }
    a.items.forEach(x => E.hide.delete(x.it.id));
    if (a.preview) {
      const { page, it } = a.items[0];
      txBegin(); touch(page); page.items = page.items.map(i => i.id === it.id ? a.preview : i); txCommit();
      E.sel.menu = true; calcFrame();
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
      render(); updateOverlay();
      return;
    }
    const M = a.M, moves = [];
    applyToSel((it, p) => {
      const [ox, oy] = origin(p);
      const n = transformItem(it, matMul(matT(-ox, -oy), matMul(M, matT(ox, oy))));
      const bb = itemBBox(n), q = pageAt((bb[0] + bb[2]) / 2 + ox, (bb[1] + bb[3]) / 2 + oy, true);
      if (q && q !== p) { const [qx, qy] = origin(q); moves.push([q, transformItem(n, matT(ox - qx, oy - qy))]); return null; }
      return n;
    });
    for (const [q, it] of moves) { touch(q); q.items = [...q.items, it]; E.sel.list.find(e => e.id === it.id).page = q; }
    txCommit();
    E.sel.menu = true; calcFrame();
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
    render(); updateOverlay();
  }
  function regionEnd(a) {
    const tiny = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) < 6 && (a.mode === 'box' || a.pts.length < 4);
    const [w0x, w0y] = s2w(a.x0, a.y0);
    if (tiny) { const h = hitItem(w0x, w0y, true); return setSel(h ? [h] : null, true); }
    const poly = a.mode === 'box' ? [[a.x0, a.y0], [a.x1, a.y0], [a.x1, a.y1], [a.x0, a.y1]].map(p => s2w(p[0], p[1])) : a.pts.map(p => s2w(p[0], p[1]));
    const bb = polyBBox(poly), list = [];
    for (const p of E.pages) {
      if (p._y > bb[3] + 50 || p._y + p._h < bb[1] - 50) continue;
      const [ox, oy] = origin(p), lp = poly.map(q => [q[0] - ox, q[1] - oy]), lbb = polyBBox(lp);
      for (const it of p.items) if (!it.locked && itemHitsPoly(it, lp, lbb)) list.push({ page: p, id: it.id });
    }
    setSel(list, false);
  }
  function hitItem(wx, wy, strokes) { // nejvrchnější položka pod bodem
    const p = pageAt(wx, wy, true);
    if (!p) return null;
    const [ox, oy] = origin(p), tol = 7 / E.view.s;
    for (let i = p.items.length - 1; i >= 0; i--) {
      const it = p.items[i];
      if (it.t === 's' && (!strokes || (strokes === 'sp' && !it.sp))) continue;
      if (itemHitsPoint(it, wx - ox, wy - oy, tol)) return { page: p, id: it.id };
    }
    return null;
  }

  /* --- akce nad výběrem --- */
  function selDelete() { if (!E.sel) return; applyToSel(() => null); txCommit(); setSel(null); render(); }
  function selCopy() {
    const f = E.sel.frame;
    clip = selItems().map(({ page, it }) => { const [ox, oy] = origin(page); return transformItem(it, matT(ox - f.cx, oy - f.cy)); });
    toast('Zkopírováno');
  }
  function pasteAt(wx, wy) {
    if (!clip) return;
    const p = pageAt(wx, wy, true), [ox, oy] = origin(p);
    const its = clip.map(it => ({ ...transformItem(it, matT(wx - ox, wy - oy)), id: uid(), locked: false }));
    txBegin(); touch(p); p.items = [...p.items, ...its]; txCommit();
    setSel(its.map(it => ({ page: p, id: it.id })), true); render();
  }
  function selDuplicate() {
    const L = selItems(), out = [];
    txBegin();
    for (const { page, it } of L) { const n = { ...transformItem(it, matT(14, 14)), id: uid() }; touch(page); page.items = [...page.items, n]; out.push({ page, id: n.id }); }
    txCommit(); setSel(out, true); render();
  }
  function selOrder(front) {
    const L = selItems(); txBegin();
    for (const { page, it } of L) { touch(page); const rest = page.items.filter(i => i.id !== it.id); page.items = front ? [...rest, it] : [it, ...rest]; }
    txCommit(); render(); toast(front ? 'Přeneseno dopředu' : 'Posláno dozadu');
  }
  function selLock(v) { applyToSel(it => ({ ...it, locked: v })); txCommit(); calcFrame(); E.sel.menu = true; updateOverlay(); }
  function styleSel(patch, commit) {
    if (!E.tx) txBegin();
    const set = new Set(E.sel.list.map(e => e.id));
    for (const p of new Set(E.sel.list.map(e => e.page))) {
      touch(p);
      p.items = p.items.map(it => {
        if (!set.has(it.id)) return it;
        if (it.t === 's') return { ...it, ...(patch.c ? { c: patch.c } : {}), ...(patch.w ? { w: patch.w } : {}), ...(patch.d != null ? { d: patch.d } : {}) };
        if (it.t === 't' && patch.c) return { ...it, color: patch.c };
        return it;
      });
    }
    if (commit) txCommit();
    calcFrame(); render(); updateOverlay();
  }
  function stylePanel(anchor) {
    const strokes = selItems().map(x => x.it).filter(i => i.t === 's');
    const allHl = strokes.length && strokes.every(s => s.k === 'h'), first = strokes[0];
    const [mn, mx, st] = allHl ? [4, 40, 1] : [0.3, 12, 0.1];
    const lab = el('span', { class: 'sl-val', text: first ? r2(first.w) : '' });
    const sl = el('input', { type: 'range', class: 'slider', min: mn, max: mx, step: st, value: first ? first.w : 1 });
    sl.addEventListener('input', () => { lab.textContent = sl.value; styleSel({ w: +sl.value }, false); });
    sl.addEventListener('change', () => styleSel({ w: +sl.value }, true));
    const types = el('div', { class: 'sp-row' }, [0, 1, 3, 2].map(d => el('button', { class: 'sbtn wide' + (first && first.d === d ? ' on' : ''), title: ['Plná', 'Čárkovaná', 'Tečkovaná', 'Čerchovaná'][d], html: icon('line' + d, 26), onclick: e => { $$('.sbtn', types).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); styleSel({ d }, true); } })));
    const cur = first ? first.c : (selItems()[0] && selItems()[0].it.color) || '';
    const body = el('div', { class: 'style-pop' },
      strokes.length ? el('div', { class: 'sp-lab', text: 'Tloušťka čáry' }) : null, strokes.length ? el('div', { class: 'sl-pop' }, sl, lab) : null,
      strokes.length ? el('div', { class: 'sp-lab', text: 'Typ čáry' }) : null, strokes.length ? types : null,
      el('div', { class: 'sp-lab', text: 'Barva' }), colorGrid(cur, c => styleSel({ c }, true)));
    showPop(anchor, body, { cls: 'dark', align: 'center' });
  }
  function selMenu() {
    const s = E.sel, single = s.single;
    const tb = (label, fn, cls = '') => el('button', { class: 'smb ' + cls, text: label, onclick: fn });
    const ib = (ic, title, fn, cls = '') => el('button', { class: 'smi ' + cls, title, html: icon(ic, 24), onclick: fn });
    if (s.locked) return [ib('lock', 'Odemknout', () => selLock(false), 'blue')];
    if (s.shape) return [
      ib('palette', 'Styl čáry', e => stylePanel(e.currentTarget)), ib('dup', 'Duplikovat', selDuplicate), ib('cut', 'Vyjmout', () => { selCopy(); selDelete(); }), ib('copy', 'Kopírovat', selCopy),
      ib('unlock', 'Zamknout', () => selLock(true)), ib('front', 'Přenést dopředu', () => selOrder(true)), ib('backw', 'Poslat dozadu', () => selOrder(false)), ib('trash', 'Smazat', selDelete, 'red')];
    if (single && single.t === 'i') return [
      ib('crop', 'Oříznout', enterCrop), ib('dup', 'Duplikovat', selDuplicate), ib('cut', 'Vyjmout', () => { selCopy(); selDelete(); }), ib('copy', 'Kopírovat', selCopy),
      ib('unlock', 'Zamknout', () => selLock(true)), ib('front', 'Přenést dopředu', () => selOrder(true)), ib('backw', 'Poslat dozadu', () => selOrder(false)), ib('trash', 'Smazat', selDelete, 'red')];
    return [
      tb('Styl', e => stylePanel(e.currentTarget)),
      single && single.t === 't' ? tb('Upravit', () => { const e = E.sel.list[0]; setSel(null); editText(e.page, single); }) : null,
      tb('Duplikovat', selDuplicate), tb('Vyjmout', () => { selCopy(); selDelete(); }), tb('Kopírovat', selCopy),
      clip ? tb('Vložit', () => { const f = E.sel.frame; pasteAt(f.cx + 18, f.cy + 18); }) : null,
      single && single.t === 't' ? tb('Dopředu', () => selOrder(true)) : null, single && single.t === 't' ? tb('Dozadu', () => selOrder(false)) : null,
      tb('Smazat', selDelete, 'red')];
  }

  /* ================= ořez obrázku ================= */
  function enterCrop() {
    const e = E.sel.list[0], it = E.sel.single;
    setSel(null);
    E.crop = { page: e.page, it, rect: (it.crop || [0, 0, 1, 1]).slice() };
    E.hide.add(it.id);
    render(); updateOverlay();
  }
  function cropGeo() {
    const { it, page } = E.crop, c = it.crop || [0, 0, 1, 1], FW = it.w / (c[2] - c[0]), FH = it.h / (c[3] - c[1]);
    return { FW, FH, fx: -c[0] * FW, fy: -c[1] * FH, ox: origin(page)[0] + it.x, oy: origin(page)[1] + it.y, co: Math.cos(it.r || 0), si: Math.sin(it.r || 0) };
  }
  function drawCrop() {
    const { it, page, rect } = E.crop, g = cropGeo(), e = Render.loadImg(it.blob);
    if (!e.ready) return;
    pageTf(lctx, page);
    lctx.translate(it.x, it.y); lctx.rotate(it.r || 0);
    lctx.globalAlpha = 0.3; lctx.drawImage(e.img, g.fx, g.fy, g.FW, g.FH); lctx.globalAlpha = 1;
    const iw = e.img.naturalWidth, ih = e.img.naturalHeight;
    lctx.drawImage(e.img, rect[0] * iw, rect[1] * ih, (rect[2] - rect[0]) * iw, (rect[3] - rect[1]) * ih, g.fx + rect[0] * g.FW, g.fy + rect[1] * g.FH, (rect[2] - rect[0]) * g.FW, (rect[3] - rect[1]) * g.FH);
  }
  function cropLocal(sx, sy) { // bod obrazovky → normalizované souřadnice celého obrázku
    const g = cropGeo(), [wx, wy] = s2w(sx, sy), dx = wx - g.ox, dy = wy - g.oy;
    return [(dx * g.co + dy * g.si - g.fx) / g.FW, (-dx * g.si + dy * g.co - g.fy) / g.FH, g];
  }
  function cropHit(sx, sy) {
    const [u, v, g] = cropLocal(sx, sy), r = E.crop.rect, tu = 24 / (g.FW * E.view.s), tv = 24 / (g.FH * E.view.s);
    const nl = Math.abs(u - r[0]) < tu, nr = Math.abs(u - r[2]) < tu, nt = Math.abs(v - r[1]) < tv, nb = Math.abs(v - r[3]) < tv;
    const inx = u > r[0] - tu && u < r[2] + tu, iny = v > r[1] - tv && v < r[3] + tv;
    if (!inx || !iny) return null;
    if (nl || nr || nt || nb) return { l: nl && !nr || (nl && u < (r[0] + r[2]) / 2), r: nr && !(nl && u < (r[0] + r[2]) / 2), t: nt && !nb || (nt && v < (r[1] + r[3]) / 2), b: nb && !(nt && v < (r[1] + r[3]) / 2) };
    return { move: true, u, v, r0: r.slice() };
  }
  function cropDrag(h, sx, sy) {
    const [u, v] = cropLocal(sx, sy), r = E.crop.rect, m = 0.04;
    if (h.move) {
      const du = clamp(u - h.u, -h.r0[0], 1 - h.r0[2]), dv = clamp(v - h.v, -h.r0[1], 1 - h.r0[3]);
      E.crop.rect = [h.r0[0] + du, h.r0[1] + dv, h.r0[2] + du, h.r0[3] + dv];
    } else {
      if (h.l) r[0] = clamp(u, 0, r[2] - m); if (h.r) r[2] = clamp(u, r[0] + m, 1);
      if (h.t) r[1] = clamp(v, 0, r[3] - m); if (h.b) r[3] = clamp(v, r[1] + m, 1);
    }
    requestLive(); updateOverlay();
  }
  function exitCrop(apply) {
    if (!E.crop) return;
    const { it, page, rect } = E.crop, g = cropGeo();
    E.hide.delete(it.id); E.crop = null;
    if (apply) {
      const lx = g.fx + rect[0] * g.FW, ly = g.fy + rect[1] * g.FH;
      const n = { ...it, crop: rect, w: g.FW * (rect[2] - rect[0]), h: g.FH * (rect[3] - rect[1]), x: it.x + lx * g.co - ly * g.si, y: it.y + lx * g.si + ly * g.co };
      txBegin(); touch(page); page.items = page.items.map(i => i.id === it.id ? n : i); txCommit();
      setSel([{ page, id: it.id }], true);
    }
    render(); updateOverlay();
  }

  /* ================= text ================= */
  function editText(page, item, lx, ly, w) {
    commitText();
    const it = item ? { ...item } : { t: 't', id: uid(), x: lx, y: ly, w, sc: 1, r: 0, html: '<div><br></div>', font: T.txt.font, size: T.txt.size, color: T.txt.color };
    if (item) { Object.assign(T.txt, { font: it.font, size: it.size, color: it.color }); E.hide.add(item.id); render(); }
    const box = el('div', { class: 'txt txt-edit', contenteditable: 'true', spellcheck: 'false' });
    Txt.styleBox(box, it); box.innerHTML = it.html;
    const wh = el('div', { class: 'txt-wh', title: 'Šířka pole' });
    const wrap = el('div', { class: 'txt-wrap' }, box, wh);
    overlay.append(wrap);
    E.txt = { page, orig: item || null, it, el: box, wrap };
    box.addEventListener('input', () => { Txt.normalize(box); });
    box.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    box.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); Txt.cmd(box, e.shiftKey ? 'outdent' : 'indent'); } e.stopPropagation(); });
    document.addEventListener('selectionchange', txtSelChange);
    wh.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); wh.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, w0 = it.w, c = Math.cos(it.r), s = Math.sin(it.r), k = E.view.s * it.sc;
      const mv = ev => { it.w = clamp(w0 + ((ev.clientX - x0) * c + (ev.clientY - y0) * s) / k, 40, 1900); box.style.width = it.w + 'px'; };
      const up = () => { wh.removeEventListener('pointermove', mv); wh.removeEventListener('pointerup', up); wh.removeEventListener('pointercancel', up); };
      wh.addEventListener('pointermove', mv); wh.addEventListener('pointerup', up); wh.addEventListener('pointercancel', up);
    });
    updateOverlay(); renderSub();
    box.focus();
    const r = document.createRange(); r.selectNodeContents(box); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  let selChT = 0;
  function txtSelChange() { clearTimeout(selChT); selChT = setTimeout(() => { if (E.txt && E.tool === 'text' && !$('.pop')) renderSubState(); }, 120); }
  function renderSubState() { // jen zvýraznění B/I/U…, ať se pole nepřekresluje pod prsty
    const st = Txt.state(E.txt.el), map = { 'Tučně': st.bold, 'Kurzíva': st.italic, 'Podtržení': st.underline, 'Odrážky': st.ul, 'Číslování': st.ol, 'Zarovnat vlevo': st.align === 'left', 'Na střed': st.align === 'center', 'Zarovnat vpravo': st.align === 'right' };
    $$('#sub .sbtn').forEach(b => { if (b.title in map) b.classList.toggle('on', !!map[b.title]); });
  }
  function commitText() {
    const t = E.txt;
    if (!t) return;
    E.txt = null;
    document.removeEventListener('selectionchange', txtSelChange);
    Txt.normalize(t.el); Txt.sanitize(t.el);
    const html = t.el.innerHTML;
    t.wrap.remove();
    if (t.orig) E.hide.delete(t.orig.id);
    const empty = Txt.isEmpty(html), p = t.page;
    if (!E.pages.includes(p)) return;
    const n = { ...t.it, html };
    if (t.orig && !empty && t.orig.html === html && ['w', 'font', 'size', 'color'].every(k => t.orig[k] === n[k])) { render(); return; }
    txBegin(); touch(p);
    if (t.orig) p.items = empty ? p.items.filter(i => i.id !== t.orig.id) : p.items.map(i => i.id === t.orig.id ? n : i);
    else if (!empty) p.items = [...p.items, n];
    txCommit(); render();
  }

  /* ================= překryvná vrstva (rámeček výběru, nabídky) ================= */
  function updateOverlay() {
    if (!E.open) return;
    const v = E.view, fr = $('#selframe'), menu = $('#selmenu');
    const d1 = $('#lh1'), d2 = $('#lh2');
    if (E.sel) {
      const s = E.sel, f = s.frame, W = f.w * v.s + PAD * 2, H = f.h * v.s + PAD * 2, cx = f.cx * v.s + v.tx, cy = f.cy * v.s + v.ty;
      const moving = E.act && E.act.type === 'xform' && E.act.moved;
      fr.hidden = !!s.line && !s.locked;
      fr.classList.toggle('locked', !!s.locked);
      fr.classList.toggle('mid', !!s.mid);
      fr.style.width = W + 'px'; fr.style.height = H + 'px';
      fr.style.transform = `translate(${cx - W / 2}px,${cy - H / 2}px) rotate(${f.r}rad)`;
      const dots = !!s.line && !s.locked && !moving;
      d1.hidden = d2.hidden = !dots;
      if (dots) [d1, d2].forEach((d, i) => { d.style.transform = `translate(${s.line[i][0] * v.s + v.tx - 8}px,${s.line[i][1] * v.s + v.ty - 8}px)`; });
      if (s.menu && !moving) {
        if (menu._for !== s || menu._clip !== !!clip || menu._lock !== s.locked || menu._single !== s.single || menu._shape !== !!s.shape) {
          menu.replaceChildren(...selMenu().filter(Boolean));
          menu._for = s; menu._clip = !!clip; menu._lock = s.locked; menu._single = s.single; menu._shape = !!s.shape;
        }
        menu.hidden = false;
        const ext = Math.abs(Math.sin(f.r)) * W / 2 + Math.abs(Math.cos(f.r)) * H / 2, mw = menu.offsetWidth, mh = menu.offsetHeight;
        let y = cy - ext - mh - 16;
        if (y < TOP_M + 4) y = Math.min(cy + ext + 16, E.vh - mh - 12);
        menu.style.transform = `translate(${clamp(cx - mw / 2, 8, E.vw - mw - 8)}px,${Math.max(8, y)}px)`;
      } else menu.hidden = true;
    } else { fr.hidden = true; menu.hidden = true; menu._for = null; d1.hidden = d2.hidden = true; }
    if (E.txt) {
      const { it, page, wrap } = E.txt, [ox, oy] = origin(page);
      wrap.style.transform = `translate(${(ox + it.x) * v.s + v.tx}px,${(oy + it.y) * v.s + v.ty}px) rotate(${it.r}rad) scale(${v.s * it.sc})`;
      wrap.style.setProperty('--inv', 1 / (v.s * it.sc));
    }
    const cf = $('#cropframe');
    if (E.crop) {
      const { it, rect } = E.crop, g = cropGeo();
      cf.hidden = false;
      const x = (g.fx + rect[0] * g.FW) * v.s, y = (g.fy + rect[1] * g.FH) * v.s;
      cf.style.width = (rect[2] - rect[0]) * g.FW * v.s + 'px'; cf.style.height = (rect[3] - rect[1]) * g.FH * v.s + 'px';
      cf.style.transformOrigin = `${-x}px ${-y}px`;
      cf.style.transform = `translate(${g.ox * v.s + v.tx + x}px,${g.oy * v.s + v.ty + y}px) rotate(${it.r || 0}rad)`;
    } else cf.hidden = true;
    const ap = $('#addpage');
    ap.style.transform = `translate(${v.tx}px,${v.ty + E.totalH * v.s + 22}px) translateX(-50%)`;
  }
  function updateIndicator() {
    const i = curIdx();
    if (E._ind !== i + '/' + E.pages.length) { E._ind = i + '/' + E.pages.length; $('#pg-cur').textContent = i + 1; $('#pg-tot').textContent = E.pages.length; Pages.mark(i); }
  }

  /* ================= ukazatel: tužka / myš / prsty ================= */
  const touches = new Map();
  let penId = null, gest = null, inertia = 0;
  const xy = e => [e.clientX, e.clientY];
  let lastPen = -1e9; // kdy se naposledy psalo tužkou – krátce potom se dotyky (dlaň) ignorují
  function endTouchGesture() {
    if (gest && gest.mode === 'sel' && E.act && E.act.type === 'xform') xformEnd();
    touches.clear(); gest = null;
  }
  function onDown(e) {
    if (e.target.closest('.txt-wrap')) return;
    cancelAnimationFrame(inertia);
    if (e.pointerType === 'touch') {
      if (penId != null || performance.now() - lastPen < 350) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        gest = { t0: performance.now(), max: 1, moved: false, sx: e.clientX, sy: e.clientY, vx: 0, vy: 0, lt: performance.now(), mode: 'pan' };
        const ch = E.crop && cropHit(e.clientX, e.clientY), h = !E.crop && selHit(e.clientX, e.clientY);
        if (ch) { gest.mode = 'crop'; gest.ch = ch; }
        else if (h) { gest.mode = 'sel'; xformStart(h, e.clientX, e.clientY, e.pointerId); }
      } else if (gest) {
        gest.max = Math.max(gest.max, touches.size);
        if (gest.mode === 'sel' && E.act) { const a = E.act; E.act = null; if (a.moved) { a.items.forEach(x => E.hide.delete(x.it.id)); E.sel.frame = a.f0; render(); updateOverlay(); } }
        gest.mode = 'pinch';
        const [a, b] = Array.from(touches.values());
        gest.d0 = Math.hypot(a.x - b.x, a.y - b.y); gest.s0 = E.view.s; gest.cx = (a.x + b.x) / 2; gest.cy = (a.y + b.y) / 2;
      }
      return;
    }
    if (e.button) return;
    e.preventDefault();
    lastPen = performance.now();
    if (penId != null) penFinish();                 // předchozí tah nedostal „zvednutí“ – dokončí se a nový hned začne
    if (touches.size || gest) endTouchGesture();    // tužka má vždy přednost před prsty a dlaní
    penId = e.pointerId;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    penDown(e);
  }
  function penDown(e) {
    const [sx, sy] = xy(e), [wx, wy] = s2w(sx, sy);
    if (E.txt) { commitText(); penId = null; return; }
    if (E.crop) { const h = cropHit(sx, sy); if (h) E.act = { type: 'crop', h }; return; }
    if (E.sel) {
      const h = selHit(sx, sy);
      if (h) return xformStart(h, sx, sy, e.pointerId);
      setSel(null);
    }
    const p = pageAt(wx, wy), tool = E.tool;
    if (tool === 'pen' || tool === 'hl') {
      if (!p) return;
      const t = tool === 'pen' ? T.pen : T.hl, pen = e.pointerType === 'pen', pr = pen ? clamp(e.pressure || 0.25, 0.02, 1) : 0.25, [ox, oy] = origin(p);
      E.act = { type: 'stroke', page: p, k: tool === 'pen' ? 'p' : 'h', c: curColor(t), w: t.widths[t.wi], d: t.dash, pr: tool === 'pen' && pen && App.settings.pressure, raw: [wx - ox, wy - oy, pr], fx: wx - ox, fy: wy - oy, fp: pr, pen, hx: sx, hy: sy };
      armHold(E.act);
      requestLive();
    } else if (tool === 'eraser') {
      E.act = { type: 'erase', R: T.er.sizes[T.er.si] / 2, sx, sy, wx, wy, began: false };
      eraseAt(wx, wy); requestLive();
    } else if (tool === 'select') {
      E.act = { type: 'region', mode: T.sel.mode, x0: sx, y0: sy, x1: sx, y1: sy, pts: [[sx, sy]] };
    } else if (tool === 'text') {
      const h = hitItem(wx, wy, false);
      if (h) { const it = h.page.items.find(i => i.id === h.id); if (it.t === 't' && !it.locked) { E.act = { type: 'textedit', page: h.page, it }; return; } }
      if (p) E.act = { type: 'textbox', page: p, x0: sx, y0: sy, x1: sx, y1: sy };
    }
  }
  /* podržení tužky na konci tahu → rozpoznání tvaru */
  function armHold(a) { clearTimeout(a.holdT); a.holdT = setTimeout(() => holdFire(a), 480); }
  function holdFire(a) {
    if (E.act !== a || a.shape) return;
    const raw = a.raw.slice();
    if (a.ex != null && Math.hypot(a.ex - a.fx, a.ey - a.fy) > 0.05) raw.push(a.ex, a.ey, a.fp);
    const sh = Shapes.detect(raw, a.w, 22 / E.view.s);
    if (!sh) return;
    a.shape = a.shapeCur = sh;
    a.p0 = [raw[raw.length - 3], raw[raw.length - 2]];
    requestLive();
  }
  function shapeAdjust(a, sx, sy) { // dokud tužka drží, tvar jde natáhnout / otočit kolem výchozího bodu
    if (!a.adj && Math.hypot(sx - a.hx, sy - a.hy) < 7) return;
    a.adj = true;
    const [wx, wy] = s2w(sx, sy), [ox, oy] = origin(a.page);
    a.shapeCur = Shapes.adjust(a.shape, a.p0, [wx - ox, wy - oy]);
  }
  const shapeItem = a => ({ t: 's', id: uid(), k: a.k, c: a.c, w: a.w, d: a.d, sp: a.shapeCur.kind, pts: encPts(Shapes.points(a.shapeCur)) });
  /* jemné vyhlazení vstupu (filtr „1 €“) – počítá jen z minulých bodů, takže jednou nakreslená
     část čáry se už nikdy nepohne; při pomalém pohybu tlumí chvění, při rychlém skoro nevyhlazuje */
  const F_MIN = 8, F_BETA = 0.05, fAlpha = (dt, fc) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  function strokeAdd(a, e) {
    const [wx, wy] = s2w(e.clientX, e.clientY), [ox, oy] = origin(a.page), lx = wx - ox, ly = wy - oy;
    const pr = a.pen ? clamp(e.pressure || a.fp, 0.02, 1) : 0.25;
    const t = e.timeStamp || performance.now();
    if (a.ft == null) { a.ft = t - 8; a.vx = a.vy = 0; a.rx = a.fx; a.ry = a.fy; }
    const dt = clamp((t - a.ft) / 1000, 0.001, 0.05), s = E.view.s;
    a.ft = t;
    const ad = fAlpha(dt, 1);
    a.vx += ((lx - a.rx) * s / dt - a.vx) * ad; a.vy += ((ly - a.ry) * s / dt - a.vy) * ad;
    a.rx = lx; a.ry = ly;
    const al = fAlpha(dt, F_MIN + F_BETA * Math.hypot(a.vx, a.vy));
    a.fx += (lx - a.fx) * al; a.fy += (ly - a.fy) * al; a.fp += (pr - a.fp) * fAlpha(dt, 5);
    a.ex = lx; a.ey = ly;
    const n = a.raw.length, md = 1 / s;
    if (Math.hypot(a.fx - a.raw[n - 3], a.fy - a.raw[n - 2]) < md) return;
    a.raw.push(a.fx, a.fy, a.fp);
  }
  function eraseAt(wx, wy) {
    const a = E.act;
    let any = false;
    for (const p of E.pages) {
      if (wy + a.R < p._y - 40 || wy - a.R > p._y + p._h + 40) continue;
      const [ox, oy] = origin(p), lx = wx - ox, ly = wy - oy;
      let ch = false;
      const out = [];
      for (const it of p.items) {
        let r = null;
        if (it.t === 's' && !it.locked) r = T.er.whole ? (itemHitsPoint(it, lx, ly, a.R) ? [] : null) : eraseStroke(it, lx, ly, a.R);
        if (r) { ch = true; out.push(...r); } else out.push(it);
      }
      if (ch) { if (!a.began) { txBegin(); a.began = true; } touch(p); p.items = out; any = true; }
    }
    return any;
  }
  function onMove(e) {
    if (e.pointerType === 'touch') {
      const t = touches.get(e.pointerId);
      if (!t || !gest) return;
      const dx = e.clientX - t.x, dy = e.clientY - t.y;
      t.x = e.clientX; t.y = e.clientY;
      if (Math.hypot(e.clientX - gest.sx, e.clientY - gest.sy) > 9 && touches.size === 1) gest.moved = true;
      if (gest.mode === 'crop') return cropDrag(gest.ch, e.clientX, e.clientY);
      if (gest.mode === 'sel') { if (E.act && E.act.ptr === e.pointerId) xformMove(e.clientX, e.clientY); return; }
      if (gest.mode === 'pan' && touches.size === 1) {
        if (!gest.moved) return;
        const now = performance.now(), dt = Math.max(1, now - gest.lt); gest.lt = now;
        gest.vx = gest.vx * 0.6 + dx / dt * 0.4; gest.vy = gest.vy * 0.6 + dy / dt * 0.4;
        E.view.tx += dx; E.view.ty += dy; viewChanged(true);
      } else if (gest.mode === 'pinch' && touches.size >= 2) {
        const [a, b] = Array.from(touches.values()), d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (Math.abs(d - gest.d0) > 12 || Math.hypot(cx - gest.cx, cy - gest.cy) > 12) gest.moved = true;
        if (!gest.moved) return;
        E.view.tx += cx - gest.cx; E.view.ty += cy - gest.cy;
        zoomAt(cx, cy, E.view.s * (d / gest.d0));
        gest.d0 = d; gest.cx = cx; gest.cy = cy;
        viewChanged(true);
      }
      return;
    }
    if (e.pointerId !== penId || !E.act) return;
    lastPen = performance.now();
    const a = E.act, [sx, sy] = xy(e);
    if (a.type === 'stroke') {
      if (a.shape) shapeAdjust(a, sx, sy);
      else {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        (evs.length ? evs : [e]).forEach(ev => strokeAdd(a, ev));
        if (Math.hypot(sx - a.hx, sy - a.hy) > 5) { a.hx = sx; a.hy = sy; armHold(a); }
      }
      requestLive();
    } else if (a.type === 'erase') {
      const [wx, wy] = s2w(sx, sy), dist = Math.hypot(wx - a.wx, wy - a.wy), n = Math.max(1, Math.ceil(dist / (a.R * 0.6)));
      let any = false;
      for (let i = 1; i <= n; i++) any = eraseAt(a.wx + (wx - a.wx) * i / n, a.wy + (wy - a.wy) * i / n) || any;
      a.wx = wx; a.wy = wy; a.sx = sx; a.sy = sy;
      if (any) requestRender(); else requestLive();
    } else if (a.type === 'region') {
      a.x1 = sx; a.y1 = sy;
      const l = a.pts[a.pts.length - 1];
      if (Math.hypot(sx - l[0], sy - l[1]) > 4) a.pts.push([sx, sy]);
      requestLive();
    } else if (a.type === 'textbox') { a.x1 = sx; a.y1 = sy; requestLive(); }
    else if (a.type === 'xform') xformMove(sx, sy);
    else if (a.type === 'crop') cropDrag(a.h, sx, sy);
  }
  function onUp(e) {
    if (e.pointerType === 'touch') {
      if (!touches.delete(e.pointerId) || !gest) return;
      if (e.type === 'pointercancel') gest.cancelled = true; // zrušený dotyk (např. dlaň) se nikdy nepočítá jako ťuknutí
      if (gest.mode === 'sel' && E.act && E.act.type === 'xform' && E.act.ptr === e.pointerId) { xformEnd(); }
      if (touches.size) return;
      const g = gest; gest = null;
      const quick = !g.cancelled && performance.now() - g.t0 < 380 && !g.moved && performance.now() - lastPen > 700;
      if (g.mode === 'crop') return;
      if (quick && g.max === 2) return undo();
      if (quick && g.max === 3) return redo();
      if (quick && g.max === 1 && g.mode === 'pan') return fingerTap(g.sx, g.sy);
      if (g.mode === 'pan' && Math.hypot(g.vx, g.vy) > 0.25 && performance.now() - g.lt < 60) {
        let vx = g.vx, vy = g.vy, last = performance.now();
        const step = now => {
          const dt = Math.min(40, now - last); last = now;
          const bx = E.view.tx, by = E.view.ty;
          E.view.tx += vx * dt; E.view.ty += vy * dt;
          vx *= Math.pow(0.996, dt); vy *= Math.pow(0.996, dt);
          viewChanged(true);
          if (Math.hypot(vx, vy) > 0.03 && (E.view.tx !== bx || E.view.ty !== by)) inertia = requestAnimationFrame(step);
        };
        inertia = requestAnimationFrame(step);
      }
      return;
    }
    if (e.pointerId !== penId) return;
    lastPen = performance.now();
    penFinish();
  }
  function penFinish() {
    penId = null;
    const a = E.act;
    if (!a) return;
    if (a.type === 'xform') return xformEnd();
    E.act = null;
    if (a.type === 'stroke') {
      clearTimeout(a.holdT);
      let it;
      if (a.shape) it = shapeItem(a);
      else {
        if (a.ex != null && Math.hypot(a.ex - a.fx, a.ey - a.fy) > 0.05) a.raw.push(a.ex, a.ey, a.fp);
        it = { t: 's', id: uid(), k: a.k, c: a.c, w: a.w, d: a.d, pts: encPts(simplify(a.raw, 0.03)) };
        if (a.pr) it.pr = 1;
      }
      txBegin(); touch(a.page); a.page.items = [...a.page.items, it]; txCommit();
      drawOne(a.page, it);
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
    } else if (a.type === 'erase') {
      if (a.began) txCommit();
      if (T.er.auto) setTool(E.prevTool || 'pen');
      render();
    } else if (a.type === 'region') {
      regionEnd(a); drawLive();
      if (a.mode !== 'box' && a.pts.length > 3) { // krátce ukáže uzavřený obrys
        lctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
        lctx.strokeStyle = '#3d8fe6'; lctx.lineWidth = 1.5; lctx.setLineDash([6, 5]);
        lctx.beginPath(); a.pts.forEach((p, i) => i ? lctx.lineTo(p[0], p[1]) : lctx.moveTo(p[0], p[1])); lctx.closePath(); lctx.stroke(); lctx.setLineDash([]);
        setTimeout(() => { if (!E.act) drawLive(); }, 180);
      }
    }
    else if (a.type === 'textedit') editText(a.page, a.it);
    else if (a.type === 'textbox') {
      const [w0x, w0y] = s2w(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1)), [ox, oy] = origin(a.page);
      const lx = clamp(w0x - ox, 4, a.page._w - 30), ly = clamp(w0y - oy, 4, a.page._h - 12);
      let w = Math.abs(a.x1 - a.x0) / E.view.s;
      if (w < 30) w = Math.min(280, a.page._w - lx - 16);
      drawLive();
      editText(a.page, null, lx, ly, Math.max(40, w));
    }
  }
  function fingerTap(sx, sy) {
    if (E.txt) return commitText();
    if (E.crop) return;
    const [wx, wy] = s2w(sx, sy);
    if (E.sel) { if (selHit(sx, sy)) { E.sel.menu = !E.sel.menu; return updateOverlay(); } setSel(null); }
    const h = hitItem(wx, wy, 'sp'); // prstem jde vybrat obrázek, text a rozpoznaný tvar
    if (h) return setSel([h], true);
    if (clip && pageAt(wx, wy)) showMenu({ x: sx, y: sy - 6 }, [{ icon: 'paste', label: 'Vložit', action: () => pasteAt(wx, wy) }], { cls: 'dark', align: 'center' });
  }
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, E.view.s * Math.exp(-e.deltaY * 0.01));
    else { E.view.tx -= e.deltaX; E.view.ty -= e.deltaY; }
    viewChanged(true);
  }
  function onKey(e) {
    if (!E.open || E.txt || e.target.closest('input,select,textarea,[contenteditable]') || $('.modal-bg')) return;
    const m = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (m && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (m && k === 'y') { e.preventDefault(); redo(); }
    else if (E.sel && !E.sel.locked && (k === 'delete' || k === 'backspace')) { e.preventDefault(); selDelete(); }
    else if (E.sel && m && k === 'c') selCopy();
    else if (E.sel && m && k === 'x') { selCopy(); selDelete(); }
    else if (E.sel && m && k === 'd') { e.preventDefault(); selDuplicate(); }
    else if (m && k === 'v' && clip) { const [wx, wy] = s2w(E.vw / 2, E.vh / 2); pasteAt(wx, wy); }
    else if (k === 'escape') { setSel(null); exitCrop(false); }
  }

  /* ================= stránky ================= */
  const clonePage = p => ({ id: uid(), nb: E.nb.id, items: p.items.map(it => ({ ...it, id: uid() })), bg: p.bg || null, w: p.w, h: p.h });
  function pagesChanged(go) { txCommit(); viewChanged(); if (go) gotoPage(go); Pages.refresh(true); }
  function prep() { commitText(); setSel(null); exitCrop(false); txBegin(); }
  function addPage(idx) { prep(); const np = Book.newPage(E.nb); E.pages.splice(idx, 0, np); layoutPages(); pagesChanged(np); }
  function deletePages(list) {
    prep();
    E.pages = E.pages.filter(p => !list.includes(p));
    if (!E.pages.length) E.pages = [Book.newPage(E.nb)];
    layoutPages(); pagesChanged();
  }
  function copyPages(list) { pclip = list.map(p => ({ items: p.items, bg: p.bg || null, w: p.w, h: p.h })); toast(list.length === 1 ? 'Stránka zkopírována' : `Zkopírováno stránek: ${list.length}`); Pages.refresh(); }
  function dupPages(list) {
    prep(); let last;
    for (const p of list) { last = clonePage(p); E.pages.splice(E.pages.indexOf(p) + 1, 0, last); }
    layoutPages(); pagesChanged(last);
  }
  function pastePages(idx) {
    if (!pclip) return;
    prep();
    const ps = pclip.map(clonePage);
    E.pages.splice(idx, 0, ...ps); layoutPages(); pagesChanged(ps[0]);
  }
  function clearPages(list) { prep(); for (const p of list) { touch(p); p.items = []; } txCommit(); render(); Pages.refresh(true); }
  function pageMenu(p) {
    const i = E.pages.indexOf(p);
    return [
      { icon: 'pageBefore', label: 'Přidat stránku před', action: () => addPage(i) },
      { icon: 'pageAfter', label: 'Přidat stránku za', action: () => addPage(i + 1) },
      '-',
      { icon: 'cut', label: 'Vyjmout', action: () => { copyPages([p]); deletePages([p]); } },
      { icon: 'copy', label: 'Kopírovat', action: () => copyPages([p]) },
      { icon: 'dup', label: 'Duplikovat', action: () => dupPages([p]) },
      pclip ? { icon: 'paste', label: `Vložit za (${pclip.length})`, action: () => pastePages(i + 1) } : null,
      '-',
      { icon: 'clear', label: 'Vyčistit stránku', action: () => clearPages([p]) },
      { icon: 'trash', label: 'Smazat stránku', danger: true, action: () => deletePages([p]) },
    ];
  }

  /* panel se všemi stránkami */
  const Pages = (() => {
    let on = false, selMode = false, io = null;
    const sel = new Set(), cache = new WeakMap();
    async function draw(p, holder) {
      const key = p.items, c0 = cache.get(p);
      if (c0 && c0.key === key && c0.paper === JSON.stringify(E.nb.paper)) { holder.replaceChildren(c0.cv); return; }
      const c = await Render.pageCanvas(p, E.nb, 300);
      c.className = 'pg-cv';
      cache.set(p, { key, cv: c, paper: JSON.stringify(E.nb.paper) });
      if (holder.isConnected) holder.replaceChildren(c);
    }
    let t = 0;
    function refresh(now) { if (!on) return; clearTimeout(t); t = setTimeout(build, now ? 0 : 600); }
    function build() {
      if (!on || !E.open) return;
      const list = $('#pg-list'), top = list.scrollTop;
      if (io) io.disconnect();
      io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); draw(e.target._p, e.target); } }), { root: list, rootMargin: '300px' });
      for (const p of Array.from(sel)) if (!E.pages.includes(p)) sel.delete(p);
      list.replaceChildren(...E.pages.map((p, i) => {
        const holder = el('div', { class: 'pg-thumb', style: { aspectRatio: `${p._w} / ${p._h}` } });
        holder._p = p; io.observe(holder);
        return el('div', { class: 'pg-item' + (sel.has(p) ? ' sel' : ''), dataset: { i }, onclick: e => {
          if (e.target.closest('.pg-more')) return;
          if (selMode) { sel.has(p) ? sel.delete(p) : sel.add(p); build(); } else gotoPage(p);
        } }, holder,
          selMode ? el('span', { class: 'pg-check', html: sel.has(p) ? icon('check', 18) : '' }) : el('button', { class: 'pg-more', html: icon('dots', 20), title: 'Možnosti stránky', onclick: e => showMenu(e.currentTarget, pageMenu(p), { align: 'right' }) }),
          el('div', { class: 'pg-num', text: i + 1 }));
      }));
      list.scrollTop = top;
      E._ind = null; updateIndicator();
      const bar = $('#pg-bar'), L = () => E.pages.filter(p => sel.has(p)), need = fn => () => { const l = L(); if (!l.length) return toast('Nejdřív vyber stránky'); fn(l); };
      const done = () => { selMode = false; sel.clear(); build(); };
      const ab = (ic, label, fn, cls = '') => el('button', { class: 'pgb ' + cls, html: icon(ic, 20) + `<span>${label}</span>`, onclick: fn });
      bar.replaceChildren(...(selMode ? [
        el('div', { class: 'pg-selinfo', text: `Vybráno: ${sel.size}` }),
        ab('copy', 'Kopírovat', need(l => { copyPages(l); done(); })), ab('dup', 'Duplikovat', need(l => { dupPages(l); done(); })),
        ab('clear', 'Vyčistit', need(l => { clearPages(l); done(); })), ab('trash', 'Smazat', need(l => { deletePages(l); done(); }), 'red'),
        el('button', { class: 'pgb blue', text: 'Hotovo', onclick: done })] : [
        el('button', { class: 'pgb blue', text: 'Vybrat', onclick: () => { selMode = true; build(); } }),
        pclip ? ab('paste', `Vložit (${pclip.length})`, () => pastePages(curIdx() + 1)) : null].filter(Boolean)));
    }
    function mark(i) { if (!on) return; $$('#pg-list .pg-item').forEach(n => n.classList.toggle('cur', +n.dataset.i === i)); const n = $(`#pg-list .pg-item[data-i="${i}"]`); if (n && !selMode) n.scrollIntoView({ block: 'nearest' }); }
    function toggle(v) {
      on = v === undefined ? !on : v; selMode = false; sel.clear();
      $('#pg-panel').hidden = !on; $('#b-pages').classList.toggle('on', on);
      $('#editor').classList.toggle('with-pages', on);
      if (E.open) resize();
      if (on) build();
    }
    return { refresh, toggle, mark, get on() { return on; } };
  })();

  /* ================= vkládání fotek a PDF ================= */
  const Ins = (() => {
    let files = [], chosen = new Set();
    function paint() {
      const add = $('#ins-add');
      add.disabled = !chosen.size; add.classList.toggle('ready', !!chosen.size);
      $('#ins-grid').replaceChildren(...files.map(f => el('button', { class: 'ins-ph' + (chosen.has(f) ? ' sel' : ''), onclick: () => { chosen.has(f) ? chosen.delete(f) : chosen.add(f); paint(); } },
        el('img', { src: f._url }), chosen.has(f) ? el('span', { class: 'ins-ck', html: icon('check', 18) }) : null)));
      $('#ins-hint').hidden = !!files.length;
    }
    function addFiles(fs) {
      for (const f of fs) { if (files.length >= 10) { toast('Najednou jde vložit nejvýš 10 fotek'); break; } f._url = URL.createObjectURL(f); files.push(f); chosen.add(f); }
      paint();
    }
    function close() { files.forEach(f => URL.revokeObjectURL(f._url)); files = []; chosen.clear(); $('#ins-panel').hidden = true; }
    function open() { commitText(); paint(); $('#ins-panel').hidden = false; }
    async function commit() {
      const list = files.filter(f => chosen.has(f));
      if (!list.length) return;
      $('#ins-add').disabled = true;
      const p = E.pages[curIdx()], [ox, oy] = origin(p), out = [];
      let [wx, wy] = s2w(E.vw / 2, E.vh / 2);
      wx = clamp(wx - ox, p._w * 0.2, p._w * 0.8); wy = clamp(wy - oy, p._h * 0.1, p._h * 0.9);
      try {
        for (let i = 0; i < list.length; i++) {
          const im = await IO.importImage(list[i]);
          const k = Math.min(p._w * 0.6 / im.w, p._h * 0.45 / im.h, 0.6);
          const w = im.w * k, h = im.h * k;
          out.push({ t: 'i', id: uid(), blob: im.blob, x: clamp(wx - w / 2 + i * 14, 0, p._w - w), y: clamp(wy - h / 2 + i * 14, 0, Math.max(0, p._h - h)), w, h, r: 0 });
        }
      } catch (e) { console.error(e); toast('Některou fotku se nepodařilo načíst'); }
      close();
      if (!out.length) return;
      txBegin(); touch(p); p.items = [...p.items, ...out]; txCommit();
      setSel(out.map(it => ({ page: p, id: it.id })), true); render();
    }
    async function pdf() {
      const [f] = await pickFiles('application/pdf,.pdf');
      if (!f) return;
      close(); toast('Načítám PDF…');
      try {
        const ps = await IO.importPdf(f, E.nb.id), i = curIdx() + 1;
        prep(); E.pages.splice(i, 0, ...ps); layoutPages(); pagesChanged(ps[0]);
        toast(`Vloženo stránek: ${ps.length}`);
      } catch (e) { console.error(e); toast('PDF se nepodařilo načíst'); }
    }
    return { open, close, commit, pdf, gallery: async () => addFiles(await pickFiles('image/*', true)), camera: async () => addFiles(await pickFiles('image/*', false, 'environment')) };
  })();

  /* ================= nastavení sešitu ================= */
  function nbSettings(anchor) {
    const nb = E.nb, P = nb.paper, mm = v => Math.round(v / 72 * 25.4);
    const apply = () => { layoutPages(); markDirty(null); viewChanged(); Pages.refresh(true); };
    const setSize = (size, w, h) => { P.size = size; const a = Math.min(w, h), b = Math.max(w, h); P.w = P.land ? b : a; P.h = P.land ? a : b; apply(); nbSettings(anchor); };
    const seg = (opts, cur, fn) => el('div', { class: 'seg' }, opts.map(([v, label]) => el('button', { class: 'segb' + (v === cur ? ' on' : ''), text: label, onclick: () => fn(v) })));
    const wI = el('input', { type: 'number', class: 'inp sm', value: mm(P.w), min: 50, max: 700 }), hI = el('input', { type: 'number', class: 'inp sm', value: mm(P.h), min: 50, max: 700 });
    const custom = () => { const w = clamp(+wI.value || 210, 50, 700) * 72 / 25.4, h = clamp(+hI.value || 297, 50, 700) * 72 / 25.4; P.size = 'custom'; P.w = w; P.h = h; P.land = w > h; apply(); };
    wI.onchange = hI.onchange = custom;
    const name = el('input', { type: 'text', class: 'inp', value: nb.name });
    name.onchange = () => { if (name.value.trim()) { nb.name = name.value.trim(); markDirty(null); } };
    showPop(anchor, el('div', { class: 'nbset' },
      el('div', { class: 'sp-lab', text: 'Název sešitu' }), name,
      el('div', { class: 'sp-lab', text: 'Formát papíru' }),
      seg([['A5', 'A5'], ['A4', 'A4'], ['A3', 'A3'], ['Letter', 'Letter'], ['custom', 'Vlastní']], P.size, v => v === 'custom' ? (P.size = 'custom', nbSettings(anchor)) : setSize(v, ...Book.SIZES[v])),
      P.size === 'custom' ? el('div', { class: 'mmrow' }, wI, '×', hI, 'mm') : null,
      el('div', { class: 'sp-lab', text: 'Orientace' }),
      seg([[false, 'Na výšku'], [true, 'Na šířku']], !!P.land, v => { P.land = v; setSize(P.size, P.w, P.h); }),
      el('div', { class: 'sp-lab', text: 'Linkování' }),
      seg([['blank', 'Čistý'], ['lined', 'Linky'], ['grid', 'Čtverečky'], ['dots', 'Tečky']], P.pattern || 'blank', v => { P.pattern = v; apply(); nbSettings(anchor); }),
      el('div', { class: 'sp-lab', text: 'Barva papíru' }),
      colorGrid(P.color, c => { P.color = c; apply(); nbSettings(anchor); }, ['#ffffff', '#fbf6e6', '#f1f3f5', '#fff9c4', '#e8f4ea', '#e6f0fb', '#2a2c31', '#111214']),
      E.pages.some(p => p.bg) ? el('p', { class: 'hint', text: 'Stránky z PDF si nechávají vlastní velikost i vzhled.' }) : null),
      { align: 'right', cls: 'dark' });
  }

  /* ================= otevření / zavření ================= */
  function resize() {
    if (!E.open) return;
    E.vw = stage.clientWidth; E.vh = stage.clientHeight; E.dpr = Math.min(window.devicePixelRatio || 1, 2);
    TOP_M = Math.round($('#tb').getBoundingClientRect().bottom + 10);
    for (const c of [cv, live]) { c.width = Math.round(E.vw * E.dpr); c.height = Math.round(E.vh * E.dpr); c.style.width = E.vw + 'px'; c.style.height = E.vh + 'px'; }
    viewChanged();
  }
  async function init() {
    stage = $('#stage'); cv = $('#cv'); live = $('#live'); overlay = $('#overlay');
    ctx = cv.getContext('2d', { alpha: false }); lctx = live.getContext('2d');
    const saved = await DB.kvGet('tools', {});
    T = JSON.parse(JSON.stringify(DEF_TOOLS));
    for (const k in T) Object.assign(T[k], saved[k] || {});
    $('#tools').replaceChildren(...[['pen', 'pen', 'Pero'], ['hl', 'hl', 'Zvýrazňovač'], ['eraser', 'eraser', 'Guma'], ['text', 'text', 'Text'], ['select', 'select', 'Výběr']].map(([t, ic, title]) =>
      el('button', { class: 'tbtn', dataset: { tool: t }, title, html: icon(ic, 26), onclick: () => setTool(t) })),
      el('span', { class: 'vsep' }), el('button', { class: 'tbtn', title: 'Vložit fotku nebo PDF', html: icon('pluscircle', 26), onclick: () => Ins.open() }));
    $('#b-back').onclick = close;
    $('#b-undo').onclick = undo; $('#b-redo').onclick = redo;
    $('#b-export').onclick = async () => { commitText(); await flushSave(); IO.exportDialog(E.nb, E.pages, curIdx()); };
    $('#b-nbset').onclick = e => nbSettings(e.currentTarget);
    $('#b-pages').onclick = () => Pages.toggle();
    $('#pg-menu').onclick = e => showMenu(e.currentTarget, pageMenu(E.pages[curIdx()]));
    $('#pg-up').onclick = () => gotoPage(E.pages[Math.max(0, curIdx() - 1)]);
    $('#pg-dn').onclick = () => gotoPage(E.pages[Math.min(E.pages.length - 1, curIdx() + 1)]);
    $('#addpage').onclick = () => addPage(E.pages.length);
    $('#crop-ok').onclick = () => exitCrop(true); $('#crop-no').onclick = () => exitCrop(false);
    $('#ins-cancel').onclick = Ins.close; $('#ins-add').onclick = Ins.commit;
    $('#ins-gallery').onclick = Ins.gallery; $('#ins-camera').onclick = Ins.camera; $('#ins-pdf').onclick = Ins.pdf;
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    // iPad: bez tohohle Safari u rychlých tahů tužkou čeká na dvojité ťuknutí / Scribble a tahy zahazuje
    for (const t of ['touchstart', 'touchmove', 'touchend']) stage.addEventListener(t, e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    for (const g of ['gesturestart', 'gesturechange']) document.addEventListener(g, e => e.preventDefault());
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', resize);
    if (window.visualViewport) visualViewport.addEventListener('resize', () => {
      window.scrollTo(0, 0);
      if (E.open && E.txt) { const r = E.txt.wrap.getBoundingClientRect(), lim = visualViewport.height - 24; if (r.bottom > lim) { E.view.ty -= Math.min(r.bottom - lim, r.top - TOP_M); viewChanged(); } }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && E.open) { commitText(); flushSave(); } });
    window.addEventListener('pagehide', () => { if (E.open) flushSave(); });
    Render.onAsync = () => { if (E.open) requestRender(); };
  }
  async function open(nbId) {
    const nb = await DB.get('notebooks', nbId);
    if (!nb) return toast('Sešit se nepodařilo otevřít');
    E.nb = nb;
    E.pages = await DB.loadPages(nb);
    if (!E.pages.length) { E.pages = [Book.newPage(nb)]; dirty.add(E.pages[0]); E.nbDirty = true; }
    Object.assign(E, { undo: [], redo: [], sel: null, act: null, txt: null, crop: null, tx: null, changed: false, tool: E.tool || 'pen', prevTool: E.prevTool || 'pen', open: true, _ind: null, rv: null, slow: false });
    E.hide.clear();
    E.backdrop = App.theme.side;
    $('#home').hidden = true; $('#editor').hidden = false;
    layoutPages();
    E.vw = stage.clientWidth; E.vh = stage.clientHeight;
    E.view = { s: Math.min(fitS(), 1000 / E.maxW), tx: E.vw / 2, ty: TOP_M };
    setTool(E.tool); updateHist(); Pages.toggle(false);
    resize();
  }
  async function close() {
    commitText(); setSel(null); exitCrop(false); closePop(); Ins.close(); Pages.toggle(false);
    if (E.tx) txCommit();
    if (E.changed || !E.nb.thumb) {
      try { const c = await Render.pageCanvas(E.pages[0], E.nb, 220); E.nb.thumb = c.toDataURL('image/jpeg', 0.7); E.nbDirty = true; } catch (e) { console.warn(e); }
    }
    await flushSave();
    E.open = false;
    Render.dropBgs();
    $('#editor').hidden = true; $('#home').hidden = false;
    Home.refresh();
  }
  return { init, open, close, E, hasClip: () => !!(clip || pclip) };
})();
