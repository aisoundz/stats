#!/usr/bin/env node
/* =====================================================================
   A PLACE BELONGS TO THE ROOM IT WAS MADE IN.
   ---------------------------------------------------------------------
   27 Aug 2026, from the founder's phone, four minutes into a football
   game that had just kicked off:

       FINAL WHISTLE
       Score your predictions
       Settling your card… waiting on the official final box score

   The rail above it read LAR at LAC, 13:48 in the 1st. It was the
   BASEBALL night's ending — that room had gone final an hour earlier —
   and it had followed him into a game that had barely started.

   It cost a real round. Q1 sat open with four questions and three
   people in the room and took ZERO answers, because the one screen the
   app deliberately refuses to interrupt is the pre-game card, and that
   is where he was parked.

   WHY IT HAPPENED. `place` is already per-room: it is kept out of
   SESSION_KEYS on purpose and restored from ROOMS[id] on a switch. That
   was right and it was not enough — a place can also arrive from a
   persisted save at boot, and boot does not know which room the save
   came from. Three separate readers then asked "is there a night to go
   back into?" and all three said yes about a room he had left.

   THE CURE, and it is the same one this file keeps applying: the fact
   carries its own identity. A place is stamped with the room it was
   made in, and one owner — resumable() — answers for all three readers.

   WHAT THIS PINS:
     a place made in room A is NOT resumable in room B
     a place made in room A IS resumable back in room A
     a place with no room stamped on it (an older save) is not resumable
     practice is untouched

       node qa/room-place.js
       node qa/room-place.js index-test.html
   ================================================================== */
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const TARGET = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2]) : path.join(ROOT, 'index.html');
const ENG = (process.env.QA_ENGINE || 'firefox');

let fail = 0;
const ok  = (id) => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const check = (id, c, why) => c ? ok(id) : bad(id, why);

(async () => {
  const { firefox, chromium } = require('playwright');
  const ENGINE = ENG === 'chromium' ? chromium : firefox;
  console.log('\n=== A PLACE BELONGS TO THE ROOM IT WAS MADE IN ===   '
    + path.basename(TARGET) + ' · ' + ENG);

  const b = await ENGINE.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.route('**/site.api.espn.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));

  const tmp = path.join(os.tmpdir(), 'qa-roomplace-' + process.pid + '.html');
  fs.copyFileSync(TARGET, tmp);
  await p.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STATS_READY === true, null, { timeout: 25000 }).catch(() => {});

  const has = await p.evaluate(() => typeof resumable === 'function');
  check('owner.exists', has,
    'resumable() does not exist — the three readers are still each answering for themselves, '
    + 'which is how the baseball ending reached the football room');

  /* The exact situation: a settle screen recorded in the baseball room,
     then the player is standing in the football room. */
  async function ask(placeRoom, activeRoom, mode) {
    return p.evaluate((c) => {
      try {
        S.mode = c.mode || 'live';
        S.place = 'predreview';                  // the settle screen
        if (c.placeRoom === null) { try { delete S.placeRoom; } catch(e){ S.placeRoom = undefined; } }
        else S.placeRoom = c.placeRoom;
        window.ACTIVE_ROOM = c.activeRoom;
        return (typeof resumable === 'function') ? resumable() : 'NO-FN';
      } catch (e) { return 'THREW ' + String(e).slice(0, 120); }
    }, { placeRoom, activeRoom, mode });
  }

  const BASE = 'slate-2026-08-27-lad-atl';   // the baseball room, finished
  const FOOT = 'slate-2026-08-27-lar-lac';   // the football room, just kicked off

  const crossed  = await ask(BASE, FOOT, 'live');
  const athome   = await ask(BASE, BASE, 'live');
  const unstamped= await ask(null,  FOOT, 'live');
  const practice = await ask(BASE, FOOT, 'demo');

  console.log(`\n     place made in baseball, standing in football -> ${crossed}`);
  console.log(`     place made in baseball, standing in baseball  -> ${athome}`);
  console.log(`     place with no room stamped on it              -> ${unstamped}`);
  console.log(`     practice                                      -> ${practice}\n`);

  check('cross-room.refused', crossed === false,
    'a settle screen recorded in the baseball room is still offered in the football room — '
    + 'this is the 27 Aug screen, and it cost a live round with four questions in it');

  check('same-room.kept', athome === true,
    'a player who left their own room mid-night can no longer resume it — this fix must not '
    + 'cost somebody their place in the room they are actually in');

  check('unstamped.refused', unstamped === false,
    'a saved place with no room on it is being treated as resumable; those come from builds '
    + 'before the stamp existed and cannot be trusted to belong here');

  check('practice.unaffected', practice === false,
    'practice is not a live room and must never be resumed into one');

  /* ============ AND THE SAME QUESTION THE OLD BUILD ANSWERED =========
     The checks above call resumable(), which only exists after the fix,
     so on the shipped build they fail as "no such function" — that shows
     the function is new, not that the old behaviour was wrong.

     landingActionsWanted() exists in BOTH builds and asks the same
     question the broken readers asked. Signed out, so its signedInNow()
     shortcut cannot mask the answer. On the shipped build this returns
     true for a place made in another room, which is the bug; after the
     fix it returns false. */
  const behaviour = await p.evaluate((rooms) => {
    try {
      S.mode = 'live';
      S.place = 'predreview';
      S.placeRoom = rooms.base;
      window.ACTIVE_ROOM = rooms.foot;
      window.signedInNow = function(){ return false; };
      return landingActionsWanted();
    } catch (e) { return 'THREW ' + String(e).slice(0, 120); }
  }, { base: BASE, foot: FOOT });

  console.log(`     landingActionsWanted() across rooms           -> ${behaviour}\n`);
  check('cross-room.behaviour', behaviour === false,
    'the landing still offers to take the player back into a night recorded in a DIFFERENT '
    + 'room — this is the observable form of the 27 Aug bug and it runs on both builds');

  await b.close();
  check('no-page-errors', errs.length === 0, errs.slice(0, 3).join(' · '));
  try { fs.unlinkSync(tmp); } catch (_) {}

  console.log(fail
    ? `\n\x1b[31mRED\x1b[0m   ${fail} failed   [${path.basename(TARGET)} · ${ENG}]`
    : `\n\x1b[32mGREEN\x1b[0m  all checks pass   [${path.basename(TARGET)} · ${ENG}]`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED', e); process.exit(1); });
