#!/usr/bin/env node
/* =====================================================================
   THE GAME OF THE NIGHT, EVERY NIGHT.
   ---------------------------------------------------------------------
   Founder, 19 Aug 2026: "I love how we have a game of the night and we
   number it. Please dont stop that — lets pick a main game for everyday,
   obviously a nationally televised game. And we can have multiple game of
   the night in a day, so figure that out so we always have a marquee
   matchup each day with a featured sport."

   A marquee used to mean a FLAGSHIP, and a flagship is a hand-written
   night in admin.html: a config somebody typed and a bank somebody wrote.
   That is right for the one game an email goes out about and impossible to
   do daily — so any day nobody hand-wrote a night simply had no marquee.

   This proposes one, from the day's real slate, using his rule in his
   order: NATIONAL TELEVISION FIRST, then SoCal — because a regional
   east-coast broadcast is a room you cannot watch while you host it.

     node host/marquee.js 2026-08-21              # propose, write nothing
     node host/marquee.js 2026-08-21 --apply      # write the file AND stamp slate/{date}
     node host/marquee.js 2026-08-21 --apply --gn 15
     node host/marquee.js 2026-08-21 --apply --auto   # no-op if a file already exists

   `--auto` is what start-slate.sh --build runs at the end of every morning
   build, so EVERY day gets a Game of the Night without anybody choosing
   one. A hand-written file always wins: --auto leaves it alone.

   IT PROPOSES. IT DOES NOT PICK ROOMS. The pick file decides what is
   hosted, and a marquee that is not in it is a ★ on a room that never
   opens a round — so this refuses to write one that is not picked unless
   the pick file does not exist yet.
   ================================================================== */
