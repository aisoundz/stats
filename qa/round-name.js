/* qa/round-name.js — PAST THE END OF THE PLAN IS OVERTIME, NOT undefined.

   13 Sept 2026. A real returning player's session logged, into
   nights/slate-2026-09-13-sd-sf/errors:

       TypeError: can't access property "toLowerCase",
                  roundName(...) is undefined          x4

   Those are the FIRST FOUR error documents this product has ever captured
   in 312 nights of play, and all four are this one bug. It had been
   failing qa/first-tap.js on and off for weeks and was read as a test
   problem, because nothing had ever proved it reached a person.

   roundTag and roundName were bare array indexes. roundTag survives that
   because it is only interpolated into strings; roundName does not,
   because five call sites do .toLowerCase() on the result — including

       'Back to the ' + L.unit + ' — ' + roundName(idx+1).toLowerCase()

   where idx+1 at the LAST round is off the end of SPORT.names.

   Measured on the two builds, same harness, same minute:
       index.html       roundName(NR) -> undefined   (throws)
       index-test.html  roundName(NR) -> "Overtime"

       node qa/round-name.js [index-test.html]
       node qa/round-name.js --sabotage
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
    const out = src.replace("  var n = SPORT.names[i];\n  return n ? n : otLabelFor(i).name;",
                            "  return SPORT.names[i];");
    if (out === src) { console.log('\n  sabotage could not find the fallback — it has moved'); process.exit(1); }
    file = '_sabotage-round-name.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  console.log(`\nqa/round-name.js — [${file}]\n`);

  await p.goto(`http://127.0.0.1:${port}/${file}?sport=basketball&fixture=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof roundName === 'function' && typeof NR !== 'undefined', { timeout: 25000 });

  const r = await p.evaluate(() => {
    const probe = (i) => {
      try { return { name: roundName(i), lower: String(roundName(i)).toLowerCase(), tag: roundTag(i) }; }
      catch (e) { return { threw: String(e).slice(0, 80) }; }
    };
    /* every sport, because the OT tail is per-sport and basketball is the
       only one anybody tests by hand */
    const out = { bySport: {} };
    for (const k of ['basketball', 'baseball', 'football', 'hockey', 'soccer']) {
      try { setSport(k); out.bySport[k] = { NR: NR, at: probe(NR), past: probe(NR + 2) }; }
      catch (e) { out.bySport[k] = { threw: String(e).slice(0, 60) }; }
    }
    return out;
  });

  for (const sport of Object.keys(r.bySport)) {
    const s = r.bySport[sport];
    if (s.threw) { ok(false, `${sport}: ${s.threw}`); continue; }
    ok(!s.at.threw && s.at.name != null,
       `${sport}: roundName(NR) is "${s.at.name}" rather than undefined` + (s.at.threw ? ` — ${s.at.threw}` : ''));
    ok(!s.past.threw && s.past.name != null,
       `${sport}: roundName(NR+2) is "${s.past.name}"`);
    /* the whole point: the five call sites do this */
    ok(s.at.lower && s.at.lower !== 'undefined',
       `${sport}: .toLowerCase() on it gives "${s.at.lower}", which is what the callers do`);
  }
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0, 2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
