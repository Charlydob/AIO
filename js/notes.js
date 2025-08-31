// notes.js — CRUD simple de notas con RTDB + espejo en localStorage
// RTDB: notes/${UID}/list/${nid}
const LS_KEY_NOTES = ()=>`notes_${UID}`;

const Notes = {
  async add(){
    const inp = document.getElementById('newNoteText');
    if(!inp) return;
    const text = (inp.value||'').trim();
    if(!text) return;
    const id = Math.random().toString(36).slice(2);
    const note = { id, text, createdAt: Date.now(), updatedAt: Date.now() };

    let rtdbOK = true;
    try { await db.ref(`notes/${UID}/list/${id}`).set(note); }
    catch(e){ rtdbOK=false; console.warn('RTDB notes set:', e); }

    const store = lsGet(LS_KEY_NOTES(), {list:{}}); store.list[id]=note; lsSet(LS_KEY_NOTES(), store);
    inp.value=''; Notes.render();

    if(!rtdbOK) alert("⚠️ Guardado offline (RTDB falló).");
  },
  async del(id){
    if(!confirm('¿Borrar nota?')) return;
    let rtdbOK = true;
    try { await db.ref(`notes/${UID}/list/${id}`).remove(); }
    catch(e){ rtdbOK=false; console.warn('RTDB notes del:', e); }

    const store = lsGet(LS_KEY_NOTES(), {list:{}}); delete store.list[id]; lsSet(LS_KEY_NOTES(), store);
    Notes.render();
    if(!rtdbOK) alert("⚠️ Borrado offline (RTDB falló).");
  },
  async edit(id){
    const store = lsGet(LS_KEY_NOTES(), {list:{}}); const cur = store.list[id];
    const text = prompt('Editar nota:', cur?.text||''); if(text==null) return;
    const note = {...cur, text: text.trim(), updatedAt: Date.now()};

    let rtdbOK = true;
    try { await db.ref(`notes/${UID}/list/${id}`).update({ text: note.text, updatedAt: note.updatedAt }); }
    catch(e){ rtdbOK=false; console.warn('RTDB notes upd:', e); }

    store.list[id]=note; lsSet(LS_KEY_NOTES(), store);
    Notes.render();
    if(!rtdbOK) alert("⚠️ Edición offline (RTDB falló).");
  },
  async render(){
    const wrap = document.getElementById('notes-list'); if(!wrap) return;
    wrap.innerHTML='';

    let list=null;
    try{
      const s = await db.ref(`notes/${UID}/list`).orderByChild('updatedAt').once('value');
      if(s.exists()){
        list = Object.values(s.val()).sort((a,b)=>b.updatedAt-a.updatedAt);
        const store = lsGet(LS_KEY_NOTES(), {list:{}}); store.list = s.val(); lsSet(LS_KEY_NOTES(), store);
      }
    }catch(e){ console.warn('RTDB notes read:', e); }

    if(!list){
      const store = lsGet(LS_KEY_NOTES(), {list:{}}); list = Object.values(store.list);
      list.sort((a,b)=>b.updatedAt-a.updatedAt);
    }

    if(list.length===0){
      const empty=document.createElement('div'); empty.className='card';
      empty.innerHTML='<div class="muted">Sin notas. Escribe arriba y pulsa “Añadir”.</div>';
      wrap.appendChild(empty); return;
    }

    list.forEach(n=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div class="row wrap">
          <div class="grow minw0">${escapeHTML(n.text).replace(/\n/g,'<br>')}</div>
          <button class="pill" onclick="Notes.edit('${n.id}')">Editar</button>
          <button class="pill danger" onclick="Notes.del('${n.id}')">Borrar</button>
        </div>
        <div class="muted" style="margin-top:6px">Actualizada: ${new Date(n.updatedAt).toLocaleString()}</div>
      `;
      wrap.appendChild(card);
    });
  }
};

function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('addNoteBtn')?.addEventListener('click', Notes.add);
  Notes.render();
});
window.Notes = Notes;
