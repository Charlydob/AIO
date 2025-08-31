// Finanzas con CUENTAS (normales / inversión), movimientos por cuenta,
// vista de detalle interna, activos de inversión, traspasos desde líquido,
// moneda de visualización con conversión básica, y carga lazy de movimientos.

let ENTRIES = {};        // map de movimientos por id
let ACCOUNTS = {};       // map de cuentas por id
let EDIT_ID = null;      // id de movimiento en edición
let EDIT_OBJ = null;     // objeto en edición (para recomputar diarios al borrar)
let charts = { net:null, incExp:null, cat:null, acc:null };
let RANGE = '30d';
let DISPLAY_CCY = 'EUR';

let ACC_CURRENT = null;       // cuenta abierta en vista interna
let ACC_MOV_OLDEST_TS = null; // paginación lazy
let ACC_SEARCH_Q = '';        // búsqueda en lista de movimientos de cuenta
let ASSET_SUMS = {}; // { [accountId]: sumaInvertidaEnMonedaDeLaCuenta }

const LS_KEY_FIN = ()=>`finance_${UID}`;
const FX = { // tasas simple editables
  EUR:{EUR:1, USD:1.1, GBP:0.85},
  USD:{EUR:0.91, USD:1, GBP:0.77},
  GBP:{EUR:1.18, USD:1.3, GBP:1}
};

function fx(amount, from, to){ from=from||'EUR'; to=to||'EUR'; return +(amount * (FX?.[from]?.[to]||1)).toFixed(2); }
function euroLike(amount, ccy=DISPLAY_CCY){ const s = new Intl.NumberFormat('es-ES',{style:'currency', currency:ccy}).format(amount||0); return s; }

// Fecha a YYYY-MM-DD
function ymd(d=new Date()){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10); }

// Coincidencia por texto/importe
function matchesQuery(e, q){
  if(!q) return true;
  q = q.trim().toLowerCase();
  const hay = [
    e.date || '',
    e.type || '',
    e.category || '',
    e.note || '',
    accountName(e.accountId) || '',
    String(e.amount||'')
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
}

// Calcula balance por día para una cuenta (en moneda de la CUENTA)
function computeDailyBalanceForAccount(acc, dayKey){
  const accCcy = acc.currency || 'EUR';

  if(acc.type==='normal'){
    let bal = acc.initBalance || 0;
    Object.values(ENTRIES).forEach(e=>{
      if(e.accountId!==acc.id) return;
      if(e.date<=dayKey){
        const v = fx(e.amount, e.currency||'EUR', accCcy);
        if(e.type==='gasto') bal -= v;
        else bal += v;
      }
    });
    return +bal.toFixed(2);
  }

  // inversión: líquido y “invertido” reconstruidos desde traspasos
  const liquidInit = (acc.liquidInit!=null)? acc.liquidInit : (acc.liquid||0); // compat
  let liquid = liquidInit;    // en moneda de la cuenta
  let investedAcc = 0;        // invertido convertido a moneda de la cuenta

  Object.values(ENTRIES).forEach(e=>{
    if(e.accountId!==acc.id) return;
    if(e.date<=dayKey && e.type==='traspaso'){
      const isToAsset   = /A activo/i.test(e.note||'');
      const isFromAsset = /Desde activo/i.test(e.note||'');
      const fee = (()=>{ const m = (e.note||'').match(/fee\s+([\d.]+)/i); return m? parseFloat(m[1]||'0')||0 : 0; })();
      const amtAcc = fx(e.amount||0, e.currency||accCcy, accCcy);
      const feeAcc = fx(fee, e.currency||accCcy, accCcy);
      if(isToAsset){        // líquido disminuye; invertido aumenta neto
        liquid      -= amtAcc;
        investedAcc += (amtAcc - feeAcc);
      }else if(isFromAsset){// líquido aumenta; invertido baja
        liquid      += amtAcc;
        investedAcc -= amtAcc;
      }
    }
  });

  return +(liquid + investedAcc).toFixed(2);
}

// Recalcula y sube balances diarios de los últimos N días (ligero)
async function recomputeDailyRange(accountId, daysBack=90){
  const acc = ACCOUNTS[accountId]; if(!acc) return;
  const base = `finance/${UID}/daily/${accountId}`;
  const today = new Date();
  const updates = {};
  for(let i=daysBack; i>=0; i--){
    const d = new Date(today); d.setDate(today.getDate()-i);
    const k = ymd(d);
    const bal = computeDailyBalanceForAccount(acc, k); // moneda de la cuenta
    updates[k] = { bal, ccy: acc.currency };
  }
  try{ await db.ref(base).update(updates); }catch(e){ console.warn('daily update', e); }
}

// --- Modal helpers ---
function openModal({title, bodyHTML, submitText='Aceptar', onSubmit}){
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  const btn = document.getElementById('modalPrimary');
  btn.textContent = submitText;
  btn.onclick = async ()=>{ if(onSubmit) await onSubmit(); };
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalBackdrop').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modalBackdrop').classList.add('hidden');
}

