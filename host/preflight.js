#!/usr/bin/env node
/* =====================================================================
   THE PRE-GAME PREFLIGHT — the check that grades TONIGHT, not the file.
   ---------------------------------------------------------------------
   2 Sept 2026. Four things hurt a real player that day and ~120 passing
   suites saw none of them:

     · twelve "QA Tester" seats on the founder's live board, one per gate
       run, in the room he was sitting in 90 minutes before first pitch
     · a prediction card that was never written to disk
     · a plan published on 31 August that outranked the correct one, so
       the app pushed "Innings 7-9 is open" during the FOURTH inning and
       ran out of rounds by the 3rd
     · a Friday cron re-scoring a night that finished on 14 August

   He found all four by looking at his phone.

   THE REASON THE GATE COULD NOT: qa/all.js reads index-test.html and asks
   whether the CODE is right. Every failure above lived in DATA and TIMING
   — a stale plan document, a pinned repository variable, a runner holding
   an old plan in memory, real rows in Firestore. None of it is in the
   file, so none of it was watched.

   THE RULE THIS FILE ENFORCES: anything that drives a live night must be
   RE-DERIVED at game time, never trusted because it exists.

   So it does not keep its own table of what a plan should look like —
   that would be a fourth copy of a fact that already has an owner. It
   runs the real builder (host/publish.js --dry-run, the same code that
   writes plans) and compares what publish.js WOULD write tonight against
   what is actually stored. A plan that no longer matches its own builder
   is stale by construction, whatever the reason.

       node host/preflight.js                    # tonight's picked rooms
       node host/preflight.js --date 2026-09-03
       node host/preflight.js --night slate-2026-09-03-colo-gt
       node host/preflight.js --quiet            # only failures

   Exit 0 = every room is fit to host. Exit 1 = at least one is not.
   Meant for cron ~60 minutes before the first game, where a non-zero
   exit is the whole point: it must SHOUT, not log. Nothing watches a
   green workflow.
   ================================================================== */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const ARG = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const QUIET = process.argv.includes('--quiet');
/* --logs points the slate lookup at another directory. It exists so the
   stale-plan check can be sabotage-tested against fabricated slate rows
   WITHOUT writing a fake pick file into gamenight-logs, where the 03:00
   cron would find it and try to host it. A test that has to litter the
   real schedule to run is a test nobody runs twice. */
const LOGS  = ARG('logs', path.join(process.env.HOME, 'gamenight-logs'));

function today(){
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const DATE  = ARG('date', today());
const ONLY  = ARG('night', '');

let fails = 0, warns = 0, checks = 0;
const say  = (s) => { if (!QUIET) console.log(s); };
const ok   = (m) => { checks++; say('  \x1b[32mok\x1b[0m    ' + m); };
const fail = (m) => { checks++; fails++; console.log('  \x1b[31mFAIL\x1b[0m  ' + m); };
const warn = (m) => { checks++; warns++; console.log('  \x1b[33mwarn\x1b[0m  ' + m); };

/* ---- which rooms are we actually hosting? --------------------------
   The pick file governs both the rail and the launcher (see the rail/cron
   note in the project memory), so it is the right question to ask. A game
   that is merely BUILT is not one a person can walk into. */
function pickedRooms(){
  if(ONLY){
    const all = allGames();
    const g = all.find(x => x.nid === ONLY);
    return g ? [g] : [{ nid: ONLY, sport: '', ev: '', home: '', away: '', league: '' }];
  }
  const pf = path.join(LOGS, `slate-pick-${DATE}.txt`);
  if(!fs.existsSync(pf)) return [];
  const want = fs.readFileSync(pf, 'utf8').trim().split('\n').map(s => s.trim().replace(/\s*\*$/, '')).filter(Boolean);
  const all = allGames();
  return want.map(w => all.find(g => g.nid === w) || { nid: w, sport: '', ev: '', home: '', away: '', league: '' });
}
function allGames(){
  const f = path.join(LOGS, `slate-all-${DATE}.tsv`);
  if(!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').map(l => {
    const c = l.split('\t');
    return { league: c[0], nid: c[1], ev: c[2], home: c[3], away: c[4], tip: c[5], sport: c[6], spath: c[7] };
  }).filter(g => g.nid);
}

