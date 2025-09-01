// Finanzas con CUENTAS (normales / inversión), movimientos (crear/editar en MODAL único),
// traspasos entre cuentas, activos de inversión, traspasos desde líquido,
// moneda de visualización con conversión básica, carga lazy de movimientos,
// patrimonio correcto (suma de balances por cuenta), y edición de cuentas.
//
// Todo unificado y sin editores "abajo": TODOS los botones abren el MISMO modal bonito.

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
let ASSET_SUMS = {};          // { [accountId]: sumaInvertidaEnMonedaDeLaCuenta }

const LS_KEY_FIN = ()=>`finance_${UID}`;
const FX = { // tasas simple editables
  EUR:{EUR:1, USD:1.1, GBP:0.85},
  USD:{EUR:0.91, USD:1, GBP:0.77},
  GBP:{EUR:1.18, USD:1.3, GBP:1}
};

let ANALYTICS_ACC = ''; // '' = todas

function populateAnalyticsAccounts(){
  const sel = document.getElementById('aAcc'); if(!sel) return;
  const keep = sel.value || ANALYTICS_ACC || '';
  sel.innerHTML = '<option value="">Todas las cuentas</option>';
  Object.values(ACCOUNTS).forEach(a=>{
    const o = document.createElement('option');
    o.value = a.id; o.textContent = a.name;
    sel.appendChild(o);
  });
  sel.value = keep;
  ANALYTICS_ACC = sel.value; // sincroniza
}

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
    accountName(e.destAccountId) || '',
    String(e.amount||'')
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
}

