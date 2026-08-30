/* ============ qa/pick-tap.js =========================================
   A TAP MUST SURVIVE A REBUILD.

   Live in production, found 24 August on a 393x852 phone in Firefox:
   tapping a player's name on the prediction sheet silently does nothing.
   No radio fills, the deck does not advance, nothing is said. The player
   carries a blank into lockPredictions() on a card worth 600 of the
   night's 1,000 points. A second tap on the same name works, so the people
   who tap twice never report it and the people who move on lose the points
   and read it as their own mistake.

   MEASURED, same tap point, only the press duration varied:

       instant (a synthetic click)   1/14    7%
       120ms  — a normal thumb tap   6/14   43%
       300ms  — a deliberate tap     8/14   57%

   THE LOSS WINDOW IS EXACTLY HOW LONG THE FINGER IS ON THE GLASS, which
   is why every automated click understated it about six-fold and why this
   file drives pointerdown, waits, and only then drives pointerup. A suite
   that uses page.click() here is a suite that will call a broken build
   nearly fine.

   TWO CAUSES, BOTH CHECKED HERE.

   1. NO CLICK EVENT AT ALL. buildPred() writes c.innerHTML, destroying and
      recreating every .pdopt, and the handler was a direct property on
      each node. Three rebuilds land inside the first-tap window —
      startPredict at +15ms, loadInactives at +316ms behind an ESPN fetch,
      repaintAfterHydrate at +1234ms behind a Firestore getDoc. If the
      subtree is swapped between mousedown and mouseup the two targets
      share no common ancestor and NO CLICK IS DISPATCHED. Traced with
      listeners on document at capture and a delegated listener on
      #predCard: pointerdown, mousedown, pointerup and mouseup all arrive,
      click never does. Delegating the click would not have caught one of
      these.

   2. THE PAGE MOVES UNDER THE FINGER. buildPred() was briefly shrinking
      the document by 53px, and pdFitPin() by a further 122px while probing
      its own layout; both forced a synchronous reflow inside that window,
      the browser clamped scrollTop, and the height came back without the
      scroll. Measured: scrollTop 1898 -> 1776 during a press, and the
      press came up over a different player's name.

   Reproduced on BOTH engines. This is not a Firefox quirk.

     node qa/pick-tap.js                    index-test.html, both engines
     node qa/pick-tap.js --file index.html  what is live right now
     node qa/pick-tap.js --engine firefox
     node qa/pick-tap.js /abs/path.html     positional, for qa/all.js

   SABOTAGE: run it with --file index.html. Every check under "held press"
   and "the page holds still" goes red there. That is the shipped build.
   ================================================================== */
const pw = require('playwright');
const path = require('path');
const { waitReady } = require('./ready.js');

const ARG = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = ARG.indexOf(flag); return (i >= 0 && ARG[i + 1]) ? ARG[i + 1] : dflt; };
const POS = ARG.filter((a, i) => !a.startsWith('--') && !(i > 0 && ARG[i - 1].startsWith('--')));
/* ============ AND IT STOPS READING TONIGHT ==========================
   30 Aug. This suite has been intermittently red for a week — 30/0, then
   29/1, then 28/2, then 30/0 — and on the same build in the same hour it
   went 28/2 and then 30/0. A check whose answer changes between two runs
   of one file is not measuring the file.

   The cause was that it loaded `?sport=basketball` and nothing else, so
   it read the LIVE slate and the live clock: which rooms exist right now,
   whether a night has expired, what slate/current happens to point at.
   All of that moves under it while it runs, and none of it is what the
   suite is about — it is about whether a finger on a name survives a
   rebuild of the sheet.

   `?fixture=1` holds the built-in night, which is what the rest of the
   gate uses for exactly this reason. It is kept because reading tonight's
   live slate in a suite about touch handling is wrong regardless.

   IT DID NOT FIX THE FLAKE, and saying so here matters more than the
   change did. Measured immediately after pinning, three consecutive runs
   of the same file: 30/0, 29/1, 30/0. So the live slate was never the
   cause and the first version of this comment — which claimed the pin as
   the fix — was wrong before anybody read it.

   BASELINE CONTROL, run before blaming the build, and then run three more
   times because one green run is what a flake looks like half the time.
   The DEPLOYED .241 — which contains none of that night's work — went
   30/0, 30/0, 30/0, 29/1 on the same quiet box, against 28/2, 30/0, 29/1,
   30/0 for the staged build. Both flake, at about the same rate. So this
   is not a regression, and it is not a staging artifact: THE RACE IS LIVE
   IN PRODUCTION RIGHT NOW.

   WHAT THAT LEAVES IS THE UNCOMFORTABLE READING. The two checks that fail
   are the two shortest presses — 0ms and 120ms — and they fail by the
   press being lost across a rebuild. That is not a property of this
   suite; it is the exact product bug the suite was written for, and the
   founder's report of it was "a second tap on the same name works". An
   intermittently red check here most likely means the race is still
   winnable by the repaint and was made rarer rather than closed. Do not
   quiet this suite. It is reporting something. */