const Fin = {
  setDisplayCurrency(v){ DISPLAY_CCY=v; Fin.refreshAll(); if(ACC_CURRENT) Fin.openAccount(ACC_CURRENT.id,true); },

  onRangeChange(v){ RANGE=v; Fin.refreshAll(); },

  switchTab(name){
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
    document.querySelectorAll('section.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('tab-'+name).classList.add('active');
    if(name==='overview') drawNetWorth();
    if(name==='analytics') drawAnalytics();
    if(name==='entries')  Fin.renderEntries();
  },

  // ---------- Cuentas ----------
  async showAddAccount(){
    // (esta versión con prompt puede quedar sobreescrita por la de modal más abajo)
    const name = prompt('Nombre de la cuenta:'); if(!name) return;
    const type = prompt('Tipo: normal / inversion','normal')?.toLowerCase()==='inversion'?'inversion':'normal';
    const color = prompt('Color hex (#RRGGBB):', '#3a86ff') || '#3a86ff';
    const currency = prompt('Moneda (EUR/USD/GBP):','EUR') || 'EUR';
    let initBalance = 0, liquid = 0;
    if(type==='normal'){
      initBalance = parseFloat(prompt('Saldo inicial:', '0')||'0')||0;
    }else{
      liquid = parseFloat(prompt('Líquido inicial (puede ser 0):','0')||'0')||0;
    }
    const idA = id();
    const acc = { id:idA, name, color, type, currency, createdAt:Date.now(), initBalance, balance:initBalance, liquid: (type==='inversion'? liquid: undefined) };

    try{ await db.ref(`finance/${UID}/accounts/${idA}`).set(acc); }
    catch(e){ console.warn('RTDB add account:', e); }

    const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}});
    store.accounts[idA]=acc; lsSet(LS_KEY_FIN(), store);
    await loadAccounts(true);
  },

  async openAccount(id, keepView=false){
    const acc = ACCOUNTS[id]; if(!acc) return;
    ACC_CURRENT = acc;
    document.getElementById('accTitle').textContent = acc.name;
    document.getElementById('accAddBtn').textContent = (acc.type==='inversion') ? '＋ Activo' : '＋ Movimiento';

    // Mostrar/ocultar secciones según tipo
    document.getElementById('accAssets').style.display = (acc.type==='inversion') ? 'block' : 'none';
    document.getElementById('accLiquidWrap').style.display = (acc.type==='inversion') ? 'block' : 'none';
    document.getElementById('accMovs').style.display = (acc.type==='inversion') ? 'none'  : 'block';
    document.getElementById('accMoreWrap').style.display = (acc.type==='inversion') ? 'none'  : 'flex';
    document.getElementById('accSearchWrap')?.classList.toggle('hidden', acc.type==='inversion');

    // Datos
    await Fin.refreshAccountHeader();

    // Contenidos
    if(acc.type==='inversion'){
      await Fin.renderAssets();
    }else{
      ACC_MOV_OLDEST_TS = null;
      document.getElementById('accMovs').innerHTML='';
      await Fin.loadMoreAccountMovs(); // 5 más
    }

    if(!keepView){
      // abrir pantalla de cuenta
      document.querySelectorAll('section.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('account-view').classList.add('active');
    }
  },

  closeAccountView(){
    ACC_CURRENT = null;
    document.getElementById('accMovs').innerHTML='';
    document.querySelectorAll('section.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('tab-overview').classList.add('active');
  },

  async refreshAccountHeader(){
    const acc = ACC_CURRENT; if(!acc) return;

    // recalcular balance actual desde init + movimientos (cuenta y, si inversión, líquido + activos)
    const { balanceNow, liquidNow } = computeAccountBalances(acc);
    const prevMonthPct = await computeDeltaVsPrevMonth(acc, balanceNow);

    document.getElementById('accBalance').textContent = euroLike(balanceNow, DISPLAY_CCY);
    const deltaEl = document.getElementById('accDelta');
    deltaEl.textContent = (prevMonthPct>=0? '▲ ':'▼ ') + Math.abs(prevMonthPct).toFixed(1) + '%';
    deltaEl.classList.toggle('up', prevMonthPct>=0);
    deltaEl.classList.toggle('down', prevMonthPct<0);
    if(acc.type==='inversion'){
      document.getElementById('accLiquid').textContent = euroLike(fx(liquidNow, acc.currency, DISPLAY_CCY), DISPLAY_CCY);
    }

    // Gráfico simple (acumulado diario últimos 90d)
    await drawAccountChart(acc.id, acc.currency);
  },

  accountPrimaryAction(){
    if(!ACC_CURRENT) return;
    if(ACC_CURRENT.type==='inversion') Fin.addAsset();
    else Fin.showAdd(ACC_CURRENT.id);
  },

  async loadMoreAccountMovs(){
    if(!ACC_CURRENT) return;
    const list = await fetchAccountMovements(ACC_CURRENT.id, 5, ACC_MOV_OLDEST_TS, ACC_SEARCH_Q);
    if(list.length===0){ document.getElementById('accMoreWrap').style.display='none'; return; }
    const wrap = document.getElementById('accMovs');
    list.forEach(e=>{
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div class="row">
          <div class="chip">${e.date}</div>
          <div class="chip">${e.type}</div>
          ${e.category?`<div class="chip">${e.category}</div>`:''}
          <div class="grow"></div>
          <div class="chip">${euroLike(fx(e.amount, e.currency||'EUR', DISPLAY_CCY), DISPLAY_CCY)}</div>
        </div>
        ${e.note?`<div class="muted">${e.note}</div>`:''}
      `;
      wrap.appendChild(card);
    });
    ACC_MOV_OLDEST_TS = list[list.length-1].ts;
  },

  // ---------- Activos (cuentas inversión) ----------
  async renderAssets(){
    const wrap = document.getElementById('accAssets'); wrap.innerHTML='';
    const accId = ACC_CURRENT.id;
    let assets = null;
    try{
      const s = await db.ref(`finance/${UID}/assets/${accId}`).once('value');
      if(s.exists()) assets = s.val();
    }catch(e){}
    assets = assets || {};
    const arr = Object.values(assets);

    if(arr.length===0){
      const empty=document.createElement('div'); empty.className='card';
      empty.innerHTML = `<div class="row"><div class="grow"></div><div class="muted">Sin activos. Pulsa “＋ Activo”.</div><div class="grow"></div></div>`;
      wrap.appendChild(empty); return;
    }

    arr.forEach(a=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div class="row">
          <div class="chip">${a.name}</div>
          <div class="chip">${a.type||'activo'}</div>
          <div class="grow"></div>
          <div class="chip">${euroLike(fx(a.invested||0, a.currency||ACC_CURRENT.currency, DISPLAY_CCY), DISPLAY_CCY)}</div>
          <button class="pill ghost" onclick="Fin.openAsset('${a.id}')">Abrir</button>
        </div>
      `;
      wrap.appendChild(card);
    });
  },

  // === _fromLiquid/_toLiquid CORREGIDOS con FX + diarios ===
  async _fromLiquid(accId, amount, ccy, assetId, fee){
    const base = `finance/${UID}`;
    const acc  = ACCOUNTS[accId]; const accCcy = acc?.currency || 'EUR';
    const amtAcc = fx(amount, ccy, accCcy);
    const feeAcc = fx(fee||0, ccy, accCcy);

    await db.ref(`${base}/assets/${accId}/${assetId}/invested`).transaction(v=>(v||0)+(amount-(fee||0)));
    await db.ref(`${base}/accounts/${accId}/liquid`).transaction(v=>(v||0)-amtAcc);

    const eid = id(); const today = ymd();
    const entry = { id:eid, type:'traspaso', date:today, amount, currency:ccy, accountId:accId, note:`A activo ${assetId} (fee ${fee||0})`, ts:Date.now() };
    await db.ref(`${base}/entries/${eid}`).set(entry);
    mirrorEntryLS(entry);

    await recomputeDailyRange(accId, 7);
  },

  async _toLiquid(accId, amount, ccy, assetId){
    const base = `finance/${UID}`;
    const acc  = ACCOUNTS[accId]; const accCcy = acc?.currency || 'EUR';
    const amtAcc = fx(amount, ccy, accCcy);

    await db.ref(`${base}/assets/${accId}/${assetId}/invested`).transaction(v=>Math.max(0,(v||0)-amount));
    await db.ref(`${base}/accounts/${accId}/liquid`).transaction(v=>(v||0)+amtAcc);

    const eid = id(); const today = ymd();
    const entry = { id:eid, type:'traspaso', date:today, amount, currency:ccy, accountId:accId, note:`Desde activo ${assetId}`, ts:Date.now() };
    await db.ref(`${base}/entries/${eid}`).set(entry);
    mirrorEntryLS(entry);

    await recomputeDailyRange(accId, 7);
  },

  // ---------- Movimientos ----------
  showAdd(forceAccountId){
    EDIT_ID = null; EDIT_OBJ = null;
    document.getElementById('edTitle').textContent='Nuevo movimiento';
    fillAccountsSelect('eAccount', forceAccountId);
    setVal('eType','gasto'); setVal('eCat','Otros'); setVal('eDate', new Date().toISOString().slice(0,10));
    setVal('eAmount',''); setVal('eCurrency','EUR'); setVal('eNote','');
    document.getElementById('eDelete').classList.add('hidden');
    openEditor();
  },

  openEdit(id, obj){
    EDIT_ID = id; EDIT_OBJ = obj;
    document.getElementById('edTitle').textContent='Editar movimiento';
    fillAccountsSelect('eAccount', obj.accountId);
    setVal('eType', obj.type); setVal('eCat', obj.category||'Otros'); setVal('eDate', obj.date);
    setVal('eAmount', obj.amount); setVal('eCurrency', obj.currency||'EUR'); setVal('eNote', obj.note||'');
    document.getElementById('eDelete').classList.remove('hidden');
    openEditor();
  },

  closeEditor(){ closeEditor(); },

  async saveEntry(){
    try{
      const amount = parseFloat(val('eAmount')||'0'); if(isNaN(amount)) return alert('Importe inválido');
      const entry = {
        accountId: val('eAccount'),
        type: val('eType'),
        category: val('eCat'),
        date: val('eDate') || new Date().toISOString().slice(0,10),
        amount, currency: val('eCurrency')||'EUR',
        note: val('eNote')||'',
        ts: Date.now()
      };
      if(!entry.accountId) return alert('Selecciona una cuenta');
      const base = `finance/${UID}`;
      const eid = EDIT_ID || id();
      if(EDIT_ID){ await db.ref(`${base}/entries/${eid}`).update(entry); }
      else{ await db.ref(`${base}/entries/${eid}`).set({...entry,id:eid}); }
      mirrorEntryLS({...entry,id:eid});

      closeEditor();
      await loadEntries(true);
      await loadAssetsSummary(true);
      await recomputeDailyRange(entry.accountId, 60);
      await loadAccounts(true); // para refrescar líquido de inversión si aplica
      Fin.refreshAll();
      if(ACC_CURRENT && ACC_CURRENT.id===entry.accountId) await Fin.openAccount(entry.accountId, true);
    }catch(e){
      console.error("save entry", e);
      const eid = EDIT_ID || id();
      const entry = {
        accountId: val('eAccount'),
        type: val('eType'),
        category: val('eCat'),
        date: val('eDate') || new Date().toISOString().slice(0,10),
        amount: parseFloat(val('eAmount')||'0'),
        currency: val('eCurrency')||'EUR',
        note: val('eNote')||'',
        ts: Date.now(), id:eid
      };
      mirrorEntryLS(entry);
      closeEditor(); await loadEntries(false);
      alert("⚠️ Guardado offline (RTDB falló).");
    }
  },

  async deleteEntry(){
    if(!EDIT_ID) return;
    try{
      if(!confirm('¿Borrar movimiento?')) return;
      await db.ref(`finance/${UID}/entries/${EDIT_ID}`).remove();
      const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}});
      delete store.entries[EDIT_ID]; lsSet(LS_KEY_FIN(), store);
      const accId = EDIT_OBJ?.accountId;
      closeEditor(); await loadEntries(true);
      if(accId) await recomputeDailyRange(accId, 60);
      await loadAssetsSummary(true);
      Fin.refreshAll();
      if(ACC_CURRENT) await Fin.openAccount(ACC_CURRENT.id,true);
    }catch(e){
      const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}});
      delete store.entries[EDIT_ID]; lsSet(LS_KEY_FIN(), store);
      closeEditor(); await loadEntries(false);
      alert("⚠️ Borrado offline (RTDB falló).");
    }
  },

  renderEntries(){
    const type = val('fType');
    const cat  = val('fCat');
    const accF = val('fAcc');
    const q    = (document.getElementById('fSearch')?.value||'').trim().toLowerCase();
    const wrap = document.getElementById('entriesList');
    wrap.innerHTML='';

    const [from,to] = rangeDates();
    const list = Object.values(ENTRIES)
      .filter(e=>{
        const d=new Date(e.date);
        return d>=from && d<=to && (!type||e.type===type) && (!cat||e.category===cat) && (!accF||e.accountId===accF) && matchesQuery(e,q);
      })
      .sort((a,b)=>b.date.localeCompare(a.date) || b.ts-a.ts);

    if(list.length===0){
      const empty=document.createElement('div'); empty.className='card';
      empty.innerHTML='<div class="muted">Sin movimientos. Pulsa ＋ Movimiento.</div>';
      wrap.appendChild(empty); return;
    }

    // Agrupar por mes
    const groups = {};
    list.forEach(e=>{
      const ym = e.date.slice(0,7);
      (groups[ym] = groups[ym] || {items:[], inc:0, exp:0}).items.push(e);
      const v = fx(e.amount, e.currency||'EUR', DISPLAY_CCY);
      if(e.type==='gasto') groups[ym].exp += v;
      if(e.type==='ingreso'||e.type==='salario'||e.type==='inversion') groups[ym].inc += v;
    });

    Object.keys(groups).sort().reverse().forEach(ym=>{
      const g = groups[ym];
      const header=document.createElement('div'); header.className='card';
      const monthLabel = monthHuman(ym);
      const net = g.inc - g.exp;
      header.innerHTML = `
        <div class="row">
          <div class="chip">${monthLabel}</div>
          <div class="grow"></div>
          <div class="chip" style="background:#3a86ff22;border-color:#3a86ff44">Ingresos: ${euroLike(g.inc)}</div>
          <div class="chip" style="background:#e2555522;border-color:#e2555544">Gastos: ${euroLike(g.exp)}</div>
          <div class="chip" style="background:${net>=0?'#21c28a22':'#e2555522'};border-color:${net>=0?'#21c28a44':'#e2555544'}">Saldo: ${euroLike(net)}</div>
        </div>
      `;
      wrap.appendChild(header);

      g.items.forEach(e=>{
        const card=document.createElement('div'); card.className='card';
        card.innerHTML = `
          <div class="row">
            <div class="chip">${e.date}</div>
            <div class="chip">${ accountName(e.accountId) }</div>
            <div class="chip">${e.type}</div>
            ${e.category?`<div class="chip">${e.category}</div>`:''}
            <div class="grow"></div>
            <div class="chip" style="background:${e.type==='gasto'?'#e2555522':'#3a86ff22'};border-color:${e.type==='gasto'?'#e2555544':'#3a86ff44'}">
              ${euroLike(fx(e.amount, e.currency||'EUR', DISPLAY_CCY))}
            </div>
          </div>
          ${e.note?`<p class="muted">${e.note}</p>`:''}
          <div class="row"><button class="pill" onclick='Fin.openEdit("${e.id}", ${JSON.stringify(e).replace(/"/g,'&quot;')})'>Editar</button></div>
        `;
        wrap.appendChild(card);
      });
    });
  },

  exportCSV(){
    const [from,to] = rangeDates();
    const rows = [["id","fecha","cuenta","tipo","categoria","importe","moneda","nota"]];
    Object.values(ENTRIES)
      .filter(e=>{ const d=new Date(e.date); return d>=from && d<=to; })
      .sort((a,b)=>a.date.localeCompare(b.date))
      .forEach(e=>rows.push([e.id,e.date,accountName(e.accountId),e.type,e.category,(""+e.amount).replace('.',','), e.currency||'EUR', (e.note||'').replace(/\n/g,' ').trim() ]));

    const csv = rows.map(r=>r.map(v=>{
      const s=String(v??'');
      return /[",;\n]/.test(s)? `"${s.replace(/"/g,'""')}"` : s;
    }).join(';')).join('\n');

    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`finanzas_${RANGE}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  },

  async refreshAll(){
    renderAccounts();
    fillAccountsSelect('eAccount');
    populateFilterAccounts();
    updateStats();
    drawNetWorth();
    drawAnalytics();
  },

  // Reset + búsqueda en vista de cuenta
  resetAndReloadAccountMovs(){
    ACC_SEARCH_Q = (document.getElementById('accSearch')?.value||'').trim().toLowerCase();
    ACC_MOV_OLDEST_TS = null;
    const wrap = document.getElementById('accMovs'); if(wrap) wrap.innerHTML='';
    const more = document.getElementById('accMoreWrap'); if(more) more.style.display='flex';
    Fin.loadMoreAccountMovs();
  }
};

// ---------- Helpers de DOM/estado ----------
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }
function val(id){ return document.getElementById(id)?.value || ''; }
function openEditor(){ document.getElementById('entry-editor').classList.add('active'); }
function closeEditor(){ document.getElementById('entry-editor').classList.remove('active'); }
function accountName(id){ return ACCOUNTS?.[id]?.name || '—'; }
function fillAccountsSelect(id, preferId){
  const sel = document.getElementById(id); if(!sel) return;
  sel.innerHTML=''; const opt = document.createElement('option'); opt.value=''; opt.textContent='— Selecciona —'; sel.appendChild(opt);
  Object.values(ACCOUNTS).forEach(a=>{
    const o=document.createElement('option'); o.value=a.id; o.textContent=`${a.name} (${a.currency})`;
    if(preferId && preferId===a.id) o.selected=true;
    sel.appendChild(o);
  });
}
function populateFilterAccounts(){
  const sel = document.getElementById('fAcc'); if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Cuenta: todas</option>';
  Object.values(ACCOUNTS).forEach(a=>{
    const o=document.createElement('option'); o.value=a.id; o.textContent=a.name; sel.appendChild(o);
  });
  if(keep) sel.value = keep;
}

// ---------- Cálculos ----------
function rangeDates(){
  const now = new Date();
  let from = new Date(0);
  if(RANGE==='30d'){ from = new Date(); from.setDate(now.getDate()-30); }
  if(RANGE==='90d'){ from = new Date(); from.setDate(now.getDate()-90); }
  if(RANGE==='ytd'){ from = new Date(now.getFullYear(),0,1); }
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
  return [from, to];
}

function updateStats(){
  const [from,to] = rangeDates();
  let inc=0, exp=0;
  Object.values(ENTRIES).forEach(e=>{
    const d=new Date(e.date); if(d<from||d>to) return;
    const v = fx(e.amount, e.currency||'EUR', DISPLAY_CCY);
    if(e.type==='gasto') exp+=v;
    if(['ingreso','salario','inversion'].includes(e.type)) inc+=v;
  });
  // Patrimonio = suma de balances actuales de TODAS las cuentas
  const net = sumNetWorthFromAccounts();
  document.getElementById('stNet').textContent = euroLike(net);
  document.getElementById('stInc').textContent = euroLike(inc);
  document.getElementById('stExp').textContent = euroLike(exp);
}

function sumNetWorthFromAccounts(){
  let total = 0;
  Object.values(ACCOUNTS).forEach(acc=>{
    const { balanceNow } = computeAccountBalances(acc); // ya en DISPLAY_CCY
    total += balanceNow;
  });
  return total;
}

function computeAccountBalances(acc){
  // balance en MONEDA DE VISUALIZACIÓN (DISPLAY_CCY)
  const accCcy = acc.currency || 'EUR';

  if(acc.type==='normal'){
    let bal = acc.initBalance||0;
    Object.values(ENTRIES).forEach(e=>{
      if(e.accountId!==acc.id) return;
      const v = fx(e.amount, e.currency||'EUR', accCcy);
      if(e.type==='gasto') bal -= v;
      if(['ingreso','salario','inversion'].includes(e.type)) bal += v;
    });
    return { balanceNow: fx(bal, accCcy, DISPLAY_CCY), liquidNow: undefined };
  }

  // inversión: balance = líquido + suma invertida (sin valoración de mercado)
  const liquid = acc.liquid || 0;                         // en moneda de la cuenta
  const investedSum = ASSET_SUMS[acc.id] || 0;            // ya en moneda de la cuenta
  const balInv = liquid + investedSum;                    // en moneda de la cuenta
  return { balanceNow: fx(balInv, accCcy, DISPLAY_CCY), liquidNow: liquid };
}

async function computeDeltaVsPrevMonth(acc, balanceNow){
  // % vs fin del mes anterior: (now - endPrev) / |endPrev|
  const prevEnd = endOfPrevMonth();
  // sum hasta prevEnd en moneda de cuenta
  let balPrev = acc.initBalance||0;
  Object.values(ENTRIES).forEach(e=>{
    if(e.accountId!==acc.id) return;
    if(new Date(e.date) > prevEnd) return;
    const v = fx(e.amount, e.currency||'EUR', acc.currency||'EUR');
    if(acc.type==='normal'){
      if(e.type==='gasto') balPrev -= v;
      if(['ingreso','salario','inversion'].includes(e.type)) balPrev += v;
    }
  });

  // activos + líquido: aproximado (sin valoración de mercado)
  if(acc.type==='inversion'){
    try{
      const s=await db.ref(`finance/${UID}/assets/${acc.id}`).once('value');
      const assets=s.val()||{};
      let inv=0;
      Object.values(assets).forEach(a=>{ inv += fx(a.invested||0, a.currency||acc.currency, acc.currency); });
      balPrev = (acc.liquid||0) + inv;
    }catch(e){}
  }

  const prevDisplay = fx(balPrev, acc.currency||'EUR', DISPLAY_CCY);
  const denom = Math.abs(prevDisplay) || 1;
  return ((balanceNow - prevDisplay)/denom)*100;
}

function endOfPrevMonth(){
  const d = new Date(); d.setDate(1); d.setHours(23,59,59,999); d.setMinutes(d.getMinutes()-1);
  return d; // último momento del mes anterior
}

async function drawAccountChart(accId, accCcy){
  const ctx = document.getElementById('accChart').getContext('2d');
  if(charts.acc) charts.acc.destroy();

  // últimos 90 días acumulado
  const to = new Date(); const from = new Date(); from.setDate(to.getDate()-89);
  const labels=[], data=[]; let acc=0;

  // mapa de variaciones por día (cuenta)
  const map={};
  Object.values(ENTRIES).forEach(e=>{
    if(e.accountId!==accId) return;
    const d=new Date(e.date); if(d<from||d>to) return;
    const k=e.date; const v = fx(e.amount, e.currency||'EUR', accCcy||'EUR');
    map[k]=(map[k]||0) + (e.type==='gasto' ? -v : v);
  });

  // base inicial hasta el día -90
  let base = 0;
  Object.values(ENTRIES).forEach(e=>{
    if(e.accountId!==accId) return;
    const d=new Date(e.date); if(d<from){ const v=fx(e.amount, e.currency||'EUR', accCcy||'EUR'); base += (e.type==='gasto' ? -v : v); }
  });

  acc = base + (ACCOUNTS[accId]?.initBalance||0);
  for(let i=89;i>=0;i--){
    const d = new Date(to); d.setDate(to.getDate()-i);
    const k = d.toISOString().slice(0,10);
    acc += (map[k]||0);
    labels.push(k.slice(5));
    data.push( fx(acc, accCcy||'EUR', DISPLAY_CCY) );
  }

  charts.acc = new Chart(ctx, { type:'line', data:{ labels, datasets:[{label:'Balance', data, tension:.2}]}, options:{responsive:true, scales:{y:{beginAtZero:false}}} });
}

// ---------- Net / Analytics ----------
function drawNetWorth(){
  const ctx = document.getElementById('netWorthChart').getContext('2d');
  if(charts.net) charts.net.destroy();

  const [from,to] = rangeDates();
  const days = Math.max(1, Math.ceil((to-from)/86400000)+1);

  const labels=[], data=[];
  for(let i=days-1;i>=0;i--){
    const d = new Date(to); d.setDate(to.getDate()-i);
    const key = ymd(d);
    labels.push(key.slice(5));

    // suma de balances de TODAS las cuentas en DISPLAY_CCY
    let sum = 0;
    Object.values(ACCOUNTS).forEach(acc=>{
      const balAccCcy = computeDailyBalanceForAccount(acc, key); // moneda de la cuenta
      sum += fx(balAccCcy, acc.currency||'EUR', DISPLAY_CCY);
    });
    data.push(+sum.toFixed(2));
  }

  charts.net = new Chart(ctx,{
    type:'line',
    data:{ labels, datasets:[{ label:`Patrimonio (${DISPLAY_CCY})`, data, tension:.2 }]},
    options:{ responsive:true, scales:{ y:{ beginAtZero:false } } }
  });
}

function drawAnalytics(){
  const ctx1 = document.getElementById('incExpChart').getContext('2d');
  const ctx2 = document.getElementById('catPieChart').getContext('2d');
  if(charts.incExp) charts.incExp.destroy();
  if(charts.cat) charts.cat.destroy();

  const [from,to] = rangeDates();
  let inc=0, exp=0; const catMap={};
  Object.values(ENTRIES).forEach(e=>{
    const d=new Date(e.date); if(d<from||d>to) return;
    const v = fx(e.amount, e.currency||'EUR', DISPLAY_CCY);
    if(['ingreso','salario','inversion'].includes(e.type)) inc+=v;
    if(e.type==='gasto'){ exp+=v; catMap[e.category]= (catMap[e.category]||0)+v; }
  });

  charts.incExp = new Chart(ctx1,{ type:'bar', data:{ labels:['Ingresos','Gastos'], datasets:[{data:[inc,exp]}] }, options:{ responsive:true, scales:{y:{beginAtZero:true}} } });
  charts.cat    = new Chart(ctx2,{ type:'pie', data:{ labels:Object.keys(catMap), datasets:[{data:Object.values(catMap)}] }, options:{ responsive:true } });
}

// ---------- Carga y espejo ----------
async function loadEntries(preferRTDB=true){
  try{
    let obj=null;
    if(preferRTDB){
      const snap = await db.ref(`finance/${UID}/entries`).once('value');
      if(snap.exists()) obj = snap.val();
    }
    if(!obj){ obj = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}).entries; }
    else{ const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); store.entries=obj; lsSet(LS_KEY_FIN(), store); }
    ENTRIES = obj||{};
  }catch(e){
    ENTRIES = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}).entries || {};
  }
}
// === 2) Carga de cuentas SIN refrescar (se refresca tras assets) ===
async function loadAccounts(preferRTDB=true){
  try{
    let obj=null;
    if(preferRTDB){
      const snap = await db.ref(`finance/${UID}/accounts`).once('value');
      if(snap.exists()) obj = snap.val();
    }
    if(!obj){ obj = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}).accounts; }
    else{
      const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}});
      store.accounts=obj; lsSet(LS_KEY_FIN(), store);
    }
    ACCOUNTS = obj||{};
  }catch(e){
    ACCOUNTS = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}).accounts || {};
  }
}
async function loadAssetsSummary(preferRTDB=true){
  try{
    let obj=null;
    if(preferRTDB){
      const s = await db.ref(`finance/${UID}/assets`).once('value');
      if(s.exists()) obj = s.val(); // {accId:{assetId:{invested,currency,...}}}
    }
    if(!obj){
      // intenta cache previa
      ASSET_SUMS = lsGet(LS_KEY_FIN(), {asset_sums:{}}).asset_sums || {};
      return;
    }
    const sums = {};
    Object.entries(obj||{}).forEach(([accId, assets])=>{
      const accCcy = ACCOUNTS?.[accId]?.currency || 'EUR';
      let sum = 0;
      Object.values(assets||{}).forEach(a=>{
        sum += fx(a.invested||0, a.currency||accCcy, accCcy); // a moneda de la cuenta
      });
      sums[accId]= +sum.toFixed(2);
    });
    ASSET_SUMS = sums;
    const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}, asset_sums:{}});
    store.asset_sums = sums; lsSet(LS_KEY_FIN(), store);
  }catch(e){
    ASSET_SUMS = lsGet(LS_KEY_FIN(), {asset_sums:{}}).asset_sums || {};
  }
}
function mirrorEntryLS(entry){
  const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}});
  store.entries[entry.id]=entry; lsSet(LS_KEY_FIN(), store);
}

