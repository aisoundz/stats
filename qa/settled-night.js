#!/usr/bin/env node
/* ============ qa/settled-night.js ====================================
   A NIGHT THE SERVER SETTLED MUST NOT BE CALLED UNSETTLED.

   Measured 30 Aug 2026 from the founder's phone, seconds after Lynx at
   Dream went FINAL 81-89. The ending said:

       Hold on — 1 round is still unscored
       You answered a round that never came back with a score, so this
         total is not final. Tell the host…
       6 / 12 questions right

   Every word of that was false. Read from Firestore at the same minute:

       r0 scored/keyed4  r1 scored/keyed4  r2 scored/keyed4  r3 scored/keyed4
       Big Time  pts=135  live=130  caughtSrv=5  roundsDone=4

   Four of four scored, paid in full. His RING even read the right number,
   135, because the seat reconcile put it there. What was wrong was
   everything derived from `S.results`.

   CAUSE. confirmReview() is the only thing in the app that fills
   S.results, and it runs when the player walks through that round's
   reveal screen. A round the SERVER graded while the player was elsewhere
   — another tab, a locked phone, already on the ending — is paid and
   invisible: awardCtx() counts it as owed, and countGraded() drops its
   four questions out of the denominator, which is how 16 became 12.
   replayMissedRounds() cannot help, because it routes through
   onHostedRound(), which refuses by design any round this device has
   already submitted.

   The fix reads the server's own key and fills what the phone missed. It
   MUST NOT PAY — the points arrived through the server floor already, and
   a second copy would push the card above the board.

   No sabotage fallback is needed: on a build without
   reconcileResultsFromServer the first checks cannot run and go red.
   ================================================================== */