const TARGET = POS[0] || argOf('--file', 'index-test.html');
const FILE = 'file://' + (path.isAbsolute(TARGET) ? TARGET : path.join(__dirname, '..', TARGET));
const ENGINES = argOf('--engine', 'firefox,chromium').split(',').map(s => s.trim()).filter(Boolean);
const VP = { width: 393, height: 852 };

let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const is = (cond, name, okDetail, badDetail) => cond ? ok(name, okDetail) : bad(name, badDetail || okDetail);

/* ---- the app, on the pick sheet, with the network pinned -------------
   loadGameStats is a live ESPN fetch. Left alone it makes loadInactives()
   rebuild the deck at an unpredictable moment, which is the very thing
   under test — so it is REMOVED rather than timed, and the rebuild is
   then driven by hand at a moment this file chooses. */
async function bootPredict(b) {
  const p = await b.newPage({ viewport: VP });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));
  await p.goto(FILE + '?sport=basketball&fixture=1', { waitUntil: 'domcontentloaded' });
  await waitReady(p);
  await p.evaluate(() => { try { window.loadGameStats = async function () { return null; }; } catch (_) {} });
  await p.evaluate(() => { startDemo(); S.name = 'QA'; startPredict(); });
  await p.waitForTimeout(700);
  return { p, errs };
}

/* Park the deck on card `k`, clear its answer, and let every scroll this
   provokes finish. Measuring a rect while a smooth scroll is still running
   aims at where the name WAS, and that is a suite bug, not a product one. */
async function aim(p, k) {
  await p.evaluate((k) => {
    try { clearTimeout(PD._adv); } catch (_) {}
    PD.i = k % predOrderList().length;
    delete S.predChoices[predOrderList()[PD.i].id];
    buildPred();
    try { PD_SHOWN = PD.i; } catch (_) {}
  }, k);
  await p.waitForTimeout(200);
  await stillness(p);
}
/* SCROLL POSITION IS NOT ENOUGH. repaintAfterHydrate() runs applySport()
   and paintSlate() about 1.2s after boot, and those repaint the header
   ABOVE the sheet: #predCard was measured sliding 69 -> 121 with scrollTop
   unchanged. Aiming during that is aiming at where the name was, and it
   makes this file's own numbers a boot-timing measurement rather than a
   tap measurement. Wait for the CARD to stop moving, not just the page. */
async function stillness(p) {
  await p.evaluate(() => { window.__still = 0; window.__lastY = -1; window.__lastT = -1e9; });
  await p.waitForFunction(() => {
    const d = document.scrollingElement || document.documentElement;
    const c = document.getElementById('predCard');
    const y = d.scrollTop, t = c ? Math.round(c.getBoundingClientRect().top) : 0;
    window.__still = (window.__lastY === y && window.__lastT === t) ? (window.__still || 0) + 1 : 0;
    window.__lastY = y; window.__lastT = t;
    return window.__still >= 4;
  }, null, { polling: 60, timeout: 8000 }).catch(() => {});
}

