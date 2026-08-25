#!/usr/bin/env node
/* ============================================================================
   qa/ci-deaf.js — CAUGHT IT CAN GO DEAF ON ITS OWN, SO IT MUST HEAL ON ITS OWN

   Live WNBA room, 24 August 2026. Caught It fired six times. The founder
   saw zero of them. The server was healthy for the whole night.

   The mechanism is an asymmetry between two listeners that the code
   believed were symmetric. roomListenersStop()'s comment says re-arming is
   not done there because "every one of these attaches lazily behind an
   `if (!handle)` guard, so dropping the handle is the whole re-arm". That
   is true of three of the four. It was false of Caught It, in three
   independent ways at once:

     1. startCallItWatch() lived INSIDE startHostedWatch(), BELOW its guard
        `if(HR.unsub || …) return`. When only Caught It had dropped, the
        round listener was alive, so the function returned at line one and
        the Caught It line was unreachable. Every repair path in the app —
        pageshow, visibilitychange, the room watchdog — funnels through
        roomListenersRearm() into that one function.

     2. roomListenersRearm() computed `wasDeaf = !HR.unsub`. One listener's
        health, answered for two. It returned 0, "nothing was wrong", to
        every caller while Caught It was silent.

     3. The watchdog in refreshRoom() tested Caught It with exactly one
        clause: `SB.callItWatchOk === false`. That flag is set true by the
        first snapshot to arrive and was cleared by NOTHING — detaching is
        not an error — so it read `true` for a listener that no longer
        existed. Rounds have had a second, structural clause (never
        attached / no longer attached) since B-59. Caught It never did.

   Every check below KILLS ONLY `PCI.unsub`, leaving the round listener
   untouched, because that is the shape of the night. And every check
   asserts the MOVE, not the absence of a complaint: the last one pushes a
   real question down the re-attached callback and demands the card appear.
   "It didn't throw" is what let a previous Caught It suite ship green over
   a feature that did nothing.

   SABOTAGE, and it is the real thing rather than a mutation:

       node qa/ci-deaf.js --file index.html

   index.html is the un-fixed build. Every repair check must go red there
   and green on index-test.html. If they pass on both, this suite is not
   measuring the bug.

   Usage:
       node qa/ci-deaf.js                        index-test.html, both engines
       node qa/ci-deaf.js --file index.html      the sabotage control
       node qa/ci-deaf.js --engine chromium      one engine
   ========================================================================== */
const playwright = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');

const ARG = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = ARG.indexOf(flag); return i >= 0 ? ARG[i + 1] : dflt; };
const TARGET = argOf('--file', ARG.find(a => /\.html$/.test(a) && a[0] !== '-') || 'index-test.html');
const FILE = 'file://' + (path.isAbsolute(TARGET) ? TARGET : path.resolve(__dirname, '..', TARGET));
/* WebKit is not offered. It crashes on this page on this box, and a suite
   that reports "webkit unavailable" is a suite claiming Safari coverage it
   does not have. Firefox and Chromium, both, every run. */
const ENGINES = (argOf('--engine', 'chromium,firefox')).split(',').map(s => s.trim()).filter(Boolean);

let pass = 0, fail = 0; const bad = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { fail++; bad.push(label + (detail ? '\n      ' + detail : '')); console.log('  \x1b[31m✗ ' + label + '\x1b[0m'); }
}

/* One live room, stubbed at the SB boundary and nowhere deeper. The two
   watchers count their own attachments and hand back real unsubscribe
   functions, so "is it listening" is a fact about handles rather than a
   fact about a mock. */
