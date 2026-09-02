/* ============ qa/schedule-menu.js ====================================
   THE SCHEDULE MAY NOT PROMISE A GAME NOBODY HOSTS.

   Founder, 31 Aug 2026: "We should also have our schedule for the next two
   weeks in our menu so people know what games are coming as well."

   That is a PROMISE surface. Everything on it is a commitment a stranger
   may plan an evening around, and this product has broken exactly this
   promise before — "never offer a room nobody hosts" is a standing rule
   written after the rail offered rooms with no runner behind them.

   Four things are checked, and three of them are about restraint:

     1. The way in still wins. The schedule sits AFTER #portalCard, which
        holds "Try a practice round". A label above that control pushed it
        below the fold on a 360x640 Android earlier the same evening and
        turned qa/way-in.js red. Browse content never outranks the door.
     2. It shows no Game Night number. Those integers are incoherent past
        3 Sept: one file counts 48/49/50, the next restarts at 1, two have
        none at all. A number on screen is a claim.
     3. It never hardcodes "tonight". The JSON is static and may be read
        hours after it was written. Every relative word is computed from
        the reader's clock.
     4. Every game it can list traces to a pick file. Enforced upstream by
        build-schedule.js iterating the picks, and asserted here against
        the real artifact so a future rewrite cannot quietly invert it.

   Static: reads the file and the JSON. No browser, so it cannot flake.

       node qa/schedule-menu.js
       node qa/schedule-menu.js index-test.html
*/
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
let SRC;
if (fi >= 0 && argv[fi + 1]) SRC = argv[fi + 1];
else SRC = argv.find(a => !a.startsWith('-')) || 'index-test.html';
SRC = path.isAbsolute(SRC) ? SRC : path.join(__dirname, '..', SRC);
const JSON_PATH = path.join(__dirname, '..', 'schedule.json');
const LOGDIR = path.join(process.env.HOME, 'gamenight-logs');

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

let s;
try { s = fs.readFileSync(SRC, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + SRC + ' — ' + e.message); process.exit(1); }

console.log('\n  schedule menu — what is coming, and nothing more');
console.log('  file  ' + path.basename(SRC) + '\n');

t('the schedule sits BELOW the way in', () => {
  const p = s.indexOf('id="portalCard"');
  const c = s.indexOf('id="schedCard"');
  if (c < 0) return 'no #schedCard in this build';
  if (p < 0) return 'no #portalCard to sit below';
  return c > p ? true
    : 'the schedule renders ABOVE the practice control — browse content must never push the door';
});

t('it is in the MENU, and still not a fifth tab', () => {
  /* MOVED 2 SEPT, and this check moved with it rather than being deleted.
     It used to require the card inside #s-landing, which was where I first
     put it — and it was asked for in the menu: "our schedule for the next
     two weeks in our menu so people know what games are coming". On a
     phone it ran 871px on the landing, more than a whole screen between
     the way in and everything under it: "the schedule eats up so much
     space."

     The half of this check that always mattered is the second half. The
     schedule must never become a fifth tab — Home, Stats, Gametime, Board,
     and the middle two spell the product. That is unchanged. */
  const c = s.indexOf('id="schedCard"');
  if (c < 0) return 'no #schedCard';
  const menu = s.indexOf('id="menuSheet"');
  if (menu < 0) return 'no #menuSheet';
  const menuEnd = s.indexOf('id="botnav"', menu);
  if (!(menu < c && c < menuEnd)) return 'the schedule is not inside the menu sheet';
  const land = s.indexOf('id="s-landing"');
  const landEnd = s.indexOf('</section>', land);
  if (land < c && c < landEnd) return 'the schedule is ALSO on the landing — one copy, not two';
  const navs = (s.match(/data-nav="[a-z]+"/g) || []);
  return navs.length === 4 ? true : `${navs.length} nav tabs — there must be exactly 4`;
});