/* The option a THUMB could press: on screen, and the topmost thing at its
   own centre. Aiming at a name behind the fixed summary bar measures the
   bar, not the bug. */
const HITTABLE = () => {
  const pid = predOrderList()[PD.i].id;
  for (const el of document.querySelectorAll('#predCard .pdopt:not(.isout)')) {
    const r = el.getBoundingClientRect();
    if (r.top < 4 || r.bottom > innerHeight - 4) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = document.elementFromPoint(x, y);
    if (!t || !t.closest || t.closest('.pdopt') !== el) continue;
    return { x, y, name: el.getAttribute('data-pd'), pid, h: r.height };
  }
  return null;
};

/* ================= 1. THE REPORTED BUG ============================== */
async function heldPress(b, eng, holdMs, n) {
  const { p } = await bootPredict(b);
  let lost = 0, tried = 0;
  const detail = [];
  for (let k = 0; k < n; k++) {
    await aim(p, k);
    const info = await p.evaluate(HITTABLE);
    if (!info) continue;
    tried++;
    await p.mouse.move(info.x, info.y);
    await p.mouse.down();
    await p.waitForTimeout(Math.max(1, Math.round(holdMs / 2)));
    /* THE REBUILD LANDS UNDER THE RESTING FINGER. In the wild this is
       loadInactives() or repaintAfterHydrate(); here it is driven by hand
       so the window is not a coin toss. */
    await p.evaluate(() => { try { buildPred(); } catch (_) {} });
    await p.waitForTimeout(Math.max(1, Math.round(holdMs / 2)));
    await p.mouse.up();
    await p.waitForTimeout(140);
    const got = await p.evaluate(pid => S.predChoices[pid] || '', info.pid);
    if (got !== info.name) { lost++; detail.push(info.name + (got ? ' -> ' + got : ' -> nothing')); }
  }
  await p.close();
  const label = 'a ' + holdMs + 'ms press survives a rebuild [' + eng + ']';
  is(lost === 0, label,
    tried + '/' + tried + ' picks landed',
    lost + ' of ' + tried + ' picks SILENTLY LOST while the finger was down: ' + detail.slice(0, 4).join(', ') +
    ' — this is the live bug: a name is tapped, no radio fills, nothing advances, nothing says so');
  return { lost, tried };
}

