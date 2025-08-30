// Firebase compat global (NO ESM)
const firebaseConfig = {
  apiKey: "AIzaSyBOeRNv3cwxLYyB9TzqAxN4z-1KQbkdGA8",
  authDomain: "aio1-70674.firebaseapp.com",
  projectId: "aio1-70674",
  storageBucket: "aio1-70674.firebasestorage.app",
  messagingSenderId: "776356971931",
  appId: "1:776356971931:web:743b5909eddb8b34bfcd3e",
  databaseURL: "https://aio1-70674-default-rtdb.europe-west1.firebasedatabase.app"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// UID local (sin Auth)
let UID = localStorage.getItem("vida_client_id");
if(!UID){ UID = Math.random().toString(36).slice(2); localStorage.setItem("vida_client_id", UID); }
window.db = db; window.UID = UID;
