#!/usr/bin/env node
/* WHAT IS ALLOWED TO FAIL WITHOUT SAYING SO
   ==================================================================
   Across 350 commits in this repo, 64 of them — nearly one in five —
   are about something that failed in silence. It is the single most
   common shape of bug here, ahead of checks that could not fail (49) and
   ahead of things that only ever worked in basketball (37).

   Three of them happened in one evening, 20 August:

     · periodLabel() threw ReferenceError because it could not see AUTO.
       The catch set a variable to null and the wrong branch ran. Every
       phone in a baseball room read "OT in progress" in the 4th inning,
       for weeks, and the fix for it had been written and had never once
       executed.
     · The feed publisher used ESPN_EVENT where the constant is EVENT. Its
       catch logged "could not publish the feed" every twenty seconds,
       which reads like a service being down rather than a typo.
     · CI.tick ran inside `catch(e){}` on every live tick. Caught It fired
       zero times all night behind a badge reading ARMED.

   A bare catch is fine around things whose failure genuinely does not
   matter: localStorage in private mode, a DOM node that may not be on
   screen, an analytics ping. The player app has around a thousand of
   those and they are correct.

   It is NOT fine in the code that hosts a night. If host/*.js or the
   shared block swallows an exception, nobody finds out until a room full
   of people is looking at the wrong thing. A ReferenceError is never an
   expected condition — it is a bug, and it must be audible.

   This suite reads the host path only, and asks one question per catch:
   if this fires, does anybody find out?

   Usage: node qa/silence.js [--list]                                     */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LIST = process.argv.includes('--list');

let PASS = 0, FAIL = 0;
const ok = (id, cond, why) => {
  if (cond) { PASS++; console.log(`  \x1b[32m✓\x1b[0m ${id}`); }
  else { FAIL++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); }
};

/* Every catch, with the body that follows it, from a chunk of source. */
function catches(src){
  const out = [];
  const re = /catch\s*\(\s*([A-Za-z_$][\w$]*)?\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, param: m[1] || '', body });
  }
  return out;
}

/* A catch is AUDIBLE if it logs, re-throws, records for a human, or hands
   the failure to something that will. Assigning a fallback value and
   carrying on is exactly what hid the OT bug, so that does not count. */
function audible(body){
  return /\blog\s*\(|console\.(error|warn|log)|throw\b|needsHuman|setState|blame\s*\(|die\s*\(|reject\s*\(/.test(body);
}

const TARGETS = [
  { file: 'host/run.js',        label: 'the runner' },
  { file: 'host/build-slate.js',label: 'the slate builder' },
  { file: 'host/publish.js',    label: 'the publisher' },
  { file: 'host/national.js',   label: 'the carriage check' },
];

(function main(){
  console.log('\n  SILENCE — can the code that hosts a night fail without saying so?\n');
  const offenders = [];

  for (const t of TARGETS) {
    const p = path.join(ROOT, t.file);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const all = catches(src);
    const mute = all.filter(c => !audible(c.body));
    console.log(`  ${t.file.padEnd(22)} ${String(all.length).padStart(3)} catch blocks · ${String(mute.length).padStart(3)} of them say nothing`);
    mute.forEach(c => offenders.push({ file: t.file, line: c.line, body: c.body.trim().replace(/\s+/g, ' ').slice(0, 60) }));
  }

  /* The shared block is host code that happens to live in admin.html, and
     it is the piece host/run.js lifts out and runs with no page around it.
     Tonight's OT bug was in here. */
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const a = admin.indexOf('/* @host-shared:start');
  const b = admin.indexOf('/* @host-shared:end */');
  if (a >= 0 && b > a) {
    const block = admin.slice(a, b);
    const before = admin.slice(0, a).split('\n').length;
    const all = catches(block);
    const mute = all.filter(c => !audible(c.body));
    console.log(`  ${'admin.html @host-shared'.padEnd(22)} ${String(all.length).padStart(3)} catch blocks · ${String(mute.length).padStart(3)} of them say nothing`);
    mute.forEach(c => offenders.push({ file: 'admin.html @host-shared', line: before + c.line - 1, body: c.body.trim().replace(/\s+/g, ' ').slice(0, 60) }));
  }

  console.log('');
  if (LIST && offenders.length) {
    offenders.forEach(o => console.log(`     ${o.file}:${o.line}  catch{ ${o.body || '(empty)'} }`));
    console.log('');
  }

  /* A CEILING, NOT A BAN. Some of these are genuinely fine — a cleanup in a
     teardown path, a best-effort write on the way out. The number is what
     matters: it must not grow. Lower it whenever one is fixed, and the day
     it hits zero, make it zero. */
  /* 52 is not a target, it is TODAY'S TRUE NUMBER, measured rather than
     guessed. My first attempt at this line was 34 and it failed on its own
     first run, which is the correct outcome for a made-up threshold.

     As a ratchet it does the useful thing immediately: the host path cannot
     get any quieter than it already is. Every one that gets a voice lowers
     the number, and the number never goes up. */
  const CAP = Number(process.env.SILENCE_CAP || 52);
  ok('silence.the-host-path-does-not-get-quieter', offenders.length <= CAP,
     `${offenders.length} catch blocks in the host path report nothing, and the agreed ceiling is ${CAP}. ` +
     `Run with --list to see them. A catch that swallows a ReferenceError turns a fix into decoration: ` +
     `that is how "OT in progress" reached every phone in a baseball room for weeks.`);

  console.log(`\n  ${FAIL ? '\x1b[31mRED' : '\x1b[32mGREEN'}  ${PASS} passed, ${FAIL} failed\x1b[0m\n`);
  process.exit(FAIL ? 1 : 0);
})();
