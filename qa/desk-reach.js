/* ============ qa/desk-reach.js ======================================
   THE PICK SHEET ON A SCREEN THAT IS NOT A PHONE.

   Founder, 24 August, on a 1850x1053 desktop in a live basketball room,
   card 4 of 6 ("MOST ASSISTS", 50 pts, +50 for the exact number):

     "theres no place for me to put my point in and press next. I still
      gotta scroll all the way to the bottom on the desktop. Gotta be
      better"

   Note the "still". This was reported on 22 August, fixed, and shipped
   with a QA suite (qa/pick-reach.js) that has been green ever since — at
   375x667 and 393x852. Both phones. The fix was two pinned controls, and
   both of them deliberately UN-pinned themselves on a large viewport:

     @media (min-width:560px){ #nextBtn{position:static} }
        "On a desktop the page is short enough that pinning is noise."
     @media (min-height:860px){ #pdBar{position:static} }
        "On a tall screen the viewport floor is nowhere near the card —
         pinning there strands the button in empty space."

   Both premises are false for this app, and false for the same reason:
   it renders as a fixed ~430px column, so the height of a twelve-name
   roster does not change when the screen gets wider. The founder's
   viewport is 1053px tall, the rule fired, #pdBar dropped out of its
   shelf into the bottom of a 1,434px deck, and Next was 416px below the
   fold. Measured on the shipped build, 24 Aug:

     1850x1053  bar static   Next y=1469   number field y=1310   (vh 1053)
     1366x625   #nextBtn static, y=808 on the live reveal        (vh  625)

   THE SHAPE OF THE MISS IS THE POINT. Every check that existed asked
   "is the control pinned" and "is it on screen" at a phone size. Nothing
   asked the same question one viewport to the right, so a rule whose
   whole job was to change behaviour at 560px and 860px was never once
   evaluated above 560px or above 852px. A media query nobody tests is a
   second, unwatched build.

   So this suite runs the reported case at the reported size, and it runs
   the phone alongside it in the same file — because the phone behaviour
   was hard-won against real demo feedback and the desktop fix must not
   buy itself out of the phone's pocket.

   ENGINE IS SELECTABLE and both run by default. A suite added earlier
   today hardcoded chromium; this box runs Firefox for the app and a
   layout bug that only exists in one engine is a layout bug.

   WebKit is NOT in the default list, and that is an admission rather than
   a choice: `pw.webkit` crashes the page on this Jetson on index.html and
   index-test.html alike, so it is a box limit, not a build difference.
   `--engine webkit` still runs it, and it should be run on a machine where
   it works before anyone claims Safari coverage for this layout.

     node qa/desk-reach.js                      both engines, index-test
     node qa/desk-reach.js --engine firefox
     node qa/desk-reach.js --file index.html    what is live right now
     node qa/desk-reach.js /abs/path.html       positional, for qa/all.js
   ================================================================== */
const pw = require('playwright');
const path = require('path');
const { waitReady } = require('./ready.js');

const ARG = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = ARG.indexOf(flag); return (i >= 0 && ARG[i+1]) ? ARG[i+1] : dflt; };
/* A POSITIONAL TARGET TOO, because qa/all.js hands one to every suite in
   its TARGETABLE set and a suite that ignores it grades whichever build it
   felt like while the banner says otherwise. That is the one-fact-many-
   copies bug all.js exists to prevent, and seventy checks once shipped
   green having silently judged the file that was already live. */
const POS = ARG.filter((a, i) => !a.startsWith('--') && !(i > 0 && ARG[i-1].startsWith('--')));
const TARGET = POS[0] || argOf('--file', 'index-test.html');
const FILE = 'file://' + (path.isAbsolute(TARGET) ? TARGET : path.join(__dirname, '..', TARGET));
const ENGINES = argOf('--engine', 'firefox,chromium').split(',').map(s => s.trim()).filter(Boolean);

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
/* A pass and a failure are different sentences. Printing the failure
   explanation next to `ok` is how a green log ends up reading like a bug
   report and nobody trusts either line. */
const is  = (cond, n, okD, failD) => cond ? ok(n, okD) : bad(n, failD === undefined ? okD : failD);