const fs = require('fs'), path = require('path');
const ARG = process.argv.slice(2);
const DATE = ARG.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const APPLY = ARG.includes('--apply');
const AUTO  = ARG.includes('--auto');     // leave a hand-written file alone
const QUIET = ARG.includes('--quiet');
const GNARG = (()=>{ const i = ARG.indexOf('--gn'); return i >= 0 ? String(ARG[i+1]||'').replace(/^#/,'') : ''; })();
const LOGDIR = path.join(process.env.HOME, 'gamenight-logs');
const log = (t, m) => console.error(`  ${t.padEnd(8)}${m}`);
const die = m => { console.error('\n  ' + m + '\n'); process.exit(1); };
if(!DATE) die('usage: node host/marquee.js YYYY-MM-DD [--apply] [--gn N]');

/* NATIONAL IS THE FIRST CUT, NOT A TIEBREAKER. If it is on one of these it
   is a candidate before any regional game is looked at. */
const NATIONAL = ['ESPN','ESPN2','ABC','CBS','NBC','FOX','FS1','NFL Net','NFL Network',
                  'ION','Apple TV','USA','USA Net','USA Network','TBS','TNT','MLB Network','Peacock',
                  'Netflix','NBA TV','truTV','ESPNU','CBSSN'];
/* A CHANNEL HE DOES NOT GET IS NOT A NATIONAL GAME. The first run of this
   proposed Dream @ Sparks as the Game of the Night — national, SoCal, 7pm
   PT, and Prime Video only, which is not in the package. "Nationally
   televised" has to mean "on television he has", or the marquee is a game
   the host cannot watch while hosting it. Confirmed available: YouTube TV
   (so every ordinary national channel), Apple TV, Netflix, and SportsNet LA
   in-market. Prime is out. Keep this list honest — it decides the night. */
const UNAVAILABLE = ['Prime Video','Prime'];
function onlyUnavailable(net){
  const P = parts(net);
  if(!P.length) return false;
  return P.every(p => UNAVAILABLE.some(u => p.toLowerCase() === u.toLowerCase()));
}
/* A LOCAL AFFILIATE IN HIS OWN MARKET IS WATCHABLE, and ranking it as
   "regional" got Saints @ Rams — the LA team, on CBS Los Angeles, at 1pm —
   beaten by a preseason game in New England. The whole reason the rule is
   "national first, then SoCal" is watchability, so a channel that reaches
   Anaheim counts even when it is not the network feed. Below true national,
   above nothing. */
const LOCAL_LA = ['KCBS-TV','KCBS','KCAL','KTTV','KABC','KNBC','KCOP','KTLA','FOX 11',
                  'Spectrum SportsNet','Spectrum Sports Net','Spectrum SportsNet LA',
                  'SportsNet LA','CBS LA','KPIX+'];
function isLocalLA(net){
  const P = parts(net).map(x => x.toLowerCase());
  return LOCAL_LA.some(x => P.includes(x.toLowerCase()));
}
/* Then watchability where the host actually is. A "regional" Phillies
   broadcast does not reach Anaheim. */
const SOCAL = ['Sparks','Dodgers','Angels','Padres','Rams','Chargers','LAFC','Galaxy',
               'LA Galaxy','San Diego FC','Lakers','Clippers','Kings','Ducks'];

/* MATCH THE WHOLE CHANNEL, NOT A SUBSTRING OF IT. "NBC Sports BO" contains
   "NBC" and is Boston regional; "CBS LA" contains "CBS" and is the local
   affiliate. A word-boundary search called both of them national and put a
   Sun @ Aces room on a Connecticut broadcast up as a featured game. The
   national channel is the WHOLE name of one of the carriers, or it is not
   the national feed. */
function parts(net){ return String(net||'').split(/\s*·\s*|,\s*/).map(x=>x.trim()).filter(Boolean); }
function isNational(net){
  const P = parts(net).map(x => x.toLowerCase());
  return NATIONAL.some(x => P.includes(x.toLowerCase()));
}
function isSoCal(g){
  const s = `${g.away||''} ${g.home||''} ${g.awayAbbr||''} ${g.homeAbbr||''}`;
  return SOCAL.some(t => s.toLowerCase().includes(t.toLowerCase()));
}
/* Prime time where the host is, because a 10am kickoff is a marquee nobody
   is home for. Scored, never disqualifying. */
function ptHour(iso){
  try{ return Number(new Date(iso).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:false})); }
  catch(_){ return 0; }
}
function score(g){
  let s = 0;
  if(onlyUnavailable(g.net)) return -1;     // cannot be featured at all
  if(isNational(g.net)) s += 100;
  else if(isLocalLA(g.net)) s += 80;       // reaches Anaheim, just not the network feed
  if(isSoCal(g))        s += 40;
  if(/^gn\d/i.test(String(g.nightId||''))) s += 25;   // a hand-written night owns the evening
  const h = ptHour(g.tipISO);
  if(h >= 16 && h <= 20) s += 20;         // 4pm–8pm PT
  else if(h >= 13)       s += 8;
  return s;
}
function why(g){
  const bits = [];
  bits.push(isNational(g.net) ? 'national' : isLocalLA(g.net) ? 'LA local' : 'regional');
  if(isSoCal(g)) bits.push('SoCal');
  /* `flagship` is set by a hand-written night AND by a previous marquee run
     — this file's own stamp. Reading it back and calling every featured game
     "hand-written" was the tool describing its own output as somebody
     else's decision. Only an id shaped like a hand-written night is one. */
  if(g.flagship && /^gn\d/i.test(String(g.nightId||''))) bits.push('hand-written flagship');
  else if(g.marquee) bits.push('already featured');
  const h = ptHour(g.tipISO);
  bits.push(h >= 16 && h <= 20 ? 'prime PT' : (h + ':00 PT'));
  return bits.join(' · ');
}

/* THE NUMBER COUNTS NIGHTS, NOT GAMES. One per calendar day the product
   runs, and every featured game that day carries it — so a Thursday with a
   baseball room and a football room is ONE Game Night with two featured
   games, not two Game Nights. */
/* ---- THE MARQUEE FILE FORMAT --------------------------------------
   ONE NUMBER PER GAME, NOT PER NIGHT. Founder, 19 Aug: "each game of the
   night its own number based on its order of being live... each of the main
   games have a number so we can correspond to it instead of sharing the
   same number each night."

       14 slate-2026-08-20-wsh-tex
       15 slate-2026-08-20-sf-lac *

   The numbers run in TIP ORDER and CONTINUE ACROSS DAYS — #13 was the
   flagship on the 19th, so Thursday's first featured game is #14 and its
   second is #15. The `*` marks the one game that is the day's main event.

   The old format (`#N` on its own line, then bare ids) is still read, so a
   file written before this change keeps working. */
function readMarquee(file){
  const out = { rows: [], legacyGn: '' };
  let txt = '';
  try{ txt = fs.readFileSync(file,'utf8'); }catch(_){ return out; }
  txt.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => {
    const legacy = line.match(/^#\s*(\d+)$/);
    if(legacy){ out.legacyGn = legacy[1]; return; }
    const m = line.match(/^(?:(\d+)\s+)?(\S+)\s*(\*)?\s*$/);
    if(!m) return;
    out.rows.push({ gn: m[1] || '', id: m[2], star: !!m[3] });
  });
  /* A legacy file numbered the whole NIGHT and starred its first line. Map
     it forward rather than losing the choice: the first id keeps the number
     and the star, and the rest are unnumbered until the next write. */
  if(out.legacyGn && out.rows.length && !out.rows.some(r => r.gn)){
    out.rows[0].gn = out.legacyGn;
    out.rows[0].star = true;
  }
  return out;
}

function nextNumber(){
  let max = 0;
  try{
    fs.readdirSync(LOGDIR).filter(f => /^slate-marquee-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).forEach(f => {
      const r = readMarquee(path.join(LOGDIR,f));
      if(r.legacyGn) max = Math.max(max, Number(r.legacyGn));
      r.rows.forEach(x => { if(x.gn) max = Math.max(max, Number(x.gn)); });
    });
  }catch(_){}
  try{
    const adm = fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
    (adm.match(/\bgn(\d+)-\d{4}-\d{2}-\d{2}/g) || []).forEach(x => {
      max = Math.max(max, Number(String(x).match(/\d+/)[0]));
    });
  }catch(_){}
  return max + 1;
}

(async () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    || (()=>{ try{ return fs.readFileSync(path.join(process.env.HOME,'.secrets/stats-firebase-admin.json'),'utf8'); }catch(_){ return ''; } })();
  if(!raw) die('FIREBASE_SERVICE_ACCOUNT is not set and no key file was found.');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  const snap = await db.doc(`slate/${DATE}`).get();
  if(!snap.exists) die(`no slate/${DATE} — build it first (DATE=${DATE} host/start-slate.sh --build)`);
  const d = snap.data() || {};
  /* PROPOSE FROM WHAT EXISTS, not from what is offered — the marquee is a
     CHOICE about the day, and a game left off the rail this morning is
     still a legitimate thing to feature (it just has to be picked too). */
  const all = (Array.isArray(d.built) && d.built.length ? d.built : (d.games || []))
                .filter(g => g && g.nightId);
  if(!all.length) die(`slate/${DATE} lists no games`);

  const MARQF = path.join(LOGDIR, 'slate-marquee-' + DATE + '.txt');
  if(AUTO && fs.existsSync(MARQF)){
    if(!QUIET) log('marquee', `${path.basename(MARQF)} already exists — leaving it alone`);
    /* STILL STAMP THE SLATE. The file is the choice; the slate document is
       where the Control Room and the rail read it, and a rebuild wipes the
       flags off the entries every morning. Skipping this is how a marquee
       that was chosen once quietly stops appearing. */
  }
  const PICKF = path.join(LOGDIR, 'slate-pick-' + DATE + '.txt');
  let PICK = null;
  try{
    if(fs.existsSync(PICKF)){
      PICK = new Set(fs.readFileSync(PICKF,'utf8').split('\n').map(x=>x.trim()).filter(Boolean));
      if(!PICK.size) PICK = null;
    }
  }catch(_){}

  /* ONE PER LEAGUE — that is what "a featured sport" means. The best of
     each, then the best overall is the Game of the Night. */
  /* NEVER STAR A ROOM NOTHING HOSTS. A ★ on a room that never opens a
     round is the worst room on the rail — it is first, it is marked, and it
     sits there all night. So the candidates are the HOSTED ones: the pick
     file when there is one, the flagship always. */
  const hostable = g => !!g.flagship || !PICK || PICK.has(g.nightId);
  const byLeague = new Map();
  all.forEach(g => {
    if(score(g) < 0) return;                // a channel he does not get
    if(!hostable(g)) return;                // nothing would open its rounds
    const k = String(g.league || g.sport || '?').toLowerCase();
    const cur = byLeague.get(k);
    if(!cur || score(g) > score(cur)) byLeague.set(k, g);
  });
  let picked = [...byLeague.values()].sort((a,b) => score(b) - score(a) || String(a.tipISO).localeCompare(String(b.tipISO)));

  /* A HAND-WRITTEN FILE IS A DECISION AND OUTRANKS THE RANKING. */
  let fromFile = false, fileRows = [];
  try{
    if(fs.existsSync(MARQF)){
      const r = readMarquee(MARQF);
      const byId = new Map(all.map(g => [g.nightId, g]));
      const chosen = r.rows.map(x => byId.get(x.id)).filter(Boolean);
      if(chosen.length){ picked = chosen; fromFile = true; fileRows = r.rows; }
    }
  }catch(_){}

  /* ---- NUMBER THEM, IN THE ORDER THEY GO LIVE ----------------------- */
  picked.sort((a,b) => String(a.tipISO).localeCompare(String(b.tipISO)));
  const byIdRow = new Map(fileRows.map(r => [r.id, r]));
  let seq = 0;
  const numbers = new Map();
  picked.forEach(g => {
    const row = byIdRow.get(g.nightId);
    /* A NUMBER IN THE FILE IS A RECORD, NOT AN INSTRUCTION. The note that
       stood here claimed build-slate.js runs AFTER this and overwrites
       whatever the file says. It runs BEFORE — start-slate.sh, lines 127
       and 168 — so a stale number in this file overwrote a correct derived
       one every morning. See the block below.

       The file's number is still honoured for a night that has ALREADY
       BEEN ANNOUNCED, because renumbering something people were told about
       is worse than an off-by-one. For anything else the slate wins. */
    if(row && row.gn && String(row.gn) === String(g.gn || row.gn)){
      numbers.set(g.nightId, String(row.gn)); return;
    }
    if(row && row.gn && g.gn && String(row.gn) !== String(g.gn)){
      log('gn', `${g.nightId}: the file says #${row.gn}, the slate derived #${g.gn} — taking the slate. `
              + `A game added late shifts every number after it, and only the slate is recomputed.`);
    }
    numbers.set(g.nightId, '');            // filled below, after the max is known
  });
  /* ============ THE SLATE OWNS THE NUMBER. THIS FILE MIRRORS IT. ======
     Founder, 22 Aug: "We added a game last minute yesterday. All the games
     should be in order."

     He named the cause exactly. Friday's fourth room — Lynx at Mystics —
     was added after the marquee files were written, so it took #17 in tip
     order and pushed Friday's last room to #19. Saturday's marquee file,
     written on the 20th when the highest known number was 18, still said
     19-22. Saturday then opened with a #19 that Friday had already used.

     The comment that used to sit here called these numbers "advisory only"
     on the grounds that build-slate.js derives them afterwards and
     overwrites whatever this file says. THE ORDER IS THE OTHER WAY ROUND.
     start-slate.sh runs build-slate.js at line 127 and this at line 168,
     and the stamp below writes `gn` into slate/{date}. So these numbers
     did not lose — they won, every morning, silently.

     Two owners of one fact, and the note explaining why it was safe named
     the exact symptom it was causing: "what put a 4:30 game between a 4:00
     and a 5:15 as #19".

     So this file stops inventing numbers. build-slate.js derives them from
     the tip-off order counting on from the previous night — which is the
     only rule that survives a game being added at the last minute, because
     it is recomputed from the series rather than remembered from a file.
     What is read here is what the slate already says. */
  picked.forEach(g => {
    if(!numbers.get(g.nightId)) numbers.set(g.nightId, String(g.gn || ''));
  });

  /* THE STAR IS THE DAY'S MAIN EVENT, and it is a separate question from
     the number. A file's `*` wins; otherwise the highest-scoring game. */
  let starId = (fileRows.find(r => r.star) || {}).id;
  if(!starId || !picked.some(g => g.nightId === starId)){
    starId = picked.slice().sort((a,b) => score(b) - score(a)
             || String(a.tipISO).localeCompare(String(b.tipISO)))[0].nightId;
  }
  if(!picked.length) die(`nothing on ${DATE} can be featured — every candidate is unhosted or on a channel that is not available`);

  console.error(`\n  THE MAIN GAMES · ${DATE}\n`);
  picked.forEach(g => {
    const n = numbers.get(g.nightId);
    const mark = g.nightId === starId ? '★' : ' ';
    /* A FLAGSHIP IS HOSTED BY ITS OWN CRON LINE (cron-start-night.sh) and
       deliberately never enters the pick file or spends MAX_ROOMS, so
       warning about it would be a false alarm every single night. */
    const inPick = !!g.flagship || !PICK || PICK.has(g.nightId);
    console.error(`  ${mark} Game Night #${String(n).padEnd(4)} ${String(g.league||'').toUpperCase().padEnd(5)} `
      + `${(g.away + ' @ ' + g.home).padEnd(40)} ${g.net || '(no tv)'}`);
    console.error(`       ${g.nightId}`);
    console.error(`       ${why(g)}${inPick ? '' : '   !!! NOT IN THE PICK FILE — nothing would host it'}`);
  });
  console.error(`\n  ★ = the day's main event.  Numbers run in tip order and continue across days.`);
  const notRun = picked.filter(g => !g.flagship && PICK && !PICK.has(g.nightId));
  const rest = all.length - picked.length;
  if(rest > 0) console.error(`\n  (${rest} other game(s) built for ${DATE} and not featured)`);

  if(!APPLY){
    console.error('\n  proposal only — add --apply to write it\n');
    return;
  }
  if(notRun.length){
    die(`${notRun.length} featured game(s) are not in slate-pick-${DATE}.txt. A ★ on a room `
      + `nothing hosts is the worst room on the rail. Add them with host/pick-slate.sh, then re-run.`);
  }

  /* Always rewrite: the file is the durable record of BOTH the choice and
     the numbers, and a number that only exists in Firestore is a number the
     next build cannot keep. */
  const out = picked.map(g =>
    `${numbers.get(g.nightId)} ${g.nightId}${g.nightId === starId ? ' *' : ''}`).join('\n') + '\n';
  fs.writeFileSync(MARQF, out);
  log('wrote', `${path.basename(MARQF)}  (${picked.length} main game(s), `
    + `#${numbers.get(picked[0].nightId)}–#${numbers.get(picked[picked.length-1].nightId)})`);

  /* ---- AND STAMP THE SLATE DOCUMENT ---------------------------------
     THE FILE IS THE CHOICE; THE SLATE IS WHERE IT IS READ. The Control
     Room and the player's rail both read slate/{date}, and the 08:10 build
     rewrites those entries from the ESPN probe every morning — so a
     marquee that lives only in a file is a marquee that appears for one
     day and then quietly stops. build-slate.js applies the file when it
     runs; this does it for every other moment, including right now.

     Both lists are stamped. `games` is what a player sees; `built` is what
     the host sees, and a host looking for tonight's main game in the
     Control Room is exactly who asked for this. */
  const stamp = arr => (arr || []).map(g => {
    if(!g || !numbers.has(g.nightId)) return g;
    /* NO `gn` HERE. This stamp is why the file's numbers won: it wrote
       them into slate/{date} after build-slate.js had derived the right
       ones. The marquee owns WHICH GAME IS FEATURED and WHICH IS THE MAIN
       EVENT — the two things only a person can decide. The number is a
       fact about tip order and belongs to the build. */
    return Object.assign({}, g, {
      marquee: true, flagship: true,
      gotn: g.nightId === starId
    });
  });
  const games = stamp(d.games), built = stamp(d.built);
  await db.doc(`slate/${DATE}`).set({
    games, built,
    flagship: (games || []).filter(g => g && g.flagship).map(g => g.nightId),
    marqueeAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  log('slate', `stamped slate/${DATE} — ${picked.length} main game(s) on the rail and in the host list`);
  log('next', `the 08:10 build reads the file — or rebuild now: DATE=${DATE} host/start-slate.sh --build`);
  console.error('');
})().catch(e => { console.error('\n  ERR', e.message, '\n'); process.exit(1); });
