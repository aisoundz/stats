/* ============ qa/slate-offer.js ======================================
   THE NUMBER IN THE LOG IS PART OF THE PRODUCT.

   From the real 3am cron log of 29 Aug 2026, two lines apart, about the
   same fourteen baseball games:

       offer   17 game(s) will appear in the picker
       rail    17 MLB game(s) built but NOT offered — not in the pick file

   Seventeen would appear and seventeen would not. The true answer was
   zero: no MLB room was offered that morning at all. The founder reads
   this log to find out what the machine did overnight, and for weeks the
   only offer-shaped number in it was a lie.

   The cause is the same disease as everywhere else in build-slate.js —
   one fact with two writers — except that here the second writer is a
   sentence rather than a variable. The `offer` line printed
   `offered.length` at a point in the run FORTY LINES BEFORE the pick file
   is read, so it could not have known what the picker would show, and
   said so anyway.

   Two things are checked, and they are different in kind:

     THE SOURCE   the pre-curation line must not claim the picker, and the
                  honest count must be printed on the --apply path, not
                  only on the dry run. It lived inside `if(!APPLY)`, which
                  meant the ONLY run that actually writes the rail was the
                  one run that never said how big it was.

     THE LOGS     candidates minus withheld must equal offered, in the
                  real ~/gamenight-logs/slate.log, for every group written
                  by a build that carries the fix. Groups written by the
                  older build are counted and REPORTED, never silently
                  skipped — a suite that quietly ignores what it cannot
                  check is how a gate comes to mean nothing.

   SLATE_SRC overrides the build-slate.js path so this can be sabotage-
   tested against an unfixed copy. SLATE_LOG does the same for the log.
   ================================================================== */
const fs = require('fs'), path = require('path');

const SRC = process.env.SLATE_SRC || path.join(__dirname, '..', 'host', 'build-slate.js');
const LOG = process.env.SLATE_LOG || path.join(process.env.HOME, 'gamenight-logs', 'slate.log');

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

let src;
try { src = fs.readFileSync(SRC, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + SRC + ' — ' + e.message); process.exit(1); }

/* CHECK THE CODE, NOT THE PROSE. The first version of this file failed on
   the FIXED build, because the comment explaining the bug quotes the very
   sentence the bug was made of — and so does the sample log line under it.
   A check that cannot tell a warning about a lie from the lie itself would
   have forced the next person to delete the explanation to get to green.
   Comments are blanked rather than removed so line numbers still point at
   the real file. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/^(\s*)\/\/.*$/gm, (m, s) => s);

console.log('qa/slate-offer.js — the offered count is the one the rail was written from');
console.log('  src ' + SRC);

/* ---- THE SOURCE ---------------------------------------------------- */

t('no logged line claims the picker before the pick file is read', () => {
  const iPick  = code.indexOf('slate-pick-');
  if (iPick < 0) return 'cannot find where the pick file is read';
  const lines = code.split('\n');
  const early = [];
  let at = 0;
  lines.forEach((line, i) => {
    if (/will appear in the picker/.test(line) && at < iPick)
      early.push(`line ${i + 1} claims the picker before slate-pick-* is read: ${line.trim()}`);
    at += line.length + 1;
  });
  return early.length ? early.join('\n         ') : true;
});

/* THE HONEST LINE IS THE ONE THAT READS railGames — not merely the first
   thing in the file that says `offer`. The first draft of this check asked
   whether ANY offer log came before `if(!APPLY)`, and the unfixed build
   passed it: its liar line sits before that block too. It was green about
   exactly the file it exists to condemn. */
const offerLines = [];
{
  const re = /log\('offer',[\s\S]{0,300}?\);/g;
  let m;
  while ((m = re.exec(code))) offerLines.push({ at: m.index, text: m[0] });
}
const honest = offerLines.find(o => /railGames\.length/.test(o.text));

