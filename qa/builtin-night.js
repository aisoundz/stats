#!/usr/bin/env node
/* =====================================================================
   THE PLACEHOLDER IS NOT A GAME ANYONE LOST.
   ---------------------------------------------------------------------
   27 Aug 2026, on the founder's screen, two hours before first pitch,
   with no room picked yet:

       "This game finished 77 to 66, Minnesota Lynx.
        Nothing left to pick."

   Nothing on that page was about Minnesota. The marquee read DODGERS at
   BRAVES with a live countdown and the rail offered tonight's two rooms.
   The browser tab said "Valkyries", and that was the tell.

   Until a room is chosen, GAME is the night baked into index.html:
   gn13-2026-08-19-min-gs, Lynx at Valkyries, tipped 2026-08-20T02:00Z.
   A real game, eight days finished. GS loads its feed, phaseNow() says
   final, gsIsAbout() honestly agrees the feed is about GAME — every
   guard passes truthfully on its way to an answer about the wrong week.

   WHAT THIS TESTS, AND WHY IT MOVED. The first fix put the guard inside
   nightIsOver() and the gate refused it: twelve checks in final-buzzer.js
   went red, because 'built-in' is ALSO the state of a real night whose
   hydration has not finished or has failed, and a night that can never
   end accepts answers after the buzzer. So this suite tests the SYMPTOM
   the founder actually read — the sentence on the screen — rather than
   the internal that produced it. That is the better assertion anyway:
   it survives the fix moving again.

     the player taps into the card with only scenery loaded
        -> the toast NEVER carries the placeholder's score or team
        -> the card does not open
     a real night whose game is genuinely final
        -> the door still shuts, and still says so

       node qa/builtin-night.js
       node qa/builtin-night.js index-test.html
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
  console.log('\n=== THE PLACEHOLDER IS NOT A GAME ANYONE LOST ===   '
    + path.basename(TARGET) + ' · ' + ENG);

  const b = await ENGINE.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.route('**/site.api.espn.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));

  const tmp = path.join(os.tmpdir(), 'qa-builtin-' + process.pid + '.html');
  fs.copyFileSync(TARGET, tmp);
  await p.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STATS_READY === true, null, { timeout: 25000 }).catch(() => {});

  /* Tap into the pre-game card in the state the founder's page was in.
     `source` is the ONLY thing that varies: 'built-in' is scenery, and
     'database' is a real night that really did end. GS is about GAME and
     says final in both, because that is the honest state that made the
     bug fire. */
  async function tapIn(source, mode, slate) {
    return p.evaluate((c) => {
      const src = c.src;
      try {
        S.mode = c.mode || 'live';
        S.screen = 'landing';
        NIGHT_CFG_SOURCE = src;
        /* THE SLATE IS THE WHOLE DISCRIMINATOR. `rooms` means the rail is
           offering games; `mine` means GAME is one of them. A fixture has
           no slate at all, which is exactly why it must not trip. */
        try {
          if (c.slate === 'none')  SLATE.games = [];
          if (c.slate === 'other') SLATE.games = [{ nightId: 'slate-2026-08-27-lad-atl' },
                                                  { nightId: 'slate-2026-08-27-lar-lac' }];
          if (c.slate === 'mine')  SLATE.games = [{ nightId: (GAME && GAME.nightId) || 'x' }];
        } catch (e) {}
        const ev = String((GAME && GAME.espnEvent) || '');
        window.GS = { ok: true, ev: ev, state: 'post',
                      teams: [{ name: 'Minnesota Lynx', ab: 'MIN', score: 77 },
                              { name: 'Golden State Valkyries', ab: 'GS', score: 66 }] };
        HR.doc = null; HR.pending = null; HR.everHad = false; HR.lostAt = 0;

        const said = [];
        window.toast = function (m) { said.push(String(m || '')); };
        startPredict();
        return { said: said.join(' | '), screen: S.screen };
      } catch (e) { return { err: String(e).slice(0, 160) }; }
    }, { src: source, mode: mode, slate: slate });
  }

  /* the three reports on 27 Aug: placeholder loaded, rail full of rooms */
  const scenery  = await tapIn('built-in', 'live', 'other');
  /* a real night that really did end — the lockout that must survive */
  const real     = await tapIn('database', 'live', 'mine');
  /* practice: no real game behind it, must always open */
  const practice = await tapIn('built-in', 'demo', 'other');
  /* A FIXTURE. No slate at all. This is the case that turned twelve
     checks red in final-buzzer.js and one in card-deadline.js on two
     earlier attempts, and it is the reason the condition is the slate
     rather than NIGHT_CFG_SOURCE. */
  const fixture  = await tapIn('built-in', 'live', 'none');

  console.log(`\n     scenery  -> "${scenery.said}"${scenery.err ? '  THREW ' + scenery.err : ''}`);
  console.log(`     real end -> "${real.said}"\n`);

  /* THE ASSERTION IS THE SENTENCE. A player cannot read a variable. */
  check('scenery.no-stale-score', !/77|66|Minnesota|Lynx|Valkyries/i.test(scenery.said || ''),
    'with only the baked-in placeholder loaded, the app told the player about a game that '
    + 'finished eight days ago — this is the "77 to 66, Minnesota Lynx" screen');

  check('scenery.says-something', (scenery.said || '').trim().length > 0,
    'the tap produced no message at all — the player taps and nothing happens, which is its own bug');

  check('scenery.card-did-not-open', scenery.screen !== 'predict',
    'the pre-game card opened on a night that is only scenery');

  /* The real lockout must survive. Losing it is worse than the bug: a
     player would file picks on a game whose result is already public. */
  check('real.door-still-shuts', real.screen !== 'predict',
    'a genuinely finished night let the player into the pre-game card');

  /* PRACTICE IS EXEMPT AND THAT IS NOT A DETAIL. The first version of
     this guard had no mode check, and desk-reach.js — which opens the
     card with startDemo() then startPredict() — went 114 red, because
     every element inside a card that never opened is unreachable. A
     rehearsal has no real game behind it and must always open. */
  check('practice.card-still-opens', practice.screen === 'predict',
    'the practice card no longer opens on the built-in night — this is the desk-reach 114-red '
    + 'regression, and it means nobody can rehearse');

  /* A FIXTURE MUST BE LEFT COMPLETELY ALONE. With no slate there are no
     rooms on offer, so "pick one of the rooms" is not a true sentence and
     the old behaviour has to stand exactly as it was. */
  check('fixture.untouched', /finish|over|closed|nothing left/i.test(fixture.said || ''),
    'with no slate loaded the door no longer behaves as it did — this is the final-buzzer and '
    + 'card-deadline breakage from the earlier attempts, where the guard fired in fixtures');

  check('real.still-explains', /finish|over|closed|nothing left/i.test(real.said || ''),
    'a genuinely finished night no longer tells the player why the card will not open');

  await b.close();
  check('no-page-errors', errs.length === 0, errs.slice(0, 3).join(' · '));
  try { fs.unlinkSync(tmp); } catch (_) {}

  console.log(fail
    ? `\n\x1b[31mRED\x1b[0m   ${fail} failed   [${path.basename(TARGET)} · ${ENG}]`
    : `\n\x1b[32mGREEN\x1b[0m  all checks pass   [${path.basename(TARGET)} · ${ENG}]`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED', e); process.exit(1); });