// Calcula balance por día para una cuenta (en MONEDA DE LA CUENTA)
function computeDailyBalanceForAccount(acc, dayKey){
  const accCcy = acc.currency || 'EUR';

  if(acc.type==='normal'){
    let bal = acc.initBalance || 0;
    Object.values(ENTRIES).forEach(e=>{
      if(e.date>dayKey) return;
      const vAcc = fx(e.amount||0, e.currency||'EUR', accCcy);
      if(e.type==='gasto' && e.accountId===acc.id) bal -= vAcc;
      if(['ingreso','salario','inversion'].includes(e.type) && e.accountId===acc.id) bal += vAcc;
      // traspaso entre cuentas
      if(e.type==='traspaso'){
        if(e.accountId===acc.id) bal -= vAcc;               // sale de origen
        if(e.destAccountId===acc.id) bal += vAcc;           // entra a destino
      }
    });
    return +bal.toFixed(2);
  }

  // inversión
  const liquidInit = (acc.liquidInit!=null)? acc.liquidInit : (acc.liquid||0);
  let liquid = liquidInit;
  let investedAcc = 0;

  Object.values(ENTRIES).forEach(e=>{
    if(e.date>dayKey) return;
    const amtAcc = fx(e.amount||0, e.currency||accCcy, accCcy);

    if(e.type==='traspaso'){
      const isToAsset   = /A activo/i.test(e.note||'');
      const isFromAsset = /Desde activo/i.test(e.note||'');
      const fee = (()=>{ const m=(e.note||'').match(/fee\s+([\d.]+)/i); return m?parseFloat(m[1]||'0')||0:0; })();
      const feeAcc = fx(fee, e.currency||accCcy, accCcy);

      if(isToAsset && e.accountId===acc.id){ liquid -= amtAcc; investedAcc += (amtAcc - feeAcc); return; }
      if(isFromAsset && e.accountId===acc.id){ liquid += amtAcc; investedAcc -= amtAcc; return; }

      // traspaso entre cuentas (afecta a líquido)
      if(e.accountId===acc.id){ liquid -= amtAcc; }
      if(e.destAccountId===acc.id){ liquid += amtAcc; }
    }else{
      // ingresos/gastos aplicados al líquido
      if(e.accountId===acc.id){
        if(e.type==='gasto') liquid -= amtAcc;
        if(['ingreso','salario','inversion'].includes(e.type)) liquid += amtAcc;
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
function openModal({title, bodyHTML, submitText='Aceptar', onSubmit, onOpen}){
  document.getElementById('modalTitle').textContent = title;
  const body = document.getElementById('modalBody');
  body.innerHTML = bodyHTML;

  const btn = document.getElementById('modalPrimary');
  btn.textContent = submitText;
  btn.onclick = async ()=>{ if(onSubmit) await onSubmit(); };

  requestAnimationFrame(()=>{ if(typeof onOpen==='function') onOpen(); });

  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalBackdrop').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modalBackdrop').classList.add('hidden');
}

// ====== UI MOVIMIENTO: MODAL ÚNICO (crear/editar) ======
function movementModalHTML(entry={}, mode='create'){
  const today = new Date().toISOString().slice(0,10);
  const isTransfer = entry.type==='traspaso';
  return `
    <label class="field"><span>Cuenta (origen)</span>
      <select id="mv_acc"></select>
    </label>

    <div class="row wrap">
      <label class="field grow"><span>Tipo</span>
        <select id="mv_type">
          <option value="gasto">Gasto</option>
          <option value="ingreso">Ingreso</option>
          <option value="salario">Salario</option>
          <option value="inversion">Inversión</option>
          <option value="traspaso">Traspaso</option>
        </select>
      </label>
      <label class="field"><span>Categoría</span>
        <select id="mv_cat">
          <option>Comida</option><option>Capricho</option><option>Casa</option>
          <option>Ocio</option><option>Util</option><option>Otros</option>
        </select>
      </label>
    </div>

    <div id="mv_dest_wrap" class="${isTransfer?'':'hidden'}">
      <label class="field"><span>Cuenta destino</span>
        <select id="mv_dest"></select>
      </label>
    </div>

    <label class="field"><span>Fecha</span><input id="mv_date" type="date" value="${entry.date||today}"/></label>
    <div class="row wrap">
      <label class="field grow"><span>Importe</span><input id="mv_amount" type="number" step="0.01" value="${entry.amount??''}"/></label>
      <label class="field"><span>Moneda</span>
        <select id="mv_ccy"><option>EUR</option><option>USD</option><option>GBP</option></select>
      </label>
    </div>
    <label class="field"><span>Notas</span><input id="mv_note" value="${(entry.note||'').replace(/"/g,'&quot;')}"/></label>

    ${mode==='edit' ? `
      <div class="row" style="margin-top:6px">
        <button class="pill danger" id="mv_delete">Borrar</button>
        <div class="grow"></div>
      </div>
    `:''}
  `;
}
function openMovementModal({mode='create', entry={}, forceAccountId}={}){
  openModal({
    title: mode==='edit' ? 'Editar movimiento' : 'Nuevo movimiento',
    submitText: mode==='edit' ? 'Guardar cambios' : 'Guardar',
    bodyHTML: movementModalHTML(entry, mode),
    onOpen: ()=>{
      // Rellenar selects
      fillAccountsSelect('mv_acc', forceAccountId || entry.accountId);
      fillAccountsSelect('mv_dest', entry.destAccountId);

      const destSel  = document.getElementById('mv_dest');
      const originSel= document.getElementById('mv_acc');
      const typeSel  = document.getElementById('mv_type');
      const destWrap = document.getElementById('mv_dest_wrap');

      // quitar "— Selecciona —" en destino
      destSel.querySelector('option[value=""]')?.remove();

      function syncCcy(){
        const acc = ACCOUNTS[originSel.value];
        document.getElementById('mv_ccy').value = entry.currency || acc?.currency || 'EUR';
      }
      function toggleDest(){
        const isTransfer = typeSel.value==='traspaso';
        destWrap.classList.toggle('hidden', !isTransfer);
        if(isTransfer){
          [...destSel.options].forEach(o => o.disabled = (o.value===originSel.value));
          if(destSel.value===originSel.value){
            const first = [...destSel.options].find(o=>!o.disabled);
            destSel.value = first ? first.value : '';
          }
        }
      }

      // Set valores
      document.getElementById('mv_type').value = entry.type || 'gasto';
      document.getElementById('mv_cat').value  = entry.category || 'Otros';
      document.getElementById('mv_ccy').value  = entry.currency || 'EUR';
      syncCcy(); toggleDest();

      originSel.addEventListener('change', ()=>{ syncCcy(); toggleDest(); });
      typeSel.addEventListener('change', toggleDest);

      // Borrado (solo en edición)
      if(mode==='edit'){
        document.getElementById('mv_delete').onclick = async ()=>{
          if(!confirm('¿Borrar movimiento?')) return;
          try{
            await db.ref(`finance/${UID}/entries/${entry.id}`).remove();
            const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); delete store.entries[entry.id]; lsSet(LS_KEY_FIN(), store);

            closeModal();
            await loadEntries(true);
            await loadAssetsSummary(true);
            await recomputeDailyRange(entry.accountId, 60);
            if(entry.destAccountId) await recomputeDailyRange(entry.destAccountId, 60);
            await loadAccounts(true);
            Fin.refreshAll();

            // refrescos inmediatos en vistas activas
            if (document.getElementById('tab-entries')?.classList.contains('active')) {
              Fin.renderEntries();
            }
            if (ACC_CURRENT && (ACC_CURRENT.id===entry.accountId || ACC_CURRENT.id===entry.destAccountId)) {
              Fin.openAccount(ACC_CURRENT.id, true);
            }
          }catch(e){
            alert('Error al borrar');
          }
        };
      }
    },
    onSubmit: async ()=>{
      const data = {
        accountId: document.getElementById('mv_acc').value,
        type:      document.getElementById('mv_type').value,
        category:  document.getElementById('mv_cat').value,
        date:      document.getElementById('mv_date').value || ymd(),
        amount:    parseFloat(document.getElementById('mv_amount').value||'0')||0,
        currency:  document.getElementById('mv_ccy').value,
        note:      document.getElementById('mv_note').value||'',
        ts:        mode==='edit' ? (entry.ts||Date.now()) : Date.now()
      };
      if(!data.accountId) return alert('Selecciona cuenta origen');

      if(data.type==='traspaso'){
        data.destAccountId = document.getElementById('mv_dest').value || '';
        if(!data.destAccountId) return alert('Selecciona cuenta destino');
        if(data.destAccountId === data.accountId) return alert('Origen y destino no pueden coincidir');
      }else{
        delete data.destAccountId;
      }

      const base = `finance/${UID}`;
      const eid = mode==='edit' ? entry.id : id();
      try{
        if(mode==='edit'){ await db.ref(`${base}/entries/${eid}`).update(data); }
        else{ await db.ref(`${base}/entries/${eid}`).set({...data,id:eid}); }
        mirrorEntryLS({...data,id:eid});
      }catch(e){ /* espejo LS ya escrito */ }

      closeModal();
      await loadEntries(true);
      await loadAssetsSummary(true);
      await recomputeDailyRange(data.accountId, 60);
      if(data.destAccountId) await recomputeDailyRange(data.destAccountId, 60);
      await loadAccounts(true);
      Fin.refreshAll();

      // refrescos inmediatos en vistas activas
      if (document.getElementById('tab-entries')?.classList.contains('active')) {
        Fin.renderEntries();
      }
      if (ACC_CURRENT && (ACC_CURRENT.id===data.accountId || ACC_CURRENT.id===data.destAccountId)) {
        Fin.openAccount(ACC_CURRENT.id, true);
      }
    }
  });
}


// ====== FIN API ======
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
  showAddAccount: async function(){
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
      `,
      onOpen: ()=>{
        const sel = document.getElementById('acc_type');
        const normal = document.getElementById('acc_block_normal');
        const inv = document.getElementById('acc_block_inv');
        function toggle(){ const isInv = sel.value==='inversion'; normal.classList.toggle('hidden', isInv); inv.classList.toggle('hidden', !isInv); }
        sel.addEventListener('change', toggle); toggle();
      },
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
        closeModal(); await loadAccounts(true); await recomputeDailyRange(idA, 7); Fin.refreshAll();
      }
    });
  },

  editAccount: async function(id){
    const acc = ACCOUNTS[id]; if(!acc) return;
    openModal({
      title:'Editar cuenta',
      submitText:'Guardar',
      bodyHTML: `
        <label class="field"><span>Nombre</span><input id="ea_name" value="${acc.name.replace(/"/g,'&quot;')}"/></label>
        <div class="row wrap">
          <label class="field grow"><span>Color</span><input id="ea_color" type="color" value="${acc.color||'#3a86ff'}"/></label>
          <label class="field"><span>Moneda</span>
            <select id="ea_ccy"><option ${acc.currency==='EUR'?'selected':''}>EUR</option><option ${acc.currency==='USD'?'selected':''}>USD</option><option ${acc.currency==='GBP'?'selected':''}>GBP</option></select>
          </label>
        </div>
        ${acc.type==='normal' ? `
          <label class="field"><span>Saldo inicial</span><input id="ea_init" type="number" step="0.01" value="${acc.initBalance||0}"/></label>
        `:`
          <label class="field"><span>Líquido</span><input id="ea_liq" type="number" step="0.01" value="${acc.liquid||acc.liquidInit||0}"/></label>
        `}
      `,
      onSubmit: async ()=>{
        const name = document.getElementById('ea_name').value.trim() || acc.name;
        const color= document.getElementById('ea_color').value || acc.color;
        const ccy  = document.getElementById('ea_ccy').value || acc.currency;
        const patch = { name, color, currency: ccy };
        if(acc.type==='normal'){
          const init = parseFloat(document.getElementById('ea_init').value||'0')||0;
          patch.initBalance = init; patch.balance = init; // balance base
        }else{
          const liq = parseFloat(document.getElementById('ea_liq').value||'0')||0;
          patch.liquid = liq; if(acc.liquidInit==null) patch.liquidInit = liq;
        }
        try{ await db.ref(`finance/${UID}/accounts/${id}`).update(patch); }catch(e){}
        ACCOUNTS[id] = {...acc, ...patch};
        const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); store.accounts[id] = ACCOUNTS[id]; lsSet(LS_KEY_FIN(), store);
        closeModal();
        await recomputeDailyRange(id, 90);
        Fin.refreshAll();
        if(ACC_CURRENT?.id===id) await Fin.openAccount(id, true);
      }
    });
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

    await Fin.refreshAccountHeader();

    if(acc.type==='inversion'){
      await Fin.renderAssets();
    }else{
      ACC_MOV_OLDEST_TS = null;
      document.getElementById('accMovs').innerHTML='';
      await Fin.loadMoreAccountMovs();
    }

    if(!keepView){
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
      const card = document.createElement('div'); card.className='card compact';
      const dest = e.destAccountId ? `<div class="chip arrow">→ ${accountName(e.destAccountId)}</div>` : '';
      card.innerHTML = `
        <div class="row tight">
          <div class="chip date">${e.date}</div>
          <div class="chip">${e.type}</div>
          ${e.category?`<div class="chip">${e.category}</div>`:''}
          ${dest}
          <div class="grow"></div>
          <div class="chip amt ${e.type==='gasto'?'neg':'pos'}">${euroLike(fx(e.amount, e.currency||'EUR', DISPLAY_CCY), DISPLAY_CCY)}</div>
        </div>
        ${e.note?`<div class="muted small">${e.note}</div>`:''}
        <div class="row"><button class="pill xs" onclick='Fin.openEdit("${e.id}")'>Editar</button></div>
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

  // líquido -> activo
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

  // activo -> líquido
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

  // ---------- Movimientos (SIEMPRE modal) ----------
  showAdd(forceAccountId){ openMovementModal({mode:'create', entry:{}, forceAccountId}); },
  openEdit(id){
    const e = ENTRIES[id]; if(!e) return;
    EDIT_ID = id; EDIT_OBJ = e;
    openMovementModal({mode:'edit', entry:e});
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
      const empty=document.createElement('div'); empty.className='card compact';
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
      if(['ingreso','salario','inversion'].includes(e.type)) groups[ym].inc += v;
    });

    Object.keys(groups).sort().reverse().forEach(ym=>{
      const g = groups[ym];
      const header=document.createElement('div'); header.className='card compact';
      const monthLabel = monthHuman(ym);
      const net = g.inc - g.exp;
      header.innerHTML = `
        <div class="row">
          <div class="chip">${monthLabel}</div>
          <div class="grow"></div>
          <div class="chip info">Ingresos: ${euroLike(g.inc)}</div>
          <div class="chip warn">Gastos: ${euroLike(g.exp)}</div>
          <div class="chip ${net>=0?'ok':'bad'}">Saldo: ${euroLike(net)}</div>
        </div>
      `;
      wrap.appendChild(header);

      g.items.forEach(e=>{
        const card=document.createElement('div'); card.className='card compact';
        const dest = e.destAccountId ? `<div class="chip arrow">→ ${accountName(e.destAccountId)}</div>` : '';
        card.innerHTML = `
          <div class="row tight">
            <div class="chip date">${e.date}</div>
            <div class="chip">${ accountName(e.accountId) }</div>
            <div class="chip">${e.type}</div>
            ${e.category?`<div class="chip">${e.category}</div>`:''}
            ${dest}
            <div class="grow"></div>
            <div class="chip amt ${e.type==='gasto'?'neg':'pos'}">
              ${euroLike(fx(e.amount, e.currency||'EUR', DISPLAY_CCY))}
            </div>
          </div>
          ${e.note?`<p class="muted small">${e.note}</p>`:''}
          <div class="row"><button class="pill xs" onclick='Fin.openEdit("${e.id}")'>Editar</button></div>
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
  populateAnalyticsAccounts();   // ← NUEVO
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
  },

  // Proxy para el FAB y el botón de la lista
  quickAddMovement(){ Fin.showAdd(); }
};

// ---------- Helpers de DOM/estado ----------
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }
function val(id){ return document.getElementById(id)?.value || ''; }
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
  const accCcy = acc.currency || 'EUR';

  if(acc.type==='normal'){
    let bal = acc.initBalance||0;
    Object.values(ENTRIES).forEach(e=>{
      const v = fx(e.amount, e.currency||'EUR', accCcy);
      if(e.accountId===acc.id){
        if(e.type==='gasto') bal -= v;
        if(['ingreso','salario','inversion'].includes(e.type)) bal += v;
        if(e.type==='traspaso') bal -= v; // sale
      }
      if(e.destAccountId===acc.id && e.type==='traspaso'){
        bal += v; // entra
      }
    });
    return { balanceNow: fx(bal, accCcy, DISPLAY_CCY), liquidNow: undefined };
  }

  // inversión: líquido + invertido (sin valoración)
  let liquid = acc.liquid || 0;
  Object.values(ENTRIES).forEach(e=>{
    const v = fx(e.amount, e.currency||accCcy, accCcy);
    if(e.type==='traspaso'){
      const isToAsset=/A activo/i.test(e.note||''); const isFromAsset=/Desde activo/i.test(e.note||'');
      if(e.accountId===acc.id && isToAsset) liquid -= v;
      else if(e.accountId===acc.id && isFromAsset) liquid += v;
      // cuenta↔cuenta
      else if(e.accountId===acc.id) liquid -= v;
      else if(e.destAccountId===acc.id) liquid += v;
    }else if(e.accountId===acc.id){
      if(e.type==='gasto') liquid -= v;
      if(['ingreso','salario','inversion'].includes(e.type)) liquid += v;
    }
  });

  const investedSum = ASSET_SUMS[acc.id] || 0;
  const balInv = liquid + investedSum;
  return { balanceNow: fx(balInv, accCcy, DISPLAY_CCY), liquidNow: liquid };
}

async function computeDeltaVsPrevMonth(acc, balanceNow){
  const prevEnd = endOfPrevMonth();
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

  const to = new Date(); const from = new Date(); from.setDate(to.getDate()-89);
  const labels=[], data=[]; let acc=0;

  const map={};
  Object.values(ENTRIES).forEach(e=>{
    if(e.accountId!==accId) return;
    const d=new Date(e.date); if(d<from||d>to) return;
    const k=e.date; const v = fx(e.amount, e.currency||'EUR', accCcy||'EUR');
    map[k]=(map[k]||0) + (e.type==='gasto' ? -v : v);
  });

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
// Patrimonio correcto (suma de cuentas por día)
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
  const accFilter = ANALYTICS_ACC; // '' = todas

  let inc=0, exp=0;
  const catMap = {};

  Object.values(ENTRIES).forEach(e=>{
    const d=new Date(e.date);
    if(d<from||d>to) return;
    if(accFilter && e.accountId!==accFilter) return;
    const v = fx(e.amount, e.currency||'EUR', DISPLAY_CCY);
    if(['ingreso','salario','inversion'].includes(e.type)) inc+=v;
    else if(e.type==='gasto'){ exp+=v; catMap[e.category]=(catMap[e.category]||0)+v; }
  });

  const title = accFilter ? `(${accountName(accFilter)})` : '(Todas)';

  charts.incExp = new Chart(ctx1,{
    type:'bar',
    data:{ labels:['Ingresos','Gastos'], datasets:[{data:[inc,exp]}] },
    options:{ responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}, title:{display:true, text:`Ingresos vs Gastos ${title}`}} }
  });
  charts.cat = new Chart(ctx2,{
    type:'pie',
    data:{ labels:Object.keys(catMap), datasets:[{data:Object.values(catMap)}] },
    options:{ responsive:true, plugins:{ title:{display:true, text:`Gasto por categoría ${title}`} } }
  });
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
async function loadAccounts(preferRTDB=true){
  try{
    let obj=null;
    if(preferRTDB){
      const snap = await db.ref(`finance/${UID}/accounts`).once('value');
      if(snap.exists()) obj = snap.val();
    }
    if(!obj){ obj = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}).accounts; }
    else{
      const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); store.accounts=obj; lsSet(LS_KEY_FIN(), store);
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
    const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}, asset_sums:{}}); store.asset_sums = sums; lsSet(LS_KEY_FIN(), store);
  }catch(e){
    ASSET_SUMS = lsGet(LS_KEY_FIN(), {asset_sums:{}}).asset_sums || {};
  }
}
function mirrorEntryLS(entry){
  const store = lsGet(LS_KEY_FIN(), {entries:{}, accounts:{}}); store.entries[entry.id]=entry; lsSet(LS_KEY_FIN(), store);
}

// ---------- UI cuentas ----------
async function renderAccounts(){
  const wrap = document.getElementById('accountsList'); if(!wrap) return;
  wrap.innerHTML='';

  const arr = Object.values(ACCOUNTS).sort((a,b)=>a.createdAt-b.createdAt);

  // precalcular balances y deltas
  const cards = await Promise.all(arr.map(async a=>{
    const { balanceNow } = computeAccountBalances(a);
    const delta = await computeDeltaVsPrevMonth(a, balanceNow);
    const up = delta>=0;
    const arrow = up ? '▲' : '▼';
    const typeLabel = (a.type==='inversion'?'Inversión':'Normal');

    const card = document.createElement('div');
    card.className='account-card';
    card.style.borderColor = (a.color||'#1a2230') + '44';

    card.innerHTML = `
      <div class="account-head">
        <div class="account-swatch" style="background:${a.color||'#3a86ff'}"></div>
        <div class="account-name">${a.name}</div>
        <div class="account-meta">
          <div class="account-type">${typeLabel}</div>
          <div class="account-ccy">${a.currency||'EUR'}</div>
          <div class="account-delta ${up?'up':'down'}">${arrow} ${Math.abs(delta).toFixed(1)}%</div>
        </div>
      </div>

      <div class="account-balance">${euroLike(balanceNow)}</div>

      <div class="account-actions">
        <button class="pill ghost sm" data-edit="${a.id}">Editar</button>
        <button class="pill sm" data-open="${a.id}">Abrir</button>
      </div>
    `;

    card.querySelector('[data-open]').addEventListener('click', ()=>Fin.openAccount(a.id));
    card.querySelector('[data-edit]').addEventListener('click', ()=>Fin.editAccount(a.id));

    return card;
  }));

  cards.forEach(c=>wrap.appendChild(c));
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
document.addEventListener('DOMContentLoaded', async ()=>{
  await Promise.all([loadAccounts(true), loadEntries(true)]);
  await loadAssetsSummary(true);
  for(const acc of Object.values(ACCOUNTS)){ await recomputeDailyRange(acc.id, 7); }
  Fin.refreshAll();
});
window.Fin = Fin;

// ---------- Utils menores ----------
function monthHuman(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('es-ES',{ month:'long', year:'numeric' }); }
