/* ====================================================================
   FAKEBASE — a Firestore and an Auth that actually store things
   ====================================================================

   `A7` on the backlog since Game Night #5: **the gate stubs Firebase.**
   Every one of the four-hundred-odd checks has run against a `window.SB`
   replaced by hand, which means the code that has caused every single
   scoring failure this product has ever had — join, submit, the outbox,
   the score push, the grader — has never once been executed by a test.
   We have been testing the app around the exact hole the bugs live in.

   The proper fix is the Firebase emulator. It cannot run here: the
   emulator downloads its jar from storage.googleapis.com at first start
   and that host is not reachable from this container. So this is the
   next best thing, and in one respect it is better.

   HOW IT WORKS, AND WHY IT NEEDS NO CHANGES TO THE APP.

   The app already reads its SDK location from `window.STATS_SDK_BASE`
   and boots with three dynamic imports:

       await import(SDK + '/firebase-app.js')
       await import(SDK + '/firebase-auth.js')
       await import(SDK + '/firebase-firestore.js')

   So the harness points that base at a hostname that does not exist,
   intercepts the request, and serves THESE modules instead. The app does
   not know and must not know. Every line of SB — the budget lanes, the
   outbox, the retry, the uid re-read, the join guard — runs exactly as it
   runs in production, against a store that really stores.

   WHERE IT IS BETTER THAN THE EMULATOR: it can lie on demand. A real
   backend will not let you say "fail the next three writes and then
   recover", and that is precisely the behaviour that lost a player his
   night. `__FB.failWrites(n)` does it in one line.

   WHERE IT IS WORSE, AND THIS IS NOT A SMALL CAVEAT: it does not run
   security rules, and it does not have Firestore's real consistency
   model. A rules bug will still reach production. Keep `A7` open for the
   emulator; this closes the larger half of it, not all of it.
   ==================================================================== */

const STORE = `
/* ---- the store, shared by all three modules ---------------------- */
const __store = (window.__FB = window.__FB || (function(){
  const docs = new Map();          // 'a/b/c' -> plain object
  const subs = [];                 // live listeners
  const log  = [];                 // every operation, in order
  let   fail = { reads:0, writes:0, all:false, why:'unavailable' };
  let   delay = 0;
  let   seq = 0;

  function now(){
    /* Deliberately monotonic rather than wall-clock: two writes in the
       same millisecond must still order, or a test that depends on
       "the later one wins" passes or fails by luck. */
    seq++;
    const ms = 1700000000000 + seq;
    return { seconds: Math.floor(ms/1000), nanoseconds: (ms%1000)*1e6,
             toMillis(){ return ms; }, toDate(){ return new Date(ms); },
             isEqual(o){ return !!o && o.toMillis && o.toMillis()===ms; } };
  }
  function err(code){
    const e = new Error('fakebase: ' + code);
    e.code = code; e.name = 'FirebaseError';
    return e;
  }
  async function gate(kind){
    if(delay) await new Promise(r=>setTimeout(r, delay));
    if(fail.all) throw err(fail.why);
    if(kind==='read'  && fail.reads  > 0){ fail.reads--;  throw err(fail.why); }
    if(kind==='write' && fail.writes > 0){ fail.writes--; throw err(fail.why); }
  }
  function clone(v){
    if(v===null || typeof v!=='object') return v;
    if(Array.isArray(v)) return v.map(clone);
    if(typeof v.toMillis==='function') return v;          // Timestamp: keep identity
    const o={}; for(const k in v) o[k]=clone(v[k]); return o;
  }
  function fire(path){
    subs.slice().forEach(s=>{ try{ if(s.match(path)) s.emit(); }catch(_){ } });
  }
  return {
    docs, subs, log, now, err, gate, clone, fire,
    get delay(){ return delay; }, set delay(v){ delay=v; },
    get fail(){ return fail; },
    /* the whole point of a fake: make it lie, on purpose, on demand */
    failWrites(n){ fail.writes = n; },
    failReads(n){  fail.reads  = n; },
    offline(on, why){ fail.all = !!on; if(why) fail.why = why; },
    reset(){ docs.clear(); subs.length=0; log.length=0;
             fail={reads:0,writes:0,all:false,why:'unavailable'}; delay=0; },
    dump(prefix){ const o={}; docs.forEach((v,k)=>{ if(!prefix||k.indexOf(prefix)===0) o[k]=v; }); return o; },
    wrote(prefix){ return log.filter(x=>x.op==='set'&&x.path.indexOf(prefix)===0); }
  };
})());
`;

