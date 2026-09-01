/* ============ qa/gn-series.js ========================================
   THE GAME NIGHT SERIES, CHECKED AGAINST THE REAL NUMBERS.

   qa/night-numbers.js already has checks named
       "no number is ever used twice across two nights"
       "the series has no gaps either"
   and both were GREEN on 1 Sept 2026 while slate/2026-09-01 held #50 and
   slate/2026-09-02 also held #50.

   They were not lying so much as looking somewhere else: both run against
   derive(...) with fabricated rooms — {id:'a',tip:'1'} — and prove the
   ALGORITHM produces a contiguous series. Neither has ever read a number
   off disk. A structural check over an arithmetic defect, which is the
   same shape as the 1,000-point ceiling that 115 suites missed.

   THE DEFECT THEY MISSED. build-slate.js numbers a day by counting on from
   YESTERDAY's slate, in tip order. Correct when written. But 2 and 3 Sept
   were numbered on 31 Aug, when 1 Sept held ONE room; when 1 Sept was
   rebuilt with THREE, it took #49-#51 and nothing renumbered the days
   already stamped ahead of it. They self-heal at their own 03:00 build,
   so the collision is invisible unless something looks at the series as a
   whole, on a day when it is wrong.

   This reads slate/{date} — the authority, by marquee.js's own words —
   and asks the only two questions that matter about a series of numbers.

       node qa/gn-series.js
       node qa/gn-series.js --days 30
*/
const path = require('path');
const fs = require('fs');

const ARG = process.argv.slice(2);
const DAYS = (() => { const i = ARG.indexOf('--days'); return i >= 0 ? Number(ARG[i + 1]) || 30 : 30; })();

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };

console.log('\n  the Game Night series, read from slate/{date}\n');

(async () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || (() => {
    try { return fs.readFileSync(path.join(process.env.HOME, '.secrets/stats-firebase-admin.json'), 'utf8'); }
    catch (_) { return ''; }
  })();
  if (!raw) {
    /* ANNOUNCED, NOT PASSED. A suite that cannot reach its data must say
       so — "I could not check" and "I checked and it is fine" are not the
       same sentence, and three suites in this repo once exited 0 while
       running nothing. */
    console.log('  --   no service account: the series was NOT checked.');
    console.log('\n  RED    0 passed, 1 failed');
    process.exit(1);
  }
  const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  /* Walk back from today so the window always covers what is live. */
  const dates = [];
  for (let i = -14; i < DAYS; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dates.push(d);
  }
  dates.sort();

  const owner = new Map();          // gn -> [nightId, date]
  const seen  = [];                 // {date, nightId, gn}
  for (const d of dates) {
    let snap;
    try { snap = await db.doc('slate/' + d).get(); } catch (_) { continue; }
    if (!snap.exists) continue;
    const games = (snap.data() || {}).games || [];
    games.forEach(g => {
      const gn = Number(g.gn);
      if (!gn) return;
      seen.push({ date: d, nightId: String(g.nightId || ''), gn });
    });
  }

  if (!seen.length) {
    console.log('  --   no numbered rooms in the window: nothing was checked.');
    console.log('\n  RED    0 passed, 1 failed');
    process.exit(1);
  }
  console.log(`       ${seen.length} numbered room(s) across ${new Set(seen.map(s => s.date)).size} day(s)\n`);

  /* ---- 1. NO NUMBER NAMES TWO ROOMS -------------------------------- */
  const dupes = [];
  seen.forEach(s => {
    const had = owner.get(s.gn);
    if (had && had.nightId !== s.nightId) {
      dupes.push(`#${s.gn}: ${had.nightId} (${had.date}) and ${s.nightId} (${s.date})`);
    } else if (!had) owner.set(s.gn, s);
  });
  dupes.length
    ? bad('no Game Night number names two different rooms', dupes.slice(0, 6).join('\n         '))
    : ok('no Game Night number names two different rooms', `${owner.size} distinct number(s)`);

  /* ---- 2. THE SERIES IS CONTIGUOUS --------------------------------- */
  /* A hole means a number was handed out and then its room vanished, or a
     day was numbered from the wrong predecessor. Either way the series
     stops being a count of anything. */
  const nums = [...owner.keys()].sort((a, b) => a - b);
  const holes = [];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) {
      for (let m = nums[i - 1] + 1; m < nums[i]; m++) holes.push(m);
    }
  }
  holes.length
    ? bad('the series has no holes', `missing: #${holes.slice(0, 12).join(', #')}` +
        (holes.length > 12 ? ` (+${holes.length - 12} more)` : '') +
        `\n         range #${nums[0]}–#${nums[nums.length - 1]}`)
    : ok('the series has no holes', `#${nums[0]}–#${nums[nums.length - 1]}, unbroken`);

  /* ---- 3. WITHIN A DAY, THE NUMBERS FOLLOW THE TIP ------------------ */
  /* Founder, 21 Aug: "Can you make the lynx game 17 and follow the order
     of the tip off time." */
  const byDay = {};
  seen.forEach(s => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const outOfOrder = Object.keys(byDay).filter(d => {
    const g = byDay[d];
    return g.some((x, i) => i > 0 && x.gn < g[i - 1].gn);
  });
  outOfOrder.length
    ? bad('within a day the numbers run in tip order', outOfOrder.join(', '))
    : ok('within a day the numbers run in tip order', `${Object.keys(byDay).length} day(s)`);

  console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL ' + (e && e.message)); process.exit(1); });
