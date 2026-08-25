#!/usr/bin/env node
/* ============================================================================
   qa/ci-window.js — ONE ANSWER WINDOW, ACROSS THREE FILES AND TWO MODES

   The founder asked for a longer Caught It window. He said 40 000. The
   number that shipped is 28 000, and the arithmetic is his own runner log:

     · a new question cannot open until the previous answer publishes;
     · the runner only notices that on its poll, ~31s;
     · the release lands on the first tick at or after open + locks + 1200.

   So a window up to 29.8s rides a tick that was already coming and costs
   nothing, and 30 000+ misses it and costs a whole extra poll — halving
   the question rate in exactly the rooms that are behind. 28s is 40 % more
   answering time for free; 40s would halve the questions to pay for it.

   THE TWO FAILURES THIS SUITE EXISTS TO PREVENT.

   B23 — the phone out-waiting the host. The document written to every
   phone said one thing and the timer that publishes the answer said
   another, and for 1.8 seconds the answer was public while the card was
   still live. A player tapping in that window had the card swap to the
   resolved view mid-tap and was graded as having sat it out. The rule that
   kills it forever: THE PHONE'S WINDOW MAY NEVER OUTLAST THE HOST'S
   SECRECY DEADLINE. That is check "the phone can never out-wait the host"
   below, run against every kind the host can produce.

   THE 9-SECOND VOICE BUG — practice and live disagreeing. "Practice mode
   has always run 20000, which is why voice worked in rehearsal and could
   not work in a room." Practice had its OWN copy of the window, six
   thousand lines from the live one, free to drift. The founder is demoing
   on practice this Wednesday. Check "practice counts against the same
   window as live" is the one that catches it, and it reads the number off
   a REAL practice card rather than out of the source.

   Deliberately NOT asserted here: the broadcast delay. A longer window is
   the wrong instrument for the feed running ahead of the television —
   that needs a delay before the question OPENS, which is separate work
   and needs measurement first.

   SABOTAGE:  node qa/ci-window.js --file index.html --admin admin.html
              (the un-migrated pair: eleven literals, two of them practice's
               own, and a host on 20000/15000)
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const playwright = require('playwright');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');

const ROOT = path.join(__dirname, '..');
const ARG = process.argv.slice(2);
const argOf = (f, d) => { const i = ARG.indexOf(f); return i >= 0 ? ARG[i + 1] : d; };
const PHONE = argOf('--file', 'index-test.html');
const HOST = argOf('--admin', PHONE === 'index.html' ? 'admin.html' : 'admin-test.html');
const ENGINES = argOf('--engine', 'chromium,firefox').split(',').map(s => s.trim()).filter(Boolean);

/* The poll budget, from the runner's own log. Not a preference — the point
   past which a window stops being free. */
const FREE_UP_TO = 29800;
const PUBLISH_DELAY = 1200;      // run.js: at = Date.now() + locks + 1200

let pass = 0, fail = 0; const bad = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { fail++; bad.push(label + (detail ? '\n      ' + detail : '')); console.log('  \x1b[31m✗ ' + label + '\x1b[0m'); }
}

/* ---------------- the host's owner, loaded the way run.js loads it ----- */
const hostSrc = fs.readFileSync(path.join(ROOT, HOST), 'utf8');
const SS = '/* @host-shared:start', EE = '/* @host-shared:end */';
const a = hostSrc.indexOf(SS), b = hostSrc.indexOf(EE);
if (a < 0 || b < 0) { console.error('FAIL: no @host-shared sentinels in ' + HOST); process.exit(1); }
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(hostSrc.slice(a, b + EE.length), ctx, { filename: 'host-shared' });
const C = ctx.AUTO && ctx.AUTO.CI;

console.log('\n  CAUGHT IT — THE ANSWER WINDOW\n  phone: ' + PHONE + '   host: ' + HOST + '\n');

ok(!!(C && typeof C.lockMsFor === 'function'), 'the host owner loads', 'AUTO.CI.lockMsFor');
if (!C || typeof C.lockMsFor !== 'function') { console.log('cannot continue'); process.exit(1); }

