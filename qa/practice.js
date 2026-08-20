#!/usr/bin/env node
/* ============ EVERY SPORT IS PLAYABLE, IN EVERY LANGUAGE ==============
   Written 20 Aug 2026, from the founder finding it himself:

     "when you go into the menu and select spanish and then test the
      question for both baseball and football it has the basketball
      questions... the caught it question for both baseball game and
      football had nothing to do with anything, it says how many quarters
      does a game run."

     "We need to have a practice round for all the sports and we need to
      have it all in spanish as well... This is another example of leaving
      things empty and not improving over time."

   He is right, and the measurement was worse than the report:

     sport        questions   with Spanish   practice Caught It
     basketball        16            16      (none)
     baseball          12             0      (none)
     football          16             0      (none)
     soccer             6             0      SC_CATCHES
     hockey            12             0      (none)

   Forty-six questions with no Spanish, and four of five sports with no
   practice Caught It at all — so the Caught It card fell through to a
   hardcoded warm-up asking how many QUARTERS a game runs, on a baseball
   night whose own chip says 3 ROUNDS.

   THE POINT OF THIS FILE IS THAT THE GAP CANNOT BE SILENT AGAIN. Adding a
   sport, or a question, without its Spanish and its Caught It now fails the
   gate and names exactly what is missing. "Empty" stops being a state the
   product can rest in.

   It reads the sports FROM THE APP, so a sixth league inherits the standard
   the moment it is registered rather than when somebody remembers.

   Usage:  node qa/practice.js  [index-test.html]
   Exit 0 green, 1 red.                                                  */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { waitReady } = require('./ready.js');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  return pos || 'index.html';
})();
const TARGET = path.basename(argFile);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

