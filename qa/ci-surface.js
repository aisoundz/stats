#!/usr/bin/env node
/* ============================================================================
   qa/ci-surface.js — WHERE A CAUGHT IT IS ALLOWED TO APPEAR, AND WHAT IT MAY
                      NEVER RE-OFFER

   Three defects from the 24 August WNBA room, all of which end with the
   player never seeing a question — or seeing one they cannot answer.

   1. HOME SUPPRESSED THE CARD, AND A ROOM SWITCH LANDS YOU ON HOME.
      ciScreenOk() blocked `landing`, `final`, `tally` and mid-quarter
      `live`. The `live` case is deliberate — a quarter question with the
      clock running owns the screen — and the end-of-night cases are right
      too. `landing` is the HOME TAB, and chooseGame() puts you there:
      roomRestore() builds a fresh S with screen 'landing' and go() obeys
      it. So the ordinary way into a room — tapping a game on the rail —
      parked every player on the one tab where Caught It was forbidden,
      silently. Founder's direction settles it: Home is becoming a scroll
      of scores and news that people stay on DURING the game, and a live
      question is the one thing that should interrupt a scroll.

   2. A RESOLVED QUESTION WAS RE-OFFERED AS OPEN, AND THE TAP WAS A MISS.
      renderCiCard() parks an un-showable card in PCI.pending as a snapshot
      of the document at that moment. When it resolved, ciWorthShowing()
      said "not yours, not worth showing" and returned WITHOUT updating
      that snapshot. ciFlush() then read state:'open' off the stale copy on
      the next navigation and painted a live card with four enabled
      buttons. firestore.rules only creates a pick while the document says
      state=='open', so the write was denied at the server, the phone
      recorded the pick locally anyway, and the night's tally graded a MISS
      on a question the player had answered. Confidently wrong.

   3. "WHAT YOU MISSED — CAUGHT IT" HAD ZERO CALL SITES. ciRecapCard() has
      existed since GN8 and nothing ever called it. Six questions fired in
      a real room and the app offered no surface anywhere that said so —
      which is why "I saw none of them" could not be checked from outside.

   Every check asserts the MOVE. The Home checks measure a rendered
   rectangle, not a boolean. The re-offer check ends by TAPPING and
   demanding that nothing was recorded and nothing was sent.

   SABOTAGE, and it is the real thing:  node qa/ci-surface.js --file index.html
   Usage:                               node qa/ci-surface.js [--engine chromium]
   ========================================================================== */
const playwright = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');

const ARG = process.argv.slice(2);
const argOf = (f, d) => { const i = ARG.indexOf(f); return i >= 0 ? ARG[i + 1] : d; };
const TARGET = argOf('--file', ARG.find(a => /\.html$/.test(a) && a[0] !== '-') || 'index-test.html');
const FILE = 'file://' + (path.isAbsolute(TARGET) ? TARGET : path.resolve(__dirname, '..', TARGET));
const ENGINES = argOf('--engine', 'chromium,firefox').split(',').map(s => s.trim()).filter(Boolean);

let pass = 0, fail = 0; const bad = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { fail++; bad.push(label + (detail ? '\n      ' + detail : '')); console.log('  \x1b[31m✗ ' + label + '\x1b[0m'); }
}

const Q = (qid, state) => ({
  qid: qid, kind: 'saw-shot', state: state || 'open',
  prompt: 'Does this next shot go in?',
  options: [{ v: 'y', k: 'Yes' }, { v: 'n', k: 'No' }],
  answer: state === 'resolved' ? 'y' : null,
  resolveText: state === 'resolved' ? 'She buried it.' : null,
  opensAtMs: Date.now(), seq: Date.now()
});

