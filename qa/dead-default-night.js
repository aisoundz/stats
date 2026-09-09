/* qa/dead-default-night.js — NOBODY IS PARKED IN A GAME THAT IS OVER.

   3 Sept 2026, the college football go-live. The founder opened the app,
   pressed the prediction card, and was told the night was finished. He
   scored zero in both rooms and answered 2 of 13 rounds. From telemetry:

       card_start -> blocked_finished        (twice, before kickoff)
       slate_pick { from: "gn13-2026-08-19-min-gs" }

   THE CHAIN, reproduced on the live site on 9 Sept:

     schedule/current correctly names tonight's featured game.
     That game is soccer (or football, or anything but basketball).
     The page boots as basketball.
     hydrateNight() REFUSES on the sport mismatch — correctly, B39-a —
       and logs "keeping the built-in night".
     The built-in night is gn13-2026-08-19-min-gs: real, published,
       and finished on 19 August.
     nightIsOver() then answers TRUE about it, and the door shuts.

   So on every night whose featured game is not basketball, a visitor
   arriving with no ?game was parked in a three-week-old finished game.

   Measured on the two builds, same harness, same minute:
       index.html      __dead=false   nightIsOver(live)=true    <- shipped
       index-test.html __dead=true    nightIsOver(live)=false   <- fixed

   NO SUITE COULD HAVE CAUGHT THIS BEFORE, and that is the point worth
   keeping: 120 of them read a file, and this needed the file PLUS a
   calendar three weeks past a baked date PLUS a featured game in another
   sport. It is a clock bug wearing a config bug's clothes.

       node qa/dead-default-night.js [index-test.html]
       node qa/dead-default-night.js --sabotage
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
    const out = src.replace("    try{ if(GAME && GAME.__dead) return false; }catch(_){}\n", "");
    if (out === src) { console.log('\n  sabotage could not find the guard — it has moved'); process.exit(1); }
    file = '_sabotage-dead-night.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));

  console.log(`\nqa/dead-default-night.js — [${file}]\n`);
  /* NO ?game, exactly how he arrived. */
  await p.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof GAME !== 'undefined' && typeof nightIsOver === 'function', { timeout: 25000 });
  await p.waitForTimeout(14000);       // let the slate and the config settle

  const r = await p.evaluate(() => {
    try { SB.join = async () => true; } catch (_) {}     // never write a seat
    let overLive = null;
    try { const m = S.mode; S.mode = 'live'; overLive = nightIsOver(); S.mode = m; }
    catch (e) { overLive = 'threw ' + e.message; }
    return {
      night: GAME.nightId, baked: !!GAME.__baked, dead: !!GAME.__dead,
      expired: (typeof nightHasExpired === 'function') ? nightHasExpired(GAME) : null,
      overLive,
      fnExists: (typeof dropDeadDefaultNight === 'function')
    };
  });

  ok(r.fnExists, 'dropDeadDefaultNight() exists and is reachable');
  ok(r.baked === true, `the built-in night is still the fallback (${r.night})`);
  /* The whole suite is only meaningful while the baked night is in the
     past. Say so rather than passing vacuously the day somebody rebakes it. */
  if (!r.expired) {
    console.log('\n  \x1b[33mNOT APPLICABLE\x1b[0m — the baked night has not expired, so there is nothing to drop.');
    console.log('  Re-bake the default and this suite becomes meaningful again.\n');
    await b.close(); srv.close(); process.exit(0);
  }
  ok(r.expired === true, 'and it has expired, which is the state that shipped');
  ok(r.dead === true, 'it is marked __dead, so nothing downstream treats it as a room');
  ok(r.overLive === false,
     'AND nightIsOver() refuses to answer for it in LIVE mode — the exact call that shut the card on 3 Sept'
     + (r.overLive === true ? '  <-- it says the night is FINISHED' : ''));
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0, 2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
