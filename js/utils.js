function ymd(d=new Date()){ const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function prettyDuration(sec){ const h=(sec/3600)|0,m=((sec%3600)/60)|0,s=sec%60; const z=n=>String(n).padStart(2,'0'); return h>0?`${h}:${z(m)}:${z(s)}`:`${z(m)}:${z(s)}`; }
function euro(n){ return (n||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'}); }
function id(){ return Math.random().toString(36).slice(2); }
function secsPretty(s){ const h=(s/3600)|0; return `${h}h ${((s%3600)/60)|0}m`; }

// ===== Fallback localStorage =====
function lsGet(key, def){ try{ const v = localStorage.getItem(key); return v? JSON.parse(v) : (def??null);}catch{ return def??null; } }
function lsSet(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){} }