function serve() {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      const f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, ''));
      fs.readFile(f, (e, b) => {
        if (e) { rs.writeHead(404); rs.end('no'); return; }
        rs.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html' : 'text/plain' });
        rs.end(b);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { chromium } = require('playwright');
  const { srv, port } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/${TARGET}`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const r = await page.evaluate(() => {
    const out = { sports: [], langs: [] };
    try { out.langs = VX.langs().map(l => l.key); } catch (_) { out.langs = ['en']; }
    const NEED = out.langs.filter(l => l !== 'en');   // every language the app offers

    Object.keys(SPORTS).forEach(key => {
      const sp = SPORTS[key];
      const rounds = (sp && sp.rounds) || [];
      const catches = (sp && sp.catches) || [];
      const s = { key, rounds: rounds.length, questions: 0, missing: {}, catches: catches.length,
                  catchesMissing: {}, badOpts: [] };
      NEED.forEach(l => { s.missing[l] = 0; s.catchesMissing[l] = 0; });

      rounds.forEach((rd, ri) => (rd.q || []).forEach((q, qi) => {
        s.questions++;
        NEED.forEach(l => {
          const t = q['t_' + l], o = q['o_' + l];
          if (!(typeof t === 'string' && t.trim())) s.missing[l]++;
          else if (!Array.isArray(o) || o.length !== (q.o || []).length) {
            s.missing[l]++;
            s.badOpts.push(`R${ri + 1}Q${qi + 1}(${l})`);
          }
        });
        /* the answer must be one of this question's own options — a
           translated bank is still graded in English */
        if ((q.o || []).indexOf(q.a) < 0) s.badOpts.push(`R${ri + 1}Q${qi + 1}: answer not an option`);
      }));

      /* a Caught It entry is {label, opts} — its translated forms are
         label_es / opts_es, and an opts list of a different length would
         re-map the answers exactly as it would on a question */
      catches.forEach((c, ci) => NEED.forEach(l => {
        const t = c['label_' + l];
        if (!(typeof t === 'string' && t.trim())) { s.catchesMissing[l]++; return; }
        /* team buttons are team names — they are not translated, and must not be */
        if (!c.teams) {
          const o = c['opts_' + l];
          if (!Array.isArray(o) || o.length !== (c.opts || []).length) {
            s.catchesMissing[l]++;
            s.badOpts.push(`catch ${ci + 1}(${l}): options do not match`);
          }
        }
      }));

      out.sports.push(s);
    });

    /* ============ LEAN MUST NOT EAT THE BANK ==========================
       LEAN turns the pre-game watchlist off by emptying CATCHES. It used to
       do that with `CATCHES.length = 0` — mutating the array that
       SPORTS[sport].catches points at — so it destroyed one sport's bank
       for the life of the page, and did it only for whichever sport was
       loaded at boot. Every other sport got its watchlist back WITH ITS
       POINTS STILL IN MAXPTS, which is a scoring defect wearing the costume
       of a feature flag.

       Walk every sport and demand two things at once: the bank survives,
       and the live binding respects LEAN. */
    out.lean = { on: (typeof LEAN_ON !== 'undefined') && !!LEAN_ON, banksAfter: {}, liveAfter: {} };
    try {
      const back = SPORT_KEY;
      Object.keys(SPORTS).forEach(k => {
        try { setSport(k); } catch (_) {}
        out.lean.banksAfter[k] = (SPORTS[k].catches || []).length;
        out.lean.liveAfter[k]  = (typeof CATCHES !== 'undefined' && CATCHES) ? CATCHES.length : -1;
      });
      try { setSport(back); } catch (_) {}
    } catch (e) { out.lean.threw = String(e); }
    return out;
  });

  console.log('\n  PRACTICE — every sport playable, in every language the app offers\n');
  console.log('  judging ' + TARGET + '   languages: ' + r.langs.join(', ') + '\n');
  console.log('  sport        rounds  questions  ' + r.langs.filter(l => l !== 'en').map(l => 'no ' + l).join('  ') + '  caught-it');
  console.log('  -----------  ------  ---------  ------  ---------');
  r.sports.forEach(s => {
    const miss = r.langs.filter(l => l !== 'en').map(l => String(s.missing[l] || 0).padStart(6)).join('  ');
    console.log('  ' + s.key.padEnd(11) + '  ' + String(s.rounds).padStart(6) + '  ' +
                String(s.questions).padStart(9) + '  ' + miss + '  ' + String(s.catches).padStart(9));
  });
  console.log('');

  ok('practice.every-sport-was-actually-read', r.sports.length >= 5,
     `only ${r.sports.length} sports found in SPORTS — the scanner is broken rather than the app`);

  const noRounds = r.sports.filter(s => s.rounds === 0 || s.questions === 0);
  ok('practice.every-sport-has-a-practice-round', noRounds.length === 0,
     noRounds.map(s => `${s.key} has ${s.rounds} round(s) and ${s.questions} question(s) — a guest who ` +
       `picks that sport gets nothing to play`).join('\n      '));

  const NEED = r.langs.filter(l => l !== 'en');
  const gaps = [];
  r.sports.forEach(s => NEED.forEach(l => {
    if (s.missing[l]) gaps.push(`${s.key}: ${s.missing[l]} of ${s.questions} question(s) have no ${l}`);
  }));
  ok('practice.every-question-exists-in-every-language', gaps.length === 0,
     gaps.join('\n      ') + '\n      A question with no translation falls back to English mid-sentence, ' +
     'which is how a Spanish player finds out the language is decoration.');

  const badOpts = r.sports.filter(s => s.badOpts.length);
  ok('practice.a-translated-question-keeps-its-shape', badOpts.length === 0,
     badOpts.map(s => `${s.key}: ${s.badOpts.join(', ')}`).join('\n      ') +
     '\n      A translated option list of a different length silently re-maps the answers.');

  const noCatch = r.sports.filter(s => s.catches === 0);
  ok('practice.every-sport-has-a-practice-caught-it', noCatch.length === 0,
     noCatch.map(s => `${s.key} has no practice Caught It bank, so the card falls through to the ` +
       `hardcoded warm-up — which asks how many QUARTERS a game runs, on a sport that may have ` +
       `innings, halves or periods`).join('\n      '));

  const catchGaps = [];
  r.sports.forEach(s => NEED.forEach(l => {
    if (s.catchesMissing[l]) catchGaps.push(`${s.key}: ${s.catchesMissing[l]} of ${s.catches} Caught It question(s) have no ${l}`);
  }));
  ok('practice.caught-it-exists-in-every-language', catchGaps.length === 0, catchGaps.join('\n      '));

  const eaten = Object.keys(r.lean.banksAfter || {}).filter(k => !r.lean.banksAfter[k]);
  ok('practice.walking-every-sport-does-not-eat-a-bank', eaten.length === 0,
     `after visiting every sport, these came back empty: ${eaten.join(', ')}. Something is mutating ` +
     `SPORTS[sport].catches in place instead of rebinding — the bank is shared, and destroying it ` +
     `is permanent for the life of the page.`);

  const leaky = r.lean.on
    ? Object.keys(r.lean.liveAfter || {}).filter(k => r.lean.liveAfter[k] > 0)
    : [];
  ok('practice.lean-applies-to-every-sport', leaky.length === 0,
     `LEAN is on, but after switching to ${leaky.join(', ')} the live watchlist came back with ` +
     `entries. LEAN used to run once at boot, so every OTHER sport kept its watchlist while its ` +
     `points stayed in MAXPTS — a wrong total, arriving through the flag meant to prevent one.`);

  ok('practice.no-page-errors', errs.length === 0, errs.slice(0, 3).join('\n      '));

  await browser.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
                             : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
