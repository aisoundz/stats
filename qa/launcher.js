#!/usr/bin/env node
/* =====================================================================
   THE LAUNCHER — which rooms actually come up.
   ---------------------------------------------------------------------
   host/start-slate.sh decides, twice an hour, which of the night's games
   get a runner. Everything it gets wrong is SILENT: a room that is never
   started looks exactly like a room where nothing has happened yet, and
   the only trace is a line in a log nobody reads during a game.

   Two of those were live on 18 Aug 2026, both able to zero out a league:

     · the watchdog's own lock lives in the same directory and matched the
       `*.lock` glob, so switching the watcher on turned MAX_ROOMS=2 into
       one room, blaming a cap that was never reached;
     · the cap was charged BEFORE the due check, so a game hours away was
       refused with "CAP" for a slot no running room held — on a Saturday
       with midday football and evening basketball, that is how the WNBA
       gets none.

       node qa/launcher.js
   ================================================================== */
const fs=require('fs'), path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','host/start-slate.sh'),'utf8');

let fail=0;
const ok  = id => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id,why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const check=(id,c,why)=> c?ok(id):bad(id,why);

/* ---- 1. a watcher is not a room ----------------------------------- */
const lr = src.slice(src.indexOf('live_rooms(){'), src.indexOf('}', src.indexOf('echo "$n"')));
check('launcher.the-watchdog-is-not-counted-as-a-room',
  /watch-\*\)\s*continue/.test(lr),
  'live_rooms() counts every *.lock in the log directory, and host/watch-start.sh keeps watch-$DATE.lock there for six hours — the watcher eats a room off the cap');
check('launcher.a-lock-counts-only-while-it-is-held',
  /flock -n "\$f" true/.test(lr),
  'a lock file survives the runner that made it; counting files rather than held locks reads a dead room as a live one');

/* ---- 2. only a DUE game spends the cap ---------------------------- */
const capAt = src.indexOf('MAX_ROOMS" -gt 0');
const dueAt = src.indexOf('DUE=$(( TIP_EPOCH - LEAD_MIN * 60 ))');
check('launcher.only-a-due-game-spends-the-cap',
  dueAt > 0 && capAt > 0 && dueAt < capAt,
  'the cap is charged before the due check, so a game hours from tip is refused with CAP for a slot nothing is using');

/* ---- 3. and a skipped room is always said out loud ---------------- */
check('launcher.a-capped-room-is-announced',
  /echo "  CAP /.test(src),
  'a room dropped for the cap must be printed; a silent truncation reads as full coverage');
check('launcher.a-league-that-is-built-but-not-hosted-is-normal',
  /RUN_LEAGUES/.test(src) && /LEAGUES=/.test(src),
  'building a league and hosting it are different decisions and must stay separate knobs');

/* ---- 4. offered to players vs hosted by us ------------------------
   The rail is built from slate/{date}, which carries every game that was
   BUILT. Runners come from RUN_LEAGUES and MAX_ROOMS. Nothing else in this
   system compares those two numbers, and the difference is rooms a person
   can walk into and sit in all night waiting for a round nothing will
   open — the same "up and mute" failure as the feed 404, through a door we
   built ourselves. Measured 18 Aug 2026: slate/2026-08-22 offered 13 rooms
   against MAX_ROOMS=2. */
check('launcher.a-league-built-but-not-hosted-is-not-silent',
  /OFFERED_UNHOSTED/.test(src) && !/Silent by design/.test(src),
  'a league that is built but not in RUN_LEAGUES is skipped without a word, while build-slate has already OFFERED its games on every phone');
check('launcher.offered-and-hosted-are-counted-against-each-other',
  /offered on the rail/.test(src) && /HOSTED BY NOBODY/.test(src),
  'the run never states how many rooms players are offered versus how many have a runner, so the gap can only be found by a person opening one');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail?1:0);