const FIRESTORE = STORE + `
const DELETE = { __del:true };
const STAMP  = { __stamp:true };

export function getFirestore(app){ return { __db:true, app:app||null }; }
export function connectFirestoreEmulator(){ /* already local */ }

function join(parts){
  return parts.map(p=>String(p)).join('/').replace(/\\/+/g,'/').replace(/^\\/|\\/$/g,'');
}
export function doc(a, ...rest){
  if(a && a.__coll) return { __doc:true, path: join([a.path, rest[0] || ('auto'+Math.abs(__store.now().toMillis()))]), id: rest[0]||'auto' };
  const path = join(rest);
  const bits = path.split('/');
  return { __doc:true, path, id: bits[bits.length-1] };
}
export function collection(a, ...rest){
  const path = a && a.__doc ? join([a.path].concat(rest)) : join(rest);
  return { __coll:true, path };
}
export function serverTimestamp(){ return STAMP; }
export function deleteField(){ return DELETE; }
export function increment(n){ return { __inc:n }; }

export function where(field, op, value){ return { __c:'where', field, op, value }; }
export function orderBy(field, dir){ return { __c:'order', field, dir: dir||'asc' }; }
export function limit(n){ return { __c:'limit', n }; }
export function query(coll, ...cs){ return { __q:true, path: coll.path, cs: cs.filter(Boolean) }; }

function resolveWrites(prev, next){
  const out = Object.assign({}, prev||{});
  for(const k in next){
    const v = next[k];
    if(v === DELETE || (v && v.__del)) { delete out[k]; continue; }
    if(v === STAMP  || (v && v.__stamp)) { out[k] = __store.now(); continue; }
    if(v && v.__inc !== undefined) { out[k] = (Number(out[k])||0) + Number(v.__inc); continue; }
    out[k] = __store.clone(v);
  }
  return out;
}

export async function setDoc(ref, data, opts){
  await __store.gate('write');
  const merge = !!(opts && opts.merge);
  const prev  = merge ? (__store.docs.get(ref.path) || {}) : {};
  const next  = resolveWrites(prev, data || {});
  __store.docs.set(ref.path, next);
  __store.log.push({ op:'set', path:ref.path, merge, keys:Object.keys(data||{}) });
  __store.fire(ref.path);
  return undefined;
}
export async function addDoc(coll, data){
  const id = 'a' + String(__store.now().toMillis());
  const ref = { __doc:true, path: coll.path + '/' + id, id };
  await setDoc(ref, data, {});
  return ref;
}
export async function deleteDoc(ref){
  await __store.gate('write');
  __store.docs.delete(ref.path);
  __store.log.push({ op:'del', path:ref.path });
  __store.fire(ref.path);
}
function snap(path){
  const d = __store.docs.get(path);
  const bits = path.split('/');
  return { id: bits[bits.length-1], ref:{ path },
           exists(){ return d !== undefined; },
           data(){ return d === undefined ? undefined : __store.clone(d); },
           get(f){ return d ? d[f] : undefined; } };
}
export async function getDoc(ref){
  await __store.gate('read');
  __store.log.push({ op:'get', path:ref.path });
  return snap(ref.path);
}
function childrenOf(path){
  const out = [];
  const want = path.split('/').length + 1;
  __store.docs.forEach((v,k)=>{
    if(k.indexOf(path + '/') !== 0) return;
    if(k.split('/').length !== want) return;      // direct children only
    out.push(k);
  });
  return out;
}
function applyConstraints(paths, cs){
  let rows = paths.map(p=>({ p, d: __store.docs.get(p) || {} }));
  (cs||[]).filter(c=>c.__c==='where').forEach(c=>{
    rows = rows.filter(r=>{
      const v = r.d[c.field];
      switch(c.op){
        case '==': return v === c.value;
        case '!=': return v !== c.value;
        case '>':  return v >  c.value;
        case '>=': return v >= c.value;
        case '<':  return v <  c.value;
        case '<=': return v <= c.value;
        case 'in': return Array.isArray(c.value) && c.value.indexOf(v) >= 0;
        default:   return true;
      }
    });
  });
  const ord = (cs||[]).filter(c=>c.__c==='order');
  ord.forEach(c=>{
    rows.sort((a,b)=>{
      const x=a.d[c.field], y=b.d[c.field];
      const nx = (x && x.toMillis) ? x.toMillis() : x;
      const ny = (y && y.toMillis) ? y.toMillis() : y;
      if(nx===ny) return 0;
      const r = (nx>ny) ? 1 : -1;
      return c.dir==='desc' ? -r : r;
    });
  });
  const lim = (cs||[]).find(c=>c.__c==='limit');
  if(lim) rows = rows.slice(0, lim.n);
  return rows.map(r=>r.p);
}
function runQuery(qOrColl){
  const path = qOrColl.path;
  const cs   = qOrColl.cs || [];
  return applyConstraints(childrenOf(path), cs);
}
export async function getDocs(qOrColl){
  await __store.gate('read');
  const paths = runQuery(qOrColl);
  __store.log.push({ op:'gets', path:qOrColl.path, n:paths.length });
  const docs = paths.map(snap);
  return { size: docs.length, empty: docs.length===0, docs,
           forEach(f){ docs.forEach(f); } };
}
export async function getCountFromServer(qOrColl){
  await __store.gate('read');
  const n = runQuery(qOrColl).length;
  __store.log.push({ op:'count', path:qOrColl.path, n });
  return { data(){ return { count:n }; } };
}
export function onSnapshot(target, cb, errCb){
  const isDoc = !!target.__doc;
  const path  = target.path;
  const emit = () => {
    try{
      if(__store.fail.all){ if(errCb) errCb(__store.err(__store.fail.why)); return; }
      if(isDoc) cb(snap(path));
      else {
        const paths = runQuery(target);
        const docs = paths.map(snap);
        cb({ size:docs.length, empty:docs.length===0, docs, forEach(f){ docs.forEach(f); } });
      }
    }catch(e){ if(errCb) errCb(e); }
  };
  const rec = {
    match(p){ return isDoc ? (p === path) : (p.indexOf(path + '/') === 0); },
    emit
  };
  __store.subs.push(rec);
  __store.log.push({ op:'listen', path });
  setTimeout(emit, 0);
  return function unsubscribe(){
    const i = __store.subs.indexOf(rec);
    if(i>=0) __store.subs.splice(i,1);
    __store.log.push({ op:'unlisten', path });
  };
}
export const Timestamp = { now(){ return __store.now(); },
  fromMillis(ms){ return { seconds:Math.floor(ms/1000), nanoseconds:0,
    toMillis(){ return ms; }, toDate(){ return new Date(ms); } }; } };
export function writeBatch(){
  const ops=[];
  return { set(r,d,o){ ops.push(()=>setDoc(r,d,o)); return this; },
           delete(r){ ops.push(()=>deleteDoc(r)); return this; },
           async commit(){ for(const f of ops) await f(); } };
}
export async function runTransaction(db, fn){
  return fn({ async get(r){ return getDoc(r); },
              set(r,d,o){ return setDoc(r,d,o); },
              delete(r){ return deleteDoc(r); } });
}
`;