/* Every kind family the builders can emit, plus the two the predicate used
   to split on and one it has never seen. */
const KINDS = ['saw-shot', 'saw-pitch', 'qtrFirst', 'qtrThrees', 'qtrMore',
               'run', 'nextScore', 'inningEnd', 'margin', '', null, 'something-new'];
const wins = KINDS.map(k => C.lockMsFor(k));
const uniq = [...new Set(wins)];

ok(uniq.length === 1,
   'one window, whatever the kind',
   'lockMsFor gave ' + JSON.stringify(uniq) + ' across ' + KINDS.length + ' kinds. The 20000/' +
   '15000 tiering bought five seconds nobody asked for and gave B23 a predicate to disagree ' +
   'about across two files. One number is one number to get wrong.');

const HOSTWIN = wins[0];
ok(HOSTWIN === 28000,
   'the window is 28 seconds',
   'lockMsFor = ' + HOSTWIN + '. 40000 was asked for; the runner log says a question cannot ' +
   'open until the previous answer publishes and the poll is ~31s, so 28000 is the largest ' +
   'window that still rides a tick that was coming anyway.');

ok(HOSTWIN + PUBLISH_DELAY <= FREE_UP_TO + PUBLISH_DELAY && HOSTWIN <= FREE_UP_TO,
   'the window is free — it does not cost the room an extra poll',
   'window ' + HOSTWIN + 'ms, publish at +' + PUBLISH_DELAY + 'ms, free up to ' + FREE_UP_TO +
   'ms. 30000 and over slips past the tick and costs a whole poll, halving the question rate ' +
   'exactly when a room is catching up.');

/* ---------------- the Control Room floor -------------------------------- */
/* Slice the function by brace matching, then take its LAST return — the
   fallback, the one reached when the shared block did not load. Matching
   the first `return` in the text picks up the delegation inside the try
   and reports a healthy floor whatever the literal says. */
function fnBody(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  let depth = 0, j = src.indexOf('{', at);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, j + 1);
}
const floorBody = fnBody(hostSrc, 'function lockMsFor(kind)');
const rets = [...floorBody.matchAll(/return\s+([^;]+);/g)].map(m => m[1].trim());
const floorTxt = rets.length ? rets[rets.length - 1] : '(not found)';
const floorVal = (() => {
  try { return vm.runInNewContext('(function(kind){ return ' + floorTxt + '; })', {})('qtrFirst'); }
  catch (_) { return null; }
})();
ok(floorVal !== null && floorVal >= HOSTWIN,
   'the Control Room fallback is never shorter than the owner it falls back from',
   'the floor evaluates to ' + JSON.stringify(floorVal) + ' against an owner of ' + HOSTWIN +
   ' (source: ' + floorTxt + '). A Control-Room-hosted room and a runner-hosted room ' +
   'disagreeing about when the answer goes public IS B23.');

/* ---------------- the runner writes no window of its own ---------------- */
const runSrc = fs.readFileSync(path.join(ROOT, 'host', 'run.js'), 'utf8');
ok(!/locksMs\s*:\s*\d/.test(runSrc),
   'the runner never writes a window it did not get from the owner',
   'host/run.js contains a numeric locksMs literal. Every phone in the room counts against ' +
   'that number; it has to come from AUTO.CI.lockMsFor or the two can drift apart silently.');