// === 3) Botón Abrir fiable (listeners en vez de inline) ===
function renderAccounts(){
  const wrap = document.getElementById('accountsList'); if(!wrap) return;
  wrap.innerHTML='';
  const arr = Object.values(ACCOUNTS).sort((a,b)=>a.createdAt-b.createdAt);

  arr.forEach(a=>{
    const { balanceNow } = computeAccountBalances(a);
    const card = document.createElement('div'); card.className='account-card'; card.style.borderColor=a.color+'44';
    card.innerHTML = `
      <div class="account-head">
        <div class="account-swatch" style="background:${a.color}"></div>
        <div class="account-name">${a.name}</div>
        <div class="grow"></div>
        <div class="account-type">${a.type==='inversion'?'Inversión':'Normal'}</div>
      </div>
      <div class="account-balance">${euroLike(balanceNow)}</div>
      <div class="row">
        <div class="chip">${a.currency}</div>
        ${a.type==='inversion'?'<div class="chip">Líquido</div>':''}
        <div class="grow"></div>
        <button class="pill ghost" data-open="${a.id}">Abrir</button>
      </div>
    `;
    wrap.appendChild(card);
    card.querySelector('[data-open]').addEventListener('click', ()=>Fin.openAccount(a.id));
  });
}

// ---------- Movimientos por cuenta (paginado + filtro) ----------
async function fetchAccountMovements(accountId, limit=5, beforeTs=null, q=''){
  const arr = Object.values(ENTRIES)
    .filter(e=>e.accountId===accountId && matchesQuery(e,q))
    .sort((a,b)=>b.ts-a.ts);
  const startIdx = beforeTs ? arr.findIndex(e=>e.ts===beforeTs) + 1 : 0;
  return arr.slice(startIdx, startIdx+limit);
}

