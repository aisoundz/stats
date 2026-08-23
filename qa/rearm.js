#!/usr/bin/env node
/* ============ COMING BACK MUST NOT COST YOU THE GAME =================
   Founder, 21 August 2026: "Dan is always refreshing his phone. So am I."

   That is not a preference, it is a bug report, and it is the reason the
   people he invited left unimpressed. Here is the mechanism it names.

   `pagehide` calls roomListenersStop(), which is right — a closed tab's
   listeners are not closed listeners, and that leak took four rooms down
   on 19 August. But on iOS `pagehide` fires when you BACKGROUND the app,
   not only when you close it. Lock your phone during a timeout, come back,
   and the rounds listener is gone.

   Nothing re-armed it. startHostedWatch() had exactly one caller, inside
   joinNight(), which is guarded by ensureJoined() -> SB.seated() — still
   true, because the teardown dropped the handle and never the seat. The
   one function that could have healed this could not be reached, and there
   was no pageshow handler in the file at all. The only cure was a manual
   refresh.

   And refreshing did not even make you whole: watchRound is
   orderBy(seq desc).limit(1), so a round that opened AND closed while you
   were away is invisible for ever, and the newest document arrives already
   scored — which is how a player gets told they went 0 for 4 on questions
   they never saw.

   qa/listeners.js proves every listener is CLOSED. Nothing proved one is
   ever re-opened. This does.

   Usage: node qa/rearm.js [index-test.html]
*/
const { chromium } = require('playwright');
const { waitReady } = require('./ready.js');
const http = require('http'), fs = require('fs'), path = require('path');

const TARGET = process.argv.find(a => /\.html$/.test(a)) || 'index.html';
let pass = 0, fail = 0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + (detail || '')); }
}
function serve(){
  const srv = http.createServer((q,r)=>{
    const f = path.join(process.cwd(), q.url.split('?')[0] === '/' ? TARGET : q.url.split('?')[0]);
    try{ r.writeHead(200,{'content-type':'text/html'}); r.end(fs.readFileSync(f)); }
    catch(_){ r.writeHead(404); r.end(''); }
  });
  return new Promise(res=>{ srv.listen(0,()=>res({srv, port:srv.address().port})); });
}

(async () => {
  console.log('\n  RE-ARM — the app heals itself instead of asking for a refresh\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:393,height:852} });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,120)));
  await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
  /* waitReady(), not a guess. On 22 Aug qa/stats-page.js was found
     skipping an entire sport per run because its fixed boot sleep
     sometimes expired before the app existed — and it had been
     reporting full coverage on the runs where it did not. */
  await waitReady(p);

  ok('rearm.the-repair-is-exported',
     await p.evaluate(()=>typeof window.roomListenersRearm === 'function'),
     'window.roomListenersRearm is not a function. Without one reachable place that re-opens a ' +
     'room, every check below measures nothing and the only cure is a manual reload.');

  /* Stand up a fake live room: a stubbed round watcher we can count, and a
     replay source holding a round that opened while we were away. */
  const r = await p.evaluate(async ()=>{
    const out = {};
    window.__armed = 0; window.__served = [];

    S.mode = 'live';
    SB.enabled = true;
    SB.watchRound = function(cb){ window.__armed++; window.__cb = cb; return function(){}; };
    SB.recentRounds = async function(){
      /* One round that opened and closed while the listener was detached. */
      return [{ id:'r1', idx:1, tag:'Q2', name:'Quarter 2', worth:20, state:'live',
                questions:[{t:'q1',o:['a','b']}] }];
    };
    const realOpen = window.onHostedRound;
    window.onHostedRound = function(v){ window.__served.push(v && v.id); };
    try{ HR.unsub = null; }catch(_){}

    /* 1. arm it, the way joining a room does */
    startHostedWatch();
    out.armedOnJoin = window.__armed;
    out.liveAfterJoin = !!HR.unsub;

    /* 2. background the app — this is what iOS does on a lock screen */
    roomListenersStop('pagehide');
    out.deafAfterHide = !HR.unsub;

    /* 3. come back */
    window.__served = [];
    window.dispatchEvent(new Event('pageshow'));
    await new Promise(z=>setTimeout(z, 260));
    out.liveAfterReturn = !!HR.unsub;
    out.armedTotal = window.__armed;
    out.replayed = window.__served.slice();

    /* 4. come back AGAIN without having gone deaf — must not re-offer */
    window.__served = [];
    window.dispatchEvent(new Event('pageshow'));
    await new Promise(z=>setTimeout(z, 260));
    out.replayedWhenAlreadyLive = window.__served.slice();

    try{ window.onHostedRound = realOpen; }catch(_){}
    return out;
  });

  ok('rearm.backgrounding-really-does-go-deaf',
     r.liveAfterJoin === true && r.deafAfterHide === true,
     `armed on join=${r.liveAfterJoin}, deaf after pagehide=${r.deafAfterHide}. If this is not ` +
     `true the rest of the suite is measuring nothing — and on iOS pagehide fires on a lock ` +
     `screen, not just on a close.`);

  ok('rearm.coming-back-re-opens-the-round-listener',
     r.liveAfterReturn === true && r.armedTotal >= 2,
     `after pageshow the round listener is ${r.liveAfterReturn ? 'live' : 'STILL DEAD'} ` +
     `(armed ${r.armedTotal}x). This is the whole bug: "Dan is always refreshing his phone." ` +
     `A player who backgrounds the app during a timeout must not have to reload to keep playing.`);

  ok('rearm.a-round-that-opened-while-away-is-replayed',
     Array.isArray(r.replayed) && r.replayed.indexOf('r1') >= 0,
     `rounds served on return: ${JSON.stringify(r.replayed)}. The live stream carries only the ` +
     `NEWEST round, so re-arming alone still loses anything that opened and closed while the ` +
     `listener was gone — and the next document arrives already scored, which is how somebody ` +
     `gets told they went 0 for 4 on questions they never saw.`);

  ok('rearm.a-healthy-return-does-not-re-offer-anything',
     Array.isArray(r.replayedWhenAlreadyLive) && r.replayedWhenAlreadyLive.length === 0,
     `coming back with a live listener replayed ${JSON.stringify(r.replayedWhenAlreadyLive)}. ` +
     `Replaying on top of a working stream would re-offer a round the player is part-way through ` +
     `answering, which is a worse bug than the one being fixed.`);

  ok('rearm.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
