#!/usr/bin/env node
/* =====================================================================
   BUILD THE WHOLE SLATE — every game of the night, not one.
   ---------------------------------------------------------------------
   THE PROBLEM. Twelve game nights, thirteen players. The product has only
   ever run ONE room a night, and the reason was never the machine — the
   runner hosts a game with no human at all. The reason was that a night
   needed a person to write it a question bank and hand-edit three
   constants, so the number of rooms was capped by the number of evenings
   somebody had free.

   Meanwhile the WNBA plays two or three games a night, MLB nine, an NFL
   Sunday sixteen. Every one of those is a room that could exist, for a fan
   who is ALREADY WATCHING THAT GAME — which is a far easier thing to ask
   for than "be at our event at seven".

   WHAT THIS DOES. Reads the scoreboard for a date, and for every game
   writes the same `schedule/{nightId}` document a hand-built night uses:
   the matchup, both rosters, and a pick sheet. The questions come from
   admin.html's TEMPLATE via host/publish.js, so admin.html stays the one
   owner of what a question is.

   WHAT IT REFUSES TO DO. It will not create a room for a game that a
   hand-written night in admin.html's NIGHTS already claims. Two rooms for
   one game splits an audience of thirteen into two audiences of six, and
   the flagship — the one with the email and the promotion behind it — is
   the one that must win. The check is on the ESPN event id, not the name.

       DATE=2026-08-19 node host/build-slate.js            # dry run
       DATE=2026-08-19 node host/build-slate.js --apply    # write it
       LEAGUE=mlb DATE=... node host/build-slate.js        # sport two

   COST. One scoreboard fetch, one roster fetch per team, and two Firestore
   writes per game plus one for the slate. For a three-game WNBA night that
   is seven writes. The free tier allows twenty thousand a day.
   ================================================================== */
const fs = require('fs'), path = require('path'), vm = require('vm');

const APPLY  = process.argv.includes('--apply');
/* A manifest the launcher can read without parsing prose. One TSV line a
   game: everything host/publish.js and host/run.js need to be handed. */
const JSONOUT = process.argv.includes('--manifest');
const LEAGUE = (process.env.LEAGUE || 'wnba').toLowerCase();
const DATE   = (process.env.DATE || '').trim();

const PATHS = {
  wnba: { path:'basketball/wnba', sport:'basketball' },
  nba:  { path:'basketball/nba',  sport:'basketball' },
  mlb:  { path:'baseball/mlb',    sport:'baseball'   },
  nfl:  { path:'football/nfl',    sport:'football'   },
  nhl:  { path:'hockey/nhl',      sport:'hockey'     },
  mls:  { path:'soccer/usa.1',    sport:'soccer'     }
};

const die = (m) => { console.error('FATAL: ' + m); process.exit(1); };
const log = (k, m) => (process.argv.includes('--manifest') ? console.error : console.log)(`  ${String(k).padEnd(7)} ${m}`);

if(!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) die('DATE must be set as YYYY-MM-DD');
const L = PATHS[LEAGUE];
if(!L) die(`unknown LEAGUE "${LEAGUE}". Known: ` + Object.keys(PATHS).join(', '));
const YMD = DATE.replace(/-/g, '');
const API = 'https://site.api.espn.com/apis/site/v2/sports/' + L.path;

/* ---- the flagship's claim on a game -------------------------------- */
/* Read NIGHTS out of admin.html the same way publish.js does. A second
   hand-kept list of "which games are already taken" is exactly the kind of
   copy that goes stale on the one night nobody checks it. */
function claimedEvents(){
  const file = path.join(__dirname, '..', 'admin.html');
  const src  = fs.readFileSync(file, 'utf8');
  const s = src.indexOf('const NIGHTS = [');
  if(s < 0) die('could not find NIGHTS in admin.html');
  let d = 0, end = -1;
  for(let j = src.indexOf('[', s); j < src.length; j++){
    const c = src[j];
    if(c === '[') d++;
    else if(c === ']'){ d--; if(!d){ end = j + 1; break; } }
  }
  const NIGHTS = vm.runInNewContext(src.slice(s, end) + ';NIGHTS;', {}, { timeout: 5000 });
  const m = new Map();
  NIGHTS.forEach(n => { if(n.espn) m.set(String(n.espn), n.id); });
  return m;
}

