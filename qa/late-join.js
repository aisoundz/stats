#!/usr/bin/env node
/* ============ THE DEVICE THAT WASN'T THERE FOR ROUND 3 ================
   23 Aug 2026, a real device on the real slate: "Innings 1–3 open after
   the 3rd" while the game was genuinely in the 4th, confirmed against
   Firestore `openedAt` — the round HAD opened on time server-side. Two
   plausible explanations were on the table at 4am and only one was
   fixable without a live game to validate against, so it wasn't touched.
   See the GN26 memory: "reproduce with a qa suite driving real HR.doc
   transitions across a late-joining device, before touching
   roomNextRound()." This is that suite.

   WHAT roomNextRound() PROMISES, in its own comment: "HR.doc is the
   newest round document the room has pushed... it is a fact about the
   ROOM and cannot go stale the way a local counter can. Take whichever
   is further along." A scored round means the NEXT one is current:
   `fromRoom = (d.state === 'scored') ? (d.idx + 1) : d.idx`.

   WHAT onHostedRound() ACTUALLY DOES, at the bottom of the function,
   after HR.doc is set:
       if(S.screen==='lobby') renderLobby(idx);
   That is the RAW round index from whatever document just arrived — not
   `renderLobby(roomNextRound(idx))`. For a device that has been on the
   lobby the whole time and just watched round 2 get scored, idx===2 is
   already correct: the room is legitimately still "between round 2 and
   round 3" for one tick. But qa/rearm.js's own comment already proves
   the OTHER case is real and expected: "the live stream carries only the
   NEWEST round... and the next document arrives already scored" — a
   device that (re)subscribes for the first time can have its FIRST ever
   round document be one it never played, already scored, several rounds
   behind the room's real position.

   For THAT device, `hostedDoc(idx)` — an exact `d.idx===qi` match, no
   catching up — hands renderLobby a round whose button then reads
   "`{tag}` ended — answer now ▶" (see the `hLive` branch in renderLobby).
   Tapping it is a dead end: `onHostedScored()`'s very first content check
   is `if(!HR.started[r.id] && !HR.submitted[r.id] && !HR.held[idx]) return`
   — a device that never played this round gets nothing from it, ever.
   So the offer on screen is not stale cosmetics, it is an actionable
   button that leads nowhere, sitting where the honest next-round state
   belongs.

   This suite calls the REAL onHostedRound() and renderLobby() — no
   stubs standing in for the function under test, unlike rearm.js, which
   deliberately stubs onHostedRound() to test the listener re-arm and
   never exercises this path at all. That is why rearm.js being green
   proves nothing about this bug.

   Usage: node qa/late-join.js [index-test.html]
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
  console.log('\n  LATE JOIN — a device seeing its FIRST round document must not be\n  offered a dead one\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:393,height:852} });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,120)));
  await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
  await waitReady(p);

  ok('late-join.the-functions-under-test-exist',
     await p.evaluate(()=>typeof window.onHostedRound==='function'
       && typeof window.renderLobby==='function' && typeof window.roomNextRound==='function'),
     'onHostedRound / renderLobby / roomNextRound are not all reachable — nothing below measures anything real.');

  const r = await p.evaluate(async ()=>{
    const out = {};
    // A late-joining device: never started, submitted, or held anything
    // in this room. This is the state a phone is in the very first
    // instant its listener attaches, before it has ever seen a round.
    S.mode = 'live';
    S.screen = 'lobby';
    S.qi = 0; S.nextQ = null; S.pts = 0;
    HR.doc = null; HR.started = {}; HR.submitted = {}; HR.scored = {};
    HR.pending = null; HR.pendingScore = null; HR.held = {}; HR.heldQs = {};

    const calls = [];
    const realRenderLobby = window.renderLobby;
    window.renderLobby = function(qi){ calls.push(qi); return realRenderLobby(qi); };

    // A round two slots behind index 2 that this device could plausibly
    // still catch: round 2 needs two questions so onHostedRound's
    // question-adoption does not reject the push outright.
    const scoredDoc = {
      id:'r2', idx:2, state:'scored', tag:'r2tag', name:'Round 3',
      key:['a','b'],
      questions:[{t:'q1',o:['a','b']},{t:'q2',o:['a','b']}]
    };
    window.onHostedRound(scoredDoc);
    await new Promise(z=>setTimeout(z, 30));

    out.calls = calls.slice();
    out.correctNext = roomNextRound(0);           // what the room's own invariant says is current
    out.btnAfterScored = (document.getElementById('lobbyBtn')||{}).textContent || '';
    out.subAfterScored = (document.getElementById('lobbySub')||{}).textContent || '';
    out.hrDocIdxAfterScored = HR.doc && HR.doc.idx;

    /* THE FUNCTIONAL CHECK, not the button copy. "ended — answer now" is
       the SAME text renderLobby shows for a round nobody has pushed yet
       (hostless-fallback, self-scoring is the correct and intended UX)
       and for a round the host already scored elsewhere (self-scoring
       is a silent dead end — HR.doc.idx===qi makes hostedDoc(qi) return
       the doc in EITHER state, so liveRoundBlocked()'s very first check,
       `if(hostedDoc(qi)) return null`, waves a scored round through
       exactly like a live one). So: actually tap it, the way a player
       would, and see whether the app walks them into a real question
       screen it can never reconcile with the host's key. */
    const renderedQi = calls.length ? calls[calls.length-1] : null;
    const blockedReason = (typeof liveRoundBlocked==='function' && renderedQi!=null)
      ? liveRoundBlocked(renderedQi) : undefined;
    document.getElementById('lobbyBtn').click();
    await new Promise(z=>setTimeout(z, 30));
    out.renderedQi = renderedQi;
    out.blockedReason = blockedReason;
    out.screenAfterTap = S.screen;

    // CONTROL CASE — a fresh device whose first document is a round that
    // is genuinely LIVE right now (not one it missed). Here idx===current
    // is correct and must still be offered — this is not "always show the
    // next round", it is specifically "never offer a dead one".
    S.screen = 'lobby'; HR.doc = null; HR.started = {}; HR.submitted = {}; HR.scored = {};
    calls.length = 0;
    const liveDoc = {
      id:'r2live', idx:2, state:'live', tag:'r2tag', name:'Round 3',
      questions:[{t:'q1',o:['a','b']},{t:'q2',o:['a','b']}]
    };
    window.onHostedRound(liveDoc);
    await new Promise(z=>setTimeout(z, 30));
    out.callsWhenGenuinelyLive = calls.slice();
    out.btnWhenGenuinelyLive = (document.getElementById('lobbyBtn')||{}).textContent || '';

    window.renderLobby = realRenderLobby;
    return out;
  });

  ok('late-join.roomNextRounds-own-invariant-says-3-not-2',
     r.correctNext === 3,
     `roomNextRound(0) against {idx:2, state:'scored'} returned ${r.correctNext}, expected 3. If this is ` +
     `wrong the invariant itself is broken, which is a different and worse bug than the one this suite exists ` +
     `to catch.`);

  ok('late-join.the-rendered-round-catches-up-to-the-room',
     r.renderedQi === 3,
     `renderLobby was called with ${JSON.stringify(r.calls)} (last: ${r.renderedQi}) after a late-joining ` +
     `device's FIRST document arrived already scored at idx 2. Expected the last call to be 3, matching ` +
     `roomNextRound()'s own answer (${r.correctNext}) — a device that never saw round 2 has no business ` +
     `being shown round 2's card at all.`);

  /* THE ACTUAL DEAD END: "ended — answer now" is shown for a round the
     host already scored AND for a round nobody has pushed yet — same
     text, opposite meaning, because renderLobby's ternary only knows
     "live" vs "not live". What makes the scored-round case dangerous is
     hostedDoc(qi) matching on idx ALONE, in ANY state, which makes
     liveRoundBlocked()'s very first line — `if(hostedDoc(qi)) return
     null` — wave a scored round through unblocked. Tap it and
     startQuarter() falls all the way to `go('live')`: a real question
     screen, scored locally, that onHostedScored() can never reconcile
     with the host's actual key for that round (it refuses anything this
     device did not start/submit/hold). That is the functional bug — the
     copy on the button is just where a person would have first noticed
     it. */
  ok('late-join.tapping-the-button-does-not-walk-into-an-unreconcilable-round',
     r.blockedReason != null && r.screenAfterTap !== 'live',
     `for the round renderLobby actually showed (${r.renderedQi}), liveRoundBlocked() returned ` +
     `${JSON.stringify(r.blockedReason)} and tapping the button left S.screen as "${r.screenAfterTap}". ` +
     `If blockedReason is null/undefined and the screen became "live", the player just started ` +
     `self-scoring a round the host will never credit them for — silently, with a full question ` +
     `screen in front of them that looks exactly like a working one.`);

  ok('late-join.genuinely-live-round-is-still-offered-normally',
     /🔴/.test(r.btnWhenGenuinelyLive) || /LIVE/.test(r.btnWhenGenuinelyLive),
     `control case failed: a round that IS actually live right now (idx 2, state live, never missed) ` +
     `read "${r.btnWhenGenuinelyLive}" instead of offering it. A fix for the scored case above must not ` +
     `break this one — that would trade a dead-end bug for a hidden-round bug.`);

  ok('late-join.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