const ARM_ROOM = () => {
  window.__ci = 0; window.__rd = 0; window.__ciCb = null;
  /* Keep the REAL watchers. The last two checks put them back and ask what
     they hand you when there is no night — stubbing over them permanently
     would have made that pair test the stub. */
  if (!window.__realWatch) window.__realWatch = { r: SB.watchRound, c: SB.watchCallIt, s: SB.seated };
  S.mode = 'live';
  /* On a real screen, not just S.screen. The card docks into #ciSlot,
     which lives inside the Gametime section — with no navigation that slot
     is in a hidden section and the card measures 0px tall while reporting
     display:block. "Visible" has to mean visible. */
  try { go('gametime'); } catch (_) { S.screen = 'gametime'; }
  SB.enabled = true;
  SB.state = 'on';
  SB.seated = function () { return true; };          // in the room, for real
  SB.watchRound = function (cb) { window.__rd++; return function () {}; };
  SB.watchCallIt = function (cb) {
    window.__ci++; window.__ciCb = cb;
    SB.callItWatchOk = true;                          // as a first snapshot does
    return function () {};
  };
  SB.recentRounds = async function () { return []; };
  SB.callItPick = async function () { return true; };
  SB.count = async () => 1; SB.joined = async () => 1; SB.rank = async () => 1;
  SB.pendingWrites = function () { return 0; };
  try { PCI.muted = false; PCI.picked = {}; PCI.graded = {}; PCI.pending = null; PCI.active = null; } catch (_) {}
  try { HR.unsub = null; PCI.unsub = null; } catch (_) {}
  startHostedWatch();
  /* Past the join grace the watchdog waits out, so the structural test is
     allowed to fire. */
  try { window.JOIN_STARTED_AT = Date.now() - 60000; } catch (_) {}
};

/* The failure, exactly as the server produces it: the Caught It listener
   and only the Caught It listener stops existing. */
const GO_DEAF = () => {
  PCI.unsub = null;
  /* Drop the callback too. Leaving the previous one in place would let the
     final check push a question down a stub that was never re-attached —
     a green that proves nothing, which is how `next-works-on-a-settled-
     question` shipped over a grammar with no "next" in it. Only a genuine
     re-attach can put a callback back here. */
  window.__ciCb = null;
};

