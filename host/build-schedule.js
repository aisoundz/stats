#!/usr/bin/env node
/* =====================================================================
   build-schedule.js — THE NEXT TWO WEEKS, AS A FILE.
   ---------------------------------------------------------------------
   31 Aug 2026. Founder's ask: "We should also have our schedule for the
   next two weeks in our menu so people know what games are coming."

   Today the site is the app and nothing else. A person who is not
   playing tonight has no reason to open it. The schedule ahead is one of
   the four things that gives them one — somebody who missed tonight can
   see the next one.

       node host/build-schedule.js        -> writes ./schedule.json

   NO NETWORK. Everything is read off disk from ~/gamenight-logs. This
   runs after the slate builders have already talked to ESPN; it is a
   projection of what they wrote, not a second opinion about it.

   ---------------------------------------------------------------------
   THE ONE RULE THAT MATTERS: NEVER LIST A GAME NOBODY WILL HOST.

   A room offered on the site that nothing opens a round in is the worst
   room on the rail — it is there, it is named, and it sits dead all
   night. The standing product rule is "never offer a room nobody hosts",
   and a schedule two weeks long is the easiest possible place to break
   it, because it is the one surface where the temptation is to list
   everything ESPN knows about.

   So this file is STRUCTURALLY incapable of it. It never iterates a
   manifest. For a date it iterates that date's PICK FILE — the durable
   record of intent, one nightId per line — and looks each id UP in the
   manifest. A game that is not picked cannot appear, because nothing in
   the code path ever reaches it. That is deliberate: it is a property of
   the loop, not a filter that a later edit can quietly remove.

   ---------------------------------------------------------------------
   AN UNBUILT NIGHT IS NOT AN EMPTY NIGHT. Three states, never merged:

     built    a pick file exists and names rooms -> those rooms, in order
     off      a pick file exists and is empty    -> a chosen dark night
     unbuilt  no pick file yet                   -> WE DO NOT KNOW YET

   "unbuilt" is the common case past about four days out and it must not
   render as "no games". It means the slate has not been built for that
   date. The day is still emitted, with games:[] and gameCount:null, so
   the menu can say "not announced yet" rather than lying by omission or
   dropping the day out of the two weeks entirely.

   ---------------------------------------------------------------------
   NO TIME-RELATIVE BOOLEANS. There is no `past`, no `isToday`, no
   `startsIn`. This file is read hours or days after it is written and
   every one of those fields would be a stale claim baked into a static
   asset — exactly the "no stale tonight" failure mode. It emits
   `generated` and the tip times, and the client does the comparison
   against its own clock. Every claim in here has to still be true
   tomorrow morning.

   ---------------------------------------------------------------------
   INPUTS, all under ~/gamenight-logs:

     slate-pick-{DATE}.txt      one nightId per line. THE AUTHORITY.
     slate-all-{DATE}.tsv       the manifest, 8 tab-separated columns:
                                league nightId espnEvent home away tip sport path
     slate-marquee-{DATE}.txt   featured games; "<gn> <nightId> [*]",
                                the * is the main event.

   Note the manifest column order: HOME comes before AWAY. Team names are
   taken verbatim from it and never re-derived from the nightId — the
   nightId is an away-home slug and reading names out of it would produce
   "Sf" and "Atl" where the manifest already has "Giants" and "Braves".

   ---------------------------------------------------------------------
   FLAGS
     --days N        window length (default 14)
     --date D        start date YYYY-MM-DD (default: today, PT)
     --out PATH      output file (default: <repo>/schedule.json)
     --logdir PATH   input dir (default: $HOME/gamenight-logs)
     --dry-run       print the JSON to stdout, write nothing
     --strict        exit 3 if any pick is unresolvable
     --quiet         suppress the human summary on stdout
   ================================================================== */

'use strict';

const fs   = require('fs');
const path = require('path');

