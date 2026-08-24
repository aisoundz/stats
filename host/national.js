#!/usr/bin/env node
/* WHAT CAN THE WHOLE COUNTRY WATCH ON A GIVEN DAY?
   ------------------------------------------------------------------
   Founder, 20 Aug 2026: "Make sure they are national games. our schedule
   should reflect that and be around that."

   Rule 7 in leagues.env said what a national game is. This says which ones
   EXIST, so a slate is built from the answer instead of checked against it
   afterwards. Saturday was picked by matchup and time and only later found to
   have a room nobody outside two cities could watch. Picking from this list
   makes that impossible rather than merely detectable.

   Usage:
     node host/national.js                          # today
     node host/national.js 2026-08-23               # one day
     node host/national.js 2026-08-23 2026-08-31    # a range, one block a day

   Reads BOTH `broadcasts` and `geoBroadcasts`. Reading only the first is what
   printed a blank channel for Saints at Rams while ESPN was carrying the
   answer in the other field the whole time.                                */

const LEAGUES = [
  ['wnba', 'basketball/wnba'], ['nfl',  'football/nfl'],
  ['mlb',  'baseball/mlb'],    ['mls',  'soccer/usa.1'],
  ['nba',  'basketball/nba'],  ['nhl',  'hockey/nhl'],
];

/* 24 Aug — 'USA'/'USA Net'/'USA Network' were missing here even though
   host/marquee.js's own NATIONAL list already has them, and the room-
   selection rule itself names USA as national (see leagues.env Rule 7 /
   the room-selection memory: "USA, ESPN, CBS, ABC, NBC, NBA TV, ION,
   Peacock/NBCSN, CNBC"). A real consequence, not a hypothetical one:
   26 Aug's WNBA Tempo @ Storm room reads "USA Net" from ESPN and was
   being scored as NOT national, taking the only qualifying game that
   day off the board. Two scripts deciding the same fact and disagreeing
   is the exact disease this codebase keeps finding — see marquee.js's
   own list for the one this was brought in line with. */
const NATIONAL = ['NFL Net','NFL Network','FOX','FS1','FS2','CBS','CBS Sports Network','NBC','ABC',
  'ION','ESPN','ESPN2','ESPNU','TNT','TBS','truTV','MLB Network','NBA TV','CW','The CW','Peacock','Netflix',
  'USA','USA Net','USA Network'];
/* A league with no linear option at all: refusing the streamer refuses the sport. */
const LEAGUE_ONLY = { mls:['Apple TV'], mlb:['Apple TV'] };
/* Excluded on purpose. Prime is rule 3 (WNBA); ESPN Unlimited is a paid add-on,
   not a channel people have, and always sat beside a linear alternative. */
const EXCLUDED = { 'Prime Video':'Prime, excluded by rule 3', 'ESPN Unlmtd':'paid add-on, not a channel' };

const PT = iso => new Date(iso).toLocaleString('en-US',
  {timeZone:'America/Los_Angeles', hour:'numeric', minute:'2-digit'});
const ET = iso => new Date(iso).toLocaleString('en-US',
  {timeZone:'America/New_York', hour:'numeric', minute:'2-digit'});

async function day(date){
  const rows = [];
  for(const [key, path] of LEAGUES){
    let d = null;
    try{
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${date.replace(/-/g,'')}`);
      d = await r.json();
    }catch(_){ continue; }
    for(const e of (d.events || [])){
      const c = (e.competitions || [])[0] || {};
      const names = [
        ...(c.broadcasts || []).flatMap(b => b.names || []),
        ...(c.geoBroadcasts || []).map(b => (b.media || {}).shortName),
      ].filter((v,i,a) => v && a.indexOf(v) === i);
      const nat = names.filter(n => NATIONAL.includes(n));
      const only = names.filter(n => (LEAGUE_ONLY[key] || []).includes(n));
      rows.push({ key, name: e.shortName || '?', iso: e.date, names,
                  ok: nat.length ? nat : (only.length ? only : null),
                  why: only.length && !nat.length ? `${only[0]}, the only way to see ${key.toUpperCase()}` : '' });
    }
  }
  rows.sort((a,b) => new Date(a.iso) - new Date(b.iso));
  const good = rows.filter(r => r.ok), bad = rows.filter(r => !r.ok);
  console.log(`\n=== ${date} · ${good.length} nationally carried of ${rows.length} ===`);
  if(!rows.length){ console.log('   no games'); return; }
  good.forEach(r => console.log(
    `   ${r.key.toUpperCase().padEnd(5)} ${r.name.padEnd(12)} ${ET(r.iso).padStart(8)} ET  ${PT(r.iso).padStart(8)} PT   ${r.ok.join(', ')}${r.why ? '   (' + r.why + ')' : ''}`));
  if(bad.length){
    console.log(`   ---- not national, do not host (${bad.length}) ----`);
    bad.forEach(r => {
      const ex = r.names.map(n => EXCLUDED[n]).filter(Boolean)[0];
      console.log(`   ${r.key.toUpperCase().padEnd(5)} ${r.name.padEnd(12)} ${PT(r.iso).padStart(8)} PT   ${r.names.join(', ') || 'no channel listed'}${ex ? '   <- ' + ex : ''}`);
    });
  }
}

(async () => {
  const a = process.argv.slice(2).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const start = a[0] || new Date().toLocaleDateString('en-CA', {timeZone:'America/Los_Angeles'});
  const end = a[1] || start;
  for(let t = new Date(start + 'T12:00:00Z'); t <= new Date(end + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate()+1)){
    await day(t.toISOString().slice(0,10));
  }
  console.log('');
})();