/* The founder's screen first, then the sizes either side of it, then the
   phones the 22 Aug fix was tuned for, then the tall phone that the
   min-height:860px rule silently un-pinned. Every one of these is a real
   machine somebody plays on; none of them is a round number chosen to
   make a check pass. */
const DESKTOP = [
  { n: "Founder's desktop", w: 1850, h: 1053, wide: true },
  { n: 'Desktop 1920',      w: 1920, h: 1080, wide: true },
  { n: 'Laptop 1440',       w: 1440, h:  820, wide: true },
  { n: 'Laptop 1366x768',   w: 1366, h:  625, wide: true },
];
const PHONE = [
  { n: 'iPhone SE',      w: 375, h:  667 },
  { n: 'iPhone 15',      w: 393, h:  852 },
  { n: 'iPhone Pro Max', w: 430, h:  932 },   // past the old 860px cliff
];

/* ---- determinism ---------------------------------------------------
   predJump() scrolls with behavior:'smooth', and a repaint changes the
   page height. Measuring while either is still moving is how a layout
   suite starts giving a different answer every run — and a flaky suite
   gets read as a product bug, which is the more expensive mistake.

   So wait for the page to STOP rather than guessing how long it takes,
   and watch the whole signature: which card is up, how many options it
   drew, how tall the document is and where it is scrolled. Two identical
   consecutive reads, not a sleep. */
async function settle(p, tries) {
  let last = null;
  for (let i = 0; i < (tries || 25); i++) {
    const sig = await p.evaluate(() => {
      const d = document.scrollingElement || document.documentElement;
      return [ (typeof PD !== 'undefined' ? PD.i : -1),
               document.querySelectorAll('#predCard .pdopt').length,
               Math.round(d.scrollHeight), Math.round(d.scrollTop) ].join('/');
    });
    if (last !== null && sig === last) return sig;
    last = sig;
    await p.waitForTimeout(90);
  }
  return last;
}

/* One read, one snapshot, so every assertion below is talking about the
   same instant. */
const look = (p) => p.evaluate(() => {
  const vh = window.innerHeight;
  const doc = document.scrollingElement || document.documentElement;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
             onScreen: r.bottom > 0 && r.top < vh && r.width > 0 && r.height > 0 };
  };
  /* What is ACTUALLY at the middle of each visible option. A fixed
     element on top of an answer is unreachable at every scroll position;
     a sticky one moves out of the way if you scroll, which is what
     sticky is for. Only the fixed case is a bug. Same rule as
     qa/pick-reach.js, deliberately — two suites disagreeing about what
     "covered" means is worse than one of them being wrong. */
  const covered = [];
  document.querySelectorAll('#predCard .pdopt').forEach((o, i) => {
    const r = o.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh) return;
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    if (!hit || o === hit || o.contains(hit) || hit.contains(o)) return;
    let n = hit, fixed = null;
    while (n && n !== document.body) { if (getComputedStyle(n).position === 'fixed') { fixed = n; break; } n = n.parentElement; }
    if (fixed) covered.push('option ' + (i + 1) + ' under fixed ' + (fixed.id ? '#' + fixed.id : fixed.tagName));
  });
  const sp = document.getElementById('s-predict');
  const bar = document.getElementById('pdBar');
  return {
    vh, vw: window.innerWidth,
    scrollTop: Math.round(doc.scrollTop),
    scrollable: Math.round(doc.scrollHeight - doc.clientHeight),
    fitpin: !!(sp && sp.classList.contains('fitpin')),
    barPos: bar ? getComputedStyle(bar).position : '(none)',
    bar:  box(bar),
    next: box(document.querySelector('#pdBar [data-pdgo="1"]')),
    back: box(document.querySelector('#pdBar [data-pdgo="-1"]')),
    lock: box(document.getElementById('pdLock')),
    num:  box(document.querySelector('#predCard .pdbonus input')),
    q:    box(document.querySelector('#predCard .pdq')),
    card: box(document.getElementById('predCard')),
    nexts: document.querySelectorAll('[data-pdgo="1"]').length,
    nums:  document.querySelectorAll('#predCard .pdbonus input').length,
    /* Diagnostics, so a failure says WHICH card it was looking at. A
       geometry failure that does not name the card it measured is
       unactionable and gets blamed on the wrong thing. */
    pdi: (typeof PD !== 'undefined' ? PD.i : -1),
    opts: document.querySelectorAll('#predCard .pdopt').length,
    /* How many columns the roster is actually drawn in, asked of the
       browser rather than inferred from the media query we hope fired.
       This is the check that catches a wide-desktop layout leaking down
       onto a phone — the card's own WIDTH cannot, because `.phone` is
       `width:100%` and clamps it to the viewport either way, so a 640px
       two-column grid inside a 343px card reports as "343px wide" and
       looks fine while the second column hangs off the screen. */
    optCols: (function(){ const o = document.querySelector('#predCard .pdopts.many');
      return o ? getComputedStyle(o).gridTemplateColumns.trim().split(/\s+/).length : 0; })(),
    /* Nothing in this app should ever scroll sideways. */
    hscroll: Math.round(doc.scrollWidth - doc.clientWidth),
    footBottom: (function(){ const f = document.getElementById('predFoot');
      return f ? Math.round(f.getBoundingClientRect().bottom + doc.scrollTop) : -1; })(),
    navTop: (function(){ const n = document.getElementById('botnav');
      return n ? Math.round(n.getBoundingClientRect().top) : -1; })(),
    covered
  };
});

