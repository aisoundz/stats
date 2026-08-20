#!/usr/bin/env node
/* ============ EVERY STATE VALUE MUST BE A STATE THAT EXISTS ===========
   Written 20 Aug 2026, after the same defect was found three times in one
   night in three different files.

   `S.place` has exactly one legal domain, declared once in the player app:

       const GAME_SCREENS = ["predict","lobby","live","review","predreview","break"]

   and `S.place` is only ever assigned from that list or from ''. So a
   comparison against anything else is *provably always false*, and an
   assignment to anything else drives the app into a state production
   cannot reach.

   WHAT THAT COST, all of it discovered on 19–20 August:

   1. index.html tested `S.place === 'play'` in TWO places. Both were dead.
      One was the game rail's collapse-while-playing rule — a feature with
      a long comment explaining why a chooser must not eat the screen
      mid-question, which had never executed once. The founder found it on
      an iPad: three sticky bars taking 41% of the viewport and the
      question scrolled into the gap between them.
   2. qa/platforms.js DROVE the app with `S.place='play'` to test that same
      collapse. So the test and the bug agreed with each other about an
      impossible state, and the check was green for a year while the
      feature had never run.
   3. qa/payoff.js did the same, and when the rail was finally made to
      collapse for real, payoff.js went RED — because its harness was still
      in the impossible state where the rail stays full. The product was
      right and the stage direction was wrong. Six more sites across five
      suites were found by sweeping for it.

   A behavioural gate cannot see this: every one of those files ran, passed
   its own assertions, and reported success. It is a STRUCTURAL defect, and
   this is a structural check.

   IT READS THE DOMAIN FROM THE APP, never from a copy. If GAME_SCREENS
   gains a member tomorrow, this check learns about it in the same commit —
   which is the whole point, because a second hand-written list of the legal
   values would be the very disease it exists to catch.

   Usage:  node qa/places.js  [--file index-test.html]
   Exit 0 green, 1 red.                                                  */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* BOTH CALLING CONVENTIONS, because this gate has two.
   qa/all.js hands a TARGETABLE suite the build as a positional argument;
   several suites are driven by hand with --file. Reading only one of them
   is how this suite spent its first run judging the build already live
   while all.js announced it was judging the candidate — the exact
   "one green, two meanings" split all.js warns about in its own header. */
const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /.html$/.test(a) && a[0] !== '-');
  return pos || 'index.html';
})();
/* ...AND BOTH PATH SHAPES. all.js hands over an ABSOLUTE path (TARGET_ABS),
   while every read below is path.join(ROOT, argFile). Joining a root onto an
   already-absolute path produced
   /home/higherthan7/stats/home/higherthan7/stats/index-test.html and an
   ENOENT crash, so inside the full gate this suite never ran a single check
   — it only ever passed when driven by hand with a bare filename. A suite
   that crashes is not a suite that agrees with you; all.js counts a crash as
   red precisely so this cannot hide. Normalised to repo-relative once, here,
   rather than at each of the six join sites. */
const REL_ARG = path.isAbsolute(argFile) ? path.relative(ROOT, argFile) : argFile;

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

/* ---- strip comments and template/string bodies, carefully -----------
   The naive version of this check would flag its own documentation: every
   file above QUOTES `S.place==='play'` in a comment explaining the bug.
   An earlier repair pass did exactly that and nested a comment inside a
   comment, breaking two suites. So: block comments, line comments and
   string literals all become spaces of the same length, which keeps every
   line and column number honest for the report. */
