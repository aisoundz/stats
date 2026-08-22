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
const NATIONAL = [
  'NBC','Peacock','FOX','FS1','FS2','CBS','Paramount+','ABC','ESPN','ESPN2','ESPNU',
  'ESPN Unlmtd','NFL Net','NFL Network','NBA TV','TNT','TBS','truTV','MLB Net',
  'MLB Network','Prime Video','Apple TV','Netflix','Ion','ION','CW','Telemundo','Universo'
];
const isNational = (name) => {
  const n = String(name || '').trim();
  if (/NBC Sports\s+\S/i.test(n)) return false;            // NBC Sports Bay Area &c
  if (/^Fox\s*\d/i.test(n) || /Fox\s+\d+\s*Plus/i.test(n)) return false;
  if (/League Pass|MSG|YES|NESN|Marquee|SNY|Bally|Spectrum|Altitude|Space City|Vegas \d/i.test(n)) return false;
  return NATIONAL.some(x => n.toLowerCase() === x.toLowerCase()
                         || n.toLowerCase().startsWith(x.toLowerCase() + ' ')
                         || n.toLowerCase() === x.toLowerCase().replace(/\+$/,''));
};

const LEAGUES = [
  { sport:'football',   key:'NFL',  path:'football/nfl' },
  { sport:'basketball', key:'WNBA', path:'basketball/wnba' },
  { sport:'baseball',   key:'MLB',  path:'baseball/mlb' },
  { sport:'soccer',     key:'MLS',  path:'soccer/usa.1' }
];

const abbr = (c) => String((c.team && (c.team.abbreviation || c.team.shortDisplayName)) || '')
  .toLowerCase().replace(/[^a-z0-9]/g,'');

(async () => {
  log('date', DATE + (APPLY ? '' : '   (dry run — add --apply to write)'));
  const ymd = DATE.replace(/-/g,'');
  const all = [];

  for (const lg of LEAGUES) {
    let j = null;
    try {
      j = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${lg.path}/scoreboard?dates=${ymd}`)
            .then(r => r.json());
    } catch (e) { log('warn', `${lg.key}: ${e.message}`); continue; }
    let nat = 0;
    (j.events || []).forEach(e => {
      const c = (e.competitions || [])[0] || {};
      const comps = c.competitors || [];
      if (comps.length !== 2) return;
      const nets = [...new Set((c.broadcasts || []).flatMap(b => b.names || []))];
      const on = nets.filter(isNational);
      if (!on.length) return;
      nat++;
      const away = comps.find(x => x.homeAway === 'away') || comps[0];
      const home = comps.find(x => x.homeAway === 'home') || comps[1];
      all.push({
        sport: lg.sport, league: lg.key,
        nightId: `slate-${DATE}-${abbr(away)}-${abbr(home)}`,
        name: e.name, tip: new Date(e.date), nets: on
      });
    });
    log(lg.key.toLowerCase(), `${nat} nationally televised of ${(j.events||[]).length}`);
  }

  if (!all.length) { log('none', 'no nationally televised games found — nothing written'); process.exit(0); }
  all.sort((a,b) => a.tip - b.tip);

  /* ---- choose: one per sport first, then fill, always keeping the gap.
     Greedy over tip time, which is what makes the result staggered by
     construction rather than by luck. */
  const picked = [];
  const fits = (g) => picked.every(p => Math.abs(g.tip - p.tip) >= MINGAP*60000);
  for (const pass of [1,2]) {
    for (const g of all) {
      if (picked.length >= WANT) break;
      if (picked.some(p => p.nightId === g.nightId)) continue;
      if (pass === 1 && picked.some(p => p.sport === g.sport)) continue;   // variety first
      if (!fits(g)) continue;
      picked.push(g);
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
  if (fs.existsSync(PICKF)) {
    log('keep', `${path.basename(PICKF)} already exists — a choice already made, leaving it alone`);
    process.exit(0);
  }
  fs.writeFileSync(PICKF, picked.map(g => g.nightId).join('\n') + '\n');
  /* NO NUMBERS. build-slate.js owns them. */
  fs.writeFileSync(MARQF, picked.map(g => g.nightId + (g === star ? ' *' : '')).join('\n') + '\n');
  log('wrote', path.basename(PICKF) + ' and ' + path.basename(MARQF));
})().catch(e => { console.error('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
