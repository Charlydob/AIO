let CURRENT=null, TICK=null, RUN_START=null, CHART=null;
const LS_KEY = ()=>`timers_${UID}`;

const UI = {
  showCreateTimer(){ swapView('timer-create-view'); },
  backToList(){ CURRENT = null; swapView('timers-list-view'); renderList(); },
  async createTimer(){
    const name = document.getElementById('newTimerName').value.trim();
    const color = document.getElementById('newTimerColor').value;
    if(!name) return;
    const tid = id();
    const data = { id:tid, name, color, createdAt: Date.now(), totalSec:0 };

    // RTDB
    let rtdbOK = true;
    try{ await db.ref(`timers/${UID}/items/${tid}`).set(data); }
    catch(e){ rtdbOK=false; console.error("RTDB set timers:", e); }

    // Fallback LS (siempre guardo espejo)
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    store.items[tid] = data; lsSet(LS_KEY(), store);

    document.getElementById('newTimerName').value='';
    swapView('timers-list-view'); renderList();

    if(!rtdbOK) alert("⚠️ Guardado offline (RTDB falló). Se sincronizará cuando funcione.");
  },
  openTimer(t){ CURRENT = t; populateDetail(t); swapView('timer-detail-view'); },
  async deleteCurrent(){
    if(!CURRENT) return;
    if(!confirm('¿Borrar temporizador?')) return;

    let rtdbOK=true;
    try{
      await db.ref(`timers/${UID}/items/${CURRENT.id}`).remove();
      await db.ref(`timers/${UID}/days/${CURRENT.id}`).remove();
    }catch(e){ rtdbOK=false; console.error("RTDB del:", e); }

    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    delete store.items[CURRENT.id];
    delete store.days?.[CURRENT.id];
    lsSet(LS_KEY(), store);

    this.backToList();
    if(!rtdbOK) alert("⚠️ Borrado offline (RTDB falló).");
  }
};

function swapView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function percentFromCreation(t){
  const elapsedSec = Math.max(1, ((Date.now()) - (t.createdAt||Date.now()))/1000);
  const pct = Math.max(0, Math.min(100, Math.round(((t.totalSec||0)/elapsedSec)*100)));
  return pct;
}

async function renderList(){
  const wrap = document.getElementById('timers-list');
  wrap.innerHTML = '';

  let items = null;
  try{
    const snap = await db.ref(`timers/${UID}/items`).orderByChild('createdAt').once('value');
    if(snap.exists()){
      items = {}; snap.forEach(s=>{ items[s.key]=s.val(); });
      // espejo LS
      const store = lsGet(LS_KEY(), {items:{}, days:{}});
      store.items = items; lsSet(LS_KEY(), store);
    }
  }catch(e){ console.warn("RTDB read timers:", e); }

  if(!items){
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    items = store.items;
  }

  const list = Object.values(items||{}).sort((a,b)=>b.createdAt-a.createdAt);
  if(list.length===0){
    const empty = document.createElement('div');
    empty.className='card';
    empty.innerHTML = `<div class="row"><div class="grow"></div><div class="muted">Sin temporizadores. Crea uno con “＋ Nuevo”.</div><div class="grow"></div></div>`;
    wrap.appendChild(empty); return;
  }

  list.forEach(t=>{
    const pct = percentFromCreation(t);
    const card = document.createElement('div');
    card.className='card';
    card.style.borderColor = t.color;
    card.innerHTML = `
      <div class="row">
        <div class="progress-ring" style="--p:${pct}; --ring:${t.color}"><span>${pct}%</span></div>
        <div class="grow minw0">
          <div class="row" style="gap:8px">
            <div class="chip" style="background:${t.color}22;border-color:${t.color}44">${t.name}</div>
            <div class="chip">Total: ${secsPretty(t.totalSec||0)}</div>
          </div>
          <div class="muted" style="margin-top:6px">Creado: ${new Date(t.createdAt).toLocaleString()}</div>
        </div>
        <button class="pill" style="background:${t.color}" data-id="${t.id}">Abrir</button>
      </div>`;
    card.querySelector('button').onclick = ()=>UI.openTimer(t);
    wrap.appendChild(card);
  });
}