/* PT is the product's timezone: the audience is US sports fans and the
   founder is in Anaheim. Named zone, never a fixed offset — the window
   can straddle a DST boundary and a hardcoded -7 would silently move
   every tip time by an hour on the far side of it. */
const ZONE = 'America/Los_Angeles';

/* ---- argv ---------------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt  = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const REPO    = path.resolve(__dirname, '..');
const LOGDIR  = opt('logdir', path.join(process.env.HOME || '', 'gamenight-logs'));
const OUT     = path.resolve(opt('out', path.join(REPO, 'schedule.json')));
const DAYS    = Math.max(1, parseInt(opt('days', '14'), 10) || 14);
const DRY     = flag('dry-run');
const STRICT  = flag('strict');
const QUIET   = flag('quiet');

/* ---- diagnostics --------------------------------------------------- */
/* Two severities, both to stderr, both also recorded IN the output file
   under _diagnostics. A warning that only exists in a terminal nobody
   read is not a warning. */
const diag = [];
function bad(date, code, msg) {            // loud: something is wrong
  diag.push({ level: 'error', date, code, message: msg });
  process.stderr.write('!! [' + date + '] ' + msg + '\n');
}
function note(date, code, msg) {           // quieter: worth knowing
  diag.push({ level: 'note', date, code, message: msg });
  process.stderr.write(' ~ [' + date + '] ' + msg + '\n');
}

/* ---- dates --------------------------------------------------------- */
/* "Today" is today IN PT, not today in UTC. At 11pm Anaheim the box is
   already on tomorrow's UTC date, and starting the window there would
   drop tonight out of the schedule entirely. */
function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());                                  // en-CA gives YYYY-MM-DD
}

/* Date arithmetic on the calendar date only. UTC noon is the anchor so
   that adding days can never trip over a DST transition. */
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const WEEKDAY  = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const DAYLABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
function ymdParts(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return { weekday: WEEKDAY.format(t), label: DAYLABEL.format(t) };
}

/* A tip time, rendered the way a person in Anaheim would say it.
   "7:30 PM PT". The zone abbreviation comes out of Intl (PDT/PST) and is
   then normalised to "PT" — nobody says "7:30 PM PDT" out loud, and the
   abbreviation would change mid-season for no reason a reader cares
   about. */
const TIME_PT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: true
});
const DATE_PT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});
const LONG_PT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true
});

function renderTip(iso) {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return {
    iso:      t.toISOString(),
    ptTime:   TIME_PT.format(t).replace(/ /g, ' ') + ' PT',
    ptLong:   LONG_PT.format(t).replace(/ /g, ' ').replace(' at ', ' · ') + ' PT',
    ptDate:   DATE_PT.format(t)
  };
}

/* ---- league labels ------------------------------------------------- */
/* host/leagues.js is the ONE owner of the league table. Read it rather
   than writing a ninth copy. If it is somehow unloadable the schedule
   still builds — it just shows the raw key instead of prose. */
let LEAGUES = {};
try {
  const L = require('./leagues.js');
  LEAGUES = (L && (L.LEAGUES || L.leagues)) || (L && typeof L === 'object' ? L : {});
} catch (e) {
  note('-', 'leagues-unreadable', 'host/leagues.js could not be loaded (' + e.message + ') — using raw league keys');
}
function leagueLabel(key) {
  const row = LEAGUES[key];
  const raw = row && row.label ? String(row.label) : '';
  /* leagues.js labels are written for prose ("the NFL", "the Premier
     League"). A menu row wants the bare noun. Strip the leading article
     and keep both. */
  return { label: raw.replace(/^the\s+/i, '') || key.toUpperCase(), prose: raw || key.toUpperCase() };
}

/* ---- readers ------------------------------------------------------- */
function readLines(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) { return null; }
}

/* The manifest. Keyed by nightId so a pick can be looked UP, which is
   the whole shape of this program. */
