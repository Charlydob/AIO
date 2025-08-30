let CURRENT_NOTE_ID = null;
const LS_KEY_NOTES = ()=>`notes_${UID}`;

const Notes = {
  showCreate(){
    CURRENT_NOTE_ID = null;
    document.getElementById('noteEditorTitle').textContent='Nueva nota';
    document.getElementById('nTitle').value='';
    document.getElementById('nTags').value='';
    document.getElementById('nBody').value='';
    document.getElementById('nDelete').classList.add('hidden');
    openView();
  },
  open(id, note){
    CURRENT_NOTE_ID = id;
    document.getElementById('noteEditorTitle').textContent='Editar nota';
    document.getElementById('nTitle').value=note.title||'';
    document.getElementById('nTags').value=(note.tags||[]).join(', ');
    document.getElementById('nBody').value=note.body||'';
    document.getElementById('nDelete').classList.remove('hidden');
    openView();
  },
  closeEditor(){ closeView(); },
  async save(){
    const title=document.getElementById('nTitle').value.trim();
    const tags=document.getElementById('nTags').value.split(',').map(s=>s.trim()).filter(Boolean);
    const body=document.getElementById('nBody').value;
    if(!title && !body) { closeView(); return; }

    const base = `notes/${UID}/items`;
    const nid = CURRENT_NOTE_ID || id();
    const obj = {id:nid,title,tags,body,updatedAt:Date.now(),createdAt:Date.now()};

    let rtdbOK=true;
    try{
      if(CURRENT_NOTE_ID) await db.ref(`${base}/${nid}`).update(obj);
      else await db.ref(`${base}/${nid}`).set(obj);
    }catch(e){ rtdbOK=false; console.error("RTDB notes set:", e); }

    const store = lsGet(LS_KEY_NOTES(), {items:{}});
    store.items[nid]=obj; lsSet(LS_KEY_NOTES(), store);

    closeView(); renderNotes();
    if(!rtdbOK) alert("⚠️ Guardado offline (RTDB falló).");
  },
  async deleteNote(){
    if(!CURRENT_NOTE_ID) return;
    let rtdbOK=true;
    try{ await db.ref(`notes/${UID}/items/${CURRENT_NOTE_ID}`).remove(); }
    catch(e){ rtdbOK=false; console.error("RTDB notes del:", e); }
    const store = lsGet(LS_KEY_NOTES(), {items:{}});
    delete store.items[CURRENT_NOTE_ID]; lsSet(LS_KEY_NOTES(), store);
    closeView(); renderNotes();
    if(!rtdbOK) alert("⚠️ Borrado offline (RTDB falló).");
  }
};

function openView(){ document.getElementById('note-editor').classList.add('active'); }
function closeView(){ document.getElementById('note-editor').classList.remove('active'); }

async function renderNotes(){
  const wrap=document.getElementById('notes-list');
  wrap.innerHTML='';
  let list=null;
  try{
    const snap = await db.ref(`notes/${UID}/items`).orderByChild('updatedAt').once('value');
    if(snap.exists()){ list=[]; snap.forEach(s=>list.push(s.val())); list.sort((a,b)=>b.updatedAt-a.updatedAt); }
  }catch(e){ console.warn("RTDB notes read:", e); }
  if(!list){ const store=lsGet(LS_KEY_NOTES(), {items:{}}); list=Object.values(store.items).sort((a,b)=>b.updatedAt-a.updatedAt); }

  if(list.length===0){
    const empty=document.createElement('div'); empty.className='card';
    empty.innerHTML='<div class="muted">Sin notas. Pulsa ＋ para crear.</div>';
    wrap.appendChild(empty); return;
  }
  list.forEach(n=>{
    const card=document.createElement('div');
    card.className='card';
    const tags=(n.tags||[]).map(t=>`<span class="chip">${t}</span>`).join(' ');
    card.innerHTML=`
      <div class="row">
        <div class="card-title minw0" style="font-weight:700">${n.title||'(Sin título)'}</div>
        <div class="grow"></div>
        <small class="muted">${new Date(n.updatedAt).toLocaleDateString()}</small>
      </div>
      <p class="muted">${(n.body||'').slice(0,120)}${(n.body||'').length>120?'…':''}</p>
      <div class="row">${tags}</div>
      <div class="row" style="margin-top:8px">
        <button class="pill" onclick="Notes.open('${n.id}', ${JSON.stringify(n).replace(/"/g,'&quot;')})">Abrir</button>
      </div>`;
    wrap.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', renderNotes);
window.Notes = Notes;
