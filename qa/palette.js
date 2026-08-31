#!/usr/bin/env node
/* ============ qa/palette.js ==========================================
   FIVE COLOURS, FIVE MEANINGS — AND THE MOST IMPORTANT BUTTON KEPT
   BREAKING THE ONE RULE THEY REST ON.

   The Arena Book locks the palette to meanings, not decoration: teal is
   YOU (your handle, your streak, your row), blue is the ACT, red is LIVE,
   green is CORRECT, gold is the CLOCK. A screen that uses teal for
   anything other than you is a bug, not a style choice.

   The v7 design review, 30 Aug, found the app breaking it in the single
   worst place available:

       "The practice CTA is teal — teal means you, blue is the primary
        action, so the most important button on the site breaks the one
        rule the palette rests on."

   paintContinueCard() was calling `btn.classList.add('teal')` on the
   RESUME button — the one control a returning player is meant to press.
   The screen said "this is you" where it meant "press this."

   AND EMOJI ARE NOT BULLETS. The same review: emoji used as section
   markers read as toy. They are reserved for Banner awards, where they
   mean something. That fix has its own trap, which this file also
   guards — see below.

   This drives the real button and reads its real colour, rather than
   grepping for a class name. A class is an input; the pixel is the
   output, and this codebase has been bitten by that difference all week.
   ================================================================== */
const PW = require('playwright');
const path = require('path'), fs = require('fs');

const ARG = process.argv.slice(2);
const TARGET = path.resolve(ARG.find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'index-test.html'));
const ENGNAME = ARG.includes('--chromium') ? 'chromium' : 'firefox';
const ENG = PW[ENGNAME];

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok   ' + n + (d ? '   ' + d : '')); }
  else { fail++; bad.push(n + (d ? '  — ' + d : '')); console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); } };

/* The two that matter here, as the shipped :root declares them. */
const BLUE = 'rgb(47, 107, 255)';   // --blue  #2f6bff  the act
const TEAL = 'rgb(40, 224, 208)';   // --teal  #28e0d0  you

(async () => {
  const b = await ENG.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));
  await p.goto('file://' + TARGET + '?fixture=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.paintContinueCard === 'function', { timeout: 25000 });

  console.log(`qa/palette.js — [${path.basename(TARGET)} · ${ENGNAME}]`);

  /* ---- THE PRIMARY ACTION IS BLUE, IN BOTH STATES ------------------
     Two-sided on purpose. A fix that painted the button blue by never
     letting it resume would pass a one-sided check while breaking the
     feature it lives on. */
  const r = await p.evaluate(async () => {
    const out = {};
    const btn = document.getElementById('landingBtn');
    if (!btn) return { none: true };
    const read = () => {
      const c = getComputedStyle(btn);
      /* The button paints via background-image (a gradient), so read both
         and hand the whole string back — the caller looks for the hue. */
      return (c.backgroundColor || '') + ' | ' + (c.backgroundImage || '');
    };
    S.mode = 'live'; S.place = 'lobby';
    S.qi = Math.max(0, (window.rounds || []).length - 1); S.nextQ = S.qi;
    window.resumable = () => true;
    window.hostedDoc = () => ({ state: 'live' });

    window.nightIsOver = () => false;
    paintContinueCard(); out.resuming = read(); out.textResuming = btn.textContent;

    window.nightIsOver = () => true;
    paintContinueCard(); out.over = read(); out.textOver = btn.textContent;

    /* And with nothing to resume, the button must still not be teal. */
    window.resumable = () => false;
    paintContinueCard(); out.idle = read();
    out.classes = btn.className;
    return out;
  });

  if (r.none) ok('the landing CTA exists', false, 'no #landingBtn to test');
  else {
    ok('the resume CTA is blue while a game is live',
       r.resuming.indexOf(BLUE) >= 0 && r.resuming.indexOf(TEAL) < 0,
       `it painted "${r.resuming}". Teal means YOU; blue is the act. This is the one button a `
       + 'returning player is meant to press');

    ok('it is still blue once the night is over',
       r.over.indexOf(TEAL) < 0,
       `after the buzzer it painted "${r.over}"`);

    ok('and blue when there is nothing to resume',
       r.idle.indexOf(TEAL) < 0,
       `idle it painted "${r.idle}" · classes "${r.classes}"`);

    ok('the button still changes what it says',
       r.textResuming !== r.textOver,
       `it read "${r.textResuming}" both live and finished — a CTA that never updates is not fixed, `
       + 'it is broken in a quieter way');
  }

  /* ---- EMOJI ARE FOR BANNER AWARDS, NOT SECTION BULLETS ------------- */
  const src = fs.readFileSync(TARGET, 'utf8');
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const heads = [...src.matchAll(/<h[123][^>]*>([^<]{0,80})/g)].map(m => m[1].trim()).filter(Boolean);
  const withEmoji = heads.filter(h => EMOJI.test(h));
  ok('no section heading uses an emoji as a bullet',
     withEmoji.length === 0,
     withEmoji.length ? withEmoji.slice(0, 4).map(h => '"' + h + '"').join(' · ')
       + '\n         Emoji belong on Banner awards, where they mean something. As section markers they read as toy.'
       : '');

  /* ---- THE TRAP THAT CAME WITH THAT FIX ----------------------------
     Removing the emoji from a heading breaks the Spanish dictionary,
     which keys every translation on the EXACT English string. That is
     one fact with two writers, and it turned the gate red on .249 after
     the emoji were pulled and the dictionary was not. */
  const dictKeys = [...src.matchAll(/\n\s*"([^"\\]{4,90})"\s*:\s*"/g)].map(m => m[1]);
  const emojiKeys = dictKeys.filter(k => EMOJI.test(k));
  const orphans = emojiKeys.filter(k => src.indexOf('>' + k) < 0);
  ok('no translation key is stranded behind an emoji the markup dropped',
     orphans.length === 0,
     orphans.length ? orphans.slice(0, 4).map(k => '"' + k + '"').join(' · ')
       + '\n         These keys carry an emoji the English markup no longer has, so the lookup misses '
       + 'and the string renders untranslated. Strip the emoji from the key too.'
       : `${emojiKeys.length} emoji-bearing key(s) checked`);

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' · '));

  await b.close();
  const verdict = fail ? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`);
  bad.forEach(x => console.log('   x ' + x));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('palette.js could not run: ' + (e && e.stack || e)); process.exit(1); });