function populateDetail(t){
  document.getElementById('dTitle').textContent = t.name;
  document.getElementById('dCreated').textContent = new Date(t.createdAt).toLocaleString();
  document.getElementById('dHero').style.setProperty('--accent', t.color);
  document.getElementById('totalPretty').textContent = secsPretty(t.totalSec||0);
  document.getElementById('startBtn').disabled=false;
  document.getElementById('stopBtn').disabled=true;
  document.getElementById('liveCounter').textContent='00:00:00';
  const pct = percentFromCreation(t);
  document.getElementById('dRing').style.setProperty('--p', pct);
  document.getElementById('dRing').style.setProperty('--ring', t.color);
  document.getElementById('dPct').textContent = pct + '%';
  drawDaily(t.id, t.color);
  renderDailyList(t.id);
}

const Timers = {
  start(){
    if(!CURRENT || TICK) return;
    RUN_START = Date.now();
    document.getElementById('startBtn').disabled=true;
    document.getElementById('stopBtn').disabled=false;
    TICK = setInterval(()=>{
      const sec = ((Date.now()-RUN_START)/1000)|0;
      document.getElementById('liveCounter').textContent = prettyDuration(sec);
    }, 200);
  },
  async stop(){
    if(!CURRENT || !TICK) return;
    clearInterval(TICK); TICK=null;
    document.getElementById('startBtn').disabled=false;
    document.getElementById('stopBtn').disabled=true;

    const elapsed = ((Date.now()-RUN_START)/1000)|0;
    RUN_START=null;

    const refItem = db.ref(`timers/${UID}/items/${CURRENT.id}`);
    const today = ymd();
    const refDay = db.ref(`timers/${UID}/days/${CURRENT.id}/${today}`);

    let rtdbOK = true;
    try{
      await refItem.transaction(it=>{ if(!it) return it; it.totalSec = (it.totalSec||0) + elapsed; return it; });
      await refDay.transaction(sec => (sec||0)+elapsed);
    }catch(e){ rtdbOK=false; console.error("RTDB tx:", e); }

    // Mirror LS
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    store.items[CURRENT.id].totalSec = (store.items[CURRENT.id].totalSec||0) + elapsed;
    store.days[CURRENT.id] = store.days[CURRENT.id] || {};
    store.days[CURRENT.id][today] = (store.days[CURRENT.id][today]||0) + elapsed;
    lsSet(LS_KEY(), store);

    const fresh = store.items[CURRENT.id];
    CURRENT = fresh;
    document.getElementById('totalPretty').textContent = secsPretty(CURRENT.totalSec||0);
    const pct = percentFromCreation(CURRENT);
    document.getElementById('dRing').style.setProperty('--p', pct);
    document.getElementById('dPct').textContent = pct + '%';
    drawDaily(CURRENT.id, CURRENT.color);
    renderDailyList(CURRENT.id);

    if(!rtdbOK) alert("⚠️ Guardado offline (RTDB falló).");
  }
};

async function renderDailyList(timerId){
  const wrap = document.getElementById('dailyList');
  wrap.innerHTML='';
  let obj = null;
  try{
    const snap = await db.ref(`timers/${UID}/days/${timerId}`).once('value');
    if(snap.exists()) obj = snap.val();
  }catch(e){ console.warn("RTDB days:", e); }
  if(!obj){
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    obj = (store.days||{})[timerId] || {};
  }
  const arr = Object.entries(obj).map(([date,sec])=>({date,sec}))
               .sort((a,b)=>b.date.localeCompare(a.date));
  arr.forEach(d=>{
    const card=document.createElement('div');
    card.className='card';
    card.innerHTML=`<div class="row">
      <div class="chip">${d.date}</div><div class="grow"></div>
      <div class="chip">${secsPretty(d.sec)}</div>
    </div>`;
    wrap.appendChild(card);
  });
}

function drawDaily(timerId, color){
  const ctx = document.getElementById('dailyChart').getContext('2d');
  (async ()=>{
    let map=null;
    try{
      const s=await db.ref(`timers/${UID}/days/${timerId}`).once('value');
      if(s.exists()) map = s.val();
    }catch(e){ console.warn("chart RTDB:", e); }
    if(!map){
      const store = lsGet(LS_KEY(), {items:{}, days:{}});
      map = (store.days||{})[timerId] || {};
    }
    const labels=[], data=[];
    for(let i=29;i>=0;i--){
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = ymd(d);
      labels.push(k.slice(5));
      data.push((map[k]||0)/3600);
    }
    if(CHART) CHART.destroy();
    CHART = new Chart(ctx,{ type:'bar', data:{ labels, datasets:[{ label:'Horas/día', data }]}, options:{responsive:true,scales:{y:{beginAtZero:true}}} });
  })();
}

document.addEventListener('DOMContentLoaded', renderList);
window.UI = UI; window.Timers = Timers;