// ---------- Boot ----------
// === 4) Boot: refrescar SOLO tras assets + diarios (coherente con patrimonio) ===
document.addEventListener('DOMContentLoaded', async ()=>{
  await Promise.all([loadAccounts(true), loadEntries(true)]);
  await loadAssetsSummary(true);
  for(const acc of Object.values(ACCOUNTS)){ await recomputeDailyRange(acc.id, 7); }
  Fin.refreshAll();
});
window.Fin = Fin;

// ---------- Utils menores ----------
function monthHuman(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('es-ES',{ month:'long', year:'numeric' }); }

// === Modal de creación de cuenta (opción bonita) — SOBRESCRIBE la versión prompt ===
Fin.showAddAccount = async function(){
  openModal({
    title:'Nueva cuenta',
    submitText:'Crear',
    bodyHTML: `
      <label class="field"><span>Nombre</span><input id="acc_name" placeholder="Mi cuenta"/></label>
      <label class="field"><span>Tipo</span>
        <select id="acc_type"><option value="normal">Normal</option><option value="inversion">Cuenta de Inversión</option></select>
      </label>
      <div class="row wrap">
        <label class="field grow"><span>Color</span><input id="acc_color" type="color" value="#3a86ff"/></label>
        <label class="field"><span>Moneda</span><select id="acc_ccy"><option>EUR</option><option>USD</option><option>GBP</option></select></label>
      </div>
      <div id="acc_block_normal">
        <label class="field"><span>Saldo inicial</span><input id="acc_init" type="number" step="0.01" value="0"/></label>
      </div>
      <div id="acc_block_inv" class="hidden">
        <label class="field"><span>Líquido inicial</span><input id="acc_liq" type="number" step="0.01" value="0"/></label>
      </div>
      <script>
        (function(){
          const sel = document.getElementById('acc_type');
          function toggle(){ const inv = sel.value==='inversion';
            document.getElementById('acc_block_normal').classList.toggle('hidden', inv);
            document.getElementById('acc_block_inv').classList.toggle('hidden', !inv);
          }
          sel.addEventListener('change', toggle); toggle();
        })();
      </script>
    `,
    onSubmit: async ()=>{
      const name = document.getElementById('acc_name').value.trim(); if(!name) return alert('Nombre requerido');
      const type = document.getElementById('acc_type').value;
      const color= document.getElementById('acc_color').value||'#3a86ff';
      const currency = document.getElementById('acc_ccy').value||'EUR';
      const initBalance = parseFloat(document.getElementById('acc_init')?.value||'0')||0;
      const liquidInit  = parseFloat(document.getElementById('acc_liq')?.value||'0')||0;

      const idA = id();
      const acc = {
        id:idA, name, color, type, currency, createdAt:Date.now(),
        initBalance: type==='normal'? initBalance:0,
        balance:     type==='normal'? initBalance:0,
        liquidInit:  type==='inversion'? liquidInit: undefined,
        liquid:      type==='inversion'? liquidInit: undefined
      };
      try{ await db.ref(`finance/${UID}/accounts/${idA}`).set(acc); }catch(e){}
      const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); store.accounts[idA]=acc; lsSet(LS_KEY_FIN(), store);
      closeModal(); await loadAccounts(true); await recomputeDailyRange(idA, 7);
    }
  });
};

