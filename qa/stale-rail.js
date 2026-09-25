/* qa/stale-rail.js — YESTERDAY'S ROOMS ARE WORSE THAN NO ROOMS.

   24 Sept 2026, 7:20pm, the founder's phone. The rail showed game nights
   #129 to #132 — Guardians at Red Sox, Dream at Liberty, RSL at Sounders,
   Astros at Mariners — every one of them FINAL. Those were the 23rd. The
   24th was #133 to #136 and four of them were live, one at halftime.

   TWO FAULTS THAT ONLY BITE TOGETHER, which is why a clean browser never
   showed it and neither did the gate:

     · the cache-paint block carried a comment promising the remembered
       rail is "ignored entirely if it is for another day" and THERE WAS
       NO DATE CHECK IN THE CODE. It painted whatever it last held.
     · the slate read swallowed its error — `catch(_){ snap = null; }` —
       so a dropped request on a phone was indistinguishable from "no
       games today". loadSlate returned false, SLATE.loaded stayed false,
       nothing retried, and nothing replaced the rail.

   A rail is a list of rooms a person can walk into. Yesterday's is worse
   than none: every tile is a dead end and nothing says so.

   Measured with the network blocked, so only the cache can paint:
       index.html       2 tiles, "Guardians", cache kept
       index-test.html  0 tiles, cache purged

       node qa/stale-rail.js [index-test.html]
       node qa/stale-rail.js --sabotage
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
    const out = src.replace("    if(!c.date || (_today && c.date !== _today)){", "    if(false){");
    if (out === src) { console.log('\n  sabotage could not find the date check — it has moved'); process.exit(1); }
    file = '_sabotage-stale-rail.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  console.log(`\nqa/stale-rail.js — [${file}]\n`);
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };

  /* ---- yesterday's cache, network down: it must NOT paint ---- */
  {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/${file}?fixture=1`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof SLATE !== 'undefined', { timeout: 25000 });
    await p.evaluate((d) => localStorage.setItem('stats_slate_cache_v1',
      JSON.stringify({ date: d, games: [{ nightId: 'x-1', away: 'Guardians', home: 'Red Sox' },
                                        { nightId: 'x-2', away: 'Dream', home: 'Liberty' }] })), day(-1));
    await p.route('**/*firestore*', r => r.abort());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => ({ n: (SLATE.games || []).length,
      first: (SLATE.games || [])[0] ? SLATE.games[0].away : null,
      kept: !!localStorage.getItem('stats_slate_cache_v1') }));
    ok(r.n === 0, `yesterday's cached rail does not paint (${r.n} game(s)${r.first ? ', "' + r.first + '"' : ''})`);
    ok(!r.kept, 'and the stale entry is purged, so a slow network cannot resurrect it');
    await ctx.close();
  }

  /* ---- TODAY's cache must still paint: the accelerator has to work ---- */
  {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/${file}?fixture=1`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof SLATE !== 'undefined', { timeout: 25000 });
    await p.evaluate((d) => localStorage.setItem('stats_slate_cache_v1',
      JSON.stringify({ date: d, games: [{ nightId: 'y-1', away: 'Cardinals', home: 'Pirates' },
                                        { nightId: 'y-2', away: 'White Sox', home: 'Royals' }] })), day(0));
    await p.route('**/*firestore*', r => r.abort());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => ({ n: (SLATE.games || []).length,
      first: (SLATE.games || [])[0] ? SLATE.games[0].away : null }));
    ok(r.n === 2 && r.first === 'Cardinals',
       `today's cached rail DOES still paint before the network answers (${r.n}, "${r.first}")`);
    await ctx.close();
  }

  /* ---- the read retries rather than accepting one failure ---- */
  {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    ok(/_try < 2/.test(src), 'the slate read tries twice before giving up');
    ok(/slate_read_failed/.test(src), 'and a failed read is reported, not swallowed');
  }

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