/* Land on the card the founder was on: the long roster that also carries
   the +50 exact-number field. Chosen by shape, not by index, so it does
   not silently start testing the two-option "winning team" card if the
   deck is ever reordered. */
async function toLongBonusCard(p) {
  const found = await p.evaluate(async () => {
    for (let i = 0; i < preds.length; i++) {
      try { predJump(i); } catch (_) {}
      await new Promise(r => setTimeout(r, 130));
      const n = document.querySelectorAll('#predCard .pdopt').length;
      const bonus = !!document.querySelector('#predCard .pdbonus input');
      if (n >= 8 && bonus) return { i, n, label: preds[i].label };
    }
    return { i: -1, n: 0 };
  });
  await settle(p);
  return found;
}

async function boot(b, vp, sport) {
  const p = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message || e)));
  await p.goto(FILE + '?sport=' + (sport || 'basketball'), { waitUntil: 'domcontentloaded' });
  await waitReady(p);
  /* ============ PIN THE FEED, OR MEASURE A MOVING PAGE ===============
     This suite went red once and green the next run on the same file, and
     the cause was not the product. startPredict() ends with
     `loadInactives()`, which awaits loadGameStats() — a live ESPN fetch —
     and then calls buildPred() AGAIN and inserts an #inactiveBar above the
     card. So the deck re-renders and the page changes height at whatever
     moment the network answers, which on a file:// page is somewhere
     between "instantly, failed" and "seconds". Geometry read across that
     boundary is a coin toss, and a flaky layout suite gets diagnosed as a
     product bug and burns a gate. That has happened twice today already.

     GS.ok is also unsafe to merely set false: loadGameStats is async and
     its `if(GS.ev!==ev){GS.ok=false;}` runs synchronously before its first
     await, so the value can flip underneath a caller. So this does not set
     a flag, it removes the caller — the pick sheet is a pre-game screen
     and the injury overlay is a different feature with its own coverage.
     Stubbed BEFORE startPredict(), which is the only thing that calls it. */
  await p.evaluate(() => {
    try { window.loadGameStats = async function(){ return null; }; } catch (_) {}
    try { GS.ok = false; GS.ev = null; GS.inj = null; } catch (_) {}
  });
  await p.evaluate(() => { startDemo(); S.name = 'QA'; startPredict(); });
  await settle(p);
  return { p, errs };
}

