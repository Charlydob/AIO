const CACHE = 'app-v7';
const ASSETS = [
  './','./index.html',
  './firebase-init.js','./utils.js','./timers.js','./finanzas.js','./notes.js',
  './app.css'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { await c.addAll(ASSETS); } catch(_) {} // no rompas si algo falla
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CLEAR_CACHES') {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const clients = await self.clients.matchAll({includeUncontrolled:true});
      clients.forEach(c => c.postMessage({type:'CACHES_CLEARED'}));
    })());
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    // HTML: network-first + cache:'reload' para saltar caché HTTP
    e.respondWith(
      fetch(new Request(e.request, {cache:'reload'})).then(r => {
        caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => caches.match(e.request, {ignoreSearch:true}))
    );
  } else {
    // Estáticos: cache-first
    e.respondWith(
      caches.match(e.request, {ignoreSearch:true}).then(cached => cached || fetch(e.request))
    );
  }
});
