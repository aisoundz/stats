/* ============ qa/log-writers.js ======================================
   A LOG FILE HAS ONE WRITER.

   Measured 30 Aug 2026 on this box:

       welcome-queue.log   3,735 timestamped lines, 1,830 of them exact repeats
       check-draft.log        32 timestamped lines,    12 exact repeats
       tipoff-verify.log      17 timestamped lines,     3 exact repeats

   A line that begins with an ISO timestamp cannot legitimately appear
   twice — the timestamp is generated per call. Every one of those pairs
   was the same process writing the same line down two different paths:
   the script's own log() does `process.stdout.write(msg)` AND
   `fs.appendFileSync(LOG, msg)`, and the cron line then redirected that
   same stdout back into that same LOG with `>>`.

   Half of the welcome queue's log was a copy of the other half. That is
   not cosmetic. It is the log the founder reads to find out whether a
   welcome email reached anybody, and every count taken from it — by a
   person or by a script — was double.

   This is the file's own recurring disease wearing yet another costume:
   one fact, two writers. The fix was to give cron a separate .cron.log
   for the things the script cannot log about itself (a crash before
   log() exists, a node error, an OOM), and leave the structured log to
   the one writer that structures it.

   CRONTAB_SRC points this at a file instead of the live crontab, so the
   check can be sabotage-tested against the old one.
   ================================================================== */
const fs = require('fs'), path = require('path'), cp = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };

console.log('qa/log-writers.js — a log file has one writer');

/* ---- the crontab ---------------------------------------------------- */
let cron = '';
try {
  cron = process.env.CRONTAB_SRC
    ? fs.readFileSync(process.env.CRONTAB_SRC, 'utf8')
    : cp.execSync('crontab -l', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (_) {
  console.log('  --   no crontab readable here; nothing to check');
  console.log('\n  GREEN  0 passed, 0 failed');
  process.exit(0);
}

/* Every cron job that runs one of this repo's host scripts and redirects
   its output somewhere. */
const jobs = [];
cron.split('\n').forEach(line => {
  const l = line.trim();
  if (!l || l.startsWith('#')) return;
  const script = l.match(/(host\/[A-Za-z0-9._-]+\.(?:js|sh))/);
  const redir  = l.match(/>>\s*(\S+)/);
  if (script && redir) jobs.push({ script: script[1], log: redir[1], line: l });
});

console.log(`  ${jobs.length} cron job(s) run a host script and redirect output`);

/* ---- what each script writes for itself ----------------------------- */
function ownLogs(scriptRel) {
  const f = path.join(ROOT, scriptRel);
  let src = '';
  try { src = fs.readFileSync(f, 'utf8'); } catch (_) { return []; }
  /* Only scripts that append to a file of their own can collide. */
  if (!/appendFileSync/.test(src)) return [];
  const out = [];
  /* path.join(process.env.HOME, 'gamenight-logs', 'name.log') and the
     plain-string forms both appear in this repo. */
  const re = /['"]([A-Za-z0-9._-]+\.log)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return [...new Set(out)];
}

const collisions = [];
jobs.forEach(j => {
  const owned = ownLogs(j.script);
  if (!owned.length) return;
  const target = path.basename(j.log);
  if (owned.indexOf(target) >= 0) {
    collisions.push(`${j.script} appends to ${target} AND cron redirects its stdout into ${target} — `
                  + 'every line it logs is written twice');
    return;
  }
  /* THE SUBTLER HALF, and the first fix on 30 Aug stopped one step short
     of it. Pointing the redirect at a different file does not give the
     line one writer — it gives it two files. A script that keeps its own
     structured log writes every line to stdout as well, so cron must
     send that stdout to /dev/null and keep only stderr, which is the one
     stream the script cannot log about itself: a crash, an OOM, a node
     error thrown before log() exists. */
  if (!/>\s*\/dev\/null/.test(j.line))
    collisions.push(`${j.script} keeps its own ${owned.join(', ')} and cron ALSO captures its stdout `
                  + `into ${target} — the same lines land in two files. Send stdout to /dev/null and `
                  + 'redirect only stderr (2>>) so the cron log holds what the script cannot log itself');
});

if (!collisions.length)
  ok('no cron job redirects into a log its own script already writes',
     `${jobs.length} job(s) checked`);
else
  bad('no cron job redirects into a log its own script already writes',
      collisions.join('\n         ')
      + '\n         give cron its own .cron.log for crashes and leave the structured log to the script');

/* ---- and the evidence on disk, which is the part that cannot be argued with ---- */
const LOGDIR = path.join(process.env.HOME || '', 'gamenight-logs');
const suspect = [];
try {
  fs.readdirSync(LOGDIR).filter(f => /\.log$/.test(f) && !/\.cron\.log$/.test(f)).forEach(f => {
    let txt = '';
    try { txt = fs.readFileSync(path.join(LOGDIR, f), 'utf8'); } catch (_) { return; }
    const stamped = txt.split('\n').filter(l => /^20\d{2}-\d{2}-\d{2}T/.test(l));
    if (stamped.length < 20) return;              // too small to be evidence
    const seen = new Set(); let dup = 0;
    stamped.forEach(l => { if (seen.has(l)) dup++; else seen.add(l); });
    /* A timestamped line repeating at all is suspicious; a fifth of them
       repeating is a second writer, not a coincidence. */
    if (dup / stamped.length > 0.2)
      suspect.push(`${f}: ${dup} of ${stamped.length} timestamped lines are exact repeats `
                 + `(${Math.round(100*dup/stamped.length)}%)`);
  });
} catch (_) {}

if (!suspect.length)
  ok('no log on disk shows a timestamped line written twice');
else
  bad('no log on disk shows a timestamped line written twice',
      suspect.join('\n         ')
      + '\n         a line stamped to the millisecond cannot legitimately appear twice');

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
