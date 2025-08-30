const UI = {
  showCreateTimer(){ swapView('timer-create-view'); },
  backToList(){ CURRENT = null; swapView('timers-list-view'); renderList(); },
  createTimer(){
    const name = document.getElementById('newTimerName').value.trim();
    const color = document.getElementById('newTimerColor').value;
    if(!name) return;
    const tid = id();
    const data = { id:tid, name, color, createdAt: Date.now(), totalSec:0 };
    db.ref(`timers/${UID}/items/${tid}`).set(data).then(()=>{
      document.getElementById('newTimerName').value='';
      swapView('timers-list-view'); renderList();
    });
  },
  openTimer(t){ CURRENT = t; populateDetail(t); swapView('timer-detail-view'); },
  deleteCurrent(){
    if(!CURRENT) return;
    if(!confirm('¿Borrar temporizador?')) return;
    db.ref(`timers/${UID}/items/${CURRENT.id}`).remove().then(()=>this.backToList());
  }
};

let CURRENT=null, TICK=null, RUN_START=null, CHART=null;

function swapView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function renderList(){
  const wrap = document.getElementById('timers-list');
  wrap.innerHTML = '';
  db.ref(`timers/${UID}/items`).orderByChild('createdAt').once('value', snap=>{
    const list = [];
    snap.forEach(s=>list.push(s.val()));
    list.reverse().forEach(t=>{
      const card = document.createElement('div');
      card.className='card';
      card.style.borderColor = t.color;
      card.innerHTML = `
        <div class="row">
          <div class="chip" style="background:${t.color}22;border-color:${t.color}44">${t.name}</div>
          <div class="grow"></div>
          <div class="chip">Total: ${secsPretty(t.totalSec||0)}</div>
        </div>
        <div class="muted">Creado: ${new Date(t.createdAt).toLocaleString()}</div>
        <div class="row" style="margin-top:8px">
          <button class="pill" style="background:${t.color}" data-id="${t.id}">Abrir</button>
        </div>`;
      card.querySelector('button').onclick = ()=>UI.openTimer(t);
      wrap.appendChild(card);
    });
  });
}
function secsPretty(s){ const h=(s/3600)|0; return `${h}h ${((s%3600)/60)|0}m`; }

function populateDetail(t){
  document.getElementById('dTitle').textContent = t.name;
  document.getElementById('dCreated').textContent = new Date(t.createdAt).toLocaleString();
  document.getElementById('dHero').style.setProperty('--accent', t.color);
  document.getElementById('totalPretty').textContent = secsPretty(t.totalSec||0);
  document.getElementById('startBtn').disabled=false;
  document.getElementById('stopBtn').disabled=true;
  document.getElementById('liveCounter').textContent='00:00:00';
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
  stop(){
    if(!CURRENT || !TICK) return;
    clearInterval(TICK); TICK=null;
    document.getElementById('startBtn').disabled=false;
    document.getElementById('stopBtn').disabled=true;

    const elapsed = ((Date.now()-RUN_START)/1000)|0;
    RUN_START=null;

    // Acumular al total y al día
    const refItem = db.ref(`timers/${UID}/items/${CURRENT.id}`);
    const today = ymd();
    const refDay = db.ref(`timers/${UID}/days/${CURRENT.id}/${today}`);
    // read-modify-write
    refItem.transaction(it=>{
      if(!it) return it;
      it.totalSec = (it.totalSec||0) + elapsed;
      return it;
    });
    refDay.transaction(sec => (sec||0)+elapsed, (err, committed, snap)=>{
      if(!err && committed){
        // refrescar
        db.ref(`timers/${UID}/items/${CURRENT.id}`).once('value', s=>{
          CURRENT = s.val();
          document.getElementById('totalPretty').textContent = secsPretty(CURRENT.totalSec||0);
          drawDaily(CURRENT.id, CURRENT.color);
          renderDailyList(CURRENT.id);
        });
      }
    });
  }
};

function renderDailyList(timerId){
  const wrap = document.getElementById('dailyList');
  wrap.innerHTML='';
  db.ref(`timers/${UID}/days/${timerId}`).once('value', snap=>{
    const arr=[];
    snap.forEach(s=>arr.push({date:s.key, sec:s.val()}));
    arr.sort((a,b)=>a.date.localeCompare(b.date)).reverse();
    arr.forEach(d=>{
      const card=document.createElement('div');
      card.className='card';
      card.innerHTML=`<div class="row">
        <div class="chip">${d.date}</div><div class="grow"></div>
        <div class="chip">${secsPretty(d.sec)}</div>
      </div>`;
      wrap.appendChild(card);
    });
  });
}

function drawDaily(timerId, color){
  const ctx = document.getElementById('dailyChart').getContext('2d');
  db.ref(`timers/${UID}/days/${timerId}`).once('value', snap=>{
    const map={}; snap.forEach(s=>map[s.key]=s.val());
    // últimos 30 días
    const labels=[], data=[];
    for(let i=29;i>=0;i--){
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = ymd(d);
      labels.push(k.slice(5)); // MM-DD
      data.push((map[k]||0)/3600);
    }
    if(CHART){ CHART.destroy(); }
    CHART = new Chart(ctx,{
      type:'bar',
      data:{ labels, datasets:[{ label:'Horas/día', data, backgroundColor: color+'aa' }]},
      options:{ responsive:true, scales:{ y:{ beginAtZero:true } } }
    });
  });
}

document.addEventListener('DOMContentLoaded', renderList);
window.UI = UI; window.Timers = Timers;