/* ================= THE REPORTED CASE ============================== */
async function desktopChecks(b, vp, eng) {
  const { p, errs } = await boot(b, vp);
  console.log('\n  ── ' + vp.n + ' (' + vp.w + 'x' + vp.h + ') [' + eng + ']');

  const card = await toLongBonusCard(p);
  is(card.i >= 0, 'found the long roster card with a +50 number field',
     card.i >= 0 ? '"' + card.label + '", ' + card.n + ' options'
                 : 'no card on this sheet has 8+ options AND a bonus field — that IS the founder\'s card, ' +
                   'so without it this suite is not exercising the reported case');
  if (card.i < 0) { await p.close(); return; }

  /* ---- 1. THE SCREEN IS USED ----------------------------------------
     The scroll was self-inflicted: 408px of roster in the middle of
     1850px of black. This is the substantive fix and the reason the
     other checks are easy to pass. */
  const a = await look(p);
  is(a.card && a.card.w > 800, 'the deck is given the width of the screen',
     a.card ? a.card.w + 'px of card in a ' + vp.w + 'px viewport' : '',
     a.card ? 'only ' + a.card.w + 'px of card in a ' + vp.w + 'px viewport — a 430px phone column on a desktop ' +
              'is what makes a card that would fit twice over need a scroll' : 'no card');
  is(a.optCols === 3, 'the roster uses the width it has been given',
     'the names are in ' + a.optCols + ' columns',
     'the roster is in ' + a.optCols + ' column(s) at ' + vp.w + 'px — a 600px column holding one file of names ' +
     'is the scroll this was supposed to delete');
  is(a.hscroll <= 1, 'the desktop does not scroll sideways', '',
     a.hscroll + 'px of horizontal scroll');

  /* ---- 2. THE FOUNDER'S BLOCKER -------------------------------------- */
  is(a.next && a.next.onScreen, 'the way forward is on screen the moment you arrive on the card',
     a.next ? 'Next at y=' + a.next.top + ' of ' + vp.h + ' (bar is position:' + a.barPos + ')' : '',
     a.next ? 'Next is at y=' + a.next.top + ' on a ' + vp.h + 'px viewport (bar is position:' + a.barPos + ') — ' +
              'this is the report: "I still gotta scroll all the way to the bottom on the desktop"' : 'Next is not rendered');
  is(a.back && a.back.onScreen, 'Back is on screen the moment you arrive on the card',
     a.back ? 'y=' + a.back.top + ' of ' + vp.h : '',
     a.back ? 'y=' + a.back.top + ' on a ' + vp.h + 'px viewport' : 'not rendered');

  /* ---- 3. "NO PLACE FOR ME TO PUT MY POINT IN" -----------------------
     The bonus fragment renders after the full roster. It is a real
     <input type=number>, and on the shipped build it was 1,310px down a
     1,053px screen — below twenty-nine names — while the stake line four
     inches above it said "+50 for the exact number". */
  is(a.nums === 1, 'the exact-number field exists and there is exactly one of it', a.nums + ' found');
  is(a.num && a.num.onScreen, 'the exact-number field is on screen the moment you arrive on the card',
     a.num ? 'y=' + a.num.top + ' of ' + vp.h : '',
     a.num ? 'it is at y=' + a.num.top + ' on a ' + vp.h + 'px viewport — the card offers +50 for a number and ' +
             'hides the box you type it into below the roster' : 'no number input rendered');

  /* ---- 4. AND IT STAYS THERE ----------------------------------------
     A player reads the question, scrolls the roster looking for a name,
     and types the number last. If the field leaves the screen while they
     are looking for the name, it is hidden at the exact moment they need
     it. */
  await p.evaluate(() => { const d = document.scrollingElement || document.documentElement; d.scrollTop = d.scrollHeight; });
  await settle(p);
  const bot = await look(p);
  is(bot.num && bot.num.onScreen, 'the exact-number field is still on screen at the BOTTOM of the roster',
     bot.num ? 'y=' + bot.num.top + ' of ' + vp.h : 'not rendered');
  is(bot.next && bot.next.onScreen, 'the way forward is still on screen at the BOTTOM of the roster',
     bot.next ? 'y=' + bot.next.top + ' of ' + vp.h : 'not rendered');
  is(bot.q && bot.q.onScreen, 'the question you are answering is still on screen at the BOTTOM of the roster',
     bot.q ? 'y=' + bot.q.top + ' of ' + vp.h : 'not rendered');

  /* ---- 5. NOTHING IS PARKED ON THE ANSWERS -------------------------- */
  is(bot.covered.length === 0, 'no fixed control is sitting on a visible answer', '',
     bot.covered.slice(0, 3).join('; '));

  /* ---- 6. IT ACTUALLY WORKS, not merely renders ---------------------- */
  await p.click('#predCard .pdopt').catch(() => {});
  await settle(p);
  const picked = await look(p);
  is(picked.lock && picked.lock.onScreen, 'the lock button is on screen once you have picked',
     picked.lock ? 'y=' + picked.lock.top + ' of ' + vp.h : 'not rendered');

  const typed = await p.evaluate(async () => {
    const el = document.querySelector('#predCard .pdbonus input');
    if (!el) return { err: 'no field' };
    const r = el.getBoundingClientRect();
    if (!(r.bottom > 0 && r.top < window.innerHeight)) return { err: 'off screen at y=' + Math.round(r.top) };
    el.focus(); el.value = '17';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r2 => setTimeout(r2, 120));
    const id = predOrderList()[PD.i].id;
    return { stored: S.predChoices[id + '_num'] };
  });
  is(typed.stored === '17', 'a number typed into the field is actually recorded',
     'S.predChoices[..._num] = "17"',
     typed.err ? ('could not type into it: ' + typed.err) : ('S.predChoices[..._num] = ' + JSON.stringify(typed.stored)));

  const before = await p.evaluate(() => PD.i);
  await p.click('#pdBar [data-pdgo="1"]').catch(() => {});
  await p.waitForTimeout(300); await settle(p);
  const after = await p.evaluate(() => PD.i);
  is(after === before + 1, 'the pinned Next advances the card', before + ' -> ' + after);

  /* ---- 7. ONE CONTROL, ONE JOB --------------------------------------
     index.html:10069 — Back and Next were MOVED into #pdBar, not copied:
     "two controls for one job is how a player ends up with a Next that
     disagrees with a Next". A desktop layout that solves reachability by
     adding a second Next has not solved it. */
  is(picked.nexts === 1, 'there is exactly one Next on the screen', '',
     picked.nexts + ' found — a desktop layout must MOVE the control, never duplicate it');

  is(errs.length === 0, 'no page errors', '', errs.slice(0, 2).join(' | '));
  await p.close();
}

