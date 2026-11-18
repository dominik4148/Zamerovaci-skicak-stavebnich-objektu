'use strict';
/* Kreslení stránek: papír, podklad z PDF, tahy, obrázky, text. Používá se pro obrazovku, náhledy i export. */
const Render = (() => {
  let onAsync = () => { };
  /* ---------- obrázky ---------- */
  const imgs = new Map();
  function loadImg(id) {
    let e = imgs.get(id);
    if (e) { imgs.delete(id); imgs.set(id, e); return e; }
    e = { img: null, ready: false, url: null };
    e.promise = DB.getBlob(id).then(rec => new Promise(res => {
      if (!rec) return res(null);
      e.url = URL.createObjectURL(new Blob([rec.data], { type: rec.type }));
      const im = new Image();
      im.onload = () => { e.img = im; e.ready = true; res(im); onAsync(); };
      im.onerror = () => res(null);
      im.src = e.url;
    }));
    imgs.set(id, e);
    if (imgs.size > 40) { const [k, old] = imgs.entries().next().value; if (old.url) URL.revokeObjectURL(old.url); imgs.delete(k); }
    return e;
  }
  const imageReady = id => loadImg(id).promise;

  /* ---------- PDF (pdf.js se načte až když je potřeba) ---------- */
  let pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(new URL('lib/pdf.min.js', document.baseURI).href).then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', document.baseURI).href;
      return m;
    });
    return pdfjsP;
  }
  const docs = new Map();
  function pdfDoc(blobId) {
    let p = docs.get(blobId);
    if (p) { docs.delete(blobId); docs.set(blobId, p); return p; }
    p = (async () => {
      const [lib, rec] = await Promise.all([pdfjs(), DB.getBlob(blobId)]);
      if (!rec) throw new Error('PDF chybí');
      const task = lib.getDocument({ data: new Uint8Array(rec.data.slice(0)) });
      p.task = task;
      return task.promise;
    })();
    docs.set(blobId, p);
    if (docs.size > 3) { const [k, old] = docs.entries().next().value; docs.delete(k); if (old.task) old.task.destroy().catch(() => { }); }
    return p;
  }
  let chain = Promise.resolve();
  function renderPdfPage(blobId, n, scale) {
    const job = chain.then(async () => {
      const doc = await pdfDoc(blobId), page = await doc.getPage(n + 1);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
      await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c;
    });
    chain = job.catch(() => { });
    return job;
  }
  /* podklady stránek pro obrazovku – drží se jen pár posledních, ať nedojde paměť */
  const bgs = new Map();
  const BG_MAX_PX = 5e6;
  function bg(page, want) {
    const cap = Math.sqrt(BG_MAX_PX / (page.w * page.h));
    want = Math.min(want, cap);
    let e = bgs.get(page.id);
    if (e) { bgs.delete(page.id); bgs.set(page.id, e); }
    else { e = { canvas: null, scale: 0, busy: false }; bgs.set(page.id, e); }
    if (!e.busy && (e.scale < want * 0.8 || e.scale > want * 1.7)) {
      e.busy = true;
      renderPdfPage(page.bg.blob, page.bg.n, want).then(c => {
        if (e.canvas) e.canvas.width = 0;
        e.canvas = c; e.scale = want; e.busy = false;
        if (bgs.get(page.id) === e) onAsync(); else c.width = 0;
      }).catch(() => { e.busy = false; e.failed = true; });
    }
    if (bgs.size > 5) { const [k, old] = bgs.entries().next().value; if (!old.busy) { if (old.canvas) old.canvas.width = 0; bgs.delete(k); } }
    return e.canvas;
  }
  function dropBgs() { for (const e of bgs.values()) if (e.canvas) e.canvas.width = 0; bgs.clear(); }

  /* ---------- papír ---------- */
  function patternLines(paper, w, h) {
    const L = { h: [], v: [], dots: null };
    const mm = 72 / 25.4;
    if (paper.pattern === 'lined') for (let y = 20 * mm; y < h - 6 * mm; y += 8 * mm) L.h.push(r2(y));
    else if (paper.pattern === 'grid') {
      for (let y = 5 * mm; y < h - 1; y += 5 * mm) L.h.push(r2(y));
      for (let x = 5 * mm; x < w - 1; x += 5 * mm) L.v.push(r2(x));
    } else if (paper.pattern === 'dots') L.dots = 5 * mm;
    return L;
  }
  const paperDark = paper => lum(paper.color || '#ffffff') < 0.4;
  const ruleColor = paper => mix(paper.color || '#ffffff', paperDark(paper) ? '#ffffff' : '#30507a', 0.2);
  function drawPaper(ctx, w, h, paper, bgCanvas) {
    ctx.fillStyle = bgCanvas ? '#ffffff' : (paper.color || '#ffffff');
    ctx.fillRect(0, 0, w, h);
    if (bgCanvas) { ctx.drawImage(bgCanvas, 0, 0, w, h); return; }
    if (!paper.pattern || paper.pattern === 'blank') return;
    const L = patternLines(paper, w, h);
    ctx.strokeStyle = ctx.fillStyle = ruleColor(paper);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const y of L.h) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    for (const x of L.v) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();
    if (L.dots) for (let y = L.dots; y < h - 1; y += L.dots) for (let x = L.dots; x < w - 1; x += L.dots) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  }

  /* ---------- položky ---------- */
  function drawItem(ctx, it, dark) {
    if (it.t === 's') {
      const g = strokeGeom(it), path = strokePath(it);
      if (it.k === 'h') {
        ctx.save();
        if (dark) ctx.globalAlpha = 0.45; else ctx.globalCompositeOperation = 'multiply';
      }
      if (g.fill) { ctx.fillStyle = it.c; ctx.fill(path); }
      else {
        ctx.strokeStyle = it.c; ctx.lineWidth = it.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash(dashFor(it));
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
      if (it.k === 'h') ctx.restore();
    } else if (it.t === 'i') {
      const e = loadImg(it.blob);
      ctx.save();
      ctx.translate(it.x, it.y); ctx.rotate(it.r || 0);
      if (e.ready) {
        const c = it.crop || [0, 0, 1, 1], iw = e.img.naturalWidth, ih = e.img.naturalHeight;
        ctx.drawImage(e.img, c[0] * iw, c[1] * ih, (c[2] - c[0]) * iw, (c[3] - c[1]) * ih, 0, 0, it.w, it.h);
      } else { ctx.fillStyle = 'rgba(128,128,128,.18)'; ctx.fillRect(0, 0, it.w, it.h); }
      ctx.restore();
    } else if (it.t === 't') {
      ctx.save();
      ctx.translate(it.x, it.y); ctx.rotate(it.r || 0); ctx.scale(it.sc, it.sc);
      Txt.draw(ctx, it);
      ctx.restore();
    }
  }
  function drawItems(ctx, items, dark, skip, view) {
    for (const it of items) {
      if (skip && skip.has(it.id)) continue;
      if (view && !bbHit(itemBBox(it), view)) continue;
      drawItem(ctx, it, dark);
    }
  }
  /* celá stránka do plátna (náhledy, obrázkový export) */
  async function pageCanvas(page, nb, pxW, opts = {}) {
    const size = Book.pageSize(page, nb), k = pxW / size.w;
    const c = document.createElement('canvas');
    c.width = Math.round(pxW); c.height = Math.round(size.h * k);
    const ctx = c.getContext('2d');
    let bgc = null;
    if (page.bg) { try { bgc = await renderPdfPage(page.bg.blob, page.bg.n, k); } catch (e) { } }
    await Promise.all(page.items.filter(i => i.t === 'i').map(i => imageReady(i.blob)));
    ctx.scale(k, k);
    drawPaper(ctx, size.w, size.h, nb.paper, bgc);
    if (bgc) bgc.width = 0;
    drawItems(ctx, page.items, !page.bg && paperDark(nb.paper), opts.skip);
    return c;
  }
  return { loadImg, imageReady, pdfjs, pdfDoc, renderPdfPage, bg, dropBgs, patternLines, paperDark, ruleColor, drawPaper, drawItem, drawItems, pageCanvas, set onAsync(f) { onAsync = f; } };
})();

/* velikosti papíru a práce se sešitem v paměti */
const Book = {
  SIZES: { A5: [419.53, 595.28], A4: [595.28, 841.89], A3: [841.89, 1190.55], Letter: [612, 792] },
  defPaper: () => ({ size: 'A4', land: false, w: 595.28, h: 841.89, pattern: 'blank', color: '#ffffff' }),
  pageSize(p, nb) { return p.bg ? { w: p.w, h: p.h } : { w: nb.paper.w, h: nb.paper.h }; },
  newPage(nb) { return { id: uid(), nb: nb.id, items: [], bg: null }; },
};