async function run(engineName) {
  const engine = playwright[engineName];
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.addInitScript(() => {});
  const E = engineName.padEnd(8);

  await page.exposeFunction('__armRoom', () => {});   // no-op; keeps the API symmetrical
  await page.evaluate('window.__ARM = ' + ARM_ROOM.toString() + '; window.__DEAF = ' + GO_DEAF.toString() + ';');

  /* ---- CONTROL: the probe really does break only Caught It ------------ */
  const ctl = await page.evaluate(() => {
    window.__ARM();
    const armed = { rd: !!HR.unsub, ci: !!PCI.unsub, ciN: window.__ci };
    window.__DEAF();
    return { armed, after: { rd: !!HR.unsub, ci: !!PCI.unsub } };
  });
  ok(ctl.armed.rd && ctl.armed.ci && ctl.armed.ciN === 1,
     E + ' control · joining a room arms BOTH listeners',
     `rounds=${ctl.armed.rd} caughtIt=${ctl.armed.ci} attaches=${ctl.armed.ciN}. ` +
     `If Caught It never attaches on a join, everything below measures nothing.`);
  ok(ctl.after.rd === true && ctl.after.ci === false,
     E + ' control · the probe kills Caught It and leaves rounds alive',
     `rounds=${ctl.after.rd} caughtIt=${ctl.after.ci}. This is the shape of the WNBA night: ` +
     `the round listener was healthy the whole time.`);

  /* ---- 1. the flag stops lying about a listener that is gone ---------- */
  const flag = await page.evaluate(() => {
    window.__ARM();
    const beforeStop = SB.callItWatchOk;
    roomListenersStop('probe');
    return { beforeStop, afterStop: SB.callItWatchOk, handle: !!PCI.unsub };
  });
  ok(flag.beforeStop === true && flag.afterStop !== true,
     E + ' the health flag stops reading true for a detached listener',
     `callItWatchOk was ${JSON.stringify(flag.beforeStop)} while attached and ` +
     `${JSON.stringify(flag.afterStop)} after the listener was torn down. Nothing ever cleared ` +
     `this flag, so the ONLY test the watchdog had for Caught It was structurally incapable of ` +
     `firing — the flag said "fine" about a listener that did not exist.`);

  /* ---- 2. startHostedWatch re-arms Caught It past a live round guard -- */
  const shw = await page.evaluate(() => {
    window.__ARM(); window.__DEAF();
    startHostedWatch();
    return { ci: !!PCI.unsub, ciN: window.__ci, rd: !!HR.unsub };
  });
  ok(shw.ci === true && shw.ciN === 2,
     E + ' startHostedWatch re-arms Caught It while the round listener is alive',
     `after the call: caughtIt handle=${shw.ci}, attach count=${shw.ciN} (want 2). ` +
     `startCallItWatch() sat below \`if(HR.unsub) return\`, so with a healthy round listener ` +
     `this function returned before it could ever reach the Caught It line.`);

  /* ---- 3/4. pageshow and visibilitychange ---------------------------- */
  const ps = await page.evaluate(async () => {
    window.__ARM(); window.__DEAF();
    window.dispatchEvent(new Event('pageshow'));
    await new Promise(z => setTimeout(z, 250));
    return { ci: !!PCI.unsub, ciN: window.__ci };
  });
  ok(ps.ci === true,
     E + ' pageshow brings Caught It back',
     `handle after pageshow=${ps.ci}, attaches=${ps.ciN}. On iOS pagehide fires on a lock ` +
     `screen; pageshow is the only event that fires on the way back.`);

  const vis = await page.evaluate(async () => {
    window.__ARM(); window.__DEAF();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(z => setTimeout(z, 250));
    return { ci: !!PCI.unsub };
  });
  ok(vis.ci === true,
     E + ' coming back to the tab brings Caught It back',
     `handle after visibilitychange=${vis.ci}`);

  /* ---- 5. the repair reports that it repaired something --------------- */
  const re = await page.evaluate(async () => {
    window.__ARM(); window.__DEAF();
    const n = roomListenersRearm('suite');
    await new Promise(z => setTimeout(z, 200));
    return { n, ci: !!PCI.unsub };
  });
  ok(re.n >= 1 && re.ci === true,
     E + ' roomListenersRearm sees a Caught It-only outage and fixes it',
     `returned ${re.n} (want >=1), handle=${re.ci}. It computed \`wasDeaf = !HR.unsub\` — one ` +
     `listener's health answered for two — so it returned 0, "nothing was wrong", to pageshow, ` +
     `visibilitychange AND the watchdog while Caught It was silent.`);

  /* ---- 6. the watchdog: structural test, not a stale flag -------------- */
  const wd = await page.evaluate(async () => {
    window.__ARM();
    window.__DEAF();
    SB.callItWatchOk = true;      // the stale value the real bug left behind
    try { await refreshRoom(); } catch (_) {}
    await new Promise(z => setTimeout(z, 250));
    const bar = document.getElementById('roomBar');
    return { ci: !!PCI.unsub, bar: ((bar && bar.textContent) || '').replace(/\s+/g, ' ').trim() };
  });
  ok(wd.ci === true,
     E + ' the watchdog sees a detached listener even with the flag stuck on true',
     `handle after refreshRoom=${wd.ci}. The only Caught It test was \`callItWatchOk===false\`, ` +
     `against a flag nothing ever cleared. Rounds get a second clause — "never attached / no ` +
     `longer attached" — and Caught It has to get the same one.`);

  /* ---- 7. and it does not blame the round listener --------------------- */
  ok(!/No connection for live questions|No connection for quarter questions/i.test(wd.bar),
     E + ' a Caught It outage does not accuse the healthy round listener',
     `room bar read: "${wd.bar}". The round listener was fine. Painting "No connection for live ` +
     `questions" over it sends the next person debugging this at the wrong lane, which is ` +
     `exactly what happened on the night.`);

  /* ---- 8. THE GUARANTEE: a question pushed after the repair LANDS ------ */
  const landed = await page.evaluate(async () => {
    window.__ARM();
    window.__DEAF();
    roomListenersRearm('suite');
    await new Promise(z => setTimeout(z, 200));
    const q = {
      qid: 'deaf-1', kind: 'saw-shot', state: 'open',
      prompt: 'Does this shot go in?',
      options: [{ v: 'y', k: 'Yes' }, { v: 'n', k: 'No' }],
      opensAt: { toMillis: () => Date.now() }, seq: Date.now(),
      locksMs: (typeof ciWindowMs === 'function') ? ciWindowMs(null) : 20000
    };
    if (typeof window.__ciCb !== 'function') return { cb: false };
    window.__ciCb([q]);
    await new Promise(z => setTimeout(z, 300));
    const card = document.getElementById('ciCard');
    const shown = !!(card && card.style.display !== 'none' && card.offsetHeight > 0);
    const txt = (card && card.textContent) || '';
    return { cb: true, shown, hasPrompt: txt.indexOf('Does this shot go in?') >= 0,
             opts: card ? card.querySelectorAll('.ciopt:not([disabled])').length : 0 };
  });
  ok(landed.cb && landed.shown && landed.hasPrompt && landed.opts === 2,
     E + ' a question pushed after the repair actually reaches the screen',
     `callback re-attached=${landed.cb} card visible=${landed.shown} prompt on it=` +
     `${landed.hasPrompt} live options=${landed.opts} (want 2). This is the only check here ` +
     `that proves the player would have SEEN the six questions. A handle being non-null is not ` +
     `a question on a screen.`);

  /* ---- 9/10. the latent one: no night must not pin the guards ---------- */
  const latent = await page.evaluate(async () => {
    /* A fresh page state with the REAL SB watchers and no night joined —
       which is every page load before joinNight() finishes. */
    S.mode = 'live';
    SB.enabled = true;
    /* The real watchers back, and the real seat test back with them. */
    SB.watchRound = window.__realWatch.r;
    SB.watchCallIt = window.__realWatch.c;
    SB.seated = window.__realWatch.s;
    try { HR.unsub = null; PCI.unsub = null; } catch (_) {}
    const out = {};
    out.roundHandle = null; out.ciHandle = null;
    try { out.roundHandle = SB.watchRound(function () {}); } catch (_) { out.roundThrew = true; }
    try { out.ciHandle = SB.watchCallIt(function () {}); } catch (_) { out.ciThrew = true; }
    out.roundTruthy = !!out.roundHandle; out.ciTruthy = !!out.ciHandle;
    delete out.roundHandle; delete out.ciHandle;

    try { HR.unsub = null; PCI.unsub = null; } catch (_) {}
    window.dispatchEvent(new Event('pageshow'));
    await new Promise(z => setTimeout(z, 250));
    out.pinnedRound = !!HR.unsub;
    out.pinnedCi = !!PCI.unsub;
    return out;
  });
  ok(latent.roundTruthy === false && latent.ciTruthy === false,
     E + ' with no night, neither watcher hands back a handle',
     `watchRound gave ${latent.roundTruthy ? 'a truthy no-op' : 'nothing'}, watchCallIt gave ` +
     `${latent.ciTruthy ? 'a truthy no-op' : 'nothing'}. Both returned \`function(){}\` — truthy ` +
     `— so \`HR.unsub = SB.watchRound(...) || null\` stored a handle for a listener that was ` +
     `never opened, and every re-arm guard in the file is \`if(handle) return\`.`);
  ok(latent.pinnedRound === false && latent.pinnedCi === false,
     E + ' pageshow before a room is joined does not pin the re-arm guards shut',
     `after one pageshow with no night: HR.unsub=${latent.pinnedRound} PCI.unsub=` +
     `${latent.pinnedCi}. pageshow fires on EVERY page load. A fake handle here is permanent ` +
     `and silent, with *WatchOk left at null so the watchdog cannot see it either — one ` +
     `dispatched event costs the whole night.`);

  ok(errs.length === 0, E + ' no page errors', errs.slice(0, 3).join(' | '));

  await browser.close();
}

(async () => {
  console.log('\n  CAUGHT IT — DEAF IN ONE EAR\n  file: ' + TARGET + '\n');
  for (const e of ENGINES) {
    console.log('  --- ' + e + ' ---');
    try { await run(e); }
    catch (err) { fail++; bad.push(e + ' crashed: ' + String(err.message).slice(0, 200)); }
  }
  if (bad.length) { console.log('\n  FAILURES:'); bad.forEach(b => console.log('   ✗ ' + b)); }
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
