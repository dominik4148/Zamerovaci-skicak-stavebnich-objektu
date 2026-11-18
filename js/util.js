'use strict';
/* ---------- základní pomůcky ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

const F = 'fill="currentColor" stroke="none"';
const ICONS = {
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1zM14 7l3 3"/>',
  hl: '<path d="M9 14l-3 3v3h3l3-3M9 14l8.5-8.5a2.1 2.1 0 013 3L12 17l-3-3zM3 21h7"/>',
  eraser: '<path d="M20 20H9l-5-5a1.5 1.5 0 010-2.1l8.9-8.9a1.5 1.5 0 012.1 0l5 5a1.5 1.5 0 010 2.1L11 20M7.5 9.5l7 7"/>',
  text: '<path d="M3 7V5h12v2M9 5v14M6.5 19h5M14 13v-1.5h7V13M17.5 11.5V19M16 19h3"/>',
  select: `<rect x="5" y="5" width="14" height="14" stroke-dasharray="2.4 2.4"/><circle cx="5" cy="5" r="1.7" ${F}/><circle cx="19" cy="5" r="1.7" ${F}/><circle cx="5" cy="19" r="1.7" ${F}/><circle cx="19" cy="19" r="1.7" ${F}/>`,
  pluscircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"/>',
  sliders: '<path d="M4 6h9M19 6h1M4 12h1M11 12h9M4 18h11"/><circle cx="16" cy="6" r="2.2"/><circle cx="8" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  dots: `<circle cx="6" cy="12" r="1.5" ${F}/><circle cx="12" cy="12" r="1.5" ${F}/><circle cx="18" cy="12" r="1.5" ${F}/>`,
  pages: '<rect x="8" y="3" width="12" height="15" rx="2"/><path d="M16 21H6a2 2 0 01-2-2V8"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>', chevR: '<path d="M9 6l6 6-6 6"/>', chevU: '<path d="M6 15l6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
  dup: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 9v9a2 2 0 01-2 2H9M10 7v6M7 10h6"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 12h6M9 16h4"/>',
  crop: '<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.6-1.7"/>',
  front: '<path d="M12 11V2M8.5 5.5L12 2l3.5 3.5M7 9l-4 2.5 9 5.5 9-5.5L17 9M3 16l9 5.5 9-5.5"/>',
  backw: '<path d="M12 2v9M8.5 7.5L12 11l3.5-3.5M7 9l-4 2.5 9 5.5 9-5.5L17 9M3 16l9 5.5 9-5.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  note: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7"/>',
  pdf: '<path d="M6 3h9l4 4v14H6zM15 3v4h4"/><path d="M9 11h6M9 14.5h6M9 18h3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  move: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 14h6M12.5 11.5L15 14l-2.5 2.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  sort: '<path d="M4 7h10M4 12h7M4 17h4M17 6v12M14 15l3 3 3-3"/>',
  lasso: '<path d="M12 5c5 0 9 2.4 9 5.5S17 16 12 16s-9-2.4-9-5.5S7 5 12 5z" stroke-dasharray="2.4 2.4"/>',
  box: '<rect x="3.5" y="6" width="17" height="12" stroke-dasharray="2.4 2.4"/>',
  alignL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  ul: `<circle cx="5" cy="7" r="1.3" ${F}/><circle cx="5" cy="12" r="1.3" ${F}/><circle cx="5" cy="17" r="1.3" ${F}/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/>`,
  ol: '<path d="M10 7h10M10 12h10M10 17h10M4 5.6l1.6-1v4.2M4 15.2c.2-1.6 2.8-1.4 2.6.2-.1 1-2.2 1.6-2.6 3.1h2.8"/>',
  indent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16M4 9.5l3.5 2.5L4 14.5"/>',
  outdent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16M7.5 9.5L4 12l3.5 2.5"/>',
  pageBefore: '<rect x="6" y="10" width="12" height="11" rx="1.5"/><path d="M12 7V2M9.5 4.5h5"/>',
  pageAfter: '<rect x="6" y="3" width="12" height="11" rx="1.5"/><path d="M12 22v-5M9.5 19.5h5"/>',
  clear: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9.5 11.5l5 5M14.5 11.5l-5 5"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>',
  upload: '<path d="M12 15V3M8 7l4-4 4 4M5 21h14"/>',
  ret: '<path d="M9 15L4 10l5-5M4 10h9a6 6 0 016 6v3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  print: '<path d="M7 8V3h10v5M7 17H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-2M7 14h10v7H7z"/>',
  erWhole: '<path d="M16.5 13H10l-3.6-3.6a1.3 1.3 0 010-1.8l4.6-4.6a1.3 1.3 0 011.8 0l4.4 4.4a1.3 1.3 0 010 1.8L13 13M9 7l4.5 4.5"/><path d="M2.5 19.5c2.2-2.6 4-2.6 6.3 0s4.1 2.6 6.4 0 4.1-2.6 6.3 0"/>',
  palette: `<path d="M12 3a9 9 0 100 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.5-4-8.1-9-8.1z"/><circle cx="7.5" cy="11.5" r="1.2" ${F}/><circle cx="10" cy="7.5" r="1.2" ${F}/><circle cx="14.5" cy="7.2" r="1.2" ${F}/><circle cx="17.3" cy="10.6" r="1.2" ${F}/>`,
  line0: '<path d="M3 12h18"/>',
  line1: '<path d="M3 12h4M10 12h4M17 12h4"/>',
  line2: `<circle cx="4" cy="12" r="1.2" ${F}/><circle cx="9.3" cy="12" r="1.2" ${F}/><circle cx="14.6" cy="12" r="1.2" ${F}/><circle cx="20" cy="12" r="1.2" ${F}/>`,
  line3: `<path d="M3 12h5M14 12h5"/><circle cx="11" cy="12" r="1.2" ${F}/><circle cx="21.5" cy="12" r="1.2" ${F}/>`,
};
function icon(name, size = 24) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function iconBtn(name, title, onclick, cls = '') {
  return el('button', { class: 'ibtn ' + cls, title, 'aria-label': title, html: icon(name), onclick });
}

/* ---------- barvy ---------- */
function hexToRgb(h) {
  h = (h || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(h) { const [r, g, b] = hexToRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const PALETTE20 = ['#111111', '#555555', '#8a8a8a', '#c9c9c9', '#ffffff', '#ee3524', '#f08a24', '#f5c60e', '#8bc34a', '#00783a',
  '#00a39b', '#19c3f0', '#0a6cf5', '#3f3fd1', '#5f2c91', '#b12bd1', '#e6399b', '#d0104c', '#8d5a3b', '#f2b8a0'];

/* ---------- datum / velikost ---------- */
function fmtDate(ts) { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; }
function fmtSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' kB';
}

/* ---------- toast, menu, dialogy ---------- */
function toast(msg, ms = 2600) {
  const t = el('div', { class: 'toast', text: msg });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, ms);
}

let _pop = null;
function closePop() { if (_pop) { _pop.remove(); _pop = null; document.removeEventListener('pointerdown', _popOut, true); } }
function _popOut(e) { if (_pop && !_pop.contains(e.target)) { closePop(); } }
/* umístí vyskakovací panel k prvku nebo bodu {x,y} */
function showPop(anchor, content, opts = {}) {
  closePop();
  const p = el('div', { class: 'pop ' + (opts.cls || '') }, content);
  document.body.append(p);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
  const pw = p.offsetWidth, ph = p.offsetHeight, W = innerWidth, H = innerHeight;
  let x = opts.align === 'right' ? r.right - pw : opts.align === 'center' ? r.left + r.width / 2 - pw / 2 : r.left;
  let y = opts.above && r.top - ph - 8 >= 8 ? r.top - ph - 8 : r.bottom + 8;
  if (y + ph > H - 8) y = Math.max(8, r.top - ph - 8);
  p.style.left = clamp(x, 8, Math.max(8, W - pw - 8)) + 'px';
  p.style.top = y + 'px';
  _pop = p;
  setTimeout(() => document.addEventListener('pointerdown', _popOut, true), 0);
  return p;
}
/* items: [{icon,label,danger,action,disabled}] nebo '-' */
function showMenu(anchor, items, opts) {
  const list = el('div', { class: 'menu' }, items.filter(Boolean).map(it => it === '-' ? el('div', { class: 'sep' }) :
    el('button', { class: 'mi' + (it.danger ? ' danger' : ''), disabled: it.disabled, onclick: () => { closePop(); it.action(); } },
      el('span', { class: 'mi-ic', html: it.icon ? icon(it.icon, 20) : '' }), el('span', { text: it.label }), it.right ? el('span', { class: 'mi-r', html: it.right }) : null)));
  return showPop(anchor, list, opts);
}
function colorGrid(current, onPick, colors = PALETTE20) {
  const inp = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#000000', class: 'cinput' });
  inp.addEventListener('change', () => onPick(inp.value));
  return el('div', { class: 'cgrid' },
    colors.map(c => el('button', { class: 'sw' + (c.toLowerCase() === (current || '').toLowerCase() ? ' on' : ''), style: { background: c }, onclick: () => onPick(c) })),
    el('label', { class: 'sw rainbow', title: 'Vlastní barva' }, inp));
}

function modal(title, body, buttons, opts = {}) {
  return new Promise(res => {
    const close = v => { bg.remove(); res(v); };
    const bg = el('div', { class: 'modal-bg', onpointerdown: e => { if (e.target === bg && !opts.sticky) close(null); } },
      el('div', { class: 'modal ' + (opts.cls || '') },
        title ? el('h3', { text: title }) : null,
        el('div', { class: 'modal-body' }, body),
        el('div', { class: 'modal-btns' }, buttons.map(b => el('button', {
          class: 'btn ' + (b.cls || ''), text: b.label,
          onclick: () => { const v = b.value === undefined ? null : (typeof b.value === 'function' ? b.value() : b.value); if (v !== false) close(v); }
        })))));
    bg._close = close;
    document.body.append(bg);
    if (opts.onOpen) opts.onOpen(bg, close);
  });
}
function dlgPrompt(title, value = '', okLabel = 'Uložit') {
  const inp = el('input', { type: 'text', class: 'inp', value, autocomplete: 'off' });
  return modal(title, inp, [{ label: 'Zrušit', value: null }, { label: okLabel, cls: 'primary', value: () => inp.value.trim() || false }], {
    onOpen: (bg, close) => { setTimeout(() => { inp.focus(); inp.select(); }, 50); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) close(inp.value.trim()); }); }
  });
}
function dlgConfirm(title, text, okLabel = 'Smazat', danger = true) {
  return modal(title, el('p', { text }), [{ label: 'Zrušit', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }]).then(v => v === true);
}

/* ---------- soubory ---------- */
function pickFiles(accept, multiple, capture) {
  return new Promise(res => {
    const inp = el('input', { type: 'file', accept, multiple, capture, style: { display: 'none' } });
    document.body.append(inp);
    let done = false;
    const fin = () => { if (done) return; done = true; const f = Array.from(inp.files || []); inp.remove(); res(f); };
    inp.addEventListener('change', fin);
    inp.addEventListener('cancel', fin);
    inp.click();
  });
}
function saveBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function shareFile(blob, name, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return true; }
  }
  saveBlob(blob, name);
  return false;
}
const safeName = s => (s || 'sesit').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'sesit';