// === Activos (modales bonitos) ===

// 1) Crear activo (modal) + opcional invertir ahora + refrescos de sumas/balances
Fin.addAsset = function(){
  const acc = ACC_CURRENT; if(!acc) return;
  openModal({
    title:'Nuevo activo',
    submitText:'Guardar',
    bodyHTML: `
      <label class="field"><span>Nombre</span><input id="as_name" placeholder="AAPL / BTC / MSCI World"/></label>
      <div class="row wrap">
        <label class="field grow"><span>Tipo</span>
          <select id="as_type"><option>stock</option><option>crypto</option><option>fund</option><option>otro</option></select>
        </label>
        <label class="field"><span>Moneda</span>
          <select id="as_ccy">
            <option ${acc.currency==='EUR'?'selected':''}>EUR</option>
            <option ${acc.currency==='USD'?'selected':''}>USD</option>
            <option ${acc.currency==='GBP'?'selected':''}>GBP</option>
          </select>
        </label>
      </div>
      <div class="row wrap">
        <label class="field grow"><span>Invertir ahora</span><input id="as_invest" type="number" step="0.01" value="0"/></label>
        <label class="field"><span>Comisión</span><input id="as_fee" type="number" step="0.01" value="0"/></label>
      </div>
    `,
    onSubmit: async ()=>{
      const name = document.getElementById('as_name').value.trim(); if(!name) return alert('Nombre requerido');
      const type = document.getElementById('as_type').value || 'stock';
      const currency = document.getElementById('as_ccy').value || acc.currency;
      const invest = Math.max(0, parseFloat(document.getElementById('as_invest').value||'0')||0);
      let   fee    = Math.max(0, parseFloat(document.getElementById('as_fee').value||'0')||0);
      if(fee > invest) fee = invest;

      const aId = id();
      const asset = { id:aId, name, type, currency, invested:0, createdAt:Date.now() };
      try{ await db.ref(`finance/${UID}/assets/${acc.id}/${aId}`).set(asset); }catch(e){ console.warn(e); }

      if(invest>0){ await Fin._fromLiquid(acc.id, invest, currency, aId, fee); }

      closeModal();
      await loadAssetsSummary(true);
      await Fin.renderAssets();
      await Fin.refreshAccountHeader();
      Fin.refreshAll();
    }
  });
};

