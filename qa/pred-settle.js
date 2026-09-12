/* qa/pred-settle.js — THE CARD IS WORTH 600 IN EVERY SPORT, NOT JUST ONE.

   11 Sept 2026. Measured across the five decks, same harness, same minute:

       basketball  6 of 6 lines gradable
       baseball    1 of 6        football  1 of 6
       hockey      1 of 6        soccer    0 of 6   (a draw voided the card)

   settleFromFeed() graded the winner plus five STAT-LEADER lines read out
   of sportCfg().box, and that box is populated for basketball alone. Every
   other deck asks about totals, first scores and counts, so five of six
   lines landed in predMissing and paid nothing. FIVE HUNDRED of the six
   hundred points on the card, every night, for every player.

   Found from the founder's own card on the 3 Sept college football
   go-live: he picked "Extra innings: No", the game ended 2-1 in nine
   innings, and nothing in the app was capable of paying him the 100 he
   had won. His picks WERE stored — nights/{id}/rounds/rP/subs — so this
   was never a missing ledger. It was a missing grader.

   Two smaller faults found in the same read and fixed with it:
     · soccer's line is id:"result" and the grader wrote truth.winner, so
       soccer graded 0 of 6 rather than 1 of 6
     · a level score returned null, voiding EVERY line, in the one sport
       where a draw is an ordinary result and a pickable option

   This suite asserts the lines a FINAL SCORE alone can settle. The rest
   (first to score, home runs, strikeouts, rush yards, corners, cards)
   need the box or the plays and are still honestly unsettled — that is a
   known gap, not a passing grade.

       node qa/pred-settle.js [index-test.html]
       node qa/pred-settle.js --sabotage
*/
const { firefox } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SAB = process.argv.includes('--sabotage');
const TARGET = path.basename((process.argv.slice(2).find(a => /\.html$/.test(a))) || 'index-test.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \x1b[32mok\x1b[0m   ' + m); }
                       else   { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };

/* Each case is a REAL final. baseball is the founder's own 3 Sept game. */
const CASES = {
  baseball: { a:1, b:2, periods:9,  want:{ winner:'Home', runs:'Under 8.5', extras:'No' } },
  football: { a:14, b:13, periods:4, want:{ winner:'Away', points:'Under 44.5' } },
  hockey:   { a:4, b:2, periods:4,  want:{ winner:'Away', goals:'Over 5.5', ot:'Yes' } },
  soccer:   { a:1, b:1, periods:2,  want:{ result:'Draw', goals:'Under 2.5', btts:'Yes' } }
};

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    try { r.end(fs.readFileSync(f)); } catch (_) { r.statusCode = 404; r.end(''); }
  }).listen(0);
  const port = srv.address().port;

  let file = TARGET;
  if (SAB) {
    const src = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
    const out = src.replace("    try{ settleFinalDerived(truth, tied, A, B); }catch(_){}\n    return {truth:truth, num:num, tied:tied, missing:missing,", "    return {truth:truth, num:num, tied:tied, missing:missing,");
    if (out === src) { console.log('\n  sabotage could not find the call — it has moved'); process.exit(1); }
    file = '_sabotage-pred-settle.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  console.log(`\nqa/pred-settle.js — [${file}]\n`);

  await p.goto(`http://127.0.0.1:${port}/${file}?fixture=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof setSport === 'function' && typeof settleFromFeed === 'function', { timeout: 25000 });

  const got = await p.evaluate((CASES) => {
    const out = {};
    for (const k of Object.keys(CASES)) {
      try {
        setSport(k);
        const c = CASES[k];
        GS.ok = true; GS.state = 'post';
        GS.teams = [{ name:'Away', ab:'AWY', score:c.a, home:false },
                    { name:'Home', ab:'HOM', score:c.b, home:true }];
        GS.box = { x:{} };
        GS.lines = [{ vals:new Array(c.periods).fill({n:0}) },
                    { vals:new Array(c.periods).fill({n:0}) }];
        const st = settleFromFeed();
        out[k] = st ? { truth: st.truth, deck: (preds||[]).length } : null;
      } catch (e) { out[k] = 'threw ' + e.message; }
    }
    return out;
  }, CASES);

  for (const sport of Object.keys(CASES)) {
    const want = CASES[sport].want, g = got[sport];
    if (!g || typeof g === 'string') { ok(false, `${sport}: settled nothing (${g || 'null'})`); continue; }
    const lines = Object.keys(want).length;
    let hit = 0;
    for (const id of Object.keys(want)) if (String(g.truth[id]) === want[id]) hit++;
    ok(hit === lines,
       `${sport}: ${hit}/${lines} final-derived lines correct` +
       (hit === lines ? `  (${Object.keys(want).map(i=>i+'='+want[i]).join(', ')})`
                      : `  got ${JSON.stringify(g.truth)}`));
    /* THE POINT OF THE WHOLE CHANGE: more than the winner. */
    ok(Object.keys(g.truth).length >= lines,
       `${sport}: grades ${Object.keys(g.truth).length} of ${g.deck} deck lines, not just the winner`);
  }
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0,2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
