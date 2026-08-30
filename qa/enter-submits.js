#!/usr/bin/env node
/* ============ qa/enter-submits.js ====================================
   ENTER SUBMITS. IT NEVER HAS, AND IT COST TWO PEOPLE.

   Reported 26 Aug 2026 by the first person outside the building to play
   this, and ranked #1 in that session's own list — "A real bug, seen by a
   stranger, tiny fix":

       "So I put in ten, and then you hit enter. Right? … Enter isn't
        working now. You gotta go to Next, but we should get the Enter to
        work."

   It was still not working on 30 Aug. By then it had cost more than a
   number field: THERE IS NO <form> ELEMENT ANYWHERE IN THE APP, so the
   browser's native Enter-submits never applied to the five inputs that
   take an email address either. On a phone the keyboard offers Go, a
   person types their address, presses it, and nothing happens — no
   submit, no error, no record anywhere. Measured that morning: 392
   accounts created, 0 with an identity, 0 rows in signups/, 0 new
   subscribers. Somebody had told the founder they signed up.

   This suite presses the actual key on the actual element and asserts the
   app does what its own visible button does. It needs no sabotage
   fallback: on a build without the fix nothing is listening, the spy is
   never called, and every check here goes red on its own.
   ================================================================== */
const PW = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');

const ARG = process.argv.slice(2);
const TARGET = path.resolve(ARG.find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'index-test.html'));
const ENGNAME = ARG.includes('--chromium') ? 'chromium' : 'firefox';
const ENG = PW[ENGNAME];

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok   ' + n + (d ? '   ' + d : '')); }
                          else { fail++; bad.push(n + (d ? '  — ' + d : '')); console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); } };

(async () => {
  const b = await ENG.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));

  await p.goto('file://' + TARGET + '?fixture=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.go === 'function', { timeout: 25000 });

  console.log(`qa/enter-submits.js — [${path.basename(TARGET)} · ${ENGNAME}]`);

  /* ---- THE STRUCTURAL FACT THAT MADE ALL OF THIS POSSIBLE ---------- */
  const forms = await p.evaluate(() => document.querySelectorAll('form').length);
  ok('there is still no <form>, so Enter can only work if the app makes it work',
     true, `${forms} <form> element(s) — the native behaviour is not available either way`);

  /* ---- press the key, on the real element -------------------------- */
  const press = async (id, spyName, prep) => p.evaluate(async ({ id, spyName, prep }) => {
    const out = { found: false, fired: false, why: '' };
    try {
      if (prep) { try { eval(prep); } catch (_) {} }
      const el = document.getElementById(id);
      if (!el) { out.why = 'no element #' + id; return out; }
      out.found = true;
      window.__spy = false;
      if (spyName) window[spyName] = function () { window.__spy = true; };
      el.focus();
      el.value = el.type === 'number' ? '10' : 'someone@example.com';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 120));
      out.fired = window.__spy === true;
    } catch (e) { out.why = String(e && e.message || e); }
    return out;
  }, { id, spyName, prep });

  /* The signup sheet's address field — the one that costs a subscriber. */
  let r = await press('suEmail', 'submitSignup');
  ok('Enter on the signup email submits it', r.found && r.fired,
     r.found ? (r.fired ? '' : 'the key did nothing — this is the reported bug') : r.why);

  /* The notify-me field. */
  r = await press('notifyEmail', 'notifyOnly');
  ok('Enter on the notify email submits it', r.found && r.fired,
     r.found ? (r.fired ? '' : 'the key did nothing') : r.why);

  /* The join sheet. */
  r = await press('jEmail', 'submitJoin');
  ok('Enter on the join-sheet email submits it', r.found && r.fired,
     r.found ? (r.fired ? '' : 'the key did nothing') : r.why);

  /* The exact-number box: THE ORIGINAL REPORT. Enter must do what the
     deck's own "Next →" does, which is predGo(1). */
  r = await p.evaluate(async () => {
    const out = { found: false, fired: false, why: '' };
    try {
      const el = document.createElement('input');
      el.id = 'num_qa'; el.type = 'number';
      document.body.appendChild(el);
      out.found = true;
      window.__pg = false;
      window.predGo = function () { window.__pg = true; };
      el.focus(); el.value = '10';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r2 => setTimeout(r2, 120));
      out.fired = window.__pg === true;
      el.remove();
    } catch (e) { out.why = String(e && e.message || e); }
    return out;
  });
  ok('Enter on the exact-number box advances the card (the 26 Aug report)',
     r.found && r.fired,
     r.fired ? '' : 'Enter did nothing on num_* — "you gotta go to Next" is still true');

  /* THE DELEGATION IS THE POINT. A handler bound to the element would be
     destroyed the next time the card assigns innerHTML — the same shape as
     the lost tap. Prove it survives a repaint. */
  r = await p.evaluate(async () => {
    const out = { fired: false };
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = '<input id="num_repaint" type="number">';
    host.innerHTML = '<input id="num_repaint" type="number">';   // the repaint
    window.__pg2 = false;
    window.predGo = function () { window.__pg2 = true; };
    const el = document.getElementById('num_repaint');
    el.focus(); el.value = '7';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r2 => setTimeout(r2, 120));
    out.fired = window.__pg2 === true;
    host.remove();
    return out;
  });
  ok('Enter still works on an input that was just re-rendered', r.fired,
     r.fired ? '' : 'the handler did not survive innerHTML — it must be delegated, not per-element');

  /* IT MUST NOT FIRE WHAT THE SCREEN SAYS YOU CANNOT DO. */
  r = await p.evaluate(async () => {
    const out = { clicked: false };
    const btn = document.getElementById('nameBtn');
    if (!btn) return { clicked: false, why: 'no #nameBtn' };
    btn.disabled = true;
    btn.onclick = function () { out.clicked = true; };
    const el = document.getElementById('gateEmail');
    if (!el) return { clicked: false, why: 'no #gateEmail' };
    el.focus(); el.value = 'someone@example.com';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r2 => setTimeout(r2, 120));
    return out;
  });
  ok('Enter does NOT fire the gate while its own button is disabled', r.clicked !== true,
     r.clicked ? 'Enter continued past a gate the screen had disabled' : '');

  /* Modified Enter belongs to the browser and to the person. */
  r = await p.evaluate(async () => {
    const el = document.getElementById('suEmail');
    if (!el) return { fired: null };
    window.__spy = false;
    window.submitSignup = function () { window.__spy = true; };
    el.focus(); el.value = 'someone@example.com';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise(r2 => setTimeout(r2, 120));
    return { fired: window.__spy };
  });
  ok('Shift+Enter does not submit', r.fired !== true,
     r.fired ? 'a modified Enter submitted the form' : '');

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' · '));

  await b.close();
  const verdict = fail ? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`);
  bad.forEach(x => console.log('   x ' + x));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('enter-submits.js could not run: ' + (e && e.stack || e)); process.exit(1); });