function strip(src) {
  const out = src.split('');
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && d === '/') { let e = src.indexOf('\n', i); if (e < 0) e = src.length; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      /* keep the quotes themselves so `S.place==='live'` still matches —
         only the INTERIOR of a long prose string is blanked, and a short
         identifier-shaped body is left alone. */
      const body = src.slice(i + 1, j);
      if (body.length > 24 || /\s/.test(body)) blank(i + 1, j);
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/* ---- the domain, read from the app itself --------------------------- */
const appSrc = fs.readFileSync(path.join(ROOT, REL_ARG), 'utf8');
const m = appSrc.match(/GAME_SCREENS\s*=\s*\[([^\]]*)\]/);
if (!m) { console.log('\n  PLACES — cannot find GAME_SCREENS in ' + REL_ARG + '. Refusing to guess.\n'); process.exit(1); }
const LEGAL = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const LEGAL_SET = new Set(LEGAL.concat(['']));   // '' means "not in the game flow", and is written deliberately

console.log('\n  PLACES — every S.place value must be one the app can reach\n');
console.log('  domain, read from ' + REL_ARG + ': ' + LEGAL.map(x => '"' + x + '"').join(' ') + '  (plus "")\n');

/* ---- every file that touches S.place -------------------------------- */
/* JUDGE THE BUILD BEING PROMOTED, REPORT THE OTHER ONE.
   all.js already learned this the hard way — half a gate grading the file
   being promoted and half grading the one already live is a single "green"
   that means two different things. So the candidate and its Control Room
   are the verdict; the currently-live pair is printed as context and
   cannot make this suite red, because a stale live file is what a promote
   is FOR. */
const CAND = REL_ARG;
const CAND_ADMIN = /-test\.html$/.test(REL_ARG) ? 'admin-test.html' : 'admin.html';
const OTHER = ['index.html', 'index-test.html', 'admin.html', 'admin-test.html']
  .filter(f => f !== CAND && f !== CAND_ADMIN && fs.existsSync(path.join(ROOT, f)));

const targets = [];
[CAND, CAND_ADMIN].forEach(f => { if (fs.existsSync(path.join(ROOT, f))) targets.push(f); });
fs.readdirSync(path.join(ROOT, 'qa')).filter(f => f.endsWith('.js') && f !== 'places.js')
  .forEach(f => targets.push(path.join('qa', f)));

const RE = /S\.place\s*(===|==|=)\s*(['"])([^'"]*)\2/g;
let scanned = 0, sites = 0;

targets.forEach(rel => {
  const src = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  scanned++;
  let hit;
  RE.lastIndex = 0;
  while ((hit = RE.exec(src))) {
    sites++;
    const val = hit[3];
    if (LEGAL_SET.has(val)) continue;
    const line = src.slice(0, hit.index).split('\n').length;
    bad.push({ file: rel, line, op: hit[1], val });
  }
});

/* the informational pass over whatever is NOT being promoted */
const alsoBad = [];
OTHER.forEach(rel => {
  const src = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  let h; const re = new RegExp(RE.source, 'g');
  while ((h = re.exec(src))) {
    if (LEGAL_SET.has(h[3])) continue;
    alsoBad.push(rel + ':' + src.slice(0, h.index).split('\n').length + "  S.place " + h[1] + " '" + h[3] + "'");
  }
});
if (alsoBad.length) {
  console.log('  not judged here (not the build being promoted):');
  alsoBad.forEach(l => console.log('    · ' + l));
  console.log('');
}

ok('places.every-value-is-reachable',
   bad.length === 0,
   bad.map(b => b.file + ':' + b.line + '  S.place ' + b.op + " '" + b.val + "'" +
     (b.op === '=' ? '   — drives the app into a state it cannot reach'
                   : '   — a comparison that is ALWAYS FALSE')).join('\n      '));

/* A domain with nothing in it means the parse failed rather than the code
   being clean, and a check that silently measures nothing is the failure
   this whole file exists to make impossible. */
ok('places.the-domain-was-actually-read', LEGAL.length >= 3,
   'GAME_SCREENS parsed to ' + LEGAL.length + ' values — too few to be real');
ok('places.something-was-actually-scanned', sites >= 5,
   'only ' + sites + ' S.place comparisons found across ' + scanned + ' files — the scanner is probably broken, not the code');

console.log('\n  ' + scanned + ' files · ' + sites + ' S.place sites · ' +
  (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
        : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
process.exit(fail ? 1 : 0);