function readManifest(date) {
  const file = path.join(LOGDIR, 'slate-all-' + date + '.tsv');
  const lines = readLines(file);
  if (!lines) return null;
  const byId = new Map();
  let dupes = 0, malformed = 0;
  lines.forEach(line => {
    const c = line.split('\t');
    if (c.length < 8) { malformed++; return; }
    const row = {
      league: c[0].trim(), nightId: c[1].trim(), espnEvent: c[2].trim(),
      home: c[3].trim(), away: c[4].trim(), tipISO: c[5].trim(),
      sport: c[6].trim(), path: c[7].trim()
    };
    if (!row.nightId) { malformed++; return; }
    const prior = byId.get(row.nightId);
    if (prior) {
      dupes++;
      /* Byte-identical repeats are noise from a builder that appended
         instead of truncating. Repeats that DISAGREE are a different and
         much worse animal: whichever one wins is a coin flip. */
      if (JSON.stringify(prior) !== JSON.stringify(row)) {
        bad(date, 'manifest-conflict',
          row.nightId + ' appears twice in slate-all-' + date + '.tsv with DIFFERENT values — keeping the first');
      }
      return;
    }
    byId.set(row.nightId, row);
  });
  if (malformed) note(date, 'manifest-malformed', malformed + ' unparseable row(s) in slate-all-' + date + '.tsv (need 8 tab-separated columns)');
  if (dupes)     note(date, 'manifest-duplicate', 'slate-all-' + date + '.tsv has ' + lines.length + ' rows but only ' + byId.size + ' distinct nightIds — ' + dupes + ' duplicate row(s), deduped');
  return byId;
}

/* The marquee. Parsed with the SAME regex build-slate.js uses, so the
   two files cannot disagree about which line is a star. Supports the
   legacy "#N on its own line" header too. */