/* ---------------- the phone ------------------------------------------- */
async function browser(engineName) {
  const br = await playwright[engineName].launch();
  const page = await br.newPage({ viewport: { width: 393, height: 852 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto('file://' + path.resolve(ROOT, PHONE), { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const E = engineName.padEnd(8);

  /* --- the phone's own constant, and cross-file agreement --- */
  const own = await page.evaluate(() => ({
    hasFn: typeof window.ciWindowMs === 'function',
    constant: (typeof window.ciWindowMs === 'function') ? window.ciWindowMs(null) : null,
    docWins9: (typeof window.ciWindowMs === 'function') ? window.ciWindowMs({ locksMs: 9000 }) : null,
    docWins40: (typeof window.ciWindowMs === 'function') ? window.ciWindowMs({ locksMs: 40000 }) : null,
    junk: (typeof window.ciWindowMs === 'function') ? window.ciWindowMs({ locksMs: 'x' }) : null
  }));

  ok(own.hasFn,
     E + ' the phone has ONE exported window function',
     'window.ciWindowMs is ' + typeof own.hasFn + '. There were eleven literals of this number ' +
     'across two files — the phone\'s two fallbacks, the discard deadline, the host owner, the ' +
     'host floor and the practice bank\'s own private copy of all of it. Eleven edits that have ' +
     'to move together is a bug waiting for the one that does not.');

  ok(own.constant === HOSTWIN,
     E + ' the phone and the host agree on the window',
     'phone fallback ' + own.constant + ' vs host ' + HOSTWIN + '. When a document arrives ' +
     'without locksMs the phone counts against its own constant, and if that is longer than ' +
     'the host\'s the answer is public while the card is still live. That is B23.');

  ok(own.docWins9 === 9000 && own.docWins40 === 40000,
     E + ' the document\'s own window always wins over the constant',
     'locksMs:9000 gave ' + own.docWins9 + ', locksMs:40000 gave ' + own.docWins40 + '. The ' +
     'number in the document is the number the host that wrote it is counting against. A phone ' +
     'that overrode it with a local constant could out-wait a host it has never met.');

  ok(own.junk === HOSTWIN,
     E + ' a document with a junk window falls back rather than breaking',
     'ciWindowMs({locksMs:"x"}) = ' + JSON.stringify(own.junk));

  /* --- THE B23 RULE, against every kind the host can emit --- */
  const b23 = await page.evaluate((pairs) => {
    /* Shim for a build that predates ciWindowMs, so the checks BELOW this
       one still run instead of the whole suite dying at the first missing
       export. A sabotage run that crashes proves less than one that
       reports which guarantees broke. */
    var win = (typeof window.ciWindowMs === 'function')
      ? window.ciWindowMs
      : function (q) { return (q && q.locksMs) || 20000; };
    return pairs.map(function (p) {
      return { kind: p.kind, host: p.locks, phone: win({ locksMs: p.locks }) };
    });
  }, KINDS.map((k, i) => ({ kind: String(k), locks: wins[i] })));
  const leaks = b23.filter(r => r.phone > r.host);
  ok(leaks.length === 0,
     E + ' the phone can never out-wait the host, on any kind',
     leaks.map(r => r.kind + ': phone ' + r.phone + ' > host ' + r.host).join('; ') +
     '  — the host publishes the answer at host+' + PUBLISH_DELAY + 'ms. Any phone still ' +
     'showing live buttons then is B23 reopened: the answer is public and the question is live.');

  /* --- and the same rule for a document that lost the field --- */
  ok(own.constant != null && own.constant <= Math.min.apply(null, wins),
     E + ' a document with NO window still cannot out-wait the shortest host window',
     'phone fallback ' + own.constant + ' vs shortest host window ' + Math.min.apply(null, wins));

  /* --- BEHAVIOUR, not a number: the card locks on the window it is given --- */
  const behave = await page.evaluate(async () => {
    S.mode = 'live'; SB.enabled = true; PCI.muted = false; PCI.picked = {};
    try { go('gametime'); } catch (_) { S.screen = 'gametime'; }
    function shot(locks, ageMs) {
      var t = Date.now() - ageMs;
      var q = { qid: 'w-' + locks + '-' + ageMs, kind: 'saw-shot', state: 'open',
                prompt: 'Window probe', options: [{ v: 'y', k: 'Yes' }, { v: 'n', k: 'No' }],
                opensAt: { toMillis: function () { return t; } }, seq: t };
      if (locks != null) q.locksMs = locks;
      PCI.active = q; renderCiCard(q);
      var card = document.getElementById('ciCard');
      return card ? card.querySelectorAll('.ciopt:not([disabled])').length : -1;
    }
    return {
      shortStillOpen: shot(5000, 2000),      // 2s into a 5s window  -> live
      shortLocked:    shot(5000, 6000),      // 6s into a 5s window  -> locked
      at22:           shot(null, 22000),     // 22s, no field: dead on 20s, live on 28s
      at29:           shot(null, 29000)      // past any legal window -> locked
    };
  });
  ok(behave.shortStillOpen === 2 && behave.shortLocked === 0,
     E + ' the card locks on the window the document gave it, not on a constant',
     '2s into a 5s window: ' + behave.shortStillOpen + ' live option(s) (want 2); 6s in: ' +
     behave.shortLocked + ' (want 0).');
  ok(behave.at29 === 0,
     E + ' nothing stays answerable past the longest legal window',
     '29s after opening, ' + behave.at29 + ' option(s) were still live. The host published the ' +
     'answer at ' + (HOSTWIN + PUBLISH_DELAY) + 'ms.');
  ok(own.constant != null && behave.at22 === (22000 < own.constant ? 2 : 0),
     E + ' a document with no window is counted against the shared constant',
     '22s in with no locksMs field gave ' + behave.at22 + ' live option(s) against a constant ' +
     'of ' + own.constant + 'ms.');

  /* --- PRACTICE AND LIVE ARE THE SAME NUMBER --------------------------- */
  const prac = await page.evaluate(async () => {
    /* PIN THE FEED FIRST. loadGameStats() is async and its
       `if(GS.ev!==ev){GS.ok=false;}` runs synchronously before its first
       await, so GS.ok flips true->false mid-render and the bank falls back
       to nothing. Load it once, properly, and wait. */
    try { if (typeof loadGameStats === 'function') await loadGameStats(true); } catch (_) {}
    S.mode = 'demo'; PCI.muted = false; PCI.picked = {}; PCI.active = null;
    try { go('gametime'); } catch (_) { S.screen = 'gametime'; }
    var out = {};

    /* 1. the ☰ "test it" path */
    try { ciDemoRun(); } catch (e) { out.err = String(e.message); }
    await new Promise(z => setTimeout(z, 300));
    out.testIt = PCI.active ? PCI.active.locksMs : null;

    /* 2. the one that fires during a practice round */
    try { PCI.active = null; demoCiFired && (demoCiFired['slot0'] = false); } catch (_) {}
    try { demoCallIt(0); } catch (e) { out.err2 = String(e.message); }
    await new Promise(z => setTimeout(z, 4600));
    out.inRound = PCI.active ? PCI.active.locksMs : null;
    return out;
  });

  /* The guarantee is not "practice equals ONE of the live numbers" — it is
     "practice equals the live number, whichever kind fires." A two-tier host
     satisfies the first for half its kinds while a demo rehearses a rhythm
     no real room has. */
  const agreesAll = wins.every(function (w) { return w === prac.testIt && w === prac.inRound; });
  ok(agreesAll,
     E + ' practice counts against the same window as live, for every kind',
     'the ☰ test card gave ' + prac.testIt + 'ms and the in-round practice card gave ' +
     prac.inRound + 'ms, against live windows of ' + JSON.stringify([...new Set(wins)]) + '. ' +
     'This is the check that ' +
     'would have caught the 9-second voice bug: "practice mode has always run 20000, which is ' +
     'why voice worked in rehearsal and could not work in a room." The founder is demoing on ' +
     'PRACTICE this Wednesday.');

  ok(errs.length === 0, E + ' no page errors', errs.slice(0, 3).join(' | '));
  await br.close();
}

(async () => {
  for (const e of ENGINES) {
    console.log('  --- ' + e + ' ---');
    try { await browser(e); }
    catch (err) { fail++; bad.push(e + ' crashed: ' + String(err.message).slice(0, 300)); }
  }
  if (bad.length) { console.log('\n  FAILURES:'); bad.forEach(x => console.log('   ✗ ' + x)); }
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