/* ================= 2. THE PATHS THAT MUST NOT BREAK ================= */
async function otherPaths(b, eng) {
  const { p, errs } = await bootPredict(b);

  /* An instant click — the way every other suite in this directory taps. */
  await aim(p, 0);
  let info = await p.evaluate(HITTABLE);
  await p.mouse.click(info.x, info.y);
  await p.waitForTimeout(200);
  is(await p.evaluate(pid => S.predChoices[pid], info.pid) === info.name,
    'an instant tap still picks [' + eng + ']', '"' + info.name + '"',
    'a plain click no longer registers — the delegated path has replaced the handler with nothing');

  /* ONE GESTURE IS ONE PICK. pointerup fires and the browser fires a click
     behind it on the same gesture; without a guard the deck runs predPick
     twice, which re-arms the auto-advance and would double-toast an OUT
     name. */
  await aim(p, 1);
  info = await p.evaluate(HITTABLE);
  await p.evaluate(() => {
    window.__picks = [];
    const orig = window.predPick;
    window.predPick = function (id, v) { window.__picks.push(id + '=' + v); return orig.apply(this, arguments); };
  });
  await p.mouse.click(info.x, info.y);
  await p.waitForTimeout(250);
  const calls = await p.evaluate(() => window.__picks.slice());
  is(calls.length === 1, 'one tap is one pick, not two [' + eng + ']',
    'predPick called once', 'predPick called ' + calls.length + ' times for one tap: ' + JSON.stringify(calls) +
    ' — pointerup and the click behind it are both firing');
  await p.evaluate(() => { window.predPick = window.predPick; });

  /* THE KEYBOARD. These are real <button>s and Enter must still choose. */
  await aim(p, 2);
  info = await p.evaluate(HITTABLE);
  const kb = await p.evaluate((nm) => {
    const el = document.querySelector('#predCard .pdopt[data-pd="' + CSS.escape(nm) + '"]');
    if (!el) return false; el.focus(); return document.activeElement === el;
  }, info.name);
  if (kb) {
    await p.keyboard.press('Enter');
    await p.waitForTimeout(250);
  }
  is(kb && await p.evaluate(pid => S.predChoices[pid], info.pid) === info.name,
    'Enter on a focused option picks it [' + eng + ']', '"' + info.name + '"',
    'the keyboard cannot make a pick — the click listener that serves it is gone or unreachable');

  /* A SYNTHETIC CLICK. Several suites in this directory, and the voice
     layer's own tests, dispatch el.click(). It emits no pointer events at
     all, so it exercises the click path on its own. */
  await aim(p, 3);
  info = await p.evaluate(HITTABLE);
  await p.evaluate((nm) => {
    const el = document.querySelector('#predCard .pdopt[data-pd="' + CSS.escape(nm) + '"]'); if (el) el.click();
  }, info.name);
  await p.waitForTimeout(250);
  is(await p.evaluate(pid => S.predChoices[pid], info.pid) === info.name,
    'a synthetic .click() still picks [' + eng + ']', '',
    'el.click() no longer picks — this is how half of qa/ taps this sheet');

  /* A SCROLL IS NOT A CHOICE. Twelve pixels is the number SLATE_TAP uses
     and it is the same gesture: a finger dragging down a thirteen-name
     roster must not spend the card's points on whatever it started on. */
  await aim(p, 4);
  info = await p.evaluate(HITTABLE);
  await p.mouse.move(info.x, info.y);
  await p.mouse.down();
  await p.mouse.move(info.x, info.y + 40, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  is(!await p.evaluate(pid => S.predChoices[pid], info.pid),
    'dragging 40px down the roster is a scroll, not a pick [' + eng + ']', '',
    'a 40px drag picked "' + info.name + '" — reading a scroll as a choice is how a player spends 100 points ' +
    'looking for a name');

  /* AND A PRESS THAT ENDS SOMEWHERE ELSE PICKS NOTHING. If layout above
     the sheet moves under a resting finger, the worst outcome is not a
     lost pick — it is a pick silently spent on the wrong player. */
  await aim(p, 5);
  info = await p.evaluate(HITTABLE);
  await p.mouse.move(info.x, info.y);
  await p.mouse.down();
  const moved = await p.evaluate((y) => {
    /* Move the CONTENT, not the pointer: exactly the failure captured in
       the wild, where #predCard grew by one .pdopt row mid-press. */
    const d = document.scrollingElement || document.documentElement;
    d.scrollTop = d.scrollTop + 60;
    const t = document.elementFromPoint(innerWidth / 2, y);
    const el = t && t.closest ? t.closest('.pdopt') : null;
    return el ? el.getAttribute('data-pd') : null;
  }, info.y);
  await p.mouse.up();
  await p.waitForTimeout(250);
  const after = await p.evaluate(pid => S.predChoices[pid] || '', info.pid);
  is(after !== moved || moved === null || moved === info.name,
    'a press that finishes on a different name picks nobody [' + eng + ']',
    moved ? 'ended over "' + moved + '", picked "' + (after || 'nothing') + '"' : 'nothing moved under the finger',
    'pressed "' + info.name + '", the page moved, and the card was spent on "' + after + '" — a silent WRONG pick');

  /* A RULED-OUT NAME IS STILL A REFUSAL. This logic used to live inside
     the per-node closure that was deleted; it has to survive the move. */
  await aim(p, 0);
  const outName = await p.evaluate(() => {
    const el = document.querySelector('#predCard .pdopt');
    const nm = el && el.getAttribute('data-pd');
    if (!nm) return null;
    try { INACTIVE.add(nm); } catch (_) { return null; }
    delete S.predChoices[predOrderList()[PD.i].id];
    buildPred();
    return nm;
  });
  if (outName) {
    await stillness(p);
    const spot = await p.evaluate((nm) => {
      const el = document.querySelector('#predCard .pdopt[data-pd="' + CSS.escape(nm) + '"]');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, isout: el.classList.contains('isout'), pid: predOrderList()[PD.i].id };
    }, outName);
    if (spot && spot.isout) {
      await p.mouse.click(spot.x, spot.y);
      await p.waitForTimeout(250);
      is(!await p.evaluate(pid => S.predChoices[pid], spot.pid),
        'a ruled-out name still cannot be spent [' + eng + ']', '"' + outName + '" refused',
        '"' + outName + '" is flagged OUT and the card took the pick anyway — a pick you are told not to make ' +
        'and can still make is a trap');
    }
    await p.evaluate((nm) => { try { INACTIVE.delete(nm); buildPred(); } catch (_) {} }, outName);
  }

  is(errs.length === 0, 'the pick sheet threw nothing [' + eng + ']', '', errs.slice(0, 3).join(' | '));
  await p.close();
}