function readMarquee(date) {
  const lines = readLines(path.join(LOGDIR, 'slate-marquee-' + date + '.txt'));
  const m = new Map();
  if (!lines) return m;
  let legacy = '';
  lines.forEach(line => {
    const lg = line.match(/^#\s*(\d+)$/);
    if (lg) { legacy = lg[1]; return; }
    const hit = line.match(/^(?:(\d+)\s+)?(\S+)\s*(\*)?\s*$/);
    if (hit) m.set(hit[2], { gn: hit[1] || '', star: !!hit[3] });
  });
  if (legacy && m.size && ![...m.values()].some(v => v.gn)) {
    const first = [...m.keys()][0];
    m.set(first, { gn: legacy, star: true });
  }
  return m;
}

/* ---- one day ------------------------------------------------------- */
function buildDay(date) {
  const parts = ymdParts(date);
  const day = { date, weekday: parts.weekday, label: parts.label, status: 'unbuilt', gameCount: null, games: [] };

  const picks = readLines(path.join(LOGDIR, 'slate-pick-' + date + '.txt'));

  /* NO PICK FILE. Not an empty night — an UNBUILT one. Say so, keep the
     day in the window, and do not go looking at the manifest for
     something to show instead. Whatever ESPN lists for 8 Sept, nobody
     has decided to host any of it, so nothing here may name it. */
  if (picks === null) {
    day.status = 'unbuilt';
    day.note   = 'Rooms for this night have not been chosen yet.';
    return day;
  }

  /* A pick file that exists and names nothing is a decision: a dark
     night. Different fact, different word. */
  if (!picks.length) {
    day.status    = 'off';
    day.gameCount = 0;
    day.note      = 'No rooms this night.';
    note(date, 'pick-empty', 'slate-pick-' + date + '.txt exists but is empty — treating as a deliberate dark night');
    return day;
  }

  day.status = 'built';

  const manifest = readManifest(date);
  const marquee  = readMarquee(date);

  if (manifest === null) {
    /* Picked rooms, no manifest at all. Every pick is unresolvable. This
       is the loud case at its worst and the day must show as built-but-
       broken rather than quietly as a dark night. */
    bad(date, 'manifest-missing',
      picks.length + ' room(s) are picked for ' + date + ' but slate-all-' + date + '.tsv does not exist — '
      + 'NO games can be listed for this date. Picked: ' + picks.join(', '));
    day.gameCount = 0;
    day.note      = 'Rooms are picked for this night but their details are not built yet.';
    day.unresolved = picks.slice();
    return day;
  }

  const games = [];
  const unresolved = [];
  const seen = new Set();

  /* THE LOOP. Over PICKS, not over the manifest. */
  picks.forEach(nightId => {
    if (seen.has(nightId)) {
      note(date, 'pick-duplicate', nightId + ' is listed twice in slate-pick-' + date + '.txt — counted once');
      return;
    }
    seen.add(nightId);

    const row = manifest.get(nightId);
    if (!row) {
      /* THE OPEN BUG. A pick naming a nightId the manifest does not have
         is how a Saturday lost 3 of its 4 rooms: the pick file was
         curated from a slate that included a league the manifest was
         never rebuilt to carry, and every consumer downstream silently
         showed a shorter night. This file will not hide it. It is
         reported loudly, it is recorded in the output, and the game is
         NOT listed — because a room whose details do not exist is a room
         nobody can host, and listing it would break the one rule. */
      unresolved.push(nightId);
      bad(date, 'pick-not-in-manifest',
        nightId + ' is picked in slate-pick-' + date + '.txt but is NOT in slate-all-' + date + '.tsv — '
        + 'it CANNOT be listed. Rebuild the manifest for ' + date + ' or drop the pick.');
      return;
    }

    const mq  = marquee.get(nightId) || null;
    const tip = renderTip(row.tipISO);
    if (!tip) {
      note(date, 'bad-tip', nightId + ' has an unparseable tip time "' + row.tipISO + '" — listed without a time');
    } else if (tip.ptDate !== date) {
      /* The night's date and the tip's PT date should agree. If they do
         not, the manifest has put a game on the wrong night — worth
         saying, but the pick file's date stays authoritative for
         grouping, because that is the night the room belongs to. */
      note(date, 'tip-date-drift',
        nightId + ' tips on ' + tip.ptDate + ' PT but is filed under ' + date + ' — grouped under ' + date);
    }

    const lbl = leagueLabel(row.league);
    games.push({
      nightId:      nightId,
      date:         date,                 // the NIGHT, from the pick file
      league:       row.league,
      leagueLabel:  lbl.label,
      leagueProse:  lbl.prose,
      sport:        row.sport,            // the family: baseball, football, soccer
      path:         row.path,             // the ESPN path: baseball/mlb
      espnEvent:    row.espnEvent,
      home:         row.home,             // verbatim from the manifest
      away:         row.away,
      matchup:      row.away + ' at ' + row.home,
      tipISO:       tip ? tip.iso : null,
      tipPT:        tip ? tip.ptTime : null,
      tipPTLong:    tip ? tip.ptLong : null,
      featured:     !!mq,
      mainEvent:    !!(mq && mq.star),
      gameNight:    mq && mq.gn ? mq.gn : null
    });
  });

  /* A star on a room nobody picked is the same disease pointed the other
     way. It is never promoted into the schedule — the pick file is the
     authority and the marquee only decorates it — but it means the two
     files have drifted and somebody should look. */
  marquee.forEach((_v, id) => {
    if (!seen.has(id)) {
      bad(date, 'marquee-not-picked',
        id + ' is featured in slate-marquee-' + date + '.txt but is NOT in slate-pick-' + date + '.txt — not listed');
    }
  });

  /* Sort by tip time; games with no time fall to the end. The pick file
     is the authority on WHICH rooms, not on what order a person reads
     them in — a schedule reads chronologically. */
  games.sort((a, b) => {
    if (!a.tipISO && !b.tipISO) return 0;
    if (!a.tipISO) return 1;
    if (!b.tipISO) return -1;
    if (a.tipISO !== b.tipISO) return a.tipISO < b.tipISO ? -1 : 1;
    return a.nightId < b.nightId ? -1 : 1;
  });

  day.games     = games;
  day.gameCount = games.length;
  if (unresolved.length) day.unresolved = unresolved;

  /* Picked rooms that all failed to resolve. The day is still "built" —
     a decision was made — but it has nothing showable, and that is a
     different sentence from "no rooms tonight". */
  if (!games.length) day.note = 'Rooms are picked for this night but their details are not built yet.';

  return day;
}

/* ---- the window ---------------------------------------------------- */
const START = opt('date', todayPT());
if (!/^\d{4}-\d{2}-\d{2}$/.test(START)) {
  process.stderr.write('!! --date must be YYYY-MM-DD, got "' + START + '"\n');
  process.exit(2);
}

const days = [];
for (let i = 0; i < DAYS; i++) days.push(buildDay(addDays(START, i)));

const now = new Date();
const out = {
  generated:    now.toISOString(),
  generatedPT:  LONG_PT.format(now).replace(/ /g, ' ').replace(' at ', ' · ') + ' PT',
  timezone:     ZONE,
  source:       'host/build-schedule.js',
  window:       { from: START, to: addDays(START, DAYS - 1), days: DAYS },
  counts: {
    days:     days.length,
    built:    days.filter(d => d.status === 'built').length,
    off:      days.filter(d => d.status === 'off').length,
    unbuilt:  days.filter(d => d.status === 'unbuilt').length,
    games:    days.reduce((n, d) => n + d.games.length, 0),
    featured: days.reduce((n, d) => n + d.games.filter(g => g.featured).length, 0),
    unresolvedPicks: days.reduce((n, d) => n + (d.unresolved ? d.unresolved.length : 0), 0)
  },
  /* Underscored because it is not product copy. It ships anyway: a
     warning that lives only in a terminal is a warning nobody reads, and
     a monitor should be able to assert counts.unresolvedPicks === 0
     without re-running the build. */
  _diagnostics: diag,
  days: days
};

const json = JSON.stringify(out, null, 2) + '\n';

if (DRY) {
  process.stdout.write(json);
} else {
  /* Atomic. schedule.json is a served asset; a reader must never get a
     half-written one. */
  const tmp = OUT + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, OUT);
}

