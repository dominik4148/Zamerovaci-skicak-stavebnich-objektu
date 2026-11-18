'use strict';
/* Import PDF a fotek, export do PDF (tahy jako vektory), záloha a obnova. */
const IO = (() => {
  const MAXDIM = 2000;

  async function importPdf(file, nbId) {
    const buf = await file.arrayBuffer();
    const lib = await Render.pdfjs();
    const task = lib.getDocument({ data: new Uint8Array(buf.slice(0)) }), doc = await task.promise;
    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      const k = Math.min(1, MAXDIM / Math.max(vp.width, vp.height));
      sizes.push({ w: r2(vp.width * k), h: r2(vp.height * k) });
    }
    task.destroy().catch(() => { });
    const blob = await DB.putBlob(buf, 'application/pdf', file.name);
    return sizes.map((s, n) => ({ id: uid(), nb: nbId, items: [], bg: { blob, n }, w: s.w, h: s.h }));
  }

  /* fotka se před uložením zmenší a zkomprimuje – šetří úložiště */
  async function importImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Obrázek nejde načíst')); i.src = url; });
      const iw = im.naturalWidth, ih = im.naturalHeight, k = Math.min(1, 2200 / Math.max(iw, ih));
      const isPng = file.type === 'image/png';
      if (isPng && k === 1 && file.size < 600e3) return { blob: await DB.putBlob(await file.arrayBuffer(), 'image/png', file.name), w: iw, h: ih };
      const c = document.createElement('canvas');
      c.width = Math.round(iw * k); c.height = Math.round(ih * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const b = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
      const out = { blob: await DB.putBlob(await b.arrayBuffer(), 'image/jpeg', file.name), w: c.width, h: c.height };
      c.width = 0;
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- export PDF ---------- */
  const n3 = v => String(Math.round(v * 1000) / 1000);
  const rgb = h => hexToRgb(h).map(v => n3(v / 255)).join(' ');
  const canvasBytes = (c, type, q) => new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), type, q));

  async function exportPdf(nb, pages, onProg = () => { }) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    out.setTitle(nb.name); out.setCreator('Zápisník'); out.setProducer('Zápisník');
    const gsM = out.context.obj({ Type: 'ExtGState', BM: 'Multiply' });
    const gsA = out.context.obj({ Type: 'ExtGState', ca: 0.45, CA: 0.45 });

    // podklady z PDF se vkládají jako původní vektorové stránky
    const srcs = new Map();
    for (const p of pages) if (p.bg) { if (!srcs.has(p.bg.blob)) srcs.set(p.bg.blob, new Set()); srcs.get(p.bg.blob).add(p.bg.n); }
    const emb = new Map();
    for (const [blobId, set] of srcs) {
      try {
        const rec = await DB.getBlob(blobId);
        const src = await PDFDocument.load(rec.data);
        const sp = src.getPages(), idx = Array.from(set).filter(i => i < sp.length);
        const boxes = idx.map(i => { const b = sp[i].getCropBox(); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; });
        const eps = await out.embedPages(idx.map(i => sp[i]), boxes);
        idx.forEach((i, j) => emb.set(blobId + ':' + i, { ep: eps[j], bw: boxes[j].right - boxes[j].left, bh: boxes[j].top - boxes[j].bottom, rot: ((sp[i].getRotation().angle % 360) + 360) % 360 }));
      } catch (e) { console.warn('PDF podklad nejde vložit vektorově, použije se obrázek', e); }
    }
    const imgE = new Map();
    async function embedImage(blobId) {
      if (imgE.has(blobId)) return imgE.get(blobId);
      const rec = await DB.getBlob(blobId);
      let im = null;
      if (rec) {
        try { im = rec.type === 'image/png' ? await out.embedPng(rec.data) : await out.embedJpg(rec.data); }
        catch (e) {
          const el0 = await Render.imageReady(blobId);
          if (el0) { const c = document.createElement('canvas'); c.width = el0.naturalWidth; c.height = el0.naturalHeight; c.getContext('2d').drawImage(el0, 0, 0); im = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9)); }
        }
      }
      imgE.set(blobId, im);
      return im;
    }

    for (let pi = 0; pi < pages.length; pi++) {
      onProg(pi, pages.length);
      const p = pages[pi], { w, h } = Book.pageSize(p, nb);
      const page = out.addPage([w, h]);
      const dark = !p.bg && Render.paperDark(nb.paper);
      let s = '';
      if (p.bg) {
        const e = emb.get(p.bg.blob + ':' + p.bg.n);
        if (e) {
          const name = page.node.newXObject('Bg', e.ep.ref);
          const sw = e.rot % 180 ? e.bh : e.bw, sh = e.rot % 180 ? e.bw : e.bh;
          const rm = e.rot === 90 ? `0 -1 1 0 0 ${n3(e.bw)}` : e.rot === 180 ? `-1 0 0 -1 ${n3(e.bw)} ${n3(e.bh)}` : e.rot === 270 ? `0 1 -1 0 ${n3(e.bh)} 0` : '1 0 0 1 0 0';
          s += `q ${n3(w / sw)} 0 0 ${n3(h / sh)} 0 0 cm ${rm} cm ${name} Do Q\n`;
        } else {
          try {
            const c = await Render.renderPdfPage(p.bg.blob, p.bg.n, 2.5);
            const im = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9));
            c.width = 0;
            s += `q ${n3(w)} 0 0 ${n3(h)} 0 0 cm ${page.node.newXObject('Bg', im.ref)} Do Q\n`;
          } catch (e2) { console.warn(e2); }
        }
      } else {
        const pc = nb.paper.color || '#ffffff';
        if (pc.toLowerCase() !== '#ffffff') s += `${rgb(pc)} rg 0 0 ${n3(w)} ${n3(h)} re f\n`;
      }
      s += `q 1 0 0 -1 0 ${n3(h)} cm 1 J 1 j\n`;
      if (!p.bg && nb.paper.pattern && nb.paper.pattern !== 'blank') {
        const L = Render.patternLines(nb.paper, w, h), rc = rgb(Render.ruleColor(nb.paper));
        s += `${rc} RG ${rc} rg 0.5 w\n`;
        for (const y of L.h) s += `0 ${y} m ${n3(w)} ${y} l\n`;
        for (const x of L.v) s += `${x} 0 m ${x} ${n3(h)} l\n`;
        if (L.h.length || L.v.length) s += 'S\n';
        if (L.dots) for (let y = L.dots; y < h - 1; y += L.dots) for (let x = L.dots; x < w - 1; x += L.dots) s += `${r2(x - 0.5)} ${r2(y - 0.5)} 1 1 re\n`;
        if (L.dots) s += 'f\n';
      }
      // tahy přesahující ze sousedních stránek se dokreslí taky
      const sets = [];
      if (pi > 0) { const q = pages[pi - 1], z = Book.pageSize(q, nb); sets.push([q.items, (w - z.w) / 2, -z.h]); }
      sets.push([p.items, 0, 0]);
      if (pi < pages.length - 1) { const q = pages[pi + 1], z = Book.pageSize(q, nb); sets.push([q.items, (w - z.w) / 2, h]); }
      let gM = null, gA = null;
      for (const [items, ox, oy] of sets) {
        const own = !ox && !oy, view = [-ox, -oy, w - ox, h - oy];
        if (!own) s += `q 1 0 0 1 ${n3(ox)} ${n3(oy)} cm\n`;
        for (const it of items) {
          if (!own && !bbHit(itemBBox(it), view)) continue;
          if (it.t === 's') {
            const g = strokeGeom(it), ops = cmdsToPdf(g.cmds), hl = it.k === 'h';
            if (hl) { s += 'q '; if (dark) { gA = gA || page.node.newExtGState('GSa', gsA); s += `${gA} gs\n`; } else { gM = gM || page.node.newExtGState('GSm', gsM); s += `${gM} gs\n`; } }
            if (g.fill) s += `${rgb(it.c)} rg\n${ops}f\n`;
            else s += `${rgb(it.c)} RG ${r2(it.w)} w [${dashFor(it).join(' ')}] 0 d\n${ops}S\n`;
            if (hl) s += 'Q\n';
          } else if (it.t === 'i') {
            const im = await embedImage(it.blob);
            if (!im) continue;
            const c = it.crop || [0, 0, 1, 1], FW = it.w / (c[2] - c[0]), FH = it.h / (c[3] - c[1]), co = Math.cos(it.r || 0), si = Math.sin(it.r || 0);
            s += `q ${n3(co)} ${n3(si)} ${n3(-si)} ${n3(co)} ${n3(it.x)} ${n3(it.y)} cm 0 0 ${n3(it.w)} ${n3(it.h)} re W n ` +
              `${n3(FW)} 0 0 ${n3(-FH)} ${n3(-c[0] * FW)} ${n3(-c[1] * FH + FH)} cm ${page.node.newXObject('Im', im.ref)} Do Q\n`;
          } else if (it.t === 't') {
            const L = Txt.layout(it), tw = it.w * it.sc, th = L.h * it.sc;
            let rs = 4; // ~288 dpi
            if (tw * th * rs * rs > 9e6) rs = Math.sqrt(9e6 / (tw * th));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.ceil(tw * rs)); c.height = Math.max(1, Math.ceil(th * rs));
            const ctx = c.getContext('2d');
            ctx.scale(it.sc * rs, it.sc * rs);
            Txt.draw(ctx, it, L);
            const im = await out.embedPng(await canvasBytes(c, 'image/png'));
            c.width = 0;
            const co = Math.cos(it.r || 0), si = Math.sin(it.r || 0);
            s += `q ${n3(co)} ${n3(si)} ${n3(-si)} ${n3(co)} ${n3(it.x)} ${n3(it.y)} cm ${n3(tw)} 0 0 ${n3(-th)} 0 ${n3(th)} cm ${page.node.newXObject('Tx', im.ref)} Do Q\n`;
          }
        }
        if (!own) s += 'Q\n';
      }
      s += 'Q\n';
      page.node.addContentStream(out.context.register(out.context.flateStream(s)));
      if (pi % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
    onProg(pages.length, pages.length);
    return out.save();
  }

  /* dialog exportu: PDF se vytvoří hned, sdílení pak jde jedním ťuknutím */
  function exportDialog(nb, pages, curIdx) {
    let token = 0, result = null;
    const status = el('div', { class: 'exp-status', text: 'Připravuji PDF…' });
    const bShare = el('button', { class: 'btn primary big', disabled: true, html: icon('share', 20) + '<span>Sdílet / odeslat…</span>' });
    const bSave = el('button', { class: 'btn big', disabled: true, html: icon('download', 20) + '<span>Uložit PDF do Souborů</span>' });
    const bPrint = el('button', { class: 'btn big', disabled: true, html: icon('print', 20) + '<span>Tisk</span>' });
    const seg = el('div', { class: 'seg' });
    const modes = [['all', 'Celý sešit']];
    if (curIdx != null && pages.length > 1) modes.push(['cur', `Jen stránka ${curIdx + 1}`]);
    let mode = 'all';
    const run = async () => {
      const my = ++token;
      result = null; [bShare, bSave, bPrint].forEach(b => b.disabled = true);
      status.textContent = 'Připravuji PDF…';
      try {
        const list = mode === 'cur' ? [pages[curIdx]] : pages;
        const bytes = await exportPdf(nb, list, (i, n) => { if (my === token) status.textContent = `Připravuji PDF… ${Math.min(i + 1, n)} / ${n}`; });
        if (my !== token) return;
        result = new Blob([bytes], { type: 'application/pdf' });
        status.textContent = `Hotovo · ${list.length} ${list.length === 1 ? 'stránka' : list.length < 5 ? 'stránky' : 'stránek'} · ${fmtSize(result.size)}`;
        [bShare, bSave, bPrint].forEach(b => b.disabled = false);
      } catch (e) { console.error(e); if (my === token) status.textContent = 'Export se nepovedl: ' + e.message; }
    };
    modes.forEach(([k, label]) => seg.append(el('button', { class: 'segb' + (k === mode ? ' on' : ''), text: label, onclick: e => { mode = k; $$('.segb', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); run(); } })));
    const name = () => safeName(nb.name) + (mode === 'cur' ? `_s${curIdx + 1}` : '') + '.pdf';
    bShare.onclick = () => result && shareFile(result, name(), 'application/pdf');
    bSave.onclick = () => { if (result) { saveBlob(result, name()); toast('PDF uloženo do stažených souborů'); } };
    bPrint.onclick = () => {
      if (!result) return;
      const ios = /iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios) { toast('V nabídce sdílení zvol „Tisk“'); shareFile(result, name(), 'application/pdf'); return; }
      const url = URL.createObjectURL(result), fr = el('iframe', { style: { display: 'none' }, src: url });
      fr.onload = () => { try { fr.contentWindow.print(); } catch (e) { window.open(url); } };
      document.body.append(fr);
      setTimeout(() => { fr.remove(); URL.revokeObjectURL(url); }, 120000);
    };
    run();
    return modal('Export', el('div', { class: 'exp' }, modes.length > 1 ? seg : null, status, bShare, bSave, bPrint,
      el('p', { class: 'hint', text: 'Sdílení otevře nabídku iPadu: WhatsApp, Zprávy, Mail, Poznámky, Soubory i Tisk. Ručně psané tahy jsou v PDF jako vektory, takže zůstanou ostré při jakémkoli zvětšení.' })),
      [{ label: 'Zavřít', value: null }]).then(() => { token++; });
  }

  /* ---------- záloha do jednoho souboru ---------- */
  const MAGIC = 'ZAPISNIK1';
  const enc = new TextEncoder(), dec = new TextDecoder();
  function i16ToB64(a) {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToI16(b) {
    const s = atob(b), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return new Int16Array(u.buffer, 0, u.length >> 1);
  }
  const pageToJson = p => JSON.stringify({ ...p, items: p.items.map(it => it.t === 's' ? { ...it, pts: i16ToB64(it.pts) } : it) });
  const pageFromJson = s => { const p = JSON.parse(s); p.items = p.items.map(it => it.t === 's' ? { ...it, pts: b64ToI16(it.pts) } : it); return p; };
  function chunk(type, ...payload) {
    const len = payload.reduce((a, b) => a + (b.byteLength !== undefined ? b.byteLength : b.size), 0);
    const h = new DataView(new ArrayBuffer(5));
    h.setUint8(0, type); h.setUint32(1, len, true);
    return new Blob([h.buffer, ...payload]);
  }
  async function backup(onProg = () => { }) {
    const parts = [enc.encode(MAGIC)];
    const meta = { v: 1, date: Date.now(), folders: await DB.all('folders'), notebooks: await DB.all('notebooks'), kv: {} };
    for (const k of await DB.keys('kv')) meta.kv[k] = await DB.kvGet(k);
    parts.push(chunk(1, enc.encode(JSON.stringify(meta))));
    const pk = await DB.keys('pages'), bk = await DB.keys('blobs'), total = pk.length + bk.length;
    let done = 0;
    for (const k of pk) { parts.push(chunk(2, enc.encode(pageToJson(await DB.get('pages', k))))); if (++done % 20 === 0) onProg(done, total); }
    for (const k of bk) {
      const r = await DB.getBlob(k), hd = enc.encode(JSON.stringify({ id: r.id, type: r.type, name: r.name })), hl = new Uint16Array([hd.length]);
      parts.push(chunk(3, hl.buffer, hd, r.data));
      onProg(++done, total);
    }
    return new Blob(parts, { type: 'application/octet-stream' });
  }
  async function restore(file, onProg = () => { }) {
    const head = dec.decode(await file.slice(0, MAGIC.length).arrayBuffer());
    if (head !== MAGIC) throw new Error('Tohle není soubor zálohy Zápisníku.');
    let off = MAGIC.length, pagesBuf = [], count = 0;
    const flush = async () => { if (pagesBuf.length) { await DB.putMany('pages', pagesBuf); pagesBuf = []; } };
    while (off < file.size) {
      const h = new DataView(await file.slice(off, off + 5).arrayBuffer());
      const type = h.getUint8(0), len = h.getUint32(1, true);
      const body = file.slice(off + 5, off + 5 + len);
      off += 5 + len;
      if (type === 1) {
        const m = JSON.parse(await body.text());
        await DB.putMany('folders', m.folders || []);
        await DB.putMany('notebooks', m.notebooks || []);
        for (const k in (m.kv || {})) await DB.kvSet(k, m.kv[k]);
      } else if (type === 2) {
        pagesBuf.push(pageFromJson(await body.text()));
        if (pagesBuf.length >= 40) await flush();
      } else if (type === 3) {
        const hl = new Uint16Array(await body.slice(0, 2).arrayBuffer())[0];
        const hd = JSON.parse(await body.slice(2, 2 + hl).text());
        await DB.put('blobs', { id: hd.id, type: hd.type, name: hd.name, data: await body.slice(2 + hl).arrayBuffer() });
      }
      if (++count % 10 === 0) onProg(off, file.size);
    }
    await flush();
  }
  return { importPdf, importImage, exportPdf, exportDialog, backup, restore };
})();
