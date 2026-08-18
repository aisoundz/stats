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
/* The six basketball categories, the same ones BB_PREDS has always had.
   `answer` is what Practice mode pretends happened; it is not a claim about
   a real game, and for a slate night nothing ever reads it. It is filled
   with a real name from the sheet only so the shape matches a hand-built
   night exactly — a config with a different SHAPE would be a second kind of
   night, and two kinds of night is how this codebase breaks. */
function predsFor(g, roster){
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
      sport: L.sport, league: LEAGUE, slate: DATE
    };

    /* Every game is OFFERED, whoever owns it. */
    offered.push({
      nightId, espnEvent: g.espnEvent, tipISO: g.tipISO,
      away: g.awayNick, home: g.homeNick,
      awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr,
      awayColor: g.awayColor, homeColor: g.homeColor,
      venue: g.venue, net: g.net, flagship: !!owner
    });

    if(owner){
      /* The flagship already has a schedule doc written from index.html's
         own constants, and a bank a human wrote. Touching either would be
         this codebase's whole disease. Offer it and leave it alone —
         and skip its roster fetch, which is two HTTP calls saved. */
      skipped.push(`${A.team.abbreviation} @ ${H.team.abbreviation} — ${owner} owns it; offered in the picker, not rebuilt`);
      continue;
    }

    const roster = { home: await rosterFor(H.team.id), away: await rosterFor(A.team.id) };
    if(!roster.home.length || !roster.away.length){
      skipped.push(`${A.team.abbreviation} @ ${H.team.abbreviation} — a roster came back empty, refusing to build a half night`);
      offered.pop();
      continue;
    }

    games.push({ g, roster, preds: predsFor(g, roster) });
    log('game', `${nightId}  ${A.team.name} @ ${H.team.name}  ` +
                `${roster.away.length}+${roster.home.length} players  ${net || '(no tv)'}`);
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
      [x.g.nightId, x.g.espnEvent, x.g.homeNick, x.g.awayNick, x.g.tipISO, x.g.sport].join('\t') + '\n'));
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
  await db.doc(`slate/${DATE}`).set(
    Object.assign({}, slate, { at: admin.firestore.FieldValue.serverTimestamp() }));
  /* THE POINTER, exactly like schedule/current. The app cannot work out
     which date's slate is "tonight" on its own: a 10pm ET tip is already
     tomorrow in UTC, and a phone's own clock is in whatever zone the person
     is standing in. One pointer, written by the thing that knows, read by
     everything else — rather than five clients each deriving a date and
     one of them getting it wrong on the night nobody checks. */
  await db.doc('slate/current').set(
    { date: DATE, league: LEAGUE, sport: L.sport, games: slate.games.length,
      at: admin.firestore.FieldValue.serverTimestamp() });
  log('key', `slate/current → ${DATE}`);
  log('key', `slate/${DATE} — ${offered.length} game(s) in the picker, ${games.length} built here` +
             (slate.flagship.length ? ` (flagship ${slate.flagship.join(', ')} runs alongside)` : ''));
  log('next', `publish each plan:  ${games.map(x =>
    `NIGHT_ID=${x.g.nightId} HOME_NICK="${x.g.homeNick}" AWAY_NICK="${x.g.awayNick}" node host/publish.js`).join('\n           ')}`);
})().catch(e => die(e.message));