async function run(engineName) {
  const browser = await playwright[engineName].launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const E = engineName.padEnd(8);

  await page.evaluate(() => {
    window.__mk = function (qid, state) {
      var q = { qid: qid, kind: 'saw-shot', state: state || 'open',
        prompt: 'Does this next shot go in?',
        options: [{ v: 'y', k: 'Yes' }, { v: 'n', k: 'No' }],
        answer: state === 'resolved' ? 'y' : null,
        resolveText: state === 'resolved' ? 'She buried it.' : null,
        seq: Date.now() };
      var t = Date.now();
      q.opensAt = { toMillis: function () { return t; } };
      return q;
    };
    window.__liveRoom = function () {
      S.mode = 'live'; SB.enabled = true; SB.state = 'on';
      window.__sent = [];
      SB.callItPick = async function (qid, v) { window.__sent.push([qid, v]); return true; };
      PCI.muted = false; PCI.picked = {}; PCI.graded = {}; PCI.pending = null; PCI.active = null;
      try { CI_RECAP && Object.keys(CI_RECAP).forEach(function (k) { delete CI_RECAP[k]; }); } catch (_) {}
      var c = document.getElementById('ciCard'); if (c) c.style.display = 'none';
    };
  });

  /* ==================================================================
     1 — HOME. chooseGame() lands the player here; the card must draw.
     ================================================================== */
  const home = await page.evaluate(async () => {
    window.__liveRoom();
    /* The screen the rail actually leaves you on — freshS()'s default,
       which go(S.screen||'landing') obeys. Read it rather than assume it,
       so this check keeps naming the real entry point if it moves. */
    var dflt = null;
    try { dflt = (typeof freshS === 'function') ? (freshS().screen || 'landing') : null; } catch (_) {}
    go('landing');
    var q = window.__mk('home-1', 'open');
    onCallItQuestions([q]);
    await new Promise(z => setTimeout(z, 400));
    var card = document.getElementById('ciCard');
    var r = card ? card.getBoundingClientRect() : null;
    return {
      dflt: dflt,
      screen: S.screen,
      screenOk: (typeof ciScreenOk === 'function') ? ciScreenOk() : null,
      display: card ? (card.style.display || 'block') : 'no-card',
      h: r ? Math.round(r.height) : 0,
      w: r ? Math.round(r.width) : 0,
      onScreen: !!(r && r.height > 20 && r.bottom > 0 && r.top < innerHeight),
      liveOpts: card ? card.querySelectorAll('.ciopt:not([disabled])').length : 0,
      hasPrompt: ((card && card.textContent) || '').indexOf('Does this next shot go in?') >= 0
    };
  });

  ok(home.dflt === 'landing',
     E + ' control · a fresh room state really does land on Home',
     `freshS().screen = ${JSON.stringify(home.dflt)}. If this is not 'landing' then the Home ` +
     `block was not the second cause of the WNBA night and this check is measuring the wrong ` +
     `entry point — go and find the one chooseGame() actually uses.`);

  ok(home.screenOk === true,
     E + ' Home no longer suppresses Caught It',
     `ciScreenOk() on screen '${home.screen}' returned ${home.screenOk}. 'landing' is the HOME ` +
     `tab and chooseGame() leaves every player on it, so blocking the card there hid it from ` +
     `anyone who entered a room the ordinary way — by tapping a game on the rail.`);

  ok(home.onScreen && home.hasPrompt && home.liveOpts === 2,
     E + ' a live question actually renders on Home, answerable',
     `card ${home.w}x${home.h} onScreen=${home.onScreen} prompt=${home.hasPrompt} ` +
     `live options=${home.liveOpts} (want 2), display=${home.display}. A boolean saying the ` +
     `screen is allowed is not a question a player can see and tap.`);

  /* ==================================================================
     1b — AND IT NEVER ARRIVES THROUGH THE ☰ BUTTON.

     ciDock() starts the card below the menu button so the button (z-index
     8700) cannot cut a 40px bite out of the card (8400) — which is exactly
     the corner holding the ✕ and the countdown. Its arithmetic was never
     wrong: instrumented on WebKit it returned top:55 against a menu bottom
     of 49 every time. But the ENTRANCE animation started at
     translateY(-22px) — a leftover from when the card lived at bottom:90px
     and had nothing above it — so for the 340ms of the drop the rendered
     card sat up to 22px higher than the position ciDock computed, straight
     under the button.

     It only ever showed on Home, because Home is the heaviest screen in
     the app and is where the entrance starts latest, and it showed about
     one run in four — the worst kind of layout bug to own. ci-clearance
     measures the resting position; this samples the WHOLE arrival.
     ================================================================== */
  const arrival = await page.evaluate(async () => {
    window.__liveRoom();
    go('landing');
    var card = document.getElementById('ciCard'); if (card) card.style.display = 'none';
    var q = window.__mk('arrive-1', 'open');
    var lows = [];
    onCallItQuestions([q]);
    for (var i = 0; i < 40; i++) {
      await new Promise(function (z) { requestAnimationFrame(function () { z(); }); });
      var c = document.getElementById('ciCard');
      var mb = document.getElementById('menuBtn');
      if (!c || c.style.display === 'none' || !mb) continue;
      var cr = c.getBoundingClientRect(), mr = mb.getBoundingClientRect();
      if (getComputedStyle(mb).display === 'none' || mr.height <= 0) continue;
      var hit = !(cr.right <= mr.left || cr.left >= mr.right ||
                  cr.bottom <= mr.top || cr.top >= mr.bottom);
      if (hit) lows.push(Math.round(cr.top));
    }
    return { frames: lows.length, highest: lows.length ? Math.min.apply(null, lows) : null };
  });
  ok(arrival.frames === 0,
     E + ' the card never travels under the ☰ on its way in',
     `it overlapped the menu button on ${arrival.frames} sampled frame(s), reaching top ` +
     `${arrival.highest}. The button is z-index 8700 against the card's 8400, so every one of ` +
     `those frames is the ✕ and the countdown being eaten. The entrance must not pass through ` +
     `the chrome above the card's resting position.`);

  /* ==================================================================
     2 — AND THE BLOCKS THAT ARE DELIBERATE STAY BLOCKED.
     ================================================================== */
  const blocks = await page.evaluate(() => {
    window.__liveRoom();
    var out = {};
    ['final', 'tally', 'name', 'join', 'rules'].forEach(function (scr) {
      S.screen = scr; out[scr] = ciScreenOk();
    });
    S.screen = 'live'; S.answered = false; out.liveOpen = ciScreenOk();
    S.answered = true; out.liveAnswered = ciScreenOk();
    return out;
  });
  ok(blocks.final === false && blocks.tally === false,
     E + ' the end of the night is still off limits',
     `final=${blocks.final} tally=${blocks.tally}. A card offering a choice on a results screen ` +
     `is a choice that cannot be made. Only the Home block was wrong.`);
  ok(blocks.liveOpen === false && blocks.liveAnswered === true,
     E + ' a quarter question with the clock running still owns the screen',
     `mid-quarter=${blocks.liveOpen} (want false), after locking the answer=` +
     `${blocks.liveAnswered} (want true). The clock is the thing being protected. Relaxing ` +
     `this to "fix" Home would put a Caught It on top of a timed question.`);

  /* ==================================================================
     3 — A RESOLVED QUESTION MUST NOT COME BACK AS AN OPEN ONE.
     ================================================================== */
  const stale = await page.evaluate(async () => {
    window.__liveRoom();
    go('gametime');
    /* Park the player where the card is legitimately suppressed: a quarter
       question with the clock running. */
    S.screen = 'live'; S.answered = false;
    var open = window.__mk('stale-1', 'open');
    onCallItQuestions([open]);
    await new Promise(z => setTimeout(z, 150));
    var held = !!(PCI.pending && String(PCI.pending.qid) === 'stale-1');
    var heldState = PCI.pending ? String(PCI.pending.state) : null;

    /* It resolves while they are still on the quarter question. */
    var done = window.__mk('stale-1', 'resolved');
    onCallItQuestions([done]);
    await new Promise(z => setTimeout(z, 150));
    var afterState = PCI.pending ? String(PCI.pending.state) : '(dropped)';

    /* They lock their quarter answer; the coast clears; ciFlush runs on
       every navigation, so this is the ordinary path back. */
    S.answered = true;
    go('gametime');
    try { ciFlush(); } catch (_) {}
    await new Promise(z => setTimeout(z, 300));

    var card = document.getElementById('ciCard');
    var visible = !!(card && card.getBoundingClientRect().height > 20);
    var liveOpts = card ? card.querySelectorAll('.ciopt[data-ciq="stale-1"]:not([disabled])').length : 0;

    /* THE MOVE: tap it anyway, through the real handler. Nothing may be
       recorded and nothing may be sent. */
    window.__sent = [];
    try { activateCiOption('stale-1', 'y'); } catch (_) {}
    await new Promise(z => setTimeout(z, 200));

    return { held: held, heldState: heldState, afterState: afterState,
             visible: visible, liveOpts: liveOpts,
             picked: PCI.picked['stale-1'] == null ? null : String(PCI.picked['stale-1']),
             sent: window.__sent.length };
  });

  ok(stale.held === true && stale.heldState === 'open',
     E + ' control · a card the screen refuses is really held in PCI.pending',
     `held=${stale.held} state=${JSON.stringify(stale.heldState)}. Without this the rest of ` +
     `this block proves nothing.`);

  ok(stale.afterState !== 'open',
     E + ' the held copy is updated when the server resolves the question',
     `PCI.pending still says state=${JSON.stringify(stale.afterState)} after the resolve landed. ` +
     `ciWorthShowing() returned false for an unpicked resolved question and returned EARLY, ` +
     `never touching the stale snapshot — so ciFlush read 'open' off it on the next navigation.`);

  ok(stale.liveOpts === 0,
     E + ' a resolved question is never re-offered with live buttons',
     `${stale.liveOpts} enabled option(s) for a question the server has already settled ` +
     `(card visible=${stale.visible}). firestore.rules refuses a pick unless the document says ` +
     `state=='open', so every one of those buttons is a trap.`);

  ok(stale.picked === null && stale.sent === 0,
     E + ' tapping it records nothing and sends nothing',
     `PCI.picked = ${JSON.stringify(stale.picked)}, writes attempted = ${stale.sent}. This is ` +
     `the whole bug: the write is DENIED server-side, the phone records the pick anyway, and ` +
     `the player is graded a miss on a question they answered. A phone that keeps an answer the ` +
     `server refused is lying about the score.`);

  /* ==================================================================
     4 — "WHAT YOU MISSED" HAS A CALL SITE.
     ================================================================== */
  const recap = await page.evaluate(async () => {
    window.__liveRoom();
    /* Nothing happened tonight: the end of the night must say nothing. */
    S.mode = 'demo';
    try { showFinal(); } catch (_) {}
    await new Promise(z => setTimeout(z, 200));
    var el = document.getElementById('fCaught');
    var emptyTxt = el ? (el.textContent || '').trim() : '(no slot)';

    /* Now a room that had two, one of which the player never saw. */
    var seen = window.__mk('recap-1', 'resolved');
    var missed = window.__mk('recap-2', 'resolved');
    missed.prompt = 'How many free throws in that trip?';
    missed.options = [{ v: '0', k: 'None' }, { v: '2', k: 'Two' }];
    missed.answer = '2';
    try { ciRecapCapture([seen, missed]); } catch (_) {}
    PCI.picked['recap-1'] = 'y';
    try { showFinal(); } catch (_) {}
    await new Promise(z => setTimeout(z, 250));
    el = document.getElementById('fCaught');
    var txt = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '(no slot)';
    var r = el ? el.getBoundingClientRect() : null;
    return { slot: !!el, emptyTxt: emptyTxt, txt: txt,
             onScreen: !!(r && r.height > 10),
             headline: txt.indexOf('WHAT YOU MISSED') >= 0,
             hasSeen: txt.indexOf('Does this next shot go in?') >= 0,
             hasMissed: txt.indexOf('How many free throws in that trip?') >= 0,
             saysWasntThere: /weren.t there/i.test(txt) };
  });

  ok(recap.slot === true,
     E + ' the final screen has somewhere to put the recap',
     `#fCaught = ${recap.slot}. ciRecapCard() had ZERO call sites and no slot to draw into: ` +
     `six questions happened and the app offered no surface anywhere that said so.`);
  ok(recap.emptyTxt === '',
     E + ' a night with no Caught It questions says nothing about them',
     `#fCaught rendered ${JSON.stringify(recap.emptyTxt)} on an empty room. Same no-fake-content ` +
     `rule as the rest of this screen.`);
  ok(recap.headline && recap.hasSeen && recap.hasMissed && recap.onScreen,
     E + ' every Caught It of the night is listed at the end of it',
     `headline=${recap.headline} answered-one-listed=${recap.hasSeen} ` +
     `never-seen-one-listed=${recap.hasMissed} onScreen=${recap.onScreen}. Text: "` +
     recap.txt.slice(0, 160) + '"');
  ok(recap.saysWasntThere,
     E + ' a question the player never saw is named as one they missed',
     `the list does not distinguish a question that was never shown from one that was. That ` +
     `distinction is the entire point of the card: "I saw zero of them" has to be answerable ` +
     `from the screen.`);

  ok(errs.length === 0, E + ' no page errors', errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  console.log('\n  CAUGHT IT — SURFACE\n  file: ' + TARGET + '\n');
  for (const e of ENGINES) {
    console.log('  --- ' + e + ' ---');
    try { await run(e); }
    catch (err) { fail++; bad.push(e + ' crashed: ' + String(err.message).slice(0, 300)); }
  }
  if (bad.length) { console.log('\n  FAILURES:'); bad.forEach(b => console.log('   ✗ ' + b)); }
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
