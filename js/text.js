'use strict';
/* Psaný text: upravuje se jako HTML v poli, na papír a do PDF se kreslí podle skutečného zalomení z prohlížeče. */
const Txt = (() => {
  const FONTS = [
    ['Systémové', '-apple-system, system-ui, "Helvetica Neue", Arial, sans-serif'],
    ['Helvetica', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
    ['Patkové', 'Georgia, "Times New Roman", serif'],
    ['Times', '"Times New Roman", Times, serif'],
    ['Strojopis', '"Courier New", Courier, monospace'],
    ['Psací', '"Bradley Hand", "Snell Roundhand", "Segoe Script", cursive'],
    ['Kulaté', '"Arial Rounded MT Bold", "Chalkboard SE", "Comic Sans MS", sans-serif'],
  ];
  const LH = 1.35;
  const cache = new WeakMap();
  let host, mctx;
  const metr = new Map();

  function fontStr(it, bold, italic) { return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${it.size}px ${it.font}`; }
  function metrics(font) {
    let m = metr.get(font);
    if (!m) {
      if (!mctx) mctx = document.createElement('canvas').getContext('2d');
      mctx.font = font;
      const t = mctx.measureText('Hg');
      const a = t.fontBoundingBoxAscent, d = t.fontBoundingBoxDescent;
      m = a > 0 ? { a, d } : { a: t.actualBoundingBoxAscent * 1.25, d: t.actualBoundingBoxDescent * 1.4 };
      metr.set(font, m);
    }
    return m;
  }
  function styleBox(elm, it) {
    elm.style.width = it.w + 'px';
    elm.style.fontFamily = it.font;
    elm.style.fontSize = it.size + 'px';
    elm.style.color = it.color;
  }
  function underlined(e, root) {
    for (; e && e !== root; e = e.parentElement) {
      if (e.tagName === 'U') return true;
      const td = e.style && (e.style.textDecorationLine || e.style.textDecoration);
      if (td && td.includes('underline')) return true;
    }
    return false;
  }
  function measureEl(root, it) {
    const base = root.getBoundingClientRect();
    const k = base.width ? it.w / base.width : 1; // přepočet, když je pole zvětšené přiblížením
    const frags = [], markers = [], range = document.createRange();
    const add = (text, r, node) => {
      if (!text.trim()) return;
      const pe = node.parentElement, cs = getComputedStyle(pe);
      const bold = parseInt(cs.fontWeight, 10) >= 600, italic = cs.fontStyle !== 'normal';
      const m = metrics(fontStr(it, bold, italic));
      const h = r.height * k;
      frags.push({ text, x: (r.left - base.left) * k, y: (r.top - base.top) * k + (h - (m.a + m.d)) / 2 + m.a, w: r.width * k, b: bold, i: italic, u: underlined(pe, root) });
    };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const s = node.data;
      if (!s) continue;
      range.selectNodeContents(node);
      const rs = range.getClientRects();
      if (rs.length === 1 && !s.includes('\t')) { add(s, rs[0], node); continue; }
      let cur = null;
      const flush = () => { if (cur) add(cur.text, { left: cur.l, top: cur.t, width: cur.r - cur.l, height: cur.h }, node); cur = null; };
      for (let i = 0; i < s.length;) {
        const cp = s.codePointAt(i), len = cp > 0xffff ? 2 : 1, ch = s.substr(i, len);
        range.setStart(node, i); range.setEnd(node, i + len);
        const r = range.getClientRects()[0];
        i += len;
        if (!r || ch === '\t' || ch === '\n') { flush(); continue; }
        if (cur && Math.abs(r.top - cur.t) < 2 && Math.abs(r.left - cur.r) < 2) { cur.text += ch; cur.r = r.right; }
        else { flush(); cur = { text: ch, l: r.left, r: r.right, t: r.top, h: r.height }; }
      }
      flush();
    }
    let num = 0;
    const m0 = metrics(fontStr(it, false, false)), lh = it.size * LH;
    for (const b of root.children) {
      const kind = b.dataset.list;
      if (kind === 'n') num++; else num = 0;
      if (!kind) continue;
      const r = b.getBoundingClientRect();
      markers.push({ text: kind === 'b' ? '•' : num + '.', x: (r.left - base.left) * k + it.size * 0.35, y: (r.top - base.top) * k + (lh - (m0.a + m0.d)) / 2 + m0.a });
    }
    return { frags, markers, h: Math.max(base.height * k, lh) };
  }
  function layout(it) {
    let L = cache.get(it);
    if (L) return L;
    if (!host) { host = el('div', { class: 'txt txt-measure' }); document.body.append(host); }
    styleBox(host, it);
    host.innerHTML = it.html;
    L = measureEl(host, it);
    host.innerHTML = '';
    cache.set(it, L);
    return L;
  }
  const height = it => layout(it).h;
  function draw(ctx, it, L) {
    L = L || layout(it);
    ctx.fillStyle = it.color;
    ctx.textBaseline = 'alphabetic';
    for (const f of L.frags) {
      ctx.font = fontStr(it, f.b, f.i);
      ctx.fillText(f.text, f.x, f.y);
      if (f.u) ctx.fillRect(f.x, f.y + it.size * 0.11, f.w, Math.max(it.size / 15, 0.6));
    }
    ctx.font = fontStr(it, false, false);
    for (const m of L.markers) ctx.fillText(m.text, m.x, m.y);
  }

  /* ---------- úpravy v poli ---------- */
  const OK_TAGS = new Set(['DIV', 'B', 'I', 'U', 'SPAN', 'BR', 'STRONG', 'EM']);
  function sanitize(root) {
    const walk = n => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1) { c.remove(); continue; }
        walk(c);
        if (!OK_TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
        const ta = c.style.textAlign, ml = c.style.marginLeft, fw = c.style.fontWeight, fs = c.style.fontStyle, td = c.style.textDecorationLine || c.style.textDecoration, dl = c.dataset.list;
        for (const a of Array.from(c.attributes)) c.removeAttribute(a.name);
        if (ta) c.style.textAlign = ta;
        if (ml) c.style.marginLeft = ml;
        if (fw) c.style.fontWeight = fw;
        if (fs) c.style.fontStyle = fs;
        if (td && td.includes('underline')) c.style.textDecoration = 'underline';
        if (dl === 'b' || dl === 'n') c.dataset.list = dl;
      }
    };
    walk(root);
  }
  function normalize(root) {
    let wrap = null;
    for (const c of Array.from(root.childNodes)) {
      if (c.nodeType === 1 && c.tagName === 'DIV') { wrap = null; continue; }
      if (!wrap) { wrap = document.createElement('div'); root.insertBefore(wrap, c); }
      wrap.append(c);
    }
    if (!root.firstChild) root.innerHTML = '<div><br></div>';
  }
  function blocks(root) {
    const sel = getSelection();
    const all = Array.from(root.children);
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return all.slice(-1);
    const r = sel.getRangeAt(0);
    const hit = all.filter(b => r.intersectsNode(b));
    return hit.length ? hit : all.slice(-1);
  }
  function cmd(root, c) {
    normalize(root);
    const bs = blocks(root);
    if (c === 'bold' || c === 'italic' || c === 'underline') document.execCommand(c);
    else if (c === 'ul' || c === 'ol') {
      const k = c === 'ul' ? 'b' : 'n', on = bs.every(b => b.dataset.list === k);
      bs.forEach(b => { if (on) delete b.dataset.list; else b.dataset.list = k; });
    } else if (c === 'indent' || c === 'outdent') {
      bs.forEach(b => {
        const v = clamp((parseFloat(b.style.marginLeft) || 0) / 1.5 + (c === 'indent' ? 1 : -1), 0, 8);
        b.style.marginLeft = v ? (v * 1.5) + 'em' : '';
      });
    } else if (c === 'left' || c === 'center' || c === 'right') bs.forEach(b => { b.style.textAlign = c === 'left' ? '' : c; });
  }
  function state(root) {
    const b = blocks(root)[0];
    const q = c => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    return { bold: q('bold'), italic: q('italic'), underline: q('underline'), ul: b && b.dataset.list === 'b', ol: b && b.dataset.list === 'n', align: (b && b.style.textAlign) || 'left' };
  }
  const isEmpty = html => { const d = document.createElement('div'); d.innerHTML = html; return !d.textContent.trim(); };
  return { FONTS, LH, layout, height, draw, measureEl, styleBox, sanitize, normalize, cmd, state, isEmpty };
})();
