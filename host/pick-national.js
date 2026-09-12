#!/usr/bin/env node
/* =====================================================================
   PICK THE NIGHT'S ROOMS — nationally televised, staggered, one per sport
   ---------------------------------------------------------------------
   Founder, 22 Aug: "Set up another 4 games tomorrow to be national
   televised games, and then 3-4 during the week. We need as much data and
   testing as we can."

   Choosing them by hand is the part that does not scale, and it is the
   part that goes wrong: Saturday's rooms were chosen on the 20th and by
   the 22nd two of them had been swapped out under the carriage rule while
   the marquee file still named them. A choice made days early is a choice
   made without the schedule in front of you.

   So this makes it the morning of, from the actual scoreboard, under the
   three rules that already govern a slate:

     RULE 7  national carriage only. "A reader in Chicago would have been
             handed a room for a game they had no way to watch." A regional
             sports network is not carriage; NBC, FOX, ESPN, Apple TV and
             their peers are.
     STAGGER never two rooms opening on top of each other. A round is a
             moment you have to be present for, and two at once means
             missing one.
     VARIETY one per sport before a second of any. Four sports exercise
             four resolver paths, four feed shapes and the room-switch
             code — which is where every worst bug has lived. That is the
             "as much testing as we can" he asked for.

       node host/pick-national.js                 # today,   dry run
       DATE=2026-08-25 node host/pick-national.js # a day,   dry run
       DATE=2026-08-25 node host/pick-national.js --apply

   Writes ~/gamenight-logs/slate-pick-<DATE>.txt and the marquee file. It
   writes NO game numbers: build-slate.js derives those from tip order,
   counting on from the previous night, and a second writer is what put
   two #19s in one week.
   ================================================================== */
const fs = require('fs'), path = require('path');

const APPLY  = process.argv.includes('--apply');
const FORCE  = process.argv.includes('--force');
/* AT LEAST THIS MANY ROOMS, EVERY DAY. Founder, 12 Sept: "We need at
   least 2 games everyday. No days off." */
const MIN    = Number(process.env.MIN_ROOMS || 2);
const DATE   = (process.env.DATE || new Date().toLocaleDateString('en-CA', {timeZone:'America/Los_Angeles'})).trim();
const WANT   = Number(process.env.ROOMS || 4);
const MINGAP = Number(process.env.MIN_GAP_MIN || 30);      // minutes between tips
const LOGDIR = path.join(process.env.HOME, 'gamenight-logs');
const log = (k,m) => console.log('  ' + String(k).padEnd(8) + ' ' + m);

/* National carriage. Deliberately a NAMED list rather than "anything not
   obviously local": a regional network with a national-sounding name is
   the exact trap Rule 7 exists for. Add to it on purpose, never by
   pattern. NBC Sports <City> and Fox <n> are regional and must not match,
   so the word boundaries matter. */
/* 28 Aug: the copy that used to sit here is gone, and it was the worst of
   the four. It had no USA Network — so the Premier League's only US
   carrier did not count — while listing 'ESPN Unlmtd' and 'Prime Video',
   which leagues.env Rule 7 and Rule 3 reject by name. Measured on three
   real days, that combination proposed an ESPN Unlimited game as the
   Game of the Night on all three, including Monday 31 Aug. One owner
   now: host/leagues.js. */
const LG = require('./leagues.js');
const isNational = (name, league) => LG.isNational(name, league);

/* Built from the one owner rather than typed again. The order is the
   order the day is considered in, so it stays explicit here — but every
   path and sport comes from host/leagues.js, which is why `epl` needed
   adding in exactly one place to become visible to this script. */
const LEAGUES = ['nfl','cfb','wnba','nhl','mlb','mls','epl'].map(k => ({
  sport: LG.get(k).sport, key: k.toUpperCase(), league: k, path: LG.get(k).path,
}));

const abbr = (c) => String((c.team && (c.team.abbreviation || c.team.shortDisplayName)) || '')
  .toLowerCase().replace(/[^a-z0-9]/g,'');

