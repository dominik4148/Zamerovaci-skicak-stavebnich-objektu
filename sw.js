// Zaměřovací skicák – offline cache. Change VERSION when files change.
const VERSION='skicak-v7';
const SHELL=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'){
    // app page: answer from cache at once (works offline), refresh the cache in the background
    e.respondWith(caches.open(VERSION).then(async c=>{
      const cached=await c.match('index.html');
      const net=fetch(req).then(r=>{if(r&&r.ok)c.put('index.html',r.clone());return r}).catch(()=>null);
      return cached||(await net)||new Response('Offline',{status:503});
    }));return;
  }
  if(url.origin===location.origin||url.host.endsWith('fonts.googleapis.com')||url.host.endsWith('fonts.gstatic.com')){
    e.respondWith(caches.open(VERSION).then(async c=>{
      const cached=await c.match(req);
      const net=fetch(req).then(r=>{if(r&&(r.ok||r.type==='opaque'))c.put(req,r.clone());return r}).catch(()=>null);
      return cached||(await net)||new Response('',{status:504});
    }));
  }
});
