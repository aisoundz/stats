/* ============================================================================
   qa/team-bars.js — THE HEAD-TO-HEAD ROW MUST AGREE WITH ITSELF

   From the AI beta tester on the Stats tab: the 3rd-down bar was answering a
   different question from its label, and Penalties had no "lower is better"
   note.

   One cause. Both rows arrive from ESPN as "N-M" and both were tagged
   'frac', which made them the same kind of number. They are not:

     3rd down efficiency  "5-16"  5 conversions of 16 attempts — a RATIO,
                                  higher is better
     Penalties            "7-55"  7 penalties for 55 yards — NOT a ratio,
                                  the count is the quantity, lower is better

   Compared as bare numerators with higher winning, 5-of-16 (31%) was shown
   beating 4-of-8 (50%), and the team with MORE penalties was highlighted as
   leading. The numbers printed either side were correct the whole time,
   which is why it survived: only the verdict was wrong.

   These are pure functions, so this suite is fast and exact. It asserts the
   VERDICT (who leads) and the note, not pixel positions.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== HEAD TO HEAD ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  /* waitReady(), not a guess at boot. It waits for the app's own
       STATS_READY flag and, when that never arrives, says plainly that
       this is a BOOT failure rather than a defect in the thing under
       test — which is the message qa/stats-page.js needed and did not
       have when it spent an evening skipping a sport per run. */
    await waitReady(page);

  const r = await page.evaluate(() => {
    const out = { has: typeof stBarCmp === 'function' && typeof stBarLow === 'function' };
    if (!out.has) return out;

    /* The exact pair from the report: worse conversion rate, more raw
       conversions. Under the old rule the 5 beat the 4. */
    out.ratio_5of16 = stBarCmp('5-16', 'ratio');
    out.ratio_4of8  = stBarCmp('4-8',  'ratio');

    /* Penalties: the count is what counts, and the yards must not leak in. */
    out.pen_7for55  = stBarCmp('7-55', 'countlow');
    out.pen_3for20  = stBarCmp('3-20', 'countlow');

    /* Plain rows are unchanged. */
    out.plain_412   = stBarCmp('412', '');
    out.pct_48      = stBarCmp('48.1', '%');

    out.lowFor = { low: stBarLow('low'), countlow: stBarLow('countlow'),
                   ratio: stBarLow('ratio'), plain: stBarLow(''), pct: stBarLow('%') };

    /* And the spec itself — that the two football rows carry the two
       different kinds, which is the thing that was actually wrong. */
    const f = (typeof ST_BARS !== 'undefined' && ST_BARS.football) || [];
    const kindOf = n => (f.find(p => p[0] === n) || [])[1];
    out.kind3rd = kindOf('3rd down efficiency');
    out.kindPen = kindOf('Penalties');
    out.anyFrac = f.some(p => p[1] === 'frac');
    return out;
  });

  ok(r.has, 'the comparison and direction helpers exist');
  if (!r.has) { await browser.close(); console.log('team-bars: helpers missing\n'); process.exit(1); }

  console.log('  3rd down   5-16 → ' + r.ratio_5of16.toFixed(3) +
              '   4-8 → ' + r.ratio_4of8.toFixed(3));
  console.log('  Penalties  7-55 → ' + r.pen_7for55 + '   3-20 → ' + r.pen_3for20);
  console.log('  kinds      3rd down=' + r.kind3rd + '  Penalties=' + r.kindPen + '\n');

  ok(r.ratio_4of8 > r.ratio_5of16,
     '4 of 8 beats 5 of 16 on third down',
     '4-8=' + r.ratio_4of8 + ' vs 5-16=' + r.ratio_5of16 + ' — the bar is comparing raw conversions');

  ok(r.pen_7for55 === 7 && r.pen_3for20 === 3,
     'Penalties compares the count, not the yards',
     'got ' + r.pen_7for55 + ' and ' + r.pen_3for20);

  ok(r.lowFor.countlow === true,
     'Penalties is marked lower-is-better',
     'stBarLow("countlow") = ' + r.lowFor.countlow);

  ok(r.lowFor.low === true, 'plain low rows stay lower-is-better');
  ok(r.lowFor.ratio === false && r.lowFor.plain === false && r.lowFor.pct === false,
     'nothing else is lower-is-better',
     JSON.stringify(r.lowFor));

  ok(r.plain_412 === 412 && Math.abs(r.pct_48 - 48.1) < 1e-9,
     'plain and percentage rows are untouched',
     r.plain_412 + ' / ' + r.pct_48);

  ok(r.kind3rd === 'ratio', 'third down is a ratio', 'kind = ' + r.kind3rd);
  ok(r.kindPen === 'countlow', 'penalties is a lower-is-better count', 'kind = ' + r.kindPen);
  ok(!r.anyFrac, "no football row is still tagged the ambiguous 'frac'");

  /* ---- the colour pair, and the empty row ---------------------------
     "New York was blue in the chart and orange in the bars." Both were
     the team's colour; only one had been through tcTooClose(), which is
     what makes two teams distinguishable when their brand colours clash.
     Every block on the page has to read the RESOLVED pair. */
  const c = await page.evaluate(() => {
    /* Two teams whose colours are deliberately near-identical, so the
       clash resolver definitely fires and the raw and resolved colours
       definitely differ. If they did not differ, this check would pass
       without proving anything. */
    GS.teams = [
      { ab:'NYG', name:'New York Giants', score:24, home:false, m:{},
        color:'#0b2265', alt:'#a71930', stat:function(k){return this.m[k];} },
      { ab:'DAL', name:'Dallas Cowboys',  score:17, home:true,  m:{},
        color:'#0c2340', alt:'#869397', stat:function(k){return this.m[k];} }
    ];
    GS.ok = true;
    try { paintTeamColours(); } catch (_) {}

    /* stFlow() reads GS.lines and returns '' without them. The first
       version of this check asserted "the rejected colour is not in the
       chart" against an EMPTY STRING, which passes for free and proves
       nothing. Give it a real four-period game. */
    const line = (ab, home, ns) => ({ ab, home,
      vals: ns.map(n => ({ n, t: String(n) })) });
    GS.lines = [ line('NYG', false, [7, 3, 0, 14]),
                 line('DAL', true,  [3, 7, 10, 0]) ];

    const raw = { a: GS.teams[0].color, h: GS.teams[1].color };
    const res = { a: GS.awayC, h: GS.homeC };

    /* Every place a raw feed colour could still be read. */
    const src = document.documentElement.outerHTML;
    return {
      raw, res, split: !!GS.colourSplit,
      rawReads: (typeof stFlow === 'function' ? 1 : 0),
      flowHtml: (function(){ try { return String(stFlow() || ''); } catch (_) { return 'THREW'; } })(),
      statsHtml: (function(){ try { return String(stTeamBars() || ''); } catch (_) { return 'THREW'; } })()
    };
  });

  console.log('  colours    raw ' + c.raw.a + ' / ' + c.raw.h +
              '   resolved ' + c.res.a + ' / ' + c.res.h +
              (c.split ? '   (clash resolved)' : '   (no clash)'));

  ok(c.split, 'the fixture really does clash, so this check means something',
     'the two colours were far enough apart that nothing was resolved');

  ok(c.res.a !== c.raw.a || c.res.h !== c.raw.h,
     'the resolved pair differs from the raw feed pair',
     'they are identical — the check cannot distinguish the two sources');

  /* The chart must not contain the raw colour that was rejected. */
  const rejected = (c.res.a !== c.raw.a) ? c.raw.a : c.raw.h;
  ok(c.flowHtml !== 'THREW', 'the flow chart renders');
  ok(c.flowHtml.length > 0 && c.flowHtml.indexOf('flCol') >= 0,
     'the flow chart actually produced columns',
     'it returned ' + c.flowHtml.length + ' chars — an empty chart passes the colour check for free');
  ok(c.flowHtml.indexOf(rejected) < 0,
     'the flow chart does not use the colour the clash resolver rejected',
     'found ' + rejected + ' in the chart while the bars use ' + c.res.a + '/' + c.res.h);

  /* ---- a 0-0 row draws no fill --------------------------------------- */
  const z = await page.evaluate(() => {
    /* stTeamBars() reads gtTeams() and famNow(), NOT GS.teams directly.
       The first version of this check set GS.teams, got no rows back, and
       took the "nothing to assert" branch — a vacuous pass dressed as
       coverage, which is the exact thing the gate exists to catch. */
    const mk = (ab, m) => ({ ab, name: ab, color: '#367fd9', m,
                             stat: function (k) { return this.m[k]; } });
    const zero = { 'Total Yards': '0', '1st Downs': '0' };
    const realGt = window.gtTeams, realFam = window.famNow;
    window.gtTeams = () => ({ a: mk('NYG', zero), h: mk('DAL', zero) });
    window.famNow  = () => 'football';
    let html = '';
    try { html = String(stTeamBars() || ''); } catch (e) { html = 'THREW ' + e.message; }
    window.gtTeams = realGt; window.famNow = realFam;
    const m = html.match(/<i style="width:(\d+)%"/);
    return { html: html.slice(0, 240), width: m ? Number(m[1]) : null,
             flat: /tbFlat/.test(html), rows: (html.match(/tbRow/g) || []).length };
  });
  console.log('  0-0 row    ' + z.rows + ' row(s), fill=' +
              (z.width == null ? 'none found' : z.width + '%') + ', flat=' + z.flat);
  if (z.width != null) {
    ok(z.width === 0, 'a 0-0 row draws no fill at all',
       'drew ' + z.width + '% — an even split reads as "evenly matched" when nothing has happened');
    ok(z.flat, 'and the track is marked flat');
  } else {
    ok(false, 'the 0-0 fixture must actually render a row',
       'no bar was produced, so nothing about empty rows was tested: ' + z.html);
  }
  ok(z.rows > 0, 'the 0-0 fixture produced rows to measure', z.html);

  /* ---- 23 Aug: two rows both said "STRIKEOUTS" -----------------------
     Batting Strikeouts and Pitching Strikeouts both had their group word
     stripped, producing two identical, unlabelled "STRIKEOUTS" rows on a
     real Stats page. Every visible row label in a sport's head-to-head
     card must be unique — that is the actual promise, and it is stronger
     than "the word strikeouts specifically doesn't collide". */
  const labels = await page.evaluate(() => {
    const mk = (ab, m) => ({ ab, name: ab, color: '#367fd9', m,
                             stat: function (k) { return this.m[k]; } });
    const box = {
      'Batting Hits': '6', 'Batting Runs Batted In': '3', 'Batting Strikeouts': '2',
      'Batting Stolen Bases': '0', 'Fielding Errors': '0', 'Fielding Double Plays': '0',
      'Pitching Strikeouts': '2'
    };
    const realGt = window.gtTeams, realFam = window.famNow;
    window.gtTeams = () => ({ a: mk('SF', Object.assign({}, box)), h: mk('BOS', Object.assign({}, box)) });
    window.famNow  = () => 'baseball';
    let html = '';
    try { html = String(stTeamBars() || ''); } catch (e) { html = 'THREW ' + e.message; }
    window.gtTeams = realGt; window.famNow = realFam;
    const m = [...html.matchAll(/tbLbl">([^<]+)</g)].map(x => x[1].trim());
    return { html: html.slice(0, 300), rows: m };
  });
  console.log('  baseball row labels: ' + JSON.stringify(labels.rows));
  ok(labels.rows.length >= 2, 'the strikeouts fixture produced rows to measure', labels.html);
  ok(new Set(labels.rows).size === labels.rows.length,
     'every visible row label in the head-to-head card is unique',
     'duplicate label(s): ' + JSON.stringify(labels.rows));
  ok(labels.rows.some(l => /batting/i.test(l)) && labels.rows.some(l => /pitching/i.test(l)),
     'the two strikeouts rows keep their disambiguating word',
     JSON.stringify(labels.rows));

  /* ---- the two numbers under each column ----------------------------
     They were bare: "7  3" under a pair of coloured bars, with nothing
     saying which way round it went. They now take the bars' colours —
     but a period WINNER is still highlighted, and colouring them inline
     would have beaten that rule and silently deleted it. Assert both. */
  const f = await page.evaluate(() => {
    const line = (ab, home, ns) => ({ ab, home, vals: ns.map(n => ({ n, t: String(n) })) });
    GS.lines = [ line('NYG', false, [7, 3, 0, 14]), line('DAL', true, [3, 7, 10, 0]) ];
    const host = document.createElement('div');
    host.innerHTML = (function () { try { return String(stFlow() || ''); } catch (_) { return ''; } })();
    document.body.appendChild(host);
    const col = host.querySelector('.flCol');
    const win = host.querySelector('.flCol.fla, .flCol.flh');
    const read = el => el ? getComputedStyle(el).color : '';
    const out = {
      any: !!col,
      inlineColour: col ? /color\s*:/.test(col.querySelector('.flNums b').getAttribute('style') || '') : null,
      hasVars: col ? /--ac\s*:/.test(col.getAttribute('style') || '') : null,
      away: col ? read(col.querySelectorAll('.flNums b')[0]) : '',
      home: col ? read(col.querySelectorAll('.flNums b')[1]) : '',
      winnerLit: null
    };
    if (win) {
      const lit = win.classList.contains('fla')
        ? win.querySelectorAll('.flNums b')[0] : win.querySelectorAll('.flNums b')[1];
      out.winnerLit = read(lit);
      out.inkExpected = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    }
    host.remove();
    return out;
  });

  if (f.any) {
    console.log('  period nums  away=' + f.away + '  home=' + f.home +
                (f.winnerLit ? '   winner=' + f.winnerLit : '   (no decided period)'));
    ok(f.hasVars, 'the column carries the team colours as custom properties');
    ok(f.inlineColour === false,
       'the numbers are NOT coloured inline',
       'an inline colour outranks the winner-highlight rule and deletes it');
    ok(f.away !== f.home, 'the two numbers are told apart by colour',
       'both rendered ' + f.away);
  } else {
    ok(false, 'the flow chart must render columns for this to mean anything');
  }

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('team-bars: RAN NOTHING\n'); process.exit(1); }
  console.log('team-bars: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
