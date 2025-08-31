// timers.js — versión completa corregida (play/pause en tarjeta, +tiempo HH:MM:SS, dashboard diario)

let CURRENT = null, TICK = null, RUN_START = null, CHART = null;
let PIE = null, DASH_OFFSET = 0; // 0 = hoy, -1 = ayer...
const LS_KEY = () => `timers_${UID}`;
let ACTIVITY_MODE = 'bar';

function setActivityMode(mode){
  const toGrid = (mode === 'grid');
  ACTIVITY_MODE = toGrid ? 'grid' : 'bar';

  // Tabs activos
  document.getElementById('tabBar') ?.classList.toggle('active', !toGrid);
  document.getElementById('tabGrid')?.classList.toggle('active',  toGrid);

  // Mostrar uno y ocultar el otro
  const cBar  = document.getElementById('dailyChart');
  const cGrid = document.getElementById('dailyHeat');
  cBar ?.classList.toggle('hidden', toGrid);
  cGrid?.classList.toggle('hidden', !toGrid);

  // liberamos el chart de barras si ocultamos
  if (toGrid && CHART){ CHART.destroy(); CHART = null; }

  // Redibujar solo si hay timer abierto
  if (CURRENT) drawActivity(CURRENT.id, CURRENT.color);
}

// ===================== UI =====================
const UI = {
  showCreateTimer(){ swapView('timer-create-view'); },
  backToList(){ CURRENT = null; swapView('timers-list-view'); renderList(); drawDashboard(); },

  async createTimer(){
    const name = document.getElementById('newTimerName').value.trim();
    const color = document.getElementById('newTimerColor').value;
    if(!name) return;
    const tid = id();

    // Estado persistente para sesiones
    const data = { id: tid, name, color, createdAt: Date.now(), totalSec: 0, running: false, runStart: null };

    // RTDB
    let rtdbOK = true;
    try { await db.ref(`timers/${UID}/items/${tid}`).set(data); }
    catch(e){ rtdbOK=false; console.error("RTDB set timers:", e); }

    // Espejo LS
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    store.items[tid] = data; lsSet(LS_KEY(), store);

    document.getElementById('newTimerName').value = '';
    swapView('timers-list-view'); renderList(); drawDashboard();

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
window.UI = UI;

// Añadir tiempo manual HH:MM:SS (reutilizable desde tarjeta o detalle)
UI.promptAddTime = async function(id){
  const targetId = id || CURRENT?.id; if(!targetId) return;
  const hhmmss = prompt('Añadir tiempo (HH:MM:SS):', '00:30:00');
  if(hhmmss==null) return;
  const sec = parseHMS(hhmmss); if(sec<=0) return;
  await Timers._addSeconds(targetId, sec);
  await Timers._refreshItems();
  if(CURRENT && CURRENT.id===targetId){
    CURRENT = lsGet(LS_KEY(), {items:{}, days:{}}).items[targetId];
    populateDetail(CURRENT);
  }
  renderList(); drawDashboard();
};

// ===================== Helpers =====================
function swapView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function percentFromCreation(t){
  const elapsedSec = Math.max(1, ((Date.now()) - (t.createdAt||Date.now()))/1000);
  const pct = Math.max(0, Math.min(100, Math.round(((t.totalSec||0)/elapsedSec)*100)));
  return pct;
}

function parseHMS(s){
  const m = String(s).trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/); if(!m) return 0;
  const h=+m[1], mi=+m[2], se=+m[3]; return h*3600+mi*60+se;
}

function todayKey(offset=0){ const d=new Date(); d.setDate(d.getDate()+offset); return ymd(d); }

// ===================== Render lista =====================
async function renderList(){
  const wrap = document.getElementById('timers-list');
  if(!wrap) return;
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
          <!-- Fila chips (en horizontal, con wrap si no caben) -->
          <div class="row wrap" style="gap:8px; margin-bottom:4px">
            <div class="chip" style="background:${t.color}22;border-color:${t.color}44">${t.name}</div>
            <div class="chip">Total: ${secsPretty((t.totalSec||0) + (t.running && t.runStart ? (((Date.now()-t.runStart)/1000)|0) : 0))}</div>
            ${t.running ? `<div class="chip" title="En curso">● Live</div>` : ``}
          </div>

          <div class="muted" style="margin-top:6px">Creado: ${new Date(t.createdAt).toLocaleString()}</div>
        </div>
        <div class="row" style="gap:6px; flex-direction:column; align-items:flex-end">
          <button class="pill ${t.running?'warning':''}" onclick="Timers.toggleFromCard('${t.id}')">${t.running?'Pausar':'Iniciar'}</button>
          <button class="pill ghost" onclick="UI.promptAddTime('${t.id}')">hh:mm:ss</button>
          <button class="pill" style="background:${t.color}" data-id="${t.id}">Abrir</button>
        </div>
      </div>`;

    // Enlaza el botón "Abrir" correcto
    card.querySelector('button[data-id]').onclick = ()=>UI.openTimer(t);

    wrap.appendChild(card);
  });
}

// ===================== Detalle =====================
function populateDetail(t){
  document.getElementById('dTitle').textContent = t.name;
  document.getElementById('dCreated').textContent = new Date(t.createdAt).toLocaleString();
  document.getElementById('dHero').style.setProperty('--accent', t.color);

  document.getElementById('totalPretty').textContent =
    secsPretty((t.totalSec||0) + (t.running && t.runStart ? (((Date.now()-t.runStart)/1000)|0) : 0));

  document.getElementById('startBtn').disabled = !!t.running;
  document.getElementById('stopBtn').disabled  = !t.running;
  document.getElementById('liveCounter').textContent =
    t.running && t.runStart ? prettyDuration(((Date.now()-t.runStart)/1000)|0) : '00:00:00';

  const pct = percentFromCreation(t);
  document.getElementById('dRing').style.setProperty('--p', pct);
  document.getElementById('dRing').style.setProperty('--ring', t.color);
  document.getElementById('dPct').textContent = pct + '%';

drawActivity(t.id, t.color);
  renderDailyList(t.id);
}

// ===================== Timers core =====================
const Timers = {
  // Play/Pause desde tarjeta
  async toggleFromCard(id){
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    const t = store.items[id];
    if(!t) return;

    if(t.running){ await this._stopLogic(t); }
    else { await this._startLogic(t); }

    await this._refreshItems();
    renderList(); drawDashboard();
  },

  // Detalle (botones)
  async start(){
    if(!CURRENT || TICK) return;
    await this._startLogic(CURRENT);
    await this._refreshItems();
    CURRENT = lsGet(LS_KEY(), {items:{}, days:{}}).items[CURRENT.id];

    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled  = false;

    RUN_START = CURRENT.runStart || Date.now();
    if(TICK) clearInterval(TICK);
    TICK = setInterval(()=>{
      const sec = ((Date.now()-(CURRENT.runStart||RUN_START))/1000)|0;
      document.getElementById('liveCounter').textContent = prettyDuration(sec);
      document.getElementById('totalPretty').textContent = secsPretty((CURRENT.totalSec||0)+sec);
    }, 200);
  },

  async stop(){
    if(!CURRENT) return;
    const storeT = lsGet(LS_KEY(), {items:{}, days:{}}).items[CURRENT.id];
    await this._stopLogic(storeT);

    if(TICK){ clearInterval(TICK); TICK=null; }
    document.getElementById('startBtn').disabled=false;
    document.getElementById('stopBtn').disabled=true;

    await this._refreshItems();
    CURRENT = lsGet(LS_KEY(), {items:{}, days:{}}).items[CURRENT.id];

    document.getElementById('totalPretty').textContent = secsPretty(CURRENT.totalSec||0);
    const pct = percentFromCreation(CURRENT);
    document.getElementById('dRing').style.setProperty('--p', pct);
    document.getElementById('dPct').textContent = pct + '%';

drawActivity(CURRENT.id, CURRENT.color);
    renderDailyList(CURRENT.id);
    drawDashboard();
  },

  // ===== Interno =====
  async _startLogic(t){
    const now = Date.now();
    try{ await db.ref(`timers/${UID}/items/${t.id}`).update({ running:true, runStart: now }); }
    catch(e){ console.warn('RTDB start:', e); }
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    store.items[t.id] = {...(store.items[t.id]||t), running:true, runStart:now};
    lsSet(LS_KEY(), store);
  },

  async _stopLogic(t){
    if(!t || !t.runStart) return;
    const elapsed = ((Date.now() - t.runStart)/1000)|0;
    const today = ymd();

    try{
      await db.ref(`timers/${UID}/items/${t.id}`).transaction(it=>{
        if(!it) return it;
        it.totalSec = (it.totalSec||0) + elapsed;
        it.running = false;
        it.runStart = null;
        return it;
      });
      await db.ref(`timers/${UID}/days/${t.id}/${today}`).transaction(sec => (sec||0)+elapsed);
    }catch(e){ console.warn('RTDB stop tx:', e); }

    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    const it = store.items[t.id]||t;
    it.totalSec = (it.totalSec||0)+elapsed;
    it.running=false; it.runStart=null;
    store.items[t.id]=it;
    store.days[t.id]=store.days[t.id]||{};
    store.days[t.id][today]=(store.days[t.id][today]||0)+elapsed;
    lsSet(LS_KEY(), store);
  },

  async _addSeconds(id, sec){
    const today = ymd();
    try{
      await db.ref(`timers/${UID}/items/${id}`).transaction(it=>{ if(!it) return it; it.totalSec=(it.totalSec||0)+sec; return it; });
      await db.ref(`timers/${UID}/days/${id}/${today}`).transaction(s => (s||0)+sec);
    }catch(e){ console.warn('RTDB addSec:', e); }

    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    const it = store.items[id];
    if(it){ it.totalSec = (it.totalSec||0)+sec; }
    store.days[id]=store.days[id]||{};
    store.days[id][today]=(store.days[id][today]||0)+sec;
    lsSet(LS_KEY(), store);
  },

  async _refreshItems(){
    try{
      const snap = await db.ref(`timers/${UID}/items`).once('value');
      if(snap.exists()){
        const items = snap.val();
        const store = lsGet(LS_KEY(), {items:{}, days:{}});
        store.items = items; lsSet(LS_KEY(), store);
      }
    }catch(e){}
  }
};
window.Timers = Timers;

// ===================== Daily list & chart =====================
async function renderDailyList(timerId){
  const wrap = document.getElementById('dailyList');
  if(!wrap) return;
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
function drawActivity(timerId, color){
  if (ACTIVITY_MODE === 'grid') drawDailyHeat(timerId);
  else drawDailyBar(timerId, color);
}
// === Barras (tu drawDaily original, renombrado) ===
function drawDailyBar(timerId, color){
  const ctx = document.getElementById('dailyChart')?.getContext('2d');
  if(!ctx) return;
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

// === Mosaico estilo GitHub — centrado, responsive y meses abreviados (ago, sep, ...) ===
// === Mosaico tipo GitHub — centrado, contraste mejorado y mes centrado en su tramo ===
async function drawDailyHeat(timerId){
  const canvas = document.getElementById('dailyHeat');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');

  // --- datos ------------------------------------------------------------
  let map=null;
  try{
    const s=await db.ref(`timers/${UID}/days/${timerId}`).once('value');
    if(s.exists()) map = s.val();
  }catch(e){ console.warn("heat RTDB:", e); }
  if(!map){
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    map = (store.days||{})[timerId] || {};
  }

  // --- layout responsive ------------------------------------------------
  const weeks   = 20;       // columnas (ajusta si quieres)
  const rows    = 7;        // L..D
  const gap     = 3;        // espacio entre celdas
  const sidePad = 8;        // margen lateral
  const topPad  = 22;       // espacio superior para etiquetas de mes

  // ancho CSS del contenedor
  const container = canvas.parentElement || canvas;
  const cssW = Math.max(220, Math.floor(container.getBoundingClientRect().width));

  // calcula tamaño de celda para que encaje
  const cell = Math.max(8, Math.floor((cssW - sidePad*2 - (weeks+1)*gap) / weeks));
  const gridW = weeks*cell + (weeks+1)*gap;
  const gridH = rows*cell  + (rows+1)*gap;

  // centrado horizontal
  const left = Math.max(sidePad, Math.floor((cssW - gridW)/2));
  const top  = topPad;

  // HiDPI nítido
  const dpr = window.devicePixelRatio || 1;
  const cssH = top + gridH + gap;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);

  // --- paleta niveles (0 más visible para que se vea TODA la cuadrícula) ---
  const shades = ['#1a2331', '#16351e', '#1f5a2c', '#2b8a3b', '#36b24b']; // 0 más claro
  const L1 = 15*60, L2 = 60*60, L3 = 2*60*60, L4 = 4*60*60;

  // --- calendario semanal anclado a lunes -----------------------------------
  const today   = new Date();
  const weekday = (today.getDay() + 6) % 7; // 0=lun ... 6=dom
  const monday  = new Date(today); monday.setDate(today.getDate() - weekday);

  // Primero calculamos metadatos de columnas (para poder centrar etiquetas de mes)
  const colsMeta = []; // [{x, month, date: lunesDeEsaCol}]
  for (let c = weeks-1; c >= 0; c--) { // derecha -> izquierda
    const colStart = new Date(monday);
    colStart.setDate(monday.getDate() - (weeks-1 - c)*7); // lunes de esa semana
    const x = left + c*(cell+gap) + gap;
    colsMeta.push({ x, month: colStart.getMonth(), date: colStart });
  }

  // Dibuja celdas (toda la cuadrícula visible)
  for (let i = 0; i < colsMeta.length; i++){
    const { x, date: colStart } = colsMeta[i];
    for (let r = 0; r < rows; r++) {
      const d = new Date(colStart); d.setDate(colStart.getDate() + r);
      const key = ymd(d);
      const sec = map[key] || 0;

      let lvl = 0;
      if (sec > 0)  lvl = 1;
      if (sec > L1) lvl = 2;
      if (sec > L2) lvl = 3;
      if (sec > L3) lvl = 4;

      const y = top + r*(cell+gap) + gap;
      ctx.fillStyle = shades[lvl];
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; // borde más marcado
      ctx.strokeRect(x+0.5, y+0.5, cell-1, cell-1);
    }
  }

  // Etiquetas de mes: agrupamos columnas contiguas por mes y rotulamos en el centro
  ctx.textBaseline = 'top';
  ctx.font = '11px ui-sans-serif, system-ui, Segoe UI, Roboto, Arial';
  ctx.fillStyle = 'rgba(233,238,248,.85)';

  let runStart = 0;
  for (let i = 1; i <= colsMeta.length; i++){
    const currMonth = colsMeta[i-1].month;
    const nextMonth = (i<colsMeta.length) ? colsMeta[i].month : -999;
    if (currMonth !== nextMonth) {
      // tramo [runStart .. i-1] del mismo mes
      const xStart = colsMeta[runStart].x;
      const xEnd   = colsMeta[i-1].x + cell; // fin de la última celda del tramo
      const cx     = xStart + (xEnd - xStart)/2;

      let mStr = colsMeta[runStart].date.toLocaleString('es-ES', { month:'short' }).replace('.','');
      mStr = mStr.slice(0,3).toLowerCase(); // "ago", "sep", ...

      // evita cortar en bordes
      const txtW = ctx.measureText(mStr).width;
      const drawX = Math.min(Math.max(cx - txtW/2, sidePad), cssW - sidePad - txtW);
      ctx.fillText(mStr, drawX, 4);

      // separador sutil al inicio del tramo (como guía de cambio de mes)
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(xStart - Math.floor(gap/2), top-2, 1, gridH + gap);
      ctx.fillStyle = 'rgba(233,238,248,.85)';

      runStart = i; // siguiente tramo
    }
  }
}


// ===================== Dashboard (pie) =====================
async function drawDashboard(){
  const lbl = document.getElementById('dashDate');
  const cnv = document.getElementById('dayPie');
  if(!lbl || !cnv) return;

  const day = todayKey(DASH_OFFSET);
  lbl.textContent = day;

  // RTDB + espejo LS
  let items = lsGet(LS_KEY(), {items:{}, days:{}}).items;
  let days  = lsGet(LS_KEY(), {items:{}, days:{}}).days || {};
  try{
    const [it,dy] = await Promise.all([
      db.ref(`timers/${UID}/items`).once('value'),
      db.ref(`timers/${UID}/days`).once('value')
    ]);
    if(it.exists()) items = it.val();
    if(dy.exists()) days  = dy.val();
    const store = lsGet(LS_KEY(), {items:{}, days:{}});
    store.items=items; store.days=days; lsSet(LS_KEY(), store);
  }catch(e){}

  // datos en SEGUNDOS (preciso)
  const labels = [], data = [], colors = [];
  let sum = 0;

  Object.values(items || {}).forEach(t => {
    const sec = (days?.[t.id]?.[day] || 0);
    if (sec > 0) {
      labels.push(t.name);
      data.push(sec);
      colors.push(t.color || '#3a86ff');
      sum += sec;
    }
  });

  const remaining = Math.max(0, 86400 - sum);
  if (remaining > 0) {
    labels.push('Restante');
    data.push(remaining);
    colors.push('#1b2431');
  }

  const ctx = cnv.getContext('2d');
  if (PIE) PIE.destroy();
  PIE = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: {
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const sec = ctx.parsed || 0;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const pct = ((sec / total) * 100).toFixed(1);
              return `${ctx.label}: ${prettyDuration(sec)} (${pct}%)`;
            }
          }
        },
        legend: {
          labels: {
            generateLabels: (chart) => {
              const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              return base.map(l => ({ ...l, text: chart.data.labels[l.index] }));
            }
          }
        }
      }
    }
  });
}

// Swipe/navegación de días
function attachDashSwipe(){
  const box = document.getElementById('dashWrap'); if(!box || box._swipeBound) return; box._swipeBound=true;
  let sx=0, sy=0, t=0;
  box.addEventListener('touchstart', e=>{ const p=e.changedTouches[0]; sx=p.clientX; sy=p.clientY; t=Date.now(); }, {passive:true});
  box.addEventListener('touchend', e=>{
    const p=e.changedTouches[0]; const dx=p.clientX-sx, dy=p.clientY-sy;
    if(Math.abs(dx)>60 && Math.abs(dy)<40 && (Date.now()-t)<800){ DASH_OFFSET += (dx<0?-1:1); drawDashboard(); }
  }, {passive:true});
  document.getElementById('prevDay')?.addEventListener('click', ()=>{ DASH_OFFSET-=1; drawDashboard(); });
  document.getElementById('nextDay')?.addEventListener('click', ()=>{ DASH_OFFSET+=1; drawDashboard(); });
}

// ===================== Lifecycles =====================
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible'){ renderList(); drawDashboard(); }
});

document.addEventListener('DOMContentLoaded', ()=>{
  renderList();
  attachDashSwipe();
  drawDashboard();
});
