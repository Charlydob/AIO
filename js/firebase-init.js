// Firebase compat global (NO ESM)
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyBOeRNv3cwxLYyB9TzqAxN4z-1KQbkdGA8",
    authDomain: "aio1-70674.firebaseapp.com",
    projectId: "aio1-70674",
    storageBucket: "aio1-70674.firebasestorage.app",
    messagingSenderId: "776356971931",
    appId: "1:776356971931:web:743b5909eddb8b34bfcd3e",
    // ⚠️ Comprueba en Firebase > Realtime Database > URL exacta:
    databaseURL: "https://aio1-70674-default-rtdb.europe-west1.firebasedatabase.app"
  };

  try{
    firebase.initializeApp(firebaseConfig);
  }catch(e){
    console.error("🔥 init error", e);
  }
  const db = firebase.database();

  // UID local (sin Auth)
  let UID = localStorage.getItem("vida_client_id");
  if(!UID){ UID = Math.random().toString(36).slice(2); localStorage.setItem("vida_client_id", UID); }

  // Health-check de conexión y permisos
  const HC_PATH = `__health__/${UID}`;
  db.ref(HC_PATH).set({ts:Date.now()})
    .then(()=>db.ref(HC_PATH).remove())
    .then(()=>console.log("✅ RTDB OK"))
    .catch(err=>{
      console.error("❌ RTDB write/read fallo:", err);
      alert("Firebase RTDB bloqueada o URL errónea. Revisa databaseURL y reglas.");
    });

  // Exponer global
  window.db = db; window.UID = UID;
})();