/* ================= 3. THE PAGE HOLDS STILL ==========================
   The second cause, measured directly rather than inferred from a lost
   tap: redrawing the card the player is already looking at must not move
   the page. This is the check that fails on the shipped build with
   scrollTop dropping 53px (buildPred's own transient) or 122px
   (pdFitPin's scratch space) at the bottom of a long roster. */
async function pageHoldsStill(b, eng) {
  const { p } = await bootPredict(b);
  /* The longest roster on the sheet — the card where a player is most
     likely to be scrolled down and least likely to notice a jump. */
  const k = await p.evaluate(() => {
    const L = predOrderList();
    let best = 0, n = -1;
    for (let i = 0; i < L.length; i++) { const c = (L[i].opts || []).length; if (c > n) { n = c; best = i; } }
    return best;
  });
  await aim(p, k);
  const r = await p.evaluate(() => {
    const d = document.scrollingElement || document.documentElement;
    d.scrollTop = d.scrollHeight;
    return null;
  });
  await stillness(p);
  const delta = await p.evaluate(() => {
    const d = document.scrollingElement || document.documentElement;
    /* PARK AT THE FLOOR, DELIBERATELY. The dip only clamps the scroll when
       there is no slack left below — which is exactly where a player is
       when they are reading the bottom of a thirteen-name roster. Re-assert
       it here, because pdFitPin() may have changed the document's height
       since stillness() returned, and a check that only fails when it
       happens to land on the boundary is a check nobody can trust. */
    d.scrollTop = d.scrollHeight;
    const el = document.querySelectorAll('#predCard .pdopt')[2] || document.querySelector('#predCard .pdopt');
    const name = el && el.getAttribute('data-pd');
    const y0 = el.getBoundingClientRect().top, s0 = d.scrollTop;
    buildPred();
    const el2 = document.querySelector('#predCard .pdopt[data-pd="' + CSS.escape(name) + '"]');
    return { name, dy: Math.round((el2 ? el2.getBoundingClientRect().top : y0) - y0), ds: d.scrollTop - s0, s0 };
  });
  is(Math.abs(delta.dy) <= 2, 'redrawing the card does not move the names under the finger [' + eng + ']',
    '"' + delta.name + '" moved ' + delta.dy + 'px',
    '"' + delta.name + '" moved ' + delta.dy + 'px (scrollTop ' + delta.ds + ') when buildPred() ran — a finger ' +
    'resting on a name comes up over a different one, and the card is spent on the wrong player or on nobody');
  await p.close();
}

/* ================= 4. THE NEIGHBOUR: CAUGHT IT ======================
   The same shape: ciShow() writes inner.innerHTML and the handler was a
   direct property on each .ciopt. The repaint window is narrower — the
   card redraws on a listener update and once when the lock timer fires,
   not three times in the first second — but the question lives twenty
   seconds and there is no second chance, so a lost tap costs more, not
   less. Reproduced on the shipped build at 393x852 in both engines. */
