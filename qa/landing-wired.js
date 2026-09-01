/* qa/landing-wired.js — the landing screen's furniture is actually WIRED.

   THE BUG THIS EXISTS FOR. Five initialisers sat in renderGametime()
   AFTER its `return`:

       return renderGametimeRest();
       try{ paintYou(); }catch(_){}
       try{ paintInvite(); }catch(_){}
       try{ tapeLoad(); }catch(_){}
       try{ handleRestore(); }catch(_){}
       try{ if(!SCHED) schedLoad(); }catch(_){}

   Four of them had NO other call site in the file. The invite button, The
   Tape, the persistent @handle and the two-week schedule were all built,
   all shipped, all gated green — and not one of them ever ran. The founder
   opened the site after a fortnight of work and said "right now it looks
   the same", which was the literal truth.

   117 suites passed over it, because every one of them called those
   functions directly. Not one asserted that anything CALLS them. That is
   the whole lesson: a function that works is not a feature that runs.

   Two further faults were hiding behind the dead code and could only be
   found once it ran: tapeRender() called `set(...)`, which is a LOCAL
   helper in three other renderers and not a global, so it threw
   ReferenceError into its own catch and The Tape never appeared; and
   tapeLoad() gave up the first time SB was not ready, which is every time,
   because readiness deliberately does not wait on the network. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
/* BOTH SHAPES, because qa/all.js uses the positional one. A TARGETABLE
   suite is handed `argv.push(TARGET_ABS)` — an absolute path with no
   flag — while running it by hand uses `--file`. This read only --file,
   so inside the gate it silently fell back to index.html and graded the
   LIVE build: it reported the five initialisers stranded at lines
   30926-30930, which are the live file's line numbers, and looked like a
   real failure of the candidate. A suite that grades the wrong file is
   worse than one that does not run, because it reports with confidence. */
const FILE = (function(){
  const a = process.argv.slice(2), i = a.indexOf('--file');
  if (i >= 0 && a[i + 1]) return a[i + 1];
  const pos = a.filter(x => !x.startsWith('--') && /\.html?$/i.test(x));
  return pos.length ? pos[0] : 'index.html';
})();
const src = fs.readFileSync(path.isAbsolute(FILE) ? FILE : path.join(ROOT, FILE), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); }
                       else { fail++; console.log('  FAIL ' + m); } };

const INITS = ['paintYou', 'paintInvite', 'tapeLoad', 'handleRestore', 'schedLoad'];

console.log('--- every initialiser is called from the readiness block ---');
/* _statsReady is the documented "code loaded and rendered once" point. */
const rd = src.indexOf('var _statsReady = function()');
ok(rd > 0, '_statsReady() exists');
const readyBlock = src.slice(rd, rd + 2600);
for (const fn of INITS) {
  ok(new RegExp('(^|[^a-zA-Z_.])' + fn + '\\(').test(readyBlock),
     `${fn}() is called from _statsReady`);
}

console.log('--- nothing is stranded after a return ---');
/* The precise shape of the bug: a call to one of these sitting below a
   `return` in the same block. Scanned line by line rather than by regex —
   the first version of this check used a multiline pattern with nested
   quantifiers and backtracked for two minutes on a 1.8MB file before
   being killed, which is its own small lesson about checks. */
{
  const lines = src.split('\n');
  const strand = {};
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*return\b/.test(lines[i])) continue;
    /* Look at the next few statements, skipping blanks and comments. */
    let seen = 0;
    for (let j = i + 1; j < lines.length && seen < 6; j++) {
      const t = lines[j].trim();
      if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
      if (t === '}' || t === '});') break;          /* block ended: fine */
      seen++;
      for (const fn of INITS) {
        if (t.includes(fn + '(')) strand[fn] = j + 1;
      }
    }
  }
  for (const fn of INITS) {
    ok(!strand[fn], strand[fn]
      ? `${fn}() is stranded after a return at line ${strand[fn]}`
      : `${fn}() is not stranded after a return`);
  }
}

console.log('--- tapeRender can actually write text ---');
{
  const i = src.indexOf('function tapeRender()');
  ok(i > 0, 'tapeRender() exists');
  const body = src.slice(i, i + 2000);
  const usesSet = /[^a-zA-Z_.]set\(/.test(body);
  const declaresSet = /(var|const|let)\s+set\s*=/.test(body);
  ok(!usesSet || declaresSet,
     'tapeRender declares its own set() before using it (it is not a global)');
}

console.log('--- the loaders survive a backend that is not up yet ---');
{
  const i = src.indexOf('function tapeLoad(');
  const body = src.slice(i, i + 1400);
  ok(/setTimeout\(/.test(body),
     'tapeLoad retries rather than giving up the first time SB is missing');
}

console.log('--- the landing gets a wide layout, like predict and final ---');
ok(/body\.on-landing \.phone\{max-width:1120px\}/.test(src),
   'body.on-landing lifts the 440px phone column at 1120px');
ok(/classList\.toggle\('on-landing'/.test(src),
   "something sets the on-landing class");
{
  /* go() alone is not enough: #s-landing ships class="screen active", so
     go() has never run on first paint — the only paint most visitors get. */
  const boot = src.indexOf("classList.add('booted')");
  ok(boot > 0 && /on-landing/.test(src.slice(boot, boot + 1200)),
     'on-landing is also set at BOOT, not only from go()');
}

console.log('--- the rail and the headline stop hiding their own content ---');
ok(!/\.grWho\{[^}]*text-overflow:ellipsis/s.test(src),
   '.grWho no longer clips the home team out of "Brewers at Cubs"');
ok(/\.mq-toprow\{[^}]*flex-wrap:wrap/s.test(src),
   '.mq-toprow wraps instead of truncating "GAME OF THE NIGHT"');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
