const CACHE = 'app-v8';
const ASSETS = ['./','./index.html','./app.css','./utils.js','./timers.js','./finanzas.js','./notes.js','./firebase-init.js'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.registration.navigationPreload?.enable(); // más rápido en first-load
  })());
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CLEAR_CACHES') {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const cs = await self.clients.matchAll({ includeUncontrolled: true });
      cs.forEach(c => c.postMessage({ type: 'CACHES_CLEARED' }));
    })());
  }
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith((async () => {
      const pre = await e.preloadResponse;
      if (pre) { caches.open(CACHE).then(c => c.put(e.request, pre.clone())); return pre; }
      try {
        const r = await fetch(new Request(e.request, { cache: 'reload' }));
        caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      } catch {
        return caches.match(e.request, { ignoreSearch: true });
      }
    })());
  } else {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(c => c || fetch(e.request)));
  }
});