(async () => {
  log('date', DATE + (APPLY ? '' : '   (dry run — add --apply to write)'));
  const ymd = DATE.replace(/-/g,'');
  let all = [];   // reassigned when an ambiguous id is filtered out

  for (const lg of LEAGUES) {
    let j = null;
    try {
      j = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${lg.path}/scoreboard?dates=${ymd}`)
            .then(r => r.json());
    } catch (e) { log('warn', `${lg.key}: ${e.message}`); continue; }
    let nat = 0, tbd = 0;
    (j.events || []).forEach(e => {
      const c = (e.competitions || [])[0] || {};
      const comps = c.competitors || [];
      if (comps.length !== 2) return;
      const nets = [...new Set((c.broadcasts || []).flatMap(b => b.names || []))];
      /* The league goes in now, because "is this national" is not a
         property of the channel alone: Apple TV is the only carrier MLS
         has, so it counts there and nowhere else. */
      const on = nets.filter(n => isNational(n, lg.league));
      if (!on.length) return;
      nat++;
      const away = comps.find(x => x.homeAway === 'away') || comps[0];
      const home = comps.find(x => x.homeAway === 'home') || comps[1];
      /* ============ A PLACEHOLDER IS NOT A FIXTURE ====================
         11 Sept 2026, extending the horizon to the end of the month. ESPN
         lists the MLB postseason as TBD at TBD weeks before the field is
         known, four such rows on 29 Sept and four on 30 Sept. Nothing in
         this pipeline looked at the team names, so the picker chose one
         and wrote slate-2026-09-29-tbd-tbd into the pick file: a hosted
         room, on the rail, for a game between two teams that do not exist
         yet. A player walking in would find no teams, no colours and a
         prediction card asking which of TBD and TBD takes it.

         Checked on the NAMES rather than the abbreviation, because abbr()
         falls back to shortDisplayName and both read TBD anyway — and
         because a real club could one day abbreviate to something odd
         while still having a name. Refuse rather than guess: the day this
         runs again with a real bracket, the fixture picks itself. */
      const named = (c) => {
        const t = (c && c.team) || {};
        const n = String(t.displayName || t.shortDisplayName || t.name || '').trim();
        return n && !/^tbd$/i.test(n) && !/\btbd\b/i.test(n);
      };
      if (!named(away) || !named(home)) { tbd++; return; }
      all.push({
        sport: lg.sport, league: lg.key,
        nightId: `slate-${DATE}-${abbr(away)}-${abbr(home)}`,
        name: e.name, tip: new Date(e.date), nets: on
      });
    });
    log(lg.key.toLowerCase(), `${nat} nationally televised of ${(j.events||[]).length}`
        + (tbd ? ` · ${tbd} refused as TBD placeholders` : ''));
  }

  if (!all.length) { log('none', 'no nationally televised games found — nothing written'); process.exit(0); }

  /* ============ AN AMBIGUOUS ROOM IS NOT A ROOM ======================
     11 Sept 2026. The night id is `slate-{date}-{away}-{home}` and carries
     NO SPORT, so two different games can claim the same one:

         mlb  slate-2026-09-19-sea-col  Rockies at Mariners
         mls  slate-2026-09-19-sea-col  Rapids at Sounders

     Seattle and Colorado field a team in both leagues. build-slate.js saw
     the clash, logged 'keeping the first', and carried on — and the picker
     put that id on the rail for the 19th. One of those two games was
     unhostable and which one you got was whichever ESPN happened to list
     first. A doubleheader does the same thing inside one league: Rays at
     Yankees twice on the 22nd, 10:05 and 16:05 PT, one id.

     Fixing the id scheme is the real repair and it touches every saved
     game, every ?game= link and every night document. Until then this
     refuses to OFFER an id it cannot resolve to one game, which is the
     half that protects a player. Said out loud, because a room silently
     missing from a rail is the thing nobody notices. */
  const byId = {};
  all.forEach(g => { (byId[g.nightId] = byId[g.nightId] || []).push(g); });
  const ambiguous = Object.keys(byId).filter(k => byId[k].length > 1);
  if (ambiguous.length) {
    ambiguous.forEach(k => {
      const gs = byId[k];
      log('CLASH', `${k} matches ${gs.length} games (`
        + gs.map(g => `${g.league}:${g.name}`).join(' | ')
        + ') — refusing all of them, the id cannot say which');
    });
    all = all.filter(g => byId[g.nightId].length === 1);
    if (!all.length) { log('none', 'every candidate was ambiguous — nothing written'); process.exit(0); }
  }
  all.sort((a,b) => a.tip - b.tip);

  /* ---- choose: one per sport first, then fill, always keeping the gap.
     Greedy over tip time, which is what makes the result staggered by
     construction rather than by luck. */
  const picked = [];
  const fits = (g) => picked.every(p => Math.abs(g.tip - p.tip) >= MINGAP*60000);

  /* ============ ROUND ROBIN, NOT FIRST COME ==========================
     Founder, 12 Sept, looking at the slate: "Why is it all MLB games.
     It's not mixed like the last one."

     The old rule was one-per-sport and then GREEDY OVER TIP TIME, which
     sounds like variety and is not. Baseball plays fifteen national games
     a day starting mid-morning; everything else plays one or two in the
     evening. So the fill ran out of slots before the afternoon, every day,
     and the day read as all baseball. Measured on real slates:

       Thu 17  TNF was the ONLY national NFL game and was not picked;
               two 9am MLB games took the slots.
       Sun 13  NFL had THIRTEEN national games. The picker took two EPL
               and an MLB before reaching the first one, on NFL Sunday.

     Now every sport gets a room before any sport gets a second, and
     within a sport a game on a broadcast network outranks one on a
     league streamer — which is the difference between Ohio State at Texas
     on ABC and a Tuesday afternoon on MLB.TV. Time is the last tiebreak,
     not the first, and the stagger is still enforced by fits(). */
  const isBroadcast = (g) => g.nets.some(n =>
    /^(NBC|FOX|CBS|ABC|ESPN|ESPN2|TNT|TBS|USA|USA Net|USA Network|Peacock|Paramount\+|Netflix|Prime Video|NBA TV|NFL Net|NFL Network)$/i.test(n));
  const bySport = {};
  all.forEach(g => { (bySport[g.sport] = bySport[g.sport] || []).push(g); });
  Object.keys(bySport).forEach(k => bySport[k].sort((a,b) =>
    (Number(isBroadcast(b)) - Number(isBroadcast(a))) || (a.tip - b.tip)));
  /* Sports enter in the order their first game does, so a day still reads
     chronologically rather than alphabetically. */
  const order = Object.keys(bySport).sort((a,b) =>
    Math.min(...bySport[a].map(g=>g.tip)) - Math.min(...bySport[b].map(g=>g.tip)));
  const taken = new Set();
  let added = true;
  while (picked.length < WANT && added) {
    added = false;
    for (const sp of order) {
      if (picked.length >= WANT) break;
      const g = bySport[sp].find(x => !taken.has(x.nightId) && fits(x));
      if (!g) continue;
      taken.add(g.nightId); picked.push(g); added = true;
    }
  }
  picked.sort((a,b) => a.tip - b.tip);

  /* The main event: the latest room that is on a broadcast network rather
     than a streamer, else simply the latest. Latest because it is the one
     most people can still be at home for. */
  const broadcast = picked.filter(g => g.nets.some(n => /^(NBC|FOX|CBS|ABC|ESPN|TNT)$/i.test(n)));
  const star = (broadcast.length ? broadcast : picked).slice(-1)[0];

  console.log('');
  picked.forEach(g => {
    const t = g.tip.toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'});
    console.log('   ' + t.padStart(8) + '  ' + g.league.padEnd(5) + g.name.padEnd(46)
      + g.nets.join(', ') + (g === star ? '   ★' : ''));
  });
  for (let i=1;i<picked.length;i++)
    console.log('        gap ' + Math.round((picked[i].tip - picked[i-1].tip)/60000) + ' min');
  const sports = [...new Set(picked.map(g=>g.sport))];
  console.log('');
  log('shape', `${picked.length} room(s), ${sports.length} sport(s): ${sports.join(', ')}`);
  if (picked.length < WANT)
    log('short', `wanted ${WANT} — the schedule did not offer ${WANT} national games far enough apart`);

  if (!APPLY) { log('dry', 'nothing written'); process.exit(0); }

  const PICKF = path.join(LOGDIR, 'slate-pick-' + DATE + '.txt');
  const MARQF = path.join(LOGDIR, 'slate-marquee-' + DATE + '.txt');
  if (fs.existsSync(PICKF) && !FORCE) {
    /* ============ A SHORT DAY IS NOT A CHOICE ========================
       This guard protects a pick somebody made on purpose. It was also
       protecting ITS OWN short answers: a day that found one room, or
       none, kept that answer for ever, because the file existed and the
       picker never looked inside it. 25 Sept sat at zero rooms with
       fifteen MLB games on, and re-running changed nothing.
       Same shape as publish.js deferring to its own stale plan.
       So: a FULL file is left alone, a SHORT one is re-picked. The daily
       cron then fills a day as soon as the carriage is announced, which
       is what makes "no days off" hold for the 29th and 30th once MLB
       names the postseason field. */
    const have = fs.readFileSync(PICKF,'utf8').split('\n').map(x=>x.trim()).filter(Boolean).length;
    if (have >= MIN) {
      log('keep', `${path.basename(PICKF)} already has ${have} room(s) — a choice already made, leaving it alone`);
      process.exit(0);
    }
    log('short', `${path.basename(PICKF)} has only ${have} room(s), under the floor of ${MIN} — re-picking`);
  }
  if (picked.length < MIN)
    log('FLOOR', `only ${picked.length} room(s) for ${DATE}, under the floor of ${MIN}. `
      + 'Everything else was regional, a paid add-on, or a TBD placeholder. '
      + 'This day will be re-picked on every run until it fills.');
  fs.writeFileSync(PICKF, picked.map(g => g.nightId).join('\n') + '\n');
  /* NO NUMBERS. build-slate.js owns them. */
  fs.writeFileSync(MARQF, picked.map(g => g.nightId + (g === star ? ' *' : '')).join('\n') + '\n');
  log('wrote', path.basename(PICKF) + ' and ' + path.basename(MARQF));
})().catch(e => { console.error('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
