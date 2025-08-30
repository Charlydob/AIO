const CACHE = 'vida-v3'; // ← bump
const ASSETS = [
  'index.html','timers.html','notas.html','finanzas.html',
  'css/opal.css','js/firebase-init.js','js/utils.js','js/timers.js','js/notes.js','js/finanzas.js',
  'manifest.webmanifest'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