/* ================= THE PHONE MUST NOT PAY FOR IT ==================== */
async function phoneChecks(b, vp, eng) {
  const { p, errs } = await boot(b, vp);
  console.log('\n  ── ' + vp.n + ' (' + vp.w + 'x' + vp.h + ') [' + eng + ']');

  const card = await toLongBonusCard(p);
  if (card.i < 0) { bad('found the long roster card', 'none on this sheet'); await p.close(); return; }

  await p.click('#predCard .pdopt').catch(() => {});
  await settle(p);
  const a = await look(p);

  /* The deck stays a phone column. The wide layout is one media query and
     it must not leak down here — three columns of roster names at 393px
     is "Kelsey Mitc…" and a clipped (OUT) flag, which is the exact bug
     the one-column fallback at 520px exists to prevent. */
  is(a.card && a.card.w <= 440, 'the phone deck is still a single phone-width column',
     a.card ? a.card.w + 'px wide at ' + vp.w + 'px' : '',
     a.card ? a.card.w + 'px wide at ' + vp.w + 'px — the wide desktop layout has leaked onto a phone, where ' +
              'three columns of names render as "Kelsey Mitc…" with the (OUT) flag clipped off' : 'no card');
  is(a.optCols === 1, 'the roster is ONE column of names on a phone',
     'grid-template-columns has ' + a.optCols + ' track',
     'the roster is drawn in ' + a.optCols + ' columns at ' + vp.w + 'px — below 520px this deck goes to one ' +
     'column on purpose: at two, "Kelsey Mitchell" renders as "Kelsey Mitc…" and the (OUT) flag on an injured ' +
     'player is clipped off entirely');
  is(a.hscroll <= 1, 'the phone does not scroll sideways', '',
     a.hscroll + 'px of horizontal scroll — something is wider than the phone it is drawn on');

  /* A twenty-nine-name roster does not fit any phone, so the bar must be
     pinned — including on a 932px-tall Pro Max, which the old
     min-height:860px rule un-pinned. */
  is(a.scrollable > 400, 'the roster really is longer than this phone',
     a.scrollable + 'px of scroll',
     'only ' + a.scrollable + 'px of scroll — under that, the checks below are measuring the easy case, ' +
     'not the twenty-nine-name roster this is about');
  is(a.barPos === 'fixed', 'the action bar is pinned on a phone the roster overflows',
     'position:' + a.barPos + ' at ' + vp.w + 'x' + vp.h +
     (vp.h >= 860 ? ' — the viewport the old min-height:860px rule un-pinned' : ''),
     'position:' + a.barPos + ' at ' + vp.w + 'x' + vp.h + ' with ' + a.scrollable + 'px of scroll under it — ' +
     'the way forward is at the bottom of a roster again' +
     (vp.h >= 860 ? ', which is exactly what min-height:860px used to do here' : ''));
  is(a.next && a.next.onScreen, 'Next is on screen', a.next ? 'y=' + a.next.top : 'not rendered');
  is(a.lock && a.lock.onScreen, 'Lock is on screen', a.lock ? 'y=' + a.lock.top : 'not rendered');

  /* The pinned bar's pixel budget. A third row took it from 70px to 112px
     and put #pdBar over the answer "Miami Dolphins" on a 375-tall phone. */
  const budget = Math.round(vp.h * 0.16);
  is(a.bar && a.bar.h > 0 && a.bar.h <= budget, 'the pinned bar stays inside its pixel budget',
     (a.bar ? a.bar.h : -1) + 'px of ' + vp.h + ' (max ' + budget + ')');

  await p.evaluate(() => { const d = document.scrollingElement || document.documentElement; d.scrollTop = d.scrollHeight; });
  await settle(p);
  const bot = await look(p);
  is(bot.next && bot.next.onScreen, 'Next is still on screen at the bottom of the roster',
     bot.next ? 'y=' + bot.next.top : 'not rendered');
  is(bot.covered.length === 0, 'no fixed control is sitting on a visible answer', '',
     bot.covered.slice(0, 3).join('; '));

  is(errs.length === 0, 'no page errors', '', errs.slice(0, 2).join(' | '));
  await p.close();
}