// 2) Abrir activo (acciones)
Fin.openAsset = async function(assetId){
  const accId = ACC_CURRENT.id;
  const s = await db.ref(`finance/${UID}/assets/${accId}/${assetId}`).once('value');
  const a = s.val(); if(!a) return alert('Activo no encontrado');

  openModal({
    title:`${a.name} — ${a.type}`,
    submitText:'Cerrar',
    bodyHTML: `
      <div class="row wrap">
        <div class="chip">Moneda: ${a.currency||ACC_CURRENT.currency}</div>
        <div class="chip">Invertido: ${euroLike(fx(a.invested||0, a.currency||ACC_CURRENT.currency, DISPLAY_CCY))}</div>
      </div>
      <div class="row" style="margin-top:8px; gap:8px">
        <button class="pill" id="btnAdd">Aportar</button>
        <button class="pill ghost" id="btnRet">Retirar a líquido</button>
        <button class="pill danger" id="btnDel">Borrar</button>
      </div>
    `,
    onSubmit: ()=>closeModal()
  });

  document.getElementById('btnAdd').onclick = async ()=>{
    openModal({
      title:`Aportar a ${a.name}`,
      submitText:'Aportar',
      bodyHTML: `
        <div class="row wrap">
          <label class="field grow"><span>Importe</span><input id="mov_amt" type="number" step="0.01"/></label>
          <label class="field"><span>Comisión</span><input id="mov_fee" type="number" step="0.01" value="0"/></label>
        </div>`,
      onSubmit: async ()=>{
        const amt = Math.max(0, parseFloat(document.getElementById('mov_amt').value||'0')||0);
        let   fee = Math.max(0, parseFloat(document.getElementById('mov_fee').value||'0')||0);
        if(amt<=0) return;
        if(fee>amt) fee=amt;
        await Fin._fromLiquid(accId, amt, a.currency||ACC_CURRENT.currency, a.id, fee);
        closeModal();
        await loadAssetsSummary(true);
        await Fin.renderAssets();
        await Fin.refreshAccountHeader();
        Fin.refreshAll();
      }
    });
  };

  document.getElementById('btnRet').onclick = async ()=>{
    openModal({
      title:`Retirar de ${a.name} a Líquido`,
      submitText:'Retirar',
      bodyHTML:`<label class="field"><span>Importe</span><input id="mov_amt" type="number" step="0.01"/></label>`,
      onSubmit: async ()=>{
        const amt = Math.max(0, parseFloat(document.getElementById('mov_amt').value||'0')||0);
        if(amt<=0) return;
        await Fin._toLiquid(accId, amt, a.currency||ACC_CURRENT.currency, a.id);
        closeModal();
        await loadAssetsSummary(true);
        await Fin.renderAssets();
        await Fin.refreshAccountHeader();
        Fin.refreshAll();
      }
    });
  };

  document.getElementById('btnDel').onclick = async ()=>{
    openModal({
      title:'Confirmar borrado',
      submitText:'Borrar',
      bodyHTML:`<div class="muted">Se eliminará el activo y su histórico invertido.</div>`,
      onSubmit: async ()=>{
        await db.ref(`finance/${UID}/assets/${accId}/${assetId}`).remove();
        closeModal();
        await loadAssetsSummary(true);
        await Fin.renderAssets();
        await Fin.refreshAccountHeader();
        Fin.refreshAll();
      }
    });
  };
};

