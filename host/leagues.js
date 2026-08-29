/* =====================================================================
   EVERY LEAGUE THIS PRODUCT KNOWS, IN ONE PLACE.
   ---------------------------------------------------------------------
   28 Aug 2026. The league table lived in FOUR files that had already
   drifted apart:

       build-slate.js   6 leagues — no epl, no cfb
       backtest.js      8 leagues — epl and cfb, added for the shadow run
       snapshot.js      2 leagues — mls and nhl, plus a breakAt nobody else had
       factbook.js      6 leagues — a different shape again, with labels

   The drift had a cost with a date on it. The Premier League resolvers
   were proven on 27 Aug — 10 games, 80 resolutions, 59 answered, 0
   invalid — and `epl` was added to backtest.js so the shadow run could
   use it. Nothing added it to build-slate.js, so the league was provably
   gradable and still could not be given a room. host/pick-monday-31aug.sh
   was written to book the first EPL night and had to open with a warning
   about its own hard dependency:

       "epl is in host/backtest.js only. It is NOT in build-slate.js or
        host/leagues.env, so nothing builds an EPL room yet."

   backtest.js said the same thing about itself, in its own comment:
   "Adding a row to an existing copy is not the same sin as writing a
   fifth copy, but it is the same disease and it should not survive the
   weekend."

   This file is the cure. A league is declared ONCE, here, and every
   consumer reads it. Adding the next one is a row, not an archaeology
   expedition through four files to find which of them already knows.

   WHAT A ROW HOLDS, and why each field is here rather than derived:

     path     what ESPN answers to. 'soccer/eng.1' — a PATH, not a sport.
              The single most expensive confusion this codebase has had:
              basketball is a FAMILY, basketball/wnba is a path, and
              conflating them silently muted every room on a slate.
     sport    the FAMILY. Picks the question bank and the pick sheet.
              Several leagues share one: wnba and nba are both basketball.
     label    how a person says it in prose. Used by the record book.
     breakAt  the ESPN status detail that means "a round can close now".
              Only leagues whose rounds are driven by a snapshot need it;
              absent means the consumer already knows its own rhythm.

   ONE DELIBERATE OMISSION. Nothing here says whether a league is BUILT or
   HOSTED. That is a nightly business decision, it changes without a code
   change, and it lives in host/leagues.env where a person can see it next
   to the rules for choosing rooms. This file answers "what is this league
   and where does ESPN keep it". It does not answer "are we playing it
   tonight", and it must never learn to.
   ================================================================== */

const LEAGUES = {
  /* ---- basketball ------------------------------------------------- */
  wnba: { path:'basketball/wnba', sport:'basketball', label:'the WNBA' },
  nba:  { path:'basketball/nba',  sport:'basketball', label:'the NBA'  },

  /* ---- baseball ---------------------------------------------------- */
  mlb:  { path:'baseball/mlb',    sport:'baseball',   label:'Major League Baseball' },

  /* ---- football ---------------------------------------------------- */
  nfl:  { path:'football/nfl',    sport:'football',   label:'the NFL' },
  /* Probed 27 Aug. A path, not a sport — the same shape as any other
     league, which is the whole point of the parameter. */
  cfb:  { path:'football/college-football', sport:'football', label:'college football' },

  /* ---- hockey ------------------------------------------------------ */
  nhl:  { path:'hockey/nhl',      sport:'hockey',     label:'the NHL',
          breakAt:'END_PERIOD' },

  /* ---- soccer ------------------------------------------------------
     Soccer has no plays[] at all, so its rounds come from box-score
     deltas taken across a break rather than from an event stream. That
     is what breakAt is for. */
  mls:  { path:'soccer/usa.1',    sport:'soccer',     label:'MLS',
          breakAt:'HALFTIME' },
  epl:  { path:'soccer/eng.1',    sport:'soccer',     label:'the Premier League',
          breakAt:'HALFTIME' }
};

/* The ESPN path split back into its two segments, because factbook.js
   wants them separately and deriving it here is better than storing the
   same fact twice in one row. 'soccer/usa.1' -> { sport:'soccer',
   league:'usa.1' }. Note this `league` is ESPN's path segment, NOT our
   key: ours is 'mls', theirs is 'usa.1'. */
function segments(key) {
  const L = LEAGUES[key];
  if (!L) return null;
  const bits = String(L.path).split('/');
  return { sport: bits[0], league: bits[1] };
}

/* Look one up. Returns null rather than throwing, so a caller can decide
   whether an unknown league is fatal (build-slate: yes) or skippable
   (backtest sweeping a list: no). */
function get(key) {
  return LEAGUES[String(key || '').toLowerCase().trim()] || null;
}

/* For the error message a person actually reads when they typo a league. */
function known() {
  return Object.keys(LEAGUES);
}