const AUTH = STORE + `
/* One auth object per app, so the Control Room's named app really is a
   different session from the player's — the exact separation that fixed
   the Game Night #1 uid collision. A fake that shared them would hide
   the bug it was written to catch. */
const SESSIONS = (window.__FBAUTH = window.__FBAUTH || {});

function mkUser(o){
  return Object.assign({ uid:'anon-1', email:'', emailVerified:false, isAnonymous:true,
                         displayName:null, async getIdToken(){ return 'fake-token'; } }, o||{});
}
export function getAuth(app){
  const key = (app && app.name) || '[DEFAULT]';
  if(!SESSIONS[key]){
    SESSIONS[key] = { name:key, currentUser:null, _cbs:[],
      _set(u){ this.currentUser = u; this._cbs.slice().forEach(f=>{ try{ f(u); }catch(_){ } }); } };
  }
  return SESSIONS[key];
}
export function connectAuthEmulator(){ /* already local */ }
export function onAuthStateChanged(auth, cb){
  auth._cbs.push(cb);
  /* Async, exactly like the real one. The app WAITS for this first call
     before deciding whether anybody is signed in — firing it
     synchronously would paper over the persistence race that orphaned a
     player's account on Game Night #1. */
  setTimeout(()=>{ try{ cb(auth.currentUser); }catch(_){ } }, 0);
  return function(){ const i=auth._cbs.indexOf(cb); if(i>=0) auth._cbs.splice(i,1); };
}
let anonN = 0;
export async function signInAnonymously(auth){
  if(window.__FB.fail.all) throw window.__FB.err(window.__FB.fail.why);
  anonN++;
  const u = mkUser({ uid: (window.__FBUID || ('anon-'+anonN)) });
  auth._set(u);
  return { user:u };
}
export async function signOut(auth){ auth._set(null); }
export function GoogleAuthProvider(){ this.__p='google'; }
GoogleAuthProvider.credential = function(){ return { __cred:'google' }; };
export async function signInWithPopup(auth){
  if(window.__FB.fail.all) throw window.__FB.err('auth/network-request-failed');
  const u = mkUser({ uid: window.__FBUID || 'google-1', email:'qa@statsgametime.com',
                     emailVerified:true, isAnonymous:false, displayName:'QA' });
  auth._set(u); return { user:u };
}
export async function signInWithCredential(auth){ return signInWithPopup(auth); }
export async function linkWithPopup(user){ return { user: mkUser({ uid:user&&user.uid, isAnonymous:false, emailVerified:true, email:'qa@statsgametime.com' }) }; }
export async function linkWithCredential(user){ return { user: mkUser({ uid:user&&user.uid, isAnonymous:false, emailVerified:true, email:'qa@statsgametime.com' }) }; }
export function isSignInWithEmailLink(){ return false; }
export async function signInWithEmailLink(auth, email){
  const u = mkUser({ uid:'link-1', email:email||'qa@statsgametime.com', emailVerified:true, isAnonymous:false });
  auth._set(u); return { user:u };
}
export async function sendSignInLinkToEmail(){ return undefined; }
export const EmailAuthProvider = { credentialWithLink(){ return { __cred:'emailLink' }; } };
`;