// Traspaso desde líquido (modal selector)
Fin.transferFromLiquid = async function(){
  const acc = ACC_CURRENT; if(!acc) return;
  const s = await db.ref(`finance/${UID}/assets/${acc.id}`).once('value');
  const assets = s.val()||{}; const arr = Object.values(assets);
  openModal({
    title:'Traspasar desde Líquido',
    submitText:'Traspasar',
    bodyHTML: `
      <label class="field"><span>Destino</span>
        <select id="tr_dst">${arr.map(a=>`<option value="${a.id}">${a.name} (${a.currency||acc.currency})</option>`).join('')}</select>
      </label>
      <div class="row wrap">
        <label class="field grow"><span>Importe</span><input id="tr_amt" type="number" step="0.01"/></label>
        <label class="field"><span>Comisión</span><input id="tr_fee" type="number" step="0.01" value="0"/></label>
      </div>
    `,
    onSubmit: async()=>{
      const dstId = document.getElementById('tr_dst').value;
      const dst = arr.find(x=>x.id===dstId); if(!dst) return alert('Activo no encontrado');
      const amt = parseFloat(document.getElementById('tr_amt').value||'0')||0;
      const fee = parseFloat(document.getElementById('tr_fee').value||'0')||0;
      if(amt<=0) return;
      await Fin._fromLiquid(acc.id, amt, dst.currency||acc.currency, dst.id, fee);
      closeModal(); await Fin.renderAssets(); await Fin.refreshAccountHeader();
    }
  });
};

