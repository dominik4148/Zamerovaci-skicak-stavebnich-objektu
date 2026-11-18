'use strict';
(async function main() {
  const fill = (id, name, size) => { const b = document.getElementById(id); if (b) b.innerHTML = icon(name, size || 24) + b.innerHTML; };
  fill('b-settings', 'gear', 26); fill('b-sort', 'sort', 20); fill('b-select', 'check', 20); fill('b-new', 'plus', 22);
  fill('b-back', 'back'); fill('b-undo', 'undo'); fill('b-redo', 'redo'); fill('b-export', 'share'); fill('b-nbset', 'sliders'); fill('b-pages', 'pages');
  fill('pg-menu', 'dots'); fill('pg-up', 'chevU', 20); fill('pg-dn', 'chevD', 20); fill('addpage', 'plus', 18);
  fill('crop-ok', 'check'); fill('crop-no', 'x'); fill('ins-gallery', 'image'); fill('ins-camera', 'camera'); fill('ins-pdf', 'pdf');
  document.querySelector('.search').insertAdjacentHTML('afterbegin', icon('search', 20));
  try {
    await DB.open();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:40px;color:#fff;font:16px system-ui">Úložiště prohlížeče není dostupné (' + e.message + '). Zkus vypnout anonymní režim.</p>';
    return;
  }
  await Home.load();
  Home.applyTheme();
  Home.init();
  await Editor.init();
  Home.render();
  document.body.classList.add('ready');
  DB.gc().catch(() => { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
})();
