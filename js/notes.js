let CURRENT_NOTE_ID = null;

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
  save(){
    const title=document.getElementById('nTitle').value.trim();
    const tags=document.getElementById('nTags').value.split(',').map(s=>s.trim()).filter(Boolean);
    const body=document.getElementById('nBody').value;
    if(!title && !body) { closeView(); return; }
    const ref = db.ref(`notes/${UID}/items`);
    if(CURRENT_NOTE_ID){
      ref.child(CURRENT_NOTE_ID).update({title,tags,body,updatedAt:Date.now()}).then(()=>{ closeView(); renderNotes(); });
    }else{
      const nid = id();
      ref.child(nid).set({id:nid,title,tags,body,createdAt:Date.now(),updatedAt:Date.now()}).then(()=>{ closeView(); renderNotes(); });
    }
  },
  deleteNote(){
    if(!CURRENT_NOTE_ID) return;
    if(!confirm('¿Borrar nota?')) return;
    db.ref(`notes/${UID}/items/${CURRENT_NOTE_ID}`).remove().then(()=>{ closeView(); renderNotes(); });
  }
};

function openView(){ document.getElementById('note-editor').classList.add('active'); }
function closeView(){ document.getElementById('note-editor').classList.remove('active'); }

function renderNotes(){
  const wrap=document.getElementById('notes-list');
  wrap.innerHTML='';
  db.ref(`notes/${UID}/items`).orderByChild('updatedAt').once('value', snap=>{
    const list=[]; snap.forEach(s=>list.push(s.val())); list.reverse();
    list.forEach(n=>{
      const card=document.createElement('div');
      card.className='card';
      const tags=(n.tags||[]).map(t=>`<span class="chip">${t}</span>`).join(' ');
      card.innerHTML=`
        <div class="row">
          <div class="card-title">${n.title||'(Sin título)'}</div>
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
  });
}

document.addEventListener('DOMContentLoaded', renderNotes);
window.Notes = Notes;
