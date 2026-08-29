#!/usr/bin/env node
/* ============ THE RECORD BOOK, HARVESTED ONCE ========================
   Founder, 21 August 2026: "Can you put a ai in the voice so when I ask
   questions about who is the all time leading rusher they can tell me...
   they should be the top dog. Their name is STATS."

   The obvious way to build that is a language model, and it is the wrong
   way. Ask one who leads the NFL in all-time rushing yards and it will
   produce a name and a number with total conviction, and it will be wrong
   often enough to embarrass him in front of somebody. A wrong number said
   confidently is worse than "I don't know" — it is the difference between
   an assistant you lean on and one you check.

   ESPN publishes the record book itself, free, with no key:

     sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/leaders

   with no season in the path, which returns season "Any", type "total" —
   the ALL-TIME list, twenty-five deep, ten categories a league. Verified
   by hand before this file was written: Emmitt Smith 18,355 rushing yards,
   Tom Brady 89,214 passing, Jerry Rice 1,549 receptions, Kareem 38,387
   points, Ty Cobb .366, Pete Rose 4,256 hits.

   So the Jetson harvests it ONCE into a static file that ships with the
   page. Consequences, all of them good:

     · it costs nothing per question, at ten players or a hundred thousand;
     · there is no key in a client-side file, because there is no key;
     · there is no runway to worry about — nothing here expires in November;
     · and STATS CANNOT MAKE ANYTHING UP, because it is not generating. It
       reads a number that has a name and a source attached, or it says it
       does not know.

   Usage:
     node host/factbook.js                 # every league, writes facts.json
     node host/factbook.js --league nfl    # just one
     node host/factbook.js --depth 5       # names to resolve per category
*/
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ARGS  = process.argv.slice(2);
const argOf = (f, d) => { const i = ARGS.indexOf(f); return (i >= 0 && ARGS[i+1]) ? ARGS[i+1] : d; };
const DEPTH = Math.max(1, Math.min(10, Number(argOf('--depth', 5)) || 5));
const ONLY  = argOf('--league', '');
const OUT   = path.join(__dirname, '..', 'facts.json');

/* The six this product actually runs. `sport` and `league` are ESPN's own
   path segments — the same pair SPORT_CFG uses, so a room's league maps
   straight onto a shelf of the record book. */
/* 28 Aug: built from host/leagues.js. The `league` here is ESPN's path
   segment, not our key — ours is 'mls', theirs is 'usa.1' — which is
   exactly the confusion segments() exists to stop anyone re-deriving by
   hand for a seventh time. */
const LG = require('./leagues.js');
const LEAGUES = ['nfl','nba','wnba','mlb','nhl','mls','epl'].map(k => ({
  key: k, ...LG.segments(k), label: LG.get(k).label,
}));

const log = (k, m) => console.log('  ' + String(k).padEnd(7) + m);

function get(url){
  /* ESPN hands back $ref values on http://; following them verbatim throws
     before it ever leaves the machine. */
  const u = String(url).replace(/^http:/, 'https:');
  return new Promise(res => {
    https.get(u, { headers:{ 'user-agent':'Mozilla/5.0 (STATS GAMETIME factbook)' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(_) { res(null); } });
    }).on('error', () => res(null));
  });
}
const wait = ms => new Promise(z => setTimeout(z, ms));

/* One athlete name per $ref, remembered — the same player tops several
   categories and there is no reason to ask twice. */
const nameCache = new Map();
async function nameOf(ref){
  if(!ref) return '';
  if(nameCache.has(ref)) return nameCache.get(ref);
  const a = await get(ref);
  const n = (a && (a.displayName || a.fullName || a.shortName)) || '';
  nameCache.set(ref, n);
  return n;
}

async function harvest(L){
  const url = `https://sports.core.api.espn.com/v2/sports/${L.sport}/leagues/${L.league}/leaders`;
  const j = await get(url);
  if(!j || !Array.isArray(j.categories) || !j.categories.length){
    log('skip', `${L.key}: no all-time leaders published`);
    return null;
  }
  const shelf = { label: L.label, season: String(j.abbreviation || j.name || 'Any'), cats: {} };
  let people = 0;
  for(const c of j.categories){
    const rows = [];
    for(const item of (c.leaders || []).slice(0, DEPTH)){
      const who = await nameOf(item.athlete && item.athlete.$ref);
      if(!who) continue;
      rows.push([ who, String(item.displayValue != null ? item.displayValue : item.value) ]);
      people++;
      await wait(40);                       // be a polite guest
    }
    if(rows.length) shelf.cats[c.name] = { d: c.displayName || c.name, l: rows };
  }
  log('ok', `${L.key}: ${Object.keys(shelf.cats).length} categories, ${people} names`);
  return shelf;
}

(async () => {
  console.log('\n  THE RECORD BOOK — all-time leaders, harvested once\n');
  const book = { built: new Date().toISOString(), depth: DEPTH, leagues: {} };
  for(const L of LEAGUES){
    if(ONLY && ONLY !== L.key) continue;
    const shelf = await harvest(L);
    if(shelf) book.leagues[L.key] = shelf;
  }
  const n = Object.keys(book.leagues).length;
  if(!n){ console.log('\n  nothing harvested — writing nothing rather than an empty book\n'); process.exit(1); }

  /* Merge rather than replace, so harvesting one league does not delete
     the other five. */
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch(_) {}
  if(prev && prev.leagues) book.leagues = Object.assign({}, prev.leagues, book.leagues);

  fs.writeFileSync(OUT, JSON.stringify(book));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\n  wrote ${OUT}  —  ${Object.keys(book.leagues).length} league(s), ${kb} kB\n`);
})();
