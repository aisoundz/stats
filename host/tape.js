#!/usr/bin/env node
/* =====================================================================
   THE TAPE — one question a day, from a game that finished.
   ---------------------------------------------------------------------
   The transferable mechanic from the Fliff read, recorded 30 Aug: "a
   reason to open the app when no game is on. We have never had one."
   Every other surface in this product needs a live game. This one needs
   yesterday.

   FOUR OF THE FIVE STEPS ALREADY EXISTED. The 06:20 backtest resolves
   every finished game into ~/gamenight-logs/backtest/{league}.jsonl, and
   each question there carries `t` (the question), `r` (the resolver),
   `st:"answered"` and `a` (the true answer, computed from the real feed).
   What was missing is a picker that publishes ONE of them.

   WRONG ANSWERS COME FROM THE BANK, NOT FROM IMAGINATION. The options are
   the resolver's own `o:` list out of admin.html, with {HOME}/{AWAY}
   substituted. A distractor somebody made up is a different question from
   the one that was graded.

   AND THE ARCHIVE OUTLIVES THE BANK. Baseball went from three rounds to
   nine on 31 Aug, so the archive is full of questions whose resolvers no
   longer exist — mlbRunsBand is in the data and gone from the bank. Any
   question whose options cannot be found, or whose TRUE ANSWER is not
   among them, is skipped. Publishing a question a player cannot get right
   is worse than publishing nothing.

   IT NEVER PAYS POINTS AND NEVER TOUCHES THE BOARD. Every Tape question
   is about a finished game and can be looked up. The reward is the
   STREAK, which counts days PLAYED, not days right.

       node host/tape.js              # today, dry run
       node host/tape.js --apply      # publish tape/{today}
       node host/tape.js --date 2026-09-01 --apply
   ================================================================== */
const fs = require('fs'), path = require('path');
const ARG = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const LOGDIR = path.join(process.env.HOME, 'gamenight-logs');
const BT = path.join(LOGDIR, 'backtest');
const DATE = ARG('date', new Date().toLocaleDateString('en-CA'));
const log = (k, m) => console.log('  ' + String(k).padEnd(7) + ' ' + m);
const die = (m) => { console.error('FATAL: ' + m); process.exit(1); };

/* ---- the bank's option lists, by resolver --------------------------
   Read out of admin.html rather than copied, for the reason every other
   reader in this repo gives: a second copy of the bank is a second bank. */
function optionsByResolver() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const out = {};
  /* Question objects are { t: '...', o: [...], r: 'name', ... } in any
     order, so match a resolver then walk back to its enclosing brace. */
  const re = /r:\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (out[name]) continue;
    let i = m.index, depth = 0;
    while (i > 0 && i > m.index - 1200) { if (src[i] === '}') depth++; if (src[i] === '{') { if (!depth) break; depth--; } i--; }
    const seg = src.slice(i, m.index + 200);
    const o = /o:\s*\[([^\]]*)\]/.exec(seg);
    if (!o) continue;
    const opts = o[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (opts.length >= 2) out[name] = opts;
  }
  return out;
}