// FAB “＋” nuevo movimiento (modal rápido)
Fin.quickAddMovement = function(){
  const accOpts = Object.values(ACCOUNTS).map(a=>`<option value="${a.id}" data-ccy="${a.currency}">${a.name} (${a.currency})</option>`).join('');
  openModal({
    title:'Nuevo movimiento',
    submitText:'Guardar',
    bodyHTML: `
      <label class="field"><span>Cuenta</span>
        <select id="qm_acc">${accOpts}</select>
      </label>
      <div class="row wrap">
        <label class="field grow"><span>Tipo</span>
          <select id="qm_type">
            <option value="gasto">Gasto</option>
            <option value="ingreso">Ingreso</option>
            <option value="salario">Salario</option>
            <option value="inversion">Inversión</option>
            <option value="traspaso">Traspaso</option>
          </select>
        </label>
        <label class="field"><span>Categoría</span>
          <select id="qm_cat">
            <option>Comida</option><option>Transporte</option><option>Casa</option>
            <option>Ocio</option><option>Salud</option><option>Otros</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Fecha</span><input id="qm_date" type="date" value="${new Date().toISOString().slice(0,10)}"/></label>
      <div class="row wrap">
        <label class="field grow"><span>Importe</span><input id="qm_amount" type="number" step="0.01"/></label>
        <label class="field"><span>Moneda</span>
          <select id="qm_ccy"><option>EUR</option><option>USD</option><option>GBP</option></select>
        </label>
      </div>
      <label class="field"><span>Notas</span><input id="qm_note"/></label>
      <script>
        (function(){
          const sel = document.getElementById('qm_acc');
          const ccy = document.getElementById('qm_ccy');
          function sync(){ const opt = sel.options[sel.selectedIndex]; ccy.value = opt?.dataset?.ccy || 'EUR'; }
          sel.addEventListener('change', sync); sync();
        })();
      </script>
    `,
    onSubmit: async ()=>{
      const entry = {
        accountId: document.getElementById('qm_acc').value,
        type: document.getElementById('qm_type').value,
        category: document.getElementById('qm_cat').value,
        date: document.getElementById('qm_date').value,
        amount: parseFloat(document.getElementById('qm_amount').value||'0')||0,
        currency: document.getElementById('qm_ccy').value,
        note: document.getElementById('qm_note').value||'',
        ts: Date.now()
      };
      if(!entry.accountId) return alert('Selecciona una cuenta');

      const base = `finance/${UID}`; const eid = id();
      try{ await db.ref(`${base}/entries/${eid}`).set({...entry,id:eid}); }catch(e){}
      mirrorEntryLS({...entry,id:eid});

      closeModal();
      await loadEntries(true);
      await loadAssetsSummary(true); // por si afecta a cuenta inversión vía traspasos
      await recomputeDailyRange(entry.accountId, 60);
      Fin.refreshAll();
      if(ACC_CURRENT && ACC_CURRENT.id===entry.accountId) await Fin.openAccount(entry.accountId, true);
    }
  });
};
