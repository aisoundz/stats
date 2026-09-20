#!/usr/bin/env node
/* =====================================================================
   THE STRIPPED BUILD MUST BE THE SAME PRODUCT.
   ---------------------------------------------------------------------
   host/strip-comments.js halves the file players download. A size win
   that quietly eats a function is not a win, and a comment stripper is
   exactly the tool that can do that: a regex eats live code the moment a
   string literal quotes a comment opener, and this file is full of
   strings quoting past bugs.

   So nothing promotes on the strength of a byte count. This loads BOTH
   files in a real browser and compares what they DO:

     · every function declaration in the source exists in the artifact
     · both boot with no page errors
     · the probes that represent the product answer identically

   The probes are deliberately the things recently fixed, because a
   regression here would be invisible and expensive: overtime naming, the
   server-settled prediction lane, and the Home button's sentence about
   when a round opens.

       node host/strip-verify.js index-test.html _promote.html
   ================================================================== */
const { firefox } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) { console.error('usage: strip-verify.js <source.html> <stripped.html>'); process.exit(1); }

let fail = 0;
const ok = (c, m) => { if (c) console.log('  \x1b[32mok\x1b[0m   ' + m);
                       else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };

/* a DECLARATION, not the word "function" in prose — prose never follows
   a line start, a brace, a paren or an equals. */
const decls = (s) => new Set(
  (s.match(/(?:^|[\n;{}=(,]\s*)function\s+([A-Za-z_$][\w$]*)\s*\(/gm) || [])
    .map(x => (x.match(/function\s+([A-Za-z_$][\w$]*)/) || [])[1]).filter(Boolean));

(async () => {
  const a = fs.readFileSync(path.join(ROOT, SRC), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, OUT), 'utf8');
  console.log(`\nstrip-verify — ${SRC} vs ${OUT}\n`);

  const da = decls(a), db = decls(b);
  const lost = [...da].filter(n => !db.has(n));
  ok(lost.length === 0, `every function declaration survived (${da.size} in, ${db.size} out)`
     + (lost.length ? ` — LOST: ${lost.slice(0, 6).join(', ')}` : ''));
  ok(b.length < a.length, `the artifact is smaller (${Math.round(b.length / 1024)}KB vs ${Math.round(a.length / 1024)}KB, `
     + `${Math.round((1 - b.length / a.length) * 100)}% off)`);

  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    try { r.end(fs.readFileSync(f)); } catch (_) { r.statusCode = 404; r.end(''); }
  }).listen(0);
  const port = srv.address().port;
  const br = await firefox.launch();
  const seen = {};

  for (const file of [SRC, OUT]) {
    const p = await br.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await p.goto(`http://127.0.0.1:${port}/${file}?sport=football&fixture=1`, { waitUntil: 'domcontentloaded' });
    let alive = false;
    try { await p.waitForFunction(() => typeof SLATE !== 'undefined' && typeof roundName === 'function', { timeout: 30000 }); alive = true; } catch (_) {}
    const probe = await p.evaluate(() => {
      const o = {};
      try { SB.join = async () => true; } catch (_) {}
      try { o.build = window.STATS_BUILD; } catch (e) { o.build = 'threw'; }
      try { o.overtime = roundName(NR); } catch (e) { o.overtime = 'threw'; }
      try { o.serverLane = SB.nightTotal({ livePts: 0, predPts: 0, predSrv: 100 }); } catch (e) { o.serverLane = 'threw'; }
      try { o.phoneWins = SB.nightTotal({ livePts: 0, predPts: 300, predSrv: 100 }); } catch (e) { o.phoneWins = 'threw'; }
      try { setMode('live'); S.place = 'lobby'; S.qi = 0; S.nextQ = 0; paintContinueCard();
            o.homeBtn = (document.getElementById('landingBtn') || {}).textContent || ''; }
      catch (e) { o.homeBtn = 'threw ' + e.message; }
      try { o.fns = Object.keys(window).filter(k => typeof window[k] === 'function').length; } catch (e) { o.fns = -1; }
      return o;
    });
    ok(alive, `${file}: boots and the app is alive`);
    ok(errs.length === 0, `${file}: no page errors` + (errs.length ? ` — ${errs.slice(0, 2).join(' | ')}` : ''));
    seen[file] = probe;
    await p.close();
  }

  const A = seen[SRC], B = seen[OUT];
  for (const k of ['build', 'overtime', 'serverLane', 'phoneWins', 'homeBtn', 'fns']) {
    ok(String(A[k]) === String(B[k]),
       `${k} matches: ${JSON.stringify(String(A[k]).slice(0, 52))}`
       + (String(A[k]) === String(B[k]) ? '' : ` vs ${JSON.stringify(String(B[k]).slice(0, 52))}`));
  }

  await br.close(); srv.close();
  console.log(`\n${fail ? '\x1b[31mNOT SAFE TO PROMOTE\x1b[0m' : '\x1b[32mthe stripped build is the same product\x1b[0m'}  (${fail} failure(s))\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('strip-verify threw — ' + ((e && e.stack) || e)); process.exit(1); });
