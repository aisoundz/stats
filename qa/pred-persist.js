/* qa/pred-persist.js — THE 600-POINT CARD HAS TO BE WRITTEN DOWN.

   2 Sept 2026, from the founder, mid-slate, 55 minutes before first pitch:
   "I already filled this out. Why do I have to do it every time. It should
   be good enough to do it one time a day."

   He had. predPick() set S.predChoices and called buildPred() and NOTHING
   ELSE. S.catchChoices — the 1-point Caught It taps — called save() on
   every single tap; the prediction card, worth 600 of the night's 1,000,
   called it nowhere. The six picks lived in page memory alone, so iOS
   evicting a backgrounded tab (or any reload) returned the player to
   "0 / 6 picked" with no warning and no way to know it had happened.

   save() is keyed per nightId through LS_KEY() and returns early unless
   the mode is live, which is why this suite drives a LIVE room: asserting
   this in practice would have measured a deliberate no-op and gone green
   over the bug.

   It joins nothing. setMode('live') moves local state only, so no seat is
   written to a real night — a lesson from the same afternoon, when a suite
   that DID join left twelve rows on the founder's live board.

       node qa/pred-persist.js [index-test.html]
       node qa/pred-persist.js --sabotage     # proves it can go red
*/
const { firefox } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SAB  = process.argv.includes('--sabotage');
/* THE GATE PASSES AN ABSOLUTE PATH. qa/all.js pushes TARGET_ABS as a
   positional to every TARGETABLE suite, and this file serves from the repo
   root and requests the basename — so an absolute path produced
   "http://127.0.0.1:PORT//home/higherthan7/stats/index-test.html" and the
   suite died on NS_ERROR_NET_EMPTY_RESPONSE while passing standalone.
   Same trap as qa/landing-wired.js on 31 Aug. Basename, always. */
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
  if (SAB) {                              /* strip the save from predPick only */
    const src = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
    const out = src.replace('  try{ save(); }catch(_){}\n  buildPred();', '  buildPred();');
    if (out === src) { console.log('\n  sabotage could not find the call — the guard has moved'); process.exit(1); }
    file = '_sabotage-pred-persist.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));

  console.log(`\nqa/pred-persist.js — [${file}]\n`);
  await p.goto(`http://127.0.0.1:${port}/${file}?sport=basketball&fixture=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined' && typeof startPredict === 'function', { timeout: 25000 });

  const made = await p.evaluate(() => {
    try { window.loadGameStats = async () => null; } catch (_) {}
    setMode('live'); S.name = 'Persist';
    startPredict();
    const first = predOrderList()[0];
    predPick(first.id, 'AAA-TEST');
    let disk = '';
    try { disk = (JSON.parse(localStorage.getItem(LS_KEY()) || '{}').predChoices || {})[first.id] || ''; } catch (_) { disk = 'ERR'; }
    return { id: first.id, mode: S.mode, key: LS_KEY(), inMemory: S.predChoices[first.id], disk };
  });

  ok(made.mode === 'live', `the room is live, so save() is not a no-op (mode "${made.mode}")`);
  ok(/_/.test(made.key) && made.key.length > 20, `the save is keyed to this night alone (${made.key})`);
  ok(made.inMemory === 'AAA-TEST', 'the pick registered in memory');
  ok(made.disk === 'AAA-TEST', 'AND WAS WRITTEN DOWN — not held in page memory alone');

  /* The real failure was a reload, so reload. */
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined', { timeout: 25000 });
  await p.waitForTimeout(2500);
  const after = await p.evaluate((id) => {
    let disk = '';
    try { disk = (JSON.parse(localStorage.getItem(LS_KEY()) || '{}').predChoices || {})[id] || ''; } catch (_) { disk = 'ERR'; }
    return { disk };
  }, made.id);

  ok(after.disk === 'AAA-TEST', 'and it is STILL there after a reload — the card is not refilled from scratch');
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0, 2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