(async () => {
  console.log('\n  THE TAPE · ' + DATE + (APPLY ? '' : '   (dry run)') + '\n');
  const OPTS = optionsByResolver();
  log('bank', Object.keys(OPTS).length + ' resolver(s) with an option list');

  let files = [];
  try { files = fs.readdirSync(BT).filter(f => f.endsWith('.jsonl')); } catch (_) {}
  if (!files.length) die('no backtest archive at ' + BT + ' — the 06:20 job has not run');

  /* Yesterday first, then walk back. A game from three weeks ago is still
     a fair question, but "last night" is the one people remember. */
  const rows = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(BT, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch (_) {}
    }
  }
  log('archive', rows.length + ' finished game(s) across ' + files.length + ' league(s)');

  /* ---- what today's rooms are, so the Tape never shadows one -------
     The archive legitimately holds games dated TODAY — ESPN dates by ET,
     so a game that finished late last night lands here. They are finished
     and safe to ask about. But "NYY @ LAA, 1-10" hours before somebody
     plays tonight's NYY @ LAA invites exactly the wrong conclusion, and
     the pool is 3,000 questions deep. Nothing is lost by staying clear. */
  const todaysTeams = new Set();
  try {
    const tsv = fs.readFileSync(path.join(LOGDIR, 'slate-all-' + DATE + '.tsv'), 'utf8');
    for (const line of tsv.split('\n')) {
      const p = line.split('\t');
      if (p.length >= 5) { todaysTeams.add(String(p[3]).toLowerCase()); todaysTeams.add(String(p[4]).toLowerCase()); }
    }
  } catch (_) {}
  if (todaysTeams.size) log('tonight', todaysTeams.size + ' team(s) on tonight\u2019s slate — their games are excluded');

  const cand = [];
  for (const g of rows) {
    /* Yesterday and earlier only. */
    if (String(g.date) >= DATE) continue;
    const hh = String(g.home || '').toLowerCase(), aa = String(g.away || '').toLowerCase();
    if (todaysTeams.has(hh) || todaysTeams.has(aa)) continue;
    for (const q of (g.q || [])) {
      if (q.st !== 'answered') continue;
      const ans = String(q.a == null ? '' : q.a).trim();
      if (!ans) continue;
      const raw = OPTS[q.r];
      if (!raw) continue;                               /* resolver retired */
      const sub = x => String(x)
        .replace(/\{HOME\}/g, g.home || 'the home side')
        .replace(/\{AWAY\}/g, g.away || 'the away side');
      const opts = raw.map(sub);
      /* THE TRUE ANSWER MUST BE ON THE CARD. Otherwise the question is
         unanswerable and every player is wrong, which is worse than no
         question at all. */
      if (opts.indexOf(ans) < 0) continue;
      cand.push({
        /* THE ROUND IS CONTEXT, NOT DECORATION. "Runs this inning, both
           teams — how many?" is meaningless on its own; with "extra
           innings" beside it, it is a question. Questions were written to
           sit under a round header and the Tape has to supply one. */
        tag: q.tag || '',
        date: g.date, league: g.league, sport: g.sport, game: g.name,
        home: g.home, away: g.away, score: (g.awayScore != null && g.homeScore != null)
          ? (g.awayScore + '-' + g.homeScore) : '',
        q: sub(q.t), options: opts, answer: ans, resolver: q.r
      });
    }
  }
  if (!cand.length) die('no question in the archive has a live option list and a matching answer');
  log('pool', cand.length + ' answerable question(s)');

  /* Freshest first, and DETERMINISTIC for the day: the same date must pick
     the same question however many times this runs, or a refresh would
     hand somebody a different question and the streak would mean nothing. */
  cand.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.q.localeCompare(b.q));
  const freshest = cand[0].date;
  const sameDay = cand.filter(c => c.date === freshest);
  let seed = 0; for (const ch of DATE) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = sameDay[seed % sameDay.length];

  /* Options are shuffled with the SAME seed — a fixed order would put the
     true answer in the same slot every day. */
  const shuffled = pick.options.slice();
  let s2 = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s2 = (s2 * 1103515245 + 12345) >>> 0;
    const j = s2 % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const doc = {
    date: DATE, from: pick.date, league: pick.league, sport: pick.sport,
    game: pick.game, score: pick.score, q: pick.q,
    options: shuffled, answer: pick.answer, resolver: pick.resolver,
    builtAt: new Date().toISOString()
  };

  console.log('');
  log('game', pick.game + '  ' + pick.date + (pick.score ? ('  (' + pick.score + ')') : ''));
  log('ask', (pick.tag ? ('[' + pick.tag + '] ') : '') + pick.q);
  shuffled.forEach((o, i) => log('', '   ' + (i + 1) + '. ' + o + (o === pick.answer ? '   <- the answer' : '')));
  log('from', pick.league.toUpperCase() + ' · resolver ' + pick.resolver);

  if (!APPLY) { console.log('\n  dry run — nothing published. Re-run with --apply.\n'); return; }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    || (() => { try { return fs.readFileSync(path.join(process.env.HOME, '.secrets/stats-firebase-admin.json'), 'utf8'); } catch (_) { return ''; } })();
  if (!raw) die('FIREBASE_SERVICE_ACCOUNT is not set and no key file was found.');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  await admin.firestore().doc('tape/' + DATE).set(doc, { merge: true });
  console.log('');
  log('wrote', 'tape/' + DATE);
  console.log('');
  process.exit(0);
})().catch(e => die((e && e.stack) || String(e)));