/* ================= THE DECISION IS MEASURED, NOT GUESSED ============
   The whole point of the change is that pinning now answers "does the
   deck overflow this screen", which a media query cannot ask. So prove
   it moves in BOTH directions on ONE viewport — same window, same
   engine, two cards. A rule that only ever returns one answer is a
   constant wearing a measurement's clothes, and the first version of
   this fix was exactly that: it asked scrollHeight>clientHeight, which
   is true on every screen this app has (`.phone` is min-height:100dvh
   and body.hasnav adds 74px outside it), so it never once un-pinned. */
async function measuredChecks(b, eng) {
  /* THE FOUNDER'S OWN SCREEN, and it took two wrong guesses to get here.
     1850x1400 was the first: the wide two-column deck fits twenty-nine
     names there with room to spare, so BOTH cards came back "fits" and the
     check could not tell a measurement from a constant. 1850x1200 was the
     second, and it fits too once the injury bar is stubbed out — which is
     the harness's own doing, so the check moved rather than the stub.

     1850x1053 is the size the bug was reported at, and it is the size where
     the two cards genuinely disagree: a two-option card clears the nav with
     400px to spare and a twenty-nine-name roster does not clear it at all.
     One window, one engine, two answers — which is the only thing that
     distinguishes a measurement from a constant. */
  const vp = { n: "Founder's desktop 1850x1053", w: 1850, h: 1053 };
  const { p, errs } = await boot(b, vp);
  console.log('\n  ── the decision is measured, not a viewport size (' + vp.w + 'x' + vp.h + ') [' + eng + ']');

  const long = await toLongBonusCard(p);
  const a = await look(p);

  const short = await p.evaluate(async () => {
    for (let i = 0; i < preds.length; i++) {
      try { predJump(i); } catch (_) {}
      await new Promise(r => setTimeout(r, 130));
      if (document.querySelectorAll('#predCard .pdopt').length <= 4) return { i, n: document.querySelectorAll('#predCard .pdopt').length };
    }
    return { i: -1 };
  });
  await settle(p);
  const s = await look(p);

  is(short.i >= 0 && long.i >= 0, 'the deck has both a short card and a long one to compare',
     'short=' + JSON.stringify(short) + ' long=' + JSON.stringify({ i: long.i, n: long.n }));

  const dump = (x) => 'card ' + x.pdi + ' / ' + x.opts + ' options, cardH=' + (x.card ? x.card.h : -1) +
                      ', fitpin=' + x.fitpin + ', position:' + x.barPos + ', scroll=' + x.scrollable +
                      ', foot bottom ' + x.footBottom + ' vs nav top ' + x.navTop;

  is(s.fitpin === true && s.barPos === 'static',
     'a card that FITS puts the controls back in the flow', dump(s),
     dump(s) + ' — a ' + short.n + '-option card on a ' + vp.h + 'px screen does not need a pinned bar, ' +
     'and a bar pinned over empty space is the noise the original media query was right to worry about');

  is(a.fitpin === false && a.barPos === 'fixed',
     'a card that does NOT fit pins them, on the very same screen', dump(a),
     dump(a) + ' — if this and the check above ever agree, the condition is not measuring anything');

  is(errs.length === 0, 'no page errors', '', errs.slice(0, 2).join(' | '));
  await p.close();
}