const PW = require('playwright');
const path = require('path');

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
  await p.waitForFunction(() => typeof window.awardCtx === 'function', { timeout: 25000 });

  console.log(`qa/settled-night.js — [${path.basename(TARGET)} · ${ENGNAME}]`);

  const r = await p.evaluate(async () => {
    const out = {};
    out.hasFn = typeof window.reconcileResultsFromServer === 'function';
    if (!out.hasFn) return out;

    S.mode = 'live'; S.name = 'QA';
    try { ledgerClear(); } catch (_) {}

    /* Four rounds, all answered on the phone. The player got Q1-Q3's
       reveal; Q4 was graded by the server while they were elsewhere, so
       the phone has answers for it and nothing else. This is the founder's
       exact shape. */
    const nR = Math.min(4, rounds.length);
    S.liveAnswers = []; S.results = [];
    for (let i = 0; i < nR; i++) {
      const qs = rounds[i].q || [];
      S.liveAnswers[i] = qs.map(() => ({ choice: 'A', bank: 0 }));
      S.results[i] = (i < nR - 1) ? qs.map(() => true) : [];   // last round: answered, ungraded
    }
    out.before = { unsettled: awardCtx(1, 2).unsettled, graded: countGraded().total };

    /* The server's view: every round keyed. Key 'A' on the first two
       questions of the last round and 'Z' on the rest, so a correct fill
       is distinguishable from a blanket true. */
    const lastQ = (rounds[nR - 1].q || []).length;
    window.SB = window.SB || {}; SB.enabled = true;
    /* The runner writes `idx` on every round doc, so the LAST round — the
       one that matters here — is delivered the way production delivers it.
       The earlier ones deliberately omit idx to exercise the id fallback,
       and one carries a junk id with no idx at all, which must be skipped
       without throwing rather than silently mis-placing a round. */
    SB.recentRounds = async () => {
      const list = [];
      for (let i = 0; i < nR; i++) {
        const qs = rounds[i].q || [];
        const key = qs.map((_, j) => (i === nR - 1 ? (j < 2 ? 'A' : 'Z') : 'A'));
        if (i === nR - 1) list.push({ id: 'r' + i, idx: i, state: 'scored', key });
        else              list.push({ id: 'r' + i,           state: 'scored', key });
      }
      list.push({ id: 'not-a-round-id', state: 'scored', key: ['A', 'A'] });
      return list;
    };

    const ptsBefore = S.pts;
    const ledgerBefore = JSON.stringify(ledger());
    out.filled = await window.reconcileResultsFromServer();

    out.after = { unsettled: awardCtx(1, 2).unsettled, graded: countGraded().total };
    out.lastResults = (S.results[nR - 1] || []).slice(0, lastQ);
    out.expectHits = 2;
    out.ptsUnchanged = (S.pts === ptsBefore);
    out.ledgerUnchanged = (JSON.stringify(ledger()) === ledgerBefore);

    /* It must not invent a verdict for a question nobody answered. */
    S.results[nR - 1] = [];
    S.liveAnswers[nR - 1] = (rounds[nR - 1].q || []).map((_, j) => j === 0 ? { choice: 'A', bank: 0 } : { choice: null, bank: 0 });
    await window.reconcileResultsFromServer();
    const rr = S.results[nR - 1] || [];
    out.onlyAnswered = rr[0] === true && rr.slice(1).every(v => v === undefined || v === null);

    return out;
  });

  ok('the app can reconcile round results from the server', r.hasFn,
     r.hasFn ? '' : 'reconcileResultsFromServer() does not exist — a round the server scored while the '
     + 'player was elsewhere stays invisible and the ending calls a settled night unsettled');

  if (r.hasFn) {
    ok('a settled night stops reporting an unscored round',
       r.before.unsettled === 1 && r.after.unsettled === 0,
       `unsettled went ${r.before.unsettled} -> ${r.after.unsettled}; it must reach 0 once the server's key is read`);

    ok('the missing round rejoins the questions-right denominator',
       r.after.graded > r.before.graded,
       `graded questions went ${r.before.graded} -> ${r.after.graded}. The founder's screen read 6/12 on a `
       + 'night with four rounds because a whole round was missing from the count');

    ok('it grades against the key, not blanket-true',
       Array.isArray(r.lastResults) && r.lastResults.filter(v => v === true).length === r.expectHits,
       `filled ${JSON.stringify(r.lastResults)} — exactly ${r.expectHits} of them should be true`);

    ok('it pays nothing', r.ptsUnchanged && r.ledgerUnchanged,
       `pts unchanged=${r.ptsUnchanged} ledger unchanged=${r.ledgerUnchanged}. The points already arrived `
       + 'through the server floor; a second copy would push the card above the board');

    ok('it invents no verdict for a question nobody answered', r.onlyAnswered === true,
       'a question the player never answered was given a result — that counts a miss against them on '
       + 'something they never saw');
  }

  /* The screen must not argue with itself. */
  const sub = await p.evaluate(() => {
    if (typeof window.prSubSay !== 'function') return { has: false };
    const el = document.getElementById('prSub');
    if (!el) return { has: true, el: false };
    prSubSay('settling'); const settling = el.textContent || '';
    prSubSay('manual');   const manual   = el.textContent || '';
    return { has: true, el: true, settling, manual };
  });
  ok('the final-buzzer screen has one instruction, not two',
     sub.has && sub.el && /nothing to enter/i.test(sub.settling) && /enter the official results/i.test(sub.manual),
     !sub.has ? 'prSubSay() does not exist — the subtitle still says "Enter the official results" while the '
              + 'card under it says "nothing for you to do"'
     : !sub.el ? '#prSub not found'
     : `settling="${sub.settling.slice(0,60)}" manual="${sub.manual.slice(0,60)}"`);

  /* The resume bar must not send somebody back into a round that finished. */
  const src = await p.evaluate(() => document.documentElement.innerHTML.length);
  const resume = require('fs').readFileSync(TARGET, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok('the resume bar does not offer a round on a night that is over',
     /nightIsOver\(\)/.test(resume.slice(resume.indexOf('roomNextRound(S.nextQ'), resume.indexOf('roomNextRound(S.nextQ') + 900)),
     'Home said "Continue tonight\'s game · Q4 is open — answer now" AFTER the game went final, because it '
     + 'read this device\'s cached round doc instead of asking whether the night was over');

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' · '));

  await b.close();
  const verdict = fail ? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`);
  bad.forEach(x => console.log('   x ' + x));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('settled-night.js could not run: ' + (e && e.stack || e)); process.exit(1); });
