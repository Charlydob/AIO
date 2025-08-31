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
