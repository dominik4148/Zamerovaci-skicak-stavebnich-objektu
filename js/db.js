'use strict';
/* IndexedDB – velké úložiště prohlížeče. Obrázky a PDF se ukládají jen jednou (blobs) a stránky na ně odkazují. */
const DB = (() => {
  let db;
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('zapisnik', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('folders', { keyPath: 'id' });
        d.createObjectStore('notebooks', { keyPath: 'id' });
        const p = d.createObjectStore('pages', { keyPath: 'id' });
        p.createIndex('nb', 'nb');
        p.createIndex('refs', 'refs', { multiEntry: true });
        d.createObjectStore('blobs', { keyPath: 'id' });
        d.createObjectStore('kv');
      };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => db.close(); res(); };
      r.onerror = () => rej(r.error);
    });
  }
  const st = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('Chyba úložiště')); });

  const get = (s, k) => rq(st(s).get(k));
  const all = s => rq(st(s).getAll());
  const put = (s, v, k) => rq(st(s, 'readwrite').put(v, k));
  const del = (s, k) => rq(st(s, 'readwrite').delete(k));
  const byIndex = (s, idx, k) => rq(st(s).index(idx).getAll(k));
  const keys = s => rq(st(s).getAllKeys());
  function putMany(s, vals) {
    if (!vals.length) return Promise.resolve();
    const t = db.transaction(s, 'readwrite'), o = t.objectStore(s);
    vals.forEach(v => o.put(v));
    return done(t);
  }
  function delMany(s, ks) {
    if (!ks.length) return Promise.resolve();
    const t = db.transaction(s, 'readwrite'), o = t.objectStore(s);
    ks.forEach(k => o.delete(k));
    return done(t);
  }
  const kvGet = async (k, def) => { const v = await rq(st('kv').get(k)); return v === undefined ? def : v; };
  const kvSet = (k, v) => put('kv', v, k);

  /* stránka → záznam s indexem odkazů na bloby */
  function pageRefs(p) {
    const s = new Set();
    if (p.bg) s.add(p.bg.blob);
    for (const it of p.items) if (it.t === 'i') s.add(it.blob);
    return Array.from(s);
  }
  const pageRec = p => ({ id: p.id, nb: p.nb, items: p.items, bg: p.bg || null, w: p.w, h: p.h, refs: pageRefs(p) });
  const savePage = p => put('pages', pageRec(p));
  const savePages = ps => putMany('pages', ps.map(pageRec));
  async function loadPages(nb) {
    const recs = await byIndex('pages', 'nb', nb.id);
    const m = new Map(recs.map(r => [r.id, r]));
    return nb.pageIds.map(id => m.get(id)).filter(Boolean);
  }
  async function deleteNotebook(id) {
    const ks = await rq(st('pages').index('nb').getAllKeys(id));
    await delMany('pages', ks);
    await del('notebooks', id);
  }
  /* smaže obrázky a PDF, na které už nic neodkazuje */
  async function gc() {
    const ids = await keys('blobs');
    const idx = st('pages').index('refs');
    const dead = [];
    await Promise.all(ids.map(id => rq(idx.count(id)).then(n => { if (!n) dead.push(id); })));
    await delMany('blobs', dead);
    return dead.length;
  }
  async function putBlob(data, type, name) {
    const id = uid();
    await put('blobs', { id, data, type, name: name || '' });
    return id;
  }
  const getBlob = id => get('blobs', id);
  return { open, get, all, put, del, byIndex, keys, putMany, delMany, kvGet, kvSet, savePage, savePages, loadPages, deleteNotebook, gc, putBlob, getBlob, pageRec, raw: () => db };
})();
