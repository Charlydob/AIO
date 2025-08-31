// firebase-init.js  (RTDB SOLO, sin Auth)
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyBOeRNv3cwxLYyB9TzqAxN4z-1KQbkdGA8",
    authDomain: "aio1-70674.firebaseapp.com",
    projectId: "aio1-70674",
    storageBucket: "aio1-70674.firebasestorage.app",
    messagingSenderId: "776356971931",
    appId: "1:776356971931:web:743b5909eddb8b34bfcd3e",
    databaseURL: "https://aio1-70674-default-rtdb.europe-west1.firebasedatabase.app"
  };

  try{ firebase.initializeApp(firebaseConfig); }catch(e){}
  const db = firebase.database();

  // UID compartido SIN Auth (mismo en todos los dispositivos)
  let UID = (window.FIXED_UID)
         || new URLSearchParams(location.search).get('uid')
         || localStorage.getItem('vida_uid')
         || 'charly';
  localStorage.setItem('vida_uid', UID);
  window.db = db;
  window.UID = UID;

  // Healthcheck
  db.ref('.info/connected').on('value', s=>{
    console.log(s.val() ? '📶 Conectado a RTDB' : '🚫 Desconectado de RTDB');
  });
  const HC = `__health__/${UID}`;
  db.ref(HC).set({ts:Date.now()}).then(()=>db.ref(HC).remove())
    .then(()=>console.log('✅ RTDB write OK'))
    .catch(err=>console.error('❌ RTDB write/read fallo:', err));

  // Migración suave: copia legacy -> namespaced si destino vacío (NO borra)
  async function softCopy(src, dst){
    const [a,b] = await Promise.all([db.ref(src).get(), db.ref(dst).get()]);
    if(!a.exists() || b.exists()) return;
    await db.ref(dst).set(a.val());
    console.log('➡️ Copiado', src, '→', dst);
  }

  (async ()=>{
    // Timers
    await softCopy('/items',            `timers/${UID}/items`);
    await softCopy('/days',             `timers/${UID}/days`);
    await softCopy('/timers/items',     `timers/${UID}/items`);
    await softCopy('/timers/days',      `timers/${UID}/days`);
    // Notes
    await softCopy('/notes/list',       `notes/${UID}/list`);
    // Finanzas
    await softCopy('/finance/entries',  `finance/${UID}/entries`);
  })();
})();

(() => {
  if (!('serviceWorker' in navigator)) return;
  const v = 'v2025-08-31-1'; // cambia en cada deploy
  navigator.serviceWorker.register('./sw.js?' + v).then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  });
})();

// Forzar actualización: actualiza SW, limpia cachés y recarga con cache-busting
async function forceUpdate() {
  try {
    // 1) Intentar activar el SW nuevo (si lo hay)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update(); // busca versión nueva de sw.js
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          await new Promise(res => {
            navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true });
          });
        }
      }
    }

    // 2) Borrar TODAS las cachés (las de tu app)
    if (window.caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 3) Recarga con "cache-buster" para forzar HTML/CSS/JS frescos
    const u = new URL(location.href);
    u.searchParams.set('hard', Date.now());
    location.replace(u.toString());
  } catch (e) {
    // fallback por si algo falla
    location.reload();
  }
}