async function getJSON(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

/* ---- rosters come from the ROSTER endpoint, never the box score -----
   A game that has not tipped has no `rosters` block on its summary at all,
   and a game that has finished lists only who PLAYED. Membership is a
   different question from participation: the night Christyn Williams was
   offered as a pick, she was not on the team. The team roster endpoint is
   the only one that answers "who is on this team". */
async function rosterFor(teamId){
  const j = await getJSON(`${API}/teams/${teamId}/roster`);
  return (j.athletes || [])
    .map(a => a.displayName || a.fullName || '')
    .map(s => String(s).trim())
    .filter(Boolean);
}

/* ---- the pick sheet, generated ------------------------------------- */
/* `answer` is what Practice mode pretends happened. It is not a claim about
   a real game and a slate night never reads it; it is filled only so the
   shape matches a hand-built night exactly, because two SHAPES of night is
   how this codebase breaks.

   ONE SHEET PER SPORT, and the difference is not cosmetic. Basketball's six
   picks name PEOPLE, which is why it needs both rosters and the grouping
   that keeps twenty-eight names off one scroll. Baseball's name none: who
   wins, how many runs, does it go extras. Generating "who scores the most
   points" for a baseball game would be a pick sheet that cannot be answered
   and a roster fetch nobody needed. */
function predsForBasketball(g, roster){
  const field = roster.home.concat(roster.away);
  const groups = [
    { ab:g.homeAbbr, name:g.homeName, names:roster.home.slice() },
    { ab:g.awayAbbr, name:g.awayName, names:roster.away.slice() }
  ];
  const player = (id, q, label, num, numLabel) => ({
    id, q, label, base:100, opts:field.slice(), groups,
    answer: field[0] || '', num, numLabel
  });
  return [
    { id:'winner', q:'Who takes it?', label:'Winner', base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    player('pts', 'Who scores the most points?',  'Most points',   20, 'How many pts?'),
    player('reb', 'Who pulls down the most?',     'Most rebounds', 10, 'How many rebounds?'),
    player('ast', 'Who dishes the most?',         'Most assists',   6, 'How many assists?'),
    player('stl', 'Who takes it away most?',      'Most steals',    3, 'How many steals?'),
    player('blk', 'Who protects the rim most?',   'Most blocks',    2, 'How many blocks?')
  ];
}

/* Mirrors BA_PREDS in index.html: six calls, none of them a person. */
function predsForBaseball(g){
  return [
    { id:'winner', q:'Who takes it?',                 label:'Winner',         base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'runs',   q:'Total runs, both teams?',       label:'Total runs',     base:100,
      opts:['Under 8.5','Over 8.5'], answer:'Under 8.5' },
    { id:'first',  q:'Who scores first?',             label:'First to score', base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'hr',     q:'Home runs in the game?',        label:'Home runs',      base:100,
      opts:['None','One','Two','Three or more'], answer:'Two' },
    { id:'ks',     q:'Which staff strikes out more?', label:'More strikeouts',base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'extras', q:'Does it go past nine?',         label:'Extra innings',  base:100,
      opts:['Yes','No'], answer:'No' }
  ];
}

/* Which sports need a roster at all. A sport whose sheet names nobody does
   not get two roster fetches it will never read — and, more importantly,
   an empty roster stops being a reason to refuse the night. */
/* Mirrors FO_PREDS in index.html: six calls, none of them a person. */
function predsForFootball(g){
  return [
    { id:'winner', q:'Who takes it?',               label:'Winner',          base:100,
      opts:[g.awayName, g.homeName], answer:g.awayName },
    { id:'points', q:'Total points, both teams?',   label:'Total points',    base:100,
      opts:['Under 44.5','Over 44.5'], answer:'Over 44.5' },
    { id:'first',  q:'First points come how?',      label:'First score',     base:100,
      opts:['Touchdown','Field goal','Safety'], answer:'Touchdown' },
    { id:'ground', q:'Who runs it better?',         label:'More rush yards', base:100,
      opts:[g.awayName, g.homeName], answer:g.awayName },
    { id:'to',     q:'Turnovers in the game?',      label:'Turnovers',       base:100,
      opts:['None','One','Two','Three or more'], answer:'Two' },
    { id:'lead',   q:'Does the lead change hands?', label:'Lead changes',    base:100,
      opts:['Yes','No'], answer:'Yes' }
  ];
}

/* Soccer's box score carries NO per-player rows at all — boxscore.teams
   only — so soccer picks are team picks by force, not by choice. */
function predsForSoccer(g){
  return [
    { id:'winner', q:'Who takes it?',                  label:'Winner',        base:100,
      opts:[g.awayName, g.homeName, 'Draw'], answer:g.homeName },
    { id:'goals',  q:'Total goals, both teams?',       label:'Total goals',   base:100,
      opts:['Under 2.5','Over 2.5'], answer:'Over 2.5' },
    { id:'first',  q:'Who scores first?',              label:'First goal',    base:100,
      opts:[g.awayName, g.homeName, 'Nobody'], answer:g.homeName },
    { id:'cards',  q:'Cards shown in the match?',      label:'Cards',         base:100,
      opts:['None','One','Two or three','Four or more'], answer:'Two or three' },
    { id:'poss',   q:'Who keeps more of the ball?',    label:'Possession',    base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'clean',  q:'Does either side keep a clean sheet?', label:'Clean sheet', base:100,
      opts:['Yes','No'], answer:'No' }
  ];
}

/* Mirrors HO_PREDS in index.html. */
function predsForHockey(g){
  return [
    { id:'winner', q:'Who takes it?',            label:'Winner',      base:100,
      opts:[g.awayName, g.homeName], answer:g.awayName },
    { id:'goals',  q:'Total goals, both teams?', label:'Total goals', base:100,
      opts:['Under 5.5','Over 5.5'], answer:'Under 5.5' },
    { id:'first',  q:'Who scores first?',        label:'First goal',  base:100,
      opts:[g.awayName, g.homeName], answer:g.awayName },
    { id:'shots',  q:'Who puts more on net?',    label:'More shots',  base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'hits',   q:'Who plays it heavier?',    label:'More hits',   base:100,
      opts:[g.awayName, g.homeName], answer:g.homeName },
    { id:'ot',     q:'Does it need overtime?',   label:'Overtime',    base:100,
      opts:['Yes','No'], answer:'No' }
  ];
}

const SHEETS = {
  basketball: { needsRoster:true,  build: predsForBasketball },
  baseball:   { needsRoster:false, build: predsForBaseball },
  football:   { needsRoster:false, build: predsForFootball },
  soccer:     { needsRoster:false, build: predsForSoccer },
  hockey:     { needsRoster:false, build: predsForHockey }
};

const two = (n) => String(n).padStart(2, '0');
function prettyDate(iso){
  const d = new Date(iso);
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON = ['January','February','March','April','May','June','July',
               'August','September','October','November','December'];
  return { long: `${DAY[d.getUTCDay()]} · ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
           short: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`,
           share: `${MON[d.getUTCMonth()].slice(0,3).toUpperCase()} ${d.getUTCDate()}` };
}

(async () => {
  log('slate', `${LEAGUE.toUpperCase()} · ${DATE}${APPLY ? '' : '  (dry run)'}`);
  const claimed = claimedEvents();
  log('flagship', claimed.size
      ? `${claimed.size} event(s) already claimed by a hand-written night`
      : 'no hand-written nights claim an event');

  const board = await getJSON(`${API}/scoreboard?dates=${YMD}`);
  const events = board.events || [];
  if(!events.length) die(`the ${LEAGUE.toUpperCase()} scoreboard lists no games on ${DATE}`);
  log('board', `${events.length} game(s) on the slate`);

  /* TWO LISTS, AND THE DIFFERENCE MATTERS.
       `games` is what this script OWNS — it writes a schedule doc, publishes
       a bank and starts a runner for each one.
       `offered` is what the PLAYER sees, and it has to include the flagship.
       A picker that lists every game except the one with the email behind it
       would be the strangest possible bug: the person who came because of
       the email arrives and cannot find the game the email was about. */
  const games = [], offered = [], skipped = [];
  for(const e of events){
    const c = e.competitions[0];
    const H = c.competitors.find(x => x.homeAway === 'home');
    const A = c.competitors.find(x => x.homeAway === 'away');
    if(!H || !A){ skipped.push(`${e.id}: no two sides`); continue; }

    const owner = claimed.get(String(e.id));
    const ab = (t) => String(t.abbreviation || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nightId = owner || `slate-${DATE}-${ab(A.team)}-${ab(H.team)}`;
    const pd = prettyDate(e.date);
    const net = (c.broadcasts || []).flatMap(b => b.names || []).join(' · ');

    const g = {
      nightId, espnEvent: String(e.id), tipISO: e.date,
      homeName: H.team.displayName, homeAbbr: H.team.abbreviation,
      homeNick: H.team.name, homeColor: '#' + String(H.team.color || '666666').replace(/^#/, ''),
      awayName: A.team.displayName, awayAbbr: A.team.abbreviation,
      awayNick: A.team.name, awayColor: '#' + String(A.team.color || '666666').replace(/^#/, ''),
      venue: (c.venue || {}).fullName || '', net,
      date: pd.long, short: pd.short, shareDate: pd.share,
      night: `${A.team.name} @ ${H.team.name}`,
      /* TWO DIFFERENT WORDS, AND THEY ARE NOT INTERCHANGEABLE.
         `sport` is the FAMILY (basketball) — it picks the question bank and
         the pick sheet. `path` is what ESPN answers to
         (basketball/wnba) — it fetches the feed. They were one column, so
         the runner was handed a family and asked ESPN for
         /sports/basketball/summary, which 404s for every league in every
         sport. The runner caught it, logged, slept 30s and opened no round
         — for four hours, in silence. Both come off PATHS above, so this
         is one fact with two names, not two facts. */
      sport: L.sport, path: L.path, league: LEAGUE, slate: DATE
    };

    /* Every game is OFFERED, whoever owns it. */
    offered.push({
      nightId, espnEvent: g.espnEvent, tipISO: g.tipISO,
      away: g.awayNick, home: g.homeNick,
      awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr,
      awayColor: g.awayColor, homeColor: g.homeColor,
      venue: g.venue, net: g.net, flagship: !!owner,
      /* The merge above filters on this. A game with no league is a game
         the next league's build cannot tell apart from its own. */
      league: LEAGUE, sport: L.sport
    });

    if(owner){
      /* The flagship already has a schedule doc written from index.html's
         own constants, and a bank a human wrote. Touching either would be
         this codebase's whole disease. Offer it and leave it alone —
         and skip its roster fetch, which is two HTTP calls saved. */
      skipped.push(`${A.team.abbreviation} @ ${H.team.abbreviation} — ${owner} owns it; offered in the picker, not rebuilt`);
      continue;
    }

    const sheet = SHEETS[L.sport];
    if(!sheet){
      skipped.push(`${A.team.abbreviation} @ ${H.team.abbreviation} — no pick sheet is written for ${L.sport} yet`);
      offered.pop();
      continue;
    }

    let roster = { home:[], away:[] };
    if(sheet.needsRoster){
      roster = { home: await rosterFor(H.team.id), away: await rosterFor(A.team.id) };
      if(!roster.home.length || !roster.away.length){
        skipped.push(`${A.team.abbreviation} @ ${H.team.abbreviation} — a roster came back empty and this sheet names players, refusing to build a half night`);
        offered.pop();
        continue;
      }
    }

    games.push({ g, roster, preds: sheet.build(g, roster) });
    log('game', `${nightId}  ${A.team.name} @ ${H.team.name}  ` +
                (sheet.needsRoster ? `${roster.away.length}+${roster.home.length} players  ` : 'team picks  ') +
                (net || '(no tv)'));
  }

  skipped.forEach(s => log('skip', s));
  log('offer', `${offered.length} game(s) will appear in the picker` +
               (offered.some(o => o.flagship) ? ', flagship included' : ''));
  if(!games.length && !offered.length)
    die('nothing to build and nothing to offer on this date');

  if(JSONOUT){
    /* stderr carries the human log above; stdout carries only the manifest,
       so `node build-slate.js --manifest 2>/dev/null` is safe to read. */
    games.forEach(x => process.stdout.write(
      [x.g.nightId, x.g.espnEvent, x.g.homeNick, x.g.awayNick, x.g.tipISO,
       x.g.sport, x.g.path].join('\t') + '\n'));
  }

  /* THE SLATE DOCUMENT is what the app reads to offer a choice. It carries
     only what a picker needs — anything more is a second copy of the night
     config that would drift from schedule/{nightId}. */
  /* Sorted by tip, because that is the order a person thinks about an
     evening in — not the order the scoreboard happened to return. */
  offered.sort((a, b) => String(a.tipISO).localeCompare(String(b.tipISO)));
  const slate = {
    date: DATE, league: LEAGUE, sport: L.sport,
    games: offered,
    flagship: offered.filter(o => o.flagship).map(o => o.nightId)
  };

  const writes = games.length + 1;
  if(!APPLY){
    log('dry', `would write ${games.length} schedule doc(s) + slate/${DATE} + slate/current = ${writes + 1} write(s)`);
    log('dry', `then: ${games.length} plan(s) via publish.js — ${writes + games.length} writes total`);
    log('next', 'add --apply to write it');
    games.forEach(x => log('  →', `schedule/${x.g.nightId}  (${JSON.stringify(x).length} bytes)`));
    log('picker', JSON.stringify(slate.games.map(g => `${g.away}@${g.home}` + (g.flagship ? ' ★' : ''))));
    return;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw) die('FIREBASE_SERVICE_ACCOUNT is not set. See host/MACHINE-SETUP.md.');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  for(const x of games){
    await db.doc(`schedule/${x.g.nightId}`).set(
      { game: x.g, roster: x.roster, preds: x.preds,
        at: admin.firestore.FieldValue.serverTimestamp(), by: 'build-slate.js' },
      { merge: true });
    log('wrote', `schedule/${x.g.nightId}`);
  }
  /* ============ ONE SLATE A DAY, MANY LEAGUES IN IT =================
     From September this box runs WNBA and NFL and MLB on the same evening,
     and `slate/{date}` is ONE document. A plain .set() here — which is what
     this was — means building the NFL slate at 8am wipes every basketball
     game out of the picker, and the person who came for the game in the
     email opens the app and cannot find it.

     So: keep every game that belongs to ANOTHER league, replace only this
     league's. Read-modify-write is safe because the builder runs once per
     league per morning from one cron line, in sequence, on one machine.
     If that ever stops being true this needs a transaction.

     "Which game are you watching?" is the right question ACROSS sports, not
     within one — a fan on a Saturday in September is choosing between a
     football game and a basketball game, not between two football games. */
  /* ============ NEVER OFFER A ROOM NOBODY HOSTS =====================
     MEASURED 18 Aug, in production, in a log nobody was reading:

         !!! 15 room(s) are OFFERED TO PLAYERS AND HOSTED BY NOBODY.
         !!! leagues built but not run: mlb mlb mlb ... (x15)

     The cron builds `wnba nfl mlb mls` and runs `wnba nfl`, because
     building is how the backtest gets its data and running costs Firestore
     reads and a room cap. Both halves are right. What was wrong is that
     `slate/{date}` — the document the PLAYER'S RAIL reads — was written
     from the BUILT set, so fifteen baseball rooms appeared in the picker
     with no runner behind any of them. Tap one and it looks like a normal
     room: it has a name, it has teams, it has a card. It just never opens a
     round, all night, in silence. That is the worst failure this product
     has, and start-slate.sh has been printing a warning about it into a
     log file at 23:00 rather than anything acting on it.

     So the rail is now written from the HOSTED set. Every game still gets
     its `schedule/{nightId}` document — the backtest, the archive and
     tomorrow's data collection are untouched — it simply is not OFFERED to
     a human unless something is going to host it.

     RUN_LEAGUES is the same variable start-slate.sh uses to decide what to
     run, passed through rather than restated, because two lists of which
     leagues are live is precisely the shape of bug this comment is about.
     Unset means "host everything you build", which is the old behaviour and
     the right default for a hand-run build. */
  const RUN = String(process.env.RUN_LEAGUES || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hosted = g => !RUN.length || RUN.includes(String(g.league || '').toLowerCase());
  const railGames = slate.games.filter(hosted);
  const withheld = slate.games.length - railGames.length;
  if(withheld)
    log('rail', `${withheld} ${LEAGUE.toUpperCase()} game(s) built but NOT offered — no runner hosts ${LEAGUE} today`);

  const slateRef = db.doc(`slate/${DATE}`);
  const prior = await slateRef.get();
  const fresh = new Set(slate.games.map(g => g.nightId));
  /* DEDUPE ON nightId, NOT JUST ON LEAGUE. Filtering by league alone was
     enough for a slate written by this script — but it is not enough for
     one written by an EARLIER version of it, whose games carry no `league`
     field at all. Those would fail the league test, be kept, and then be
     added again: the same game twice in the picker, which reads as the app
     being broken rather than as a migration. A nightId is the one thing
     that is unique whatever wrote it. */
  const kept = (prior.exists ? (prior.data().games || []) : [])
                 .filter(g => g && g.nightId && g.league !== LEAGUE && !fresh.has(g.nightId));
  /* `fresh` covers every game built for this league, hosted or not, so a
     game that WAS offered yesterday and is not hosted today is removed
     rather than left behind by the filter. */
  const merged = kept.concat(railGames)
                     .sort((a,b) => String(a.tipISO).localeCompare(String(b.tipISO)));
  const leagues = [...new Set(merged.map(g => g.league).filter(Boolean))];
  if(kept.length)
    log('merge', `kept ${kept.length} game(s) from ${[...new Set(kept.map(g=>g.league))].join(', ')} already on this date`);

  await slateRef.set({
    date: DATE, games: merged, leagues,
    flagship: merged.filter(g => g.flagship).map(g => g.nightId),
    at: admin.firestore.FieldValue.serverTimestamp()
  });
  /* THE POINTER, exactly like schedule/current. The app cannot work out
     which date's slate is "tonight" on its own: a 10pm ET tip is already
     tomorrow in UTC, and a phone's own clock is in whatever zone the person
     is standing in. One pointer, written by the thing that knows, read by
     everything else — rather than five clients each deriving a date and
     one of them getting it wrong on the night nobody checks. */
  /* THE POINTER ONLY EVER NAMES TODAY.
     Building a FUTURE date is a normal and useful thing to do — checking
     Saturday's ten-game football slate on a Wednesday, for instance — and
     the first version of this moved slate/current every time, so a
     rehearsal for Saturday would have shown Saturday's games to everyone
     opening the app on Wednesday night. The pointer answers "what is on
     RIGHT NOW", and a build for another day is not an answer to that.

     Today is the BOX's today, deliberately. It is the machine that runs the
     nights, its clock is the one the cron fires on, and a phone's clock is
     in whatever zone its owner is standing in. */
  const today = new Date().toLocaleDateString('en-CA');
  if(DATE === today){
    await db.doc('slate/current').set(
      { date: DATE, leagues, games: merged.length,
        at: admin.firestore.FieldValue.serverTimestamp() });
    log('key', `slate/current → ${DATE} · ${merged.length} game(s) across ${leagues.join(', ')}`);
  } else {
    log('note', `${DATE} is not today (${today}) — slate/${DATE} is written and ready, ` +
                'but slate/current is left alone so tonight keeps pointing at tonight');
  }
  log('key', `slate/${DATE} — ${offered.length} ${LEAGUE.toUpperCase()} game(s), ${games.length} built here` +
             (slate.flagship.length ? ` (flagship ${slate.flagship.join(', ')} runs alongside)` : ''));
  log('next', `publish each plan:  ${games.map(x =>
    `NIGHT_ID=${x.g.nightId} HOME_NICK="${x.g.homeNick}" AWAY_NICK="${x.g.awayNick}" node host/publish.js`).join('\n           ')}`);
})().catch(e => die(e.message));
