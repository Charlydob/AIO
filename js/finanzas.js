let ENTRIES = {};
let EDIT_ID = null;
let charts = { net:null, incExp:null, cat:null };

const Fin = {
  switchTab(name){
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
    document.querySelectorAll('section.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('tab-'+name).classList.add('active');
    if(name==='overview') drawNetWorth();
    if(name==='analytics') drawAnalytics();
  },
  showAdd(){
    EDIT_ID = null;
    document.getElementById('edTitle').textContent='Nuevo movimiento';
    ['eType','eCat','eDate','eAmount','eNote'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('eDelete').classList.add('hidden');
    openEditor();
  },
  openEdit(id, obj){
    EDIT_ID = id;
    document.getElementById('edTitle').textContent='Editar movimiento';
    document.getElementById('eType').value=obj.type;
    document.getElementById('eCat').value=obj.category||'Otros';
    document.getElementById('eDate').value=obj.date;
    document.getElementById('eAmount').value=obj.amount;
    document.getElementById('eNote').value=obj.note||'';
    document.getElementById('eDelete').classList.remove('hidden');
    openEditor();
  },
  closeEditor(){ closeEditor(); },
  async saveEntry(){
    try{
      const entry = {
        type: document.getElementById('eType').value||'gasto',
        category: document.getElementById('eCat').value||'Otros',
        date: document.getElementById('eDate').value || new Date().toISOString().slice(0,10),
        amount: parseFloat(document.getElementById('eAmount').value||'0'),
        note: document.getElementById('eNote').value||'',
        ts: Date.now()
      };
      const base = `finance/${UID}/entries`;
      if(EDIT_ID){
        await db.ref(`${base}/${EDIT_ID}`).update(entry);
      }else{
        const eid=id();
        await db.ref(`${base}/${eid}`).set({...entry,id:eid});
      }
      closeEditor(); loadEntries();
    }catch(e){ console.error("save entry", e); alert("No se pudo guardar el movimiento."); }
  },
  async deleteEntry(){
    try{
      if(!EDIT_ID) return;
      if(!confirm('¿Borrar movimiento?')) return;
      await db.ref(`finance/${UID}/entries/${EDIT_ID}`).remove();
      closeEditor(); loadEntries();
    }catch(e){ console.error("delete entry", e); alert("No se pudo borrar."); }
  },
  renderEntries(){
    const type = document.getElementById('fType').value;
    const cat = document.getElementById('fCat').value;
    const wrap = document.getElementById('entriesList');
    wrap.innerHTML='';
    const list = Object.values(ENTRIES).sort((a,b)=>b.date.localeCompare(a.date))
      .filter(e=>(!type||e.type===type)&&(!cat||e.category===cat));
    if(list.length===0){
      const empty=document.createElement('div'); empty.className='card';
      empty.innerHTML='<div class="muted">Sin movimientos. Pulsa ＋ para añadir.</div>';
      wrap.appendChild(empty); return;
    }
    list.forEach(e=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div class="row">
          <div class="chip">${e.date}</div>
          <div class="chip">${e.type}</div>
          <div class="chip">${e.category}</div>
          <div class="grow"></div>
          <div class="chip" style="background:${e.type==='gasto'?'#e2555522':'#3a86ff22'};border-color:${e.type==='gasto'?'#e2555544':'#3a86ff44'}">
            ${euro(e.amount)}
          </div>
        </div>
        <p class="muted">${e.note||''}</p>
        <div class="row"><button class="pill" onclick='Fin.openEdit("${e.id}", ${JSON.stringify(e).replace(/"/g,'&quot;')})'>Editar</button></div>
      `;
      wrap.appendChild(card);
    });
  }
};

function openEditor(){ document.getElementById('entry-editor').classList.add('active'); }
function closeEditor(){ document.getElementById('entry-editor').classList.remove('active'); }

async function loadEntries(){
  try{
    const snap = await db.ref(`finance/${UID}/entries`).once('value');
    ENTRIES = snap.exists()? snap.val(): {};
    Fin.renderEntries();
    updateStats();
    drawNetWorth();
    drawAnalytics();
  }catch(e){ console.error("load entries", e); alert("No se pudieron cargar los datos."); }
}

function updateStats(){
  const now = new Date(); const from = new Date(); from.setDate(now.getDate()-30);
  let inc=0, exp=0, inv=0, salary=0;
  Object.values(ENTRIES).forEach(e=>{
    const d=new Date(e.date); if(d<from) return;
    if(e.type==='ingreso') inc+=e.amount;
    if(e.type==='gasto') exp+=e.amount;
    if(e.type==='inversion') inv+=e.amount;
    if(e.type==='salario') salary+=e.amount;
  });
  const net = sumNetWorth();
  document.getElementById('stNet').textContent = euro(net);
  document.getElementById('stInc').textContent = euro(inc+salary);
  document.getElementById('stExp').textContent = euro(exp);
  const pct = salary>0 ? Math.round((inv/salary)*100) : 0;
  document.getElementById('stInvPct').textContent = pct+" %";
}

function sumNetWorth(){
  let s=0;
  Object.values(ENTRIES).forEach(e=>{
    if(e.type==='ingreso'||e.type==='salario'||e.type==='inversion') s+=e.amount;
    if(e.type==='gasto') s-=e.amount;
  });
  return s;
}

function drawNetWorth(){
  const ctx = document.getElementById('netWorthChart').getContext('2d');
  const days=90, labels=[], data=[]; let acc=0;
  const map={};
  Object.values(ENTRIES).forEach(e=>{
    map[e.date] = (map[e.date]||0) + (e.type==='gasto' ? -e.amount : e.amount);
  });
  for(let i=days-1;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const k = d.toISOString().slice(0,10);
    acc += (map[k]||0);
    labels.push(k.slice(5));
    data.push(acc);
  }
  if(charts.net) charts.net.destroy();
  charts.net = new Chart(ctx,{ type:'line', data:{labels, datasets:[{label:'Patrimonio (€)', data}]} });
}

function drawAnalytics(){
  const ctx1 = document.getElementById('incExpChart').getContext('2d');
  const ctx2 = document.getElementById('catPieChart').getContext('2d');
  const from = new Date(); from.setDate(from.getDate()-30);
  let inc=0, exp=0; const catMap={};
  Object.values(ENTRIES).forEach(e=>{
    const d=new Date(e.date); if(d<from) return;
    if(e.type==='ingreso'||e.type==='salario'||e.type==='inversion') inc+=e.amount;
    if(e.type==='gasto'){ exp+=e.amount; catMap[e.category]= (catMap[e.category]||0)+e.amount; }
  });
  if(charts.incExp) charts.incExp.destroy();
  charts.incExp = new Chart(ctx1,{ type:'bar', data:{ labels:['Ingresos','Gastos'], datasets:[{data:[inc,exp]}] }, options:{scales:{y:{beginAtZero:true}}} });
  if(charts.cat) charts.cat.destroy();
  charts.cat = new Chart(ctx2,{ type:'pie', data:{ labels:Object.keys(catMap), datasets:[{data:Object.values(catMap)}] } });
}

document.addEventListener('DOMContentLoaded', loadEntries);
window.Fin = Fin;