/* ================= THE LIVE LOOP, WHICH HAPPENS SIXTEEN TIMES ======
   #nextBtn is the other control with a viewport-size proxy on it, and
   the sentence above it says "the button below". A 1366x768 laptop is
   past min-width:560px, so it was static, and the reveal put it at
   y=808 on a 625px viewport. */
async function liveChecks(b, vp, eng) {
  const { p, errs } = await boot(b, vp);
  console.log('\n  ── live question confirm, ' + vp.n + ' (' + vp.w + 'x' + vp.h + ') [' + eng + ']');

  await p.evaluate(() => { try { startQuarter(0); } catch (_) {} });
  await p.waitForTimeout(500); await settle(p);
  const tapped = await p.evaluate(() => {
    const o = document.querySelector('#qOpts .opt, #qOpts button');
    if (!o) return false;
    o.click(); return true;
  });
  is(tapped, 'the live question offers an answer to tap');
  if (!tapped) { await p.close(); return; }
  await p.waitForTimeout(500); await settle(p);

  const nb = await p.evaluate(() => {
    const b2 = document.getElementById('nextBtn');
    if (!b2) return { there: false };
    const cs = getComputedStyle(b2), r = b2.getBoundingClientRect();
    return { there: cs.display !== 'none', pos: cs.position, top: Math.round(r.top), vh: window.innerHeight,
             onScreen: r.bottom > 0 && r.top < window.innerHeight && r.height > 0,
             label: (b2.textContent || '').trim(),
             count: document.querySelectorAll('#nextBtn').length };
  });
  is(nb.there, 'the confirm button appears after answering', '"' + (nb.label || '') + '"', 'it is still display:none');
  is(nb.onScreen, 'the confirm button is on screen without scrolling',
     '"' + nb.label + '" at y=' + nb.top + ' of ' + nb.vh + ', position:' + nb.pos,
     '"' + nb.label + '" is at y=' + nb.top + ' on a ' + nb.vh + 'px viewport (position:' + nb.pos + ') — the reveal ' +
     'copy points at "the button below" and here it is below the fold');
  is(nb.count === 1, 'there is exactly one confirm button', nb.count + ' found', nb.count + ' found');

  is(errs.length === 0, 'no page errors', '', errs.slice(0, 2).join(' | '));
  await p.close();
}

(async () => {
  console.log('  desk-reach — ' + TARGET + ' — engines: ' + ENGINES.join(', '));
  for (const eng of ENGINES) {
    if (!pw[eng]) { bad('engine ' + eng + ' exists in playwright'); continue; }
    const b = await pw[eng].launch();
    for (const vp of DESKTOP) await desktopChecks(b, vp, eng);
    for (const vp of PHONE)   await phoneChecks(b, vp, eng);
    await measuredChecks(b, eng);
    await liveChecks(b, { n: 'Laptop 1366x768', w: 1366, h: 625 }, eng);
    await liveChecks(b, { n: "Founder's desktop", w: 1850, h: 1053 }, eng);
    await b.close();
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FATAL ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