/* =====================================================================
   THE SECOND FACT THIS FILE OWNS: IS A GAME NATIONALLY CARRIED?
   ---------------------------------------------------------------------
   28 Aug 2026. There were FOUR national lists in host/, and all four
   disagreed:

     build-slate.js   no USA Network at all
     national.js      had USA — and its own comment, dated 24 Aug, says it
                      was brought in line with marquee.js after a real
                      incident: "26 Aug's WNBA Tempo @ Storm room reads
                      'USA Net' from ESPN and was being scored as NOT
                      national, taking the only qualifying game that day
                      off the board."
     marquee.js       had USA and Apple TV, no CW, no Spanish
     pick-national.js NO USA — and it lists Prime Video and ESPN Unlmtd,
                      both of which leagues.env Rule 7 rejects by name

   That last one is the expensive one, because pick-national.js is the
   script that CHOOSES the game of the night. Measured on 28 Aug against
   three real days, it proposed as national:

       29 Aug   Astros at Mets              ESPN Unlmtd
       30 Aug   Red Sox at Yankees          ESPN Unlmtd
       31 Aug   Phillies at Diamondbacks    ESPN Unlmtd   ← Game of the Night

   ESPN Unlimited is a paid add-on. leagues.env Rule 7: "ESPN Unlimited on
   its own. It is a paid add-on, not a channel people have." So Monday's
   marquee was going to be a game most readers cannot watch, while Arsenal
   at Aston Villa on USA Network sat in the same day unseen — because that
   script's league list did not know epl either. Two copies of two facts,
   failing together.

   THE BAR, and it is leagues.env Rule 7 verbatim: NATIONAL LINEAR, plus
   the national streamers that are genuinely universal within their
   package, plus ONE exception for a league with no linear option at all.
   ================================================================== */

const NATIONAL = [
  /* Broadcast */
  'ABC','CBS','FOX','NBC','The CW','CW',
  /* National cable */
  'ESPN','ESPN2','ESPNU','FS1','FS2','NFL Net','NFL Network','NBA TV',
  'MLB Net','MLB Network','TNT','TBS','truTV','ION','Ion',
  'CBS Sports Network','CBSSN',
  /* USA Network. Missing from build-slate.js and pick-national.js until
     28 Aug even though national.js had already fixed exactly this on the
     24th. It is NBCUniversal's flagship cable channel and it is how the
     Premier League reaches the United States. */
  'USA','USA Net','USA Network',
  /* National streamers that come inside the broadcaster's own package
     rather than as a separate purchase. */
  'Peacock','Paramount+','Netflix',
  /* National Spanish-language, both NBCUniversal. Spanish is LIVE in the
     product at ?lang=es, so these reach players we already built for. */
  'Telemundo','Universo',
];

/* NOT NATIONAL, however national the name sounds. Kept as an explicit
   list rather than a comment so the reason survives the next edit.
     Prime Video    excluded for the WNBA by leagues.env Rule 3, and the
                    marquee's own comment records it proposing a Prime-only
                    game as Game of the Night once already.
     ESPN Unlmtd    a paid add-on, not a channel people have (Rule 7). */
const NOT_NATIONAL = ['Prime Video','Amazon Prime','ESPN Unlmtd','ESPN Unlimited','ESPN+'];

/* THE ONE EXCEPTION. A streamer counts ONLY where the league has no
   linear option at all: every MLS match is Apple TV, and Friday MLB is
   Apple TV exclusive. Refusing streamers there would refuse the sport. */
const LEAGUE_ONLY_STREAMER = { mls:['Apple TV'], mlb:['Apple TV'] };

/* Regionals that read as national. A regional network with a national-
   sounding name is the exact trap Rule 7 exists for, so these are matched
   on purpose and never by a general pattern. */
const REGIONAL = [
  /NBC Sports\s+\S/i,                    // NBC Sports Bay Area, Boston, …
  /^Fox\s*\d/i, /Fox\s+\d+\s*Plus/i,     // Fox 12 Plus (Portland) &c
  /League Pass|MSG|YES|NESN|Marquee|SNY|Bally|Spectrum|Altitude|Space City|Vegas \d/i,
  /\bKPIX|KCBS|WUSA|CBS ?4\b/i,          // named local affiliates
  /Sports ?Net(work)? [A-Z]/,            // AZ Family Sports Net &c
  /TV Network$/i,                        // Lions TV Network
];

/* Does this carriage string clear the bar?
     net    what ESPN gave us. May be one name or several joined by '·'
            or ','. Both shapes exist in the feed and both are handled,
            because reading only one of them is how a blank channel got
            printed for Saints at Rams while the answer sat in the other
            field the whole time.
     league OUR key ('mls', 'epl'), optional. Only used for the
            league-only-streamer exception. */
function isNational(net, league) {
  const parts = String(net || '')
    .split(/[·,]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return false;

  const ok = LEAGUE_ONLY_STREAMER[String(league || '').toLowerCase()] || [];

  return parts.some(name => {
    if (NOT_NATIONAL.some(b => name.toLowerCase() === b.toLowerCase())) return false;
    if (REGIONAL.some(rx => rx.test(name))) return false;
    if (ok.some(s => name.toLowerCase() === s.toLowerCase())) return true;
    /* EXACT MATCH, DELIBERATELY. The version of this in pick-national.js
       also accepted anything STARTING with a national name, and that is
       how a local affiliate gets promoted: "CW Seattle" starts with "CW",
       "CBS LA" starts with "CBS", "ABC 7" starts with "ABC". All three
       are exactly the regional-with-a-national-name trap Rule 7 was
       written for, and two of them are in real slate data from this week.
       pick-national.js's own comment says it: "Add to it on purpose,
       never by pattern." So the pattern is gone. A new carrier is a row
       in NATIONAL above, added by a person who checked. */
    const n = name.toLowerCase();
    return NATIONAL.some(x => {
      const t = x.toLowerCase();
      return n === t || n === t.replace(/\+$/, '');
    });
  });
}

module.exports = {
  LEAGUES, get, known, segments,
  NATIONAL, NOT_NATIONAL, LEAGUE_ONLY_STREAMER, isNational,
};