/* ---- what WOULD publish.js write for this night, right now? --------
   Spawned rather than required: publish.js reads NIGHT_ID into a
   module-scope const at load time, so requiring it once and mutating
   process.env would grade the first night nine times. Running the real
   binary per night is both correct and the thing we actually want to
   assert — that the shipped builder agrees with the stored plan. */
function wouldPublish(g){
  const r = spawnSync('node', [path.join(__dirname, 'publish.js'), '--dry-run'], {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, {
      NIGHT_ID: g.nid, HOME_NICK: g.home || '', AWAY_NICK: g.away || '',
      ESPN_EVENT: g.ev || '', SPORT: g.sport || ''
    })
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/would publish (\d+) rounds/);
  return { n: m ? Number(m[1]) : null, out };
}

/* ---- is a runner up, and did it boot AFTER the plan was written? ----
   run.js reads the plan ONCE at boot (readPlan, before the tick loop). A
   runner started before a plan change holds the old one in memory for its
   whole life, so republishing looks identical to republishing correctly.
   That cost six innings on 2 Sept: the plan was fixed at 18:11 and
   nothing changed until the runner was restarted at 18:37. */
function runnerFor(nid){
  const ps = spawnSync('ps', ['-eo', 'pid,lstart,args', '--no-headers'], { encoding: 'utf8' });
  for(const line of (ps.stdout || '').split('\n')){
    if(!/run\.js/.test(line) || /grep/.test(line)) continue;
    const pid = line.trim().split(/\s+/)[0];
    let env = '';
    try { env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8'); } catch(_) { continue; }
    if(env.split('\0').indexOf('NIGHT_ID=' + nid) < 0) continue;
    let started = null;
    try { started = Number(fs.statSync(`/proc/${pid}`).mtimeMs); } catch(_) {}
    return { pid, started };
  }
  return null;
}

/* ---- --due: run ONCE a day, in the window before the first game ----
   A preflight on a fixed clock would fail every run after the last game
   ended ("already FINAL") and teach the founder to stop reading it —
   the same wolf-crying the Sunday stand-down exists to prevent. So cron
   ticks every 15 minutes and this decides. Due = inside [first tip - 90,
   first tip - 45] and not already run today. Same shape as the tip-off
   jobs, and it asks host/tipoff-when.js rather than keeping a second
   clock of its own. */
function dueNow(rooms){
  try{
    const { dayPlan, ptMinutes, ptDay } = require('./tipoff-when.js');
    const all = allGames();
    const tips = rooms.map(function(r){ var g = all.find(function(x){ return x.nid === r.nid; }); return g && g.tip; }).filter(Boolean);
    if(!tips.length) return { due:false, why:'no tip times in the pick file' };
    const plan = dayPlan(tips, new Date());
    if(plan.firstTipPT == null) return { due:false, why:'no first tip' };
    const now = ptMinutes(new Date());
    const open = plan.firstTipPT - 90, close = plan.firstTipPT - 45;
    const mark = path.join(LOGS, '.preflight-ran-' + ptDay(new Date()));
    if(fs.existsSync(mark)) return { due:false, why:'already ran today' };
    if(now < open || now > close) return { due:false, why:'not in the window [' + open + ',' + close + '] PT, now ' + now };
    try{ fs.writeFileSync(mark, new Date().toISOString()); }catch(_){}
    return { due:true };
  }catch(e){ return { due:false, why:'due-check threw: ' + ((e && e.message) || e) }; }
}

(async () => {
  const rooms = pickedRooms();
  if(process.argv.includes('--due')){
    const d = dueNow(rooms);
    if(!d.due){ if(!QUIET) console.log('preflight not due — ' + d.why); process.exit(0); }
  }
  console.log(`\nPREFLIGHT — ${DATE} · ${rooms.length} room(s) picked${ONLY ? ' (filtered)' : ''}\n`);
  if(!rooms.length){
    console.log('  no pick file for this date — nothing is being hosted.\n');
    process.exit(0);
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw){ console.log('  FATAL: FIREBASE_SERVICE_ACCOUNT is not set — cannot read a single night.\n'); process.exit(1); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  for(const g of rooms){
    console.log(`── ${g.nid}${g.sport ? '  (' + g.sport + ')' : ''}`);
    const nref = db.collection('nights').doc(g.nid);

    /* 1. THE PLAN EXISTS */
    const psnap = await nref.collection('plan').doc('rounds').get();
    if(!psnap.exists){ fail('no plan published — the runner will refuse to invent questions'); console.log(''); continue; }
    const plan = psnap.data() || {};
    const stored = (plan.rounds || []).length;
    const writtenAt = plan.at && plan.at.toDate ? plan.at.toDate() : null;
    ok(`a plan is published — ${stored} rounds, by ${String(plan.by || '?').split('·')[0].trim()}` +
       (writtenAt ? `, written ${writtenAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}` : ''));

    /* 2. THE STORED PLAN STILL MATCHES ITS OWN BUILDER */
    if(g.sport){
      const would = wouldPublish(g);
      if(would.n == null) warn(`could not ask publish.js what it would write (${(would.out.split('\n').pop() || '').slice(0, 70)})`);
      else if(would.n !== stored)
        fail(`STALE PLAN — stored ${stored} rounds, but publish.js would write ${would.n} today. ` +
             `This is the 2 Sept failure exactly: a plan outliving the bank that defines it.`);
      else ok(`the plan still matches its builder (${stored} rounds)`);
    }

    /* 3. A RUNNER, AND ONE THAT HAS SEEN THIS PLAN */
    const r = runnerFor(g.nid);
    if(!r) warn('no runner holds this room yet — start-slate.sh launches one nearer the game');
    else if(writtenAt && r.started && r.started < writtenAt.getTime())
      fail(`the runner (pid ${r.pid}) BOOTED BEFORE THE PLAN WAS WRITTEN — it reads the plan once, ` +
           `at boot, so it is still hosting the old one. Restart it or the republish did nothing.`);
    else ok(`a runner holds the room (pid ${r.pid}) and started after the plan was written`);

    /* 4. NO SYNTHETIC SEATS */
    const seats = await nref.collection('players').get();
    const fake = [];
    seats.forEach(d => { const v = d.data() || {};
      if(/^(QA|Test|Persist|Smoke)\b/i.test(String(v.name || '')) && !(v.pts > 0)) fake.push(v.name); });
    if(fake.length) fail(`${fake.length} synthetic seat(s) on a live board: ${[...new Set(fake)].join(', ')} — a suite wrote to production`);
    else ok(`no synthetic seats (${seats.size} real seat(s))`);

    /* 5. WHAT THE PUSH WILL ACTUALLY SAY, rendered, not described.
          "Innings 7-9 is open" read fine in code and was a lie on a phone. */
    const first = (plan.rounds || [])[0] || {};
    const qn = (first.qs || []).length;
    if(first.name) ok(`round 1 will read: "\u{1F534} ${first.name} is done · ${qn} question${qn === 1 ? '' : 's'} about what just happened."`);
    else warn('round 1 has no name — the push would be headed by a blank');

    /* 6. THE GAME IS REAL, AND HAS NOT ALREADY FINISHED */
    if(g.ev && g.spath){
      try{
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${g.spath}/summary?event=${g.ev}`);
        const j = await res.json();
        const st = ((j.header || {}).competitions || [{}])[0].status || {};
        const state = (st.type || {}).state || '?';
        if(state === 'post') fail(`ESPN says this game is already FINAL — hosting it would re-score a finished night`);
        else ok(`ESPN has the game as "${(st.type || {}).detail || state}"`);
      }catch(e){ warn(`could not reach ESPN for event ${g.ev} — ${(e && e.message) || e}`); }
    } else warn('no ESPN event id on this row — cannot confirm the game is real');

    console.log('');
  }

  const verdict = fails ? '\x1b[31mNO-GO\x1b[0m' : '\x1b[32mGO\x1b[0m';
  console.log(`${verdict}  ${checks} check(s) · ${fails} failed · ${warns} warning(s)\n`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('preflight threw — ' + ((e && e.stack) || e)); process.exit(1); });
