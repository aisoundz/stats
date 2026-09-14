/* qa/ping-ask.js — THE ONE INTERRUPTION, AT THE ONE MOMENT IT IS WORTH IT.

   13 Sept 2026, read out of the telemetry rather than guessed:

       76 people locked a prediction card.
       56 of them left BEFORE THE FIRST QUESTION EVER OPENED.   (74%)
        3 saw a question and did not answer it.                 (4%)
       median wait from locking the card to the first round: 19 minutes.

   So the loss was never confusion, a bad question, or a broken round. It
   is a phone put down during a game — which is the CORRECT thing to do,
   because the product's whole claim is that you watch the television and
   it pays you for paying attention. The ping is what is supposed to call
   you back, and it was an opt-in row: 156 of 190 sessions never turned it
   on. They put the phone down and nothing ever rang.

   This asks once, on the first lobby, straight after the card is locked —
   the moment of most commitment and the start of the dead time. It is a
   SOFT ask: the browser prompt fires on the tap, never on render, because
   an unsolicited permission prompt is how a browser stops trusting you.

   WHAT IT MUST NOT DO, and each of these is a check below: nag somebody
   who already granted it, ask again after a denial it cannot undo,
   interrupt practice, or reappear at a later lobby or after a decline.

       node qa/ping-ask.js [index-test.html]
       node qa/ping-ask.js --sabotage
*/
const { firefox } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SAB = process.argv.includes('--sabotage');
const TARGET = path.basename((process.argv.slice(2).find(a => /\.html$/.test(a))) || 'index-test.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \x1b[32mok\x1b[0m   ' + m); }
                       else   { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    try { r.end(fs.readFileSync(f)); } catch (_) { r.statusCode = 404; r.end(''); }
  }).listen(0);
  const port = srv.address().port;

  let file = TARGET;
  if (SAB) {
    const src = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
    /* the guard that keeps it off every screen it does not belong on */
    const out = src.replace("        && ALERTS.perm() === 'default';", "        ;");
    if (out === src) { console.log('\n  sabotage could not find the guard — it has moved'); process.exit(1); }
    file = '_sabotage-ping-ask.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  console.log(`\nqa/ping-ask.js — [${file}]\n`);

  await p.goto(`http://127.0.0.1:${port}/${file}?sport=basketball&fixture=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof renderLobby === 'function' && typeof ALERTS !== 'undefined', { timeout: 25000 });

  /* FAIL, DO NOT THROW, ON A BUILD THAT HAS NONE OF THIS. Run against
     index.html before the feature shipped, the evaluate died on an
     undefined PING_ASK_DONE and the suite ended in a stack trace. qa/all.js
     scores a crash as a failure so it was never a false green, but a check
     that cannot say WHAT is missing is a check somebody has to debug
     instead of read. */
  const r = await p.evaluate(() => {
    if (typeof PING_ASK_DONE === 'undefined' || !document.getElementById('pingAsk'))
      return { missing: true };
    try { SB.join = async () => true; } catch (_) {}      // never write a seat
    const el = () => document.getElementById('pingAsk');
    const vis = () => { const e = el(); return !!e && e.style.display !== 'none'; };
    const out = {};
    ALERTS.perm = () => 'default'; setMode('live'); S.name = 'Ping';
    PING_ASK_DONE = false; renderLobby(0);
    out.shown = vis();
    out.copy = (document.getElementById('pingAskS') || {}).textContent || '';
    out.hasButton = !!document.getElementById('pingAskBtn');
    PING_ASK_DONE = false; ALERTS.perm = () => 'granted'; renderLobby(0); out.granted = vis();
    PING_ASK_DONE = false; ALERTS.perm = () => 'denied';  renderLobby(0); out.denied  = vis();
    PING_ASK_DONE = false; ALERTS.perm = () => 'default'; setMode('demo'); renderLobby(0); out.practice = vis();
    PING_ASK_DONE = false; setMode('live'); renderLobby(2); out.later = vis();
    PING_ASK_DONE = false; renderLobby(0); pingAskDismiss(); renderLobby(0); out.afterNo = vis();
    /* the standing row must survive a decline: it is the way back */
    out.rowStillThere = !!document.getElementById('alertRow');
    return out;
  });

  if (r.missing) {
    ok(false, 'this build has no ping ask at all: #pingAsk and PING_ASK_DONE are both absent');
    await b.close(); srv.close();
    if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
    console.log(`\n\x1b[31mRED\x1b[0m  ${pass} passed, ${fail} failed   [${file}]\n`);
    process.exit(1);
  }
  ok(r.shown, 'it appears on the first lobby when the ping has not been decided');
  ok(r.hasButton, 'and carries a button, so the browser prompt fires on a TAP and never on render');
  ok(/first question/i.test(r.copy) && /quarter|period|inning|half/i.test(r.copy),
     `it names the real boundary rather than a guessed number of minutes: "${r.copy.slice(0, 64)}…"`);
  ok(!r.granted,  'it does NOT nag a player who already granted the ping');
  ok(!r.denied,   'it does NOT ask again after a denial it cannot undo');
  ok(!r.practice, 'it never interrupts practice');
  ok(!r.later,    'it asks at the FIRST lobby only, not at every round');
  ok(!r.afterNo,  'and it does not come back after "no thanks"');
  ok(r.rowStillThere, 'the standing alert row survives a decline, so there is still a way back');
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0, 2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