t('it is a dropdown, closed until asked for', () => {
  /* Opened flat, fourteen days of fixtures ran off the bottom of the sheet
     under Sign out. It is a <details> so the browser owns the disclosure —
     keyboard, screen reader and the open/closed state come free — and it
     must ship CLOSED, or the menu is a wall again. */
  const d = s.indexOf('id="schedDrop"');
  if (d < 0) return 'no #schedDrop — the schedule is not a dropdown';
  const tag = s.slice(s.lastIndexOf('<', d), s.indexOf('>', d) + 1);
  if (!/^<details/.test(tag)) return 'the schedule wrapper is not a <details>';
  if (/\bopen\b/.test(tag)) return 'the dropdown ships OPEN — the menu is a wall again';
  const c = s.indexOf('id="schedCard"');
  if (!(d < c)) return 'the card is not inside the dropdown';
  /* Open, it must scroll inside itself rather than growing the sheet. */
  return /#schedDrop\[open\] #schedCard\{[^}]*overflow-y:auto/.test(s)
    ? true : 'an open dropdown does not scroll inside itself';
});

t('no Game Night number reaches the screen', () => {
  const a = s.indexOf('function schedRender');
  if (a < 0) return 'no schedRender()';
  const b = s.indexOf('function schedLoad', a);
  return s.slice(a, b).includes('gameNight')
    ? 'schedRender renders gameNight — those integers are incoherent past 3 Sept'
    : true;
});

t('no hardcoded "tonight" in the renderer', () => {
  const a = s.indexOf('var SCHED = null');
  if (a < 0) return 'no schedule reader';
  const b = s.indexOf('function schedLoad', a);
  return /tonight/i.test(s.slice(a, b))
    ? 'the renderer hardcodes a relative word — a static file read hours later would lie'
    : true;
});

t('a missing schedule.json hides the card rather than showing an error', () => {
  const a = s.indexOf('function schedLoad');
  if (a < 0) return 'no schedLoad()';
  const seg = s.slice(a, a + 1200);
  return /\.catch\s*\(/.test(seg) && /r\.ok\s*\?/.test(seg)
    ? true
    : 'schedLoad does not handle a failed or non-ok fetch — a broken file would surface to a player';
});

/* ---- the artifact itself, not just the renderer -------------------- */
let J = null;
try { J = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch (e) { J = null; }

if (!J) {
  console.log('  --   schedule.json is absent or unreadable: the ARTIFACT checks below did');
  console.log('       not run. Build it with `node host/build-schedule.js`.');
} else {
  t('every listed game traces back to a pick file', () => {
    /* The upstream loop iterates the picks. Asserted here against the real
       files so a rewrite cannot silently invert it into a manifest walk. */
    const bad = [];
    (J.days || []).forEach(d => {
      const pf = path.join(LOGDIR, 'slate-pick-' + d.date + '.txt');
      let picks = null;
      try { picks = fs.readFileSync(pf, 'utf8').split('\n').map(x => x.trim()).filter(Boolean); }
      catch (e) { picks = null; }
      (d.games || []).forEach(g => {
        if (picks === null) bad.push(`${d.date}: lists ${g.nightId} but has NO pick file`);
        else if (!picks.includes(g.nightId)) bad.push(`${d.date}: ${g.nightId} is not in the pick file`);
      });
    });
    return bad.length ? bad.slice(0, 6).join('\n         ') : true;
  });

  t('an unbuilt day is not reported as an empty day', () => {
    const wrong = (J.days || []).filter(d =>
      d.status === 'unbuilt' && d.gameCount !== null && d.gameCount !== undefined);
    return wrong.length
      ? wrong.map(d => `${d.date} is unbuilt but reports gameCount ${d.gameCount}`).join('; ')
      : true;
  });

  t('the window is the full fourteen days, none dropped', () => {
    const n = (J.days || []).length;
    return n === 14 ? true : `${n} days in the file, expected 14`;
  });
}

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