const APP = STORE + `
const APPS = (window.__FBAPPS = window.__FBAPPS || {});
export function initializeApp(cfg, name){
  const key = name || '[DEFAULT]';
  APPS[key] = APPS[key] || { name:key, options:cfg||{} };
  return APPS[key];
}
export function getApp(name){ return APPS[name || '[DEFAULT]'] || null; }
export function getApps(){ return Object.keys(APPS).map(k=>APPS[k]); }
export function deleteApp(){ return Promise.resolve(); }
`;

module.exports = {
  'firebase-app.js': APP,
  'firebase-auth.js': AUTH,
  'firebase-firestore.js': FIRESTORE,
  /* Wire it into a Playwright page. Two lines at the call site, and the
     app boots against it believing it reached Google. */
  async install(page, opts){
    const o = opts || {};
    await page.route('**/fakebase.local/**', route => {
      const u = route.request().url();
      const file = u.split('/').pop().split('?')[0];
      const body = module.exports[file];
      if(!body) return route.fulfill({status:404, body:'no module '+file});
      route.fulfill({ status:200, contentType:'text/javascript',
                      headers:{ 'Access-Control-Allow-Origin':'*' }, body });
    });
    await page.addInitScript(cfg => {
      window.STATS_SDK_BASE = 'https://fakebase.local/10.12.2';
      window.STATS_FIREBASE = cfg.firebase;
      if(cfg.uid) window.__FBUID = cfg.uid;
    }, { firebase: o.config || { projectId:'stats-qa', apiKey:'fake-key',
                                 authDomain:'stats-qa.firebaseapp.com', appId:'1:1:web:1' },
         uid: o.uid || null });
  }
};