t('an offer count is computed from the set the rail is written from', () => {
  if (!offerLines.length) return 'nothing logs an `offer` count at all';
  if (!honest)
    return 'no offer line reads railGames.length — every one of them reports a different set '
         + 'than the `merged = kept.concat(railGames)` that writes the rail:\n         '
         + offerLines.map(o => o.text.trim()).join('\n         ');
  return true;
});

t('that honest count is printed on the --apply path, not only the dry run', () => {
  const iApply = code.indexOf('if(!APPLY){');
  if (iApply < 0) return 'cannot find the `if(!APPLY){` block to compare against';
  if (!honest) return 'there is no honest offer count to print on either path';
  if (honest.at > iApply)
    return 'the railGames-based offer count sits inside the dry-run block, so the 3am --apply '
         + 'cron — the only run that actually writes the rail players see — never states how '
         + 'many rooms it offered';
  return true;
});

t('no pre-curation count is dressed up as an offer', () => {
  const liars = offerLines.filter(o => !/railGames\.length/.test(o.text) && o.at < code.indexOf('slate-pick-'));
  return liars.length
    ? 'an `offer` line is logged before curation, which cannot know what the picker will show:\n         '
      + liars.map(o => o.text.trim()).join('\n         ')
    : true;
});

t('the rail is still written from the hosted set, not the candidate set', () =>
  /merged\s*=\s*kept\.concat\(railGames\)/.test(code) ||
  'slate.games/offered is being written to the rail instead of railGames — '
  + 'rooms would be offered that nothing hosts');

/* ---- THE LOGS ------------------------------------------------------ */

let logText = null;
try { logText = fs.readFileSync(LOG, 'utf8'); } catch (_) {}

if (logText === null) {
  console.log('  --   no ' + LOG + ' on this box; the log arithmetic was not checked');
} else {
  /* Group by `cand`: everything until the next cand line belongs to it. */
  const groups = [];
  let cur = null;
  for (const raw of logText.split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^cand\s+(\d+)\s+(\S+)/))) {
      if (cur) groups.push(cur);
      cur = { cand: +m[1], league: m[2], withheld: 0, offer: null };
    } else if (cur && (m = line.match(/^rail\s+(\d+)\s+\S+\s+game\(s\) built but NOT offered/))) {
      cur.withheld = +m[1];
    } else if (cur && (m = line.match(/^offer\s+(\d+) of (\d+)/))) {
      cur.offer = +m[1]; cur.total = +m[2];
    }
  }
  if (cur) groups.push(cur);

  const old = (logText.match(/will appear in the picker/g) || []).length;
  console.log(`  log ${LOG}`);
  console.log(`      ${groups.length} group(s) from a build carrying the fix; `
            + `${old} line(s) from the older build are NOT checkable and were not checked`);

  /* NO DATA IS NOT A FAILURE, AND IT IS NOT A PASS EITHER. Until the 3am
     cron next runs there is no group from a fixed build to check, and a
     suite that goes red for eight hours over that teaches the person to
     ignore it — the same reason the Sunday guards exist in check-draft.js.
     It is announced instead, so nobody reads the green as coverage. */
  const complete = groups.filter(g => g.offer !== null);
  if (!complete.length) {
    console.log('  --   the log arithmetic was NOT checked: no group from a fixed build has '
              + 'reached\n       ' + LOG + ' yet. It will be checked after the next build-slate run.');
  } else
  t('every checkable group adds up: candidates − withheld = offered', () => {
    const broken = complete.filter(g => g.cand - g.withheld !== g.offer);
    if (broken.length)
      return broken.map(g => `${g.league}: cand ${g.cand} − withheld ${g.withheld} = `
        + `${g.cand - g.withheld}, but the log says ${g.offer} offered`).join('\n         ');
    return true;
  });

  t('no group reports more offered than it built', () => {
    const over = groups.filter(g => g.offer !== null && g.total != null && g.offer > g.total);
    return over.length
      ? over.map(g => `${g.league}: ${g.offer} offered of ${g.total} built`).join('\n         ')
      : true;
  });
}

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