async function caughtIt(b, eng) {
  const p = await b.newPage({ viewport: VP });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));
  await p.goto(FILE + '?sport=basketball&fixture=1', { waitUntil: 'domcontentloaded' });
  await waitReady(p);
  /* Caught It refuses to draw on screens it must not share — see
     ciScreenOk(). The lobby is where it belongs. */
  await p.evaluate(() => { startDemo(); S.name = 'QA'; try { go('lobby'); } catch (_) {} });
  await p.evaluate(() => { try { demoCallIt(0); } catch (_) {} });
  await p.waitForTimeout(4800);
  const up = await p.evaluate(() => ({
    opts: document.querySelectorAll('#ciCard .ciopt:not([disabled])').length,
    qid: (window.PCI && PCI.active && PCI.active.qid) || null
  }));
  if (!up.opts || !up.qid) {
    bad('a Caught It card is on screen to test [' + eng + ']',
      'no open Caught It card appeared in demo — this section proved nothing, which is worse than a red');
    await p.close();
    return;
  }
  const info = await p.evaluate(() => {
    const el = document.querySelector('#ciCard .ciopt:not([disabled])');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: el.getAttribute('data-civ') };
  });
  await p.mouse.move(info.x, info.y);
  await p.mouse.down();
  await p.waitForTimeout(60);
  await p.evaluate(() => { try { renderCiCard(PCI.active); } catch (_) {} });
  await p.waitForTimeout(60);
  await p.mouse.up();
  await p.waitForTimeout(300);
  const got = await p.evaluate(qid => (PCI.picked && PCI.picked[qid] != null) ? String(PCI.picked[qid]) : '', up.qid);
  is(got === String(info.v), 'a held press on a Caught It option survives a repaint [' + eng + ']',
    'answered "' + got + '"',
    'the answer was SILENTLY LOST — pressed "' + info.v + '", the card repainted under the finger, and the ' +
    'question recorded ' + (got ? '"' + got + '"' : 'nothing') + ' on a twenty-second clock with no second chance');

  /* And the ordinary tap still answers, on a fresh question. */
  await p.evaluate(() => { try { PCI.picked = {}; demoCiFired['slot1'] = false; demoCallIt(1); } catch (_) {} });
  await p.waitForTimeout(4800);
  const up2 = await p.evaluate(() => ({
    opts: document.querySelectorAll('#ciCard .ciopt:not([disabled])').length,
    qid: (window.PCI && PCI.active && PCI.active.qid) || null
  }));
  if (up2.opts && up2.qid) {
    const i2 = await p.evaluate(() => {
      const el = document.querySelector('#ciCard .ciopt:not([disabled])');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: el.getAttribute('data-civ') };
    });
    await p.mouse.click(i2.x, i2.y);
    await p.waitForTimeout(300);
    const g2 = await p.evaluate(qid => (PCI.picked && PCI.picked[qid] != null) ? String(PCI.picked[qid]) : '', up2.qid);
    is(g2 === String(i2.v), 'an instant tap on a Caught It option still answers [' + eng + ']', '',
      'a plain tap no longer answers Caught It');
  }
  is(errs.length === 0, 'Caught It threw nothing [' + eng + ']', '', errs.slice(0, 3).join(' | '));
  await p.close();
}

(async () => {
  console.log('\n=== pick-tap  ' + TARGET + '  ' + VP.width + 'x' + VP.height + ' ===');
  const N = Number(argOf('--n', '8'));
  for (const eng of ENGINES) {
    let b;
    try { b = await pw[eng].launch(); }
    catch (e) { bad('engine ' + eng + ' launches', String(e && e.message || e)); continue; }
    console.log('\n  ── ' + eng);
    /* Three durations, because the bug is a function of how long the
       finger rests and the instant case is the one that lies. */
    for (const hold of [0, 120, 300]) await heldPress(b, eng, hold, N);
    await pageHoldsStill(b, eng);
    await otherPaths(b, eng);
    await caughtIt(b, eng);
    await b.close();
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