/* ---- the human summary --------------------------------------------- */
if (!QUIET) {
  const w = out.window;
  process.stdout.write('\nSCHEDULE  ' + w.from + ' -> ' + w.to + '  (' + w.days + ' days)\n');
  process.stdout.write('  ' + out.counts.built + ' built · ' + out.counts.off + ' off · '
    + out.counts.unbuilt + ' unbuilt · ' + out.counts.games + ' games listed\n\n');
  days.forEach(d => {
    if (d.status === 'unbuilt') {
      process.stdout.write('  ' + d.date + ' ' + d.weekday + '   — not built yet\n');
      return;
    }
    if (d.status === 'off') {
      process.stdout.write('  ' + d.date + ' ' + d.weekday + '   — dark night (no rooms)\n');
      return;
    }
    process.stdout.write('  ' + d.date + ' ' + d.weekday + '   ' + d.games.length + ' room'
      + (d.games.length === 1 ? '' : 's')
      + (d.unresolved ? '   (' + d.unresolved.length + ' PICKED BUT UNLISTABLE)' : '') + '\n');
    d.games.forEach(g => {
      process.stdout.write('      ' + (g.mainEvent ? '*' : (g.featured ? '+' : ' ')) + ' '
        + String(g.tipPT || '--').padStart(11) + '  '
        + String(g.leagueLabel).padEnd(22) + ' ' + g.matchup + '\n');
    });
  });
  const errs = diag.filter(d => d.level === 'error').length;
  process.stdout.write('\n' + (DRY ? 'dry run — nothing written' : 'wrote ' + OUT) + '\n');
  if (errs) process.stdout.write(errs + ' error(s) reported above — the file WAS written and correctly omits them\n');
  process.stdout.write('\n');
}

if (STRICT && out.counts.unresolvedPicks) process.exit(3);
