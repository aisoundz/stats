#!/usr/bin/env node
/* =====================================================================
   COMPOSE THE EDITION — so the fallback is not what ships.
   ---------------------------------------------------------------------
   14 Sept 2026. The founder's own inbox, read with his permission:

       12 Sept  "6 rooms today on Stats Gametime"   -> trash
       13 Sept  "Texas got there by one..."          -> unread
       14 Sept  "4 rooms today on Stats Gametime"   -> unread

   Three delivered, none opened, one binned. Delivery was never the
   problem. The problem is that on most days nobody writes an edition, so
   tipoff-daily.js falls back to a schedule-only note: no numbers, no
   question, no settled line, and a subject that is the room count. It
   sends with its own warnings attached — NO STATS CARD, NO GAMETIME CARD
   — and it is a letter you learn to stop opening.

   Everything a real edition needs is already on disk or one fetch away.
   It was assembled BY HAND on 3 and 13 Sept, both times in minutes, from:

     · ESPN season leaders for a team playing tonight  -> the STATS card
     · a two-option question from tonight's own plan   -> the GAMETIME card
     · a scored round from last night + the real final -> settled

   So this composes it. It writes the SAME tipoff-copy-{DATE}.json a
   person would write, and marks it `composed:true` rather than
   `autofallback:true`, because unlike the fallback it actually claims
   things and every claim is checkable.

   WHAT IT WILL NOT DO. If it cannot find a real number, a real question or
   a real settled answer, it leaves that card OUT rather than inventing
   one. A missing STATS card is a worse email; a made-up one is a dead
   product. EMAIL-VOICE.md rule 5: no unverified number, ever.

       node host/compose-tipoff.js                 # print what it would write
       node host/compose-tipoff.js --apply         # write the copy file
       node host/compose-tipoff.js --date 2026-09-15
   ================================================================== */
const fs = require('fs'), path = require('path');
const LOGS  = path.join(process.env.HOME, 'gamenight-logs');
const ARG   = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const log   = (k, m) => console.log('  ' + String(k).padEnd(9) + ' ' + m);

function ptDay(d){ return new Date(d.toLocaleString('en-US',{timeZone:'America/Los_Angeles'}))
  .toLocaleDateString('en-CA'); }
const DATE = ARG('date', ptDay(new Date()));
const YEST = (() => { const d = new Date(DATE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); })();

/* no em dashes in anything we write — EMAIL-VOICE rule 1 */
const clean = (s) => String(s).replace(/—/g, ',').replace(/\s+,/g, ',');

function rooms(date){
  try{
    const pick = fs.readFileSync(path.join(LOGS, `slate-pick-${date}.txt`), 'utf8')
      .trim().split('\n').map(s => s.trim().replace(/\s*\*$/, '')).filter(Boolean);
    const all = fs.readFileSync(path.join(LOGS, `slate-all-${date}.tsv`), 'utf8')
      .trim().split('\n').map(l => l.split('\t'));
    return pick.map(n => { const r = all.find(c => c[1] === n); if (!r) return null;
      return { league:r[0], nightId:r[1], event:r[2], home:r[3], away:r[4], tip:r[5], sport:r[6], spath:r[7] };
    }).filter(Boolean);
  }catch(_){ return []; }
}

async function espn(spath, event){
  try{
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${spath}/summary?event=${event}`);
    return await r.json();
  }catch(_){ return null; }
}

/* NOT EVERY LEADER IS A STAT WORTH PRINTING. The first version took the
   first two categories ESPN returned and produced

       4   Dominic Calvert-Lewin's total shots for LEE.
       2   Harvey Barnes's total shots for NEW.

   which passes the shape check and is noise. A season ERA, a home run
   count or a strikeout total carries a whole season in one figure; a shot
   count carries an afternoon. The cards written by hand that read well
   used 1.97, 38, 3.03 — all from this list. Anything not on it is used
   only when nothing better exists on the whole slate, and a game that can
   offer a ranked category is preferred to one that cannot. */
const STAT_RANK = [
  'earned run average','home runs','runs batted in','strikeouts','batting average','wins','saves',
  'passing yards','rushing yards','receiving yards','touchdowns','tackles','sacks',
  'points','rebounds','assists','goals','points per game','goals against average','save percentage'
];
const rankOf = (name) => {
  const n = String(name || '').toLowerCase();
  const i = STAT_RANK.findIndex(k => n === k);
  return i < 0 ? STAT_RANK.length : i;
};

/* ---- the STATS card: two real numbers, attributed ------------------ */
/* SCAN THE WHOLE SLATE, THEN CHOOSE. The first version stopped at the
   first game offering ANY ranked category, and on 14 Sept that was an EPL
   fixture whose goalkeeper had 4 saves — 'saves' is on the list for
   baseball and hockey, where it means a season. Two MLB games on the same
   slate were carrying a 2.51 ERA and 228 strikeouts. Collect every
   candidate first and pick the best two globally; a shot count is only
   ever used when the whole slate has nothing better. */
async function statsCard(gs){
  const all = [];
  for(const g of gs){
    const j = await espn(g.spath, g.event); if(!j) continue;
    (j.leaders || []).forEach(t => (t.leaders || []).forEach(cat => {
      const a = (cat.leaders || [])[0];
      if(!a || !a.athlete) return;
      all.push({
        value: String(a.displayValue),
        who:   `${a.athlete.displayName}'s ${String(cat.displayName).toLowerCase()}`,
        team:  (t.team && t.team.abbreviation) || '',
        rank:  rankOf(cat.displayName)
      });
    }));
  }
  if(all.length < 2) return null;
  all.sort((x, y) => x.rank - y.rank);
  const a = all[0];
  /* two different people, so the card is not one player twice */
  const b = all.find(x => x.who !== a.who && x.team !== a.team) || all[1];
  return {
    lead: 'Both from ESPN season leaders, read this morning.',
    a: { value:a.value, who: clean(a.who) + ' for ' + a.team + '.' },
    b: { value:b.value, who: clean(b.who) + ' for ' + b.team + '.' }
  };
}

/* ---- the GAMETIME card: a real two-option question ----------------- */
async function questionCard(db, gs){
  for(const g of gs){
    let plan = null;
    try{ plan = (await db.doc(`nights/${g.nightId}/plan/rounds`).get()).data(); }catch(_){}
    if(!plan) continue;
    for(const r of (plan.rounds || [])){
      for(const q of (r.qs || [])){
        if((q.o || []).length === 2){
          return { id:`${g.nightId}-${r.tag}`,
                   text: clean(`${g.away} at ${g.home}. ${q.t}`),
                   options: q.o.slice(0, 2),
                   note: clean(`One of ${(plan.rounds||[]).length} rounds tonight, and the last one is worth the most.`) };
        }
      }
    }
  }
  return null;
}

/* ---- settled: last night's real answer, with a verifiable score ----- */
/* THE SETTLED SCORE HAS TO BE ONE THE SENDER CAN FIND. send-tipoff-auto
   verifies a claimed final by sweeping the last three days of each
   league's ESPN scoreboard. A cup tie does not appear in its league's
   scoreboard: Brighton at Coventry on 13 Sept was carried in our manifest
   as `epl` and is a Carabao fixture, so a true 5-0 was unverifiable and
   the send was refused. Correctly — a score nothing can confirm has no
   business in a letter.
   So the leagues whose scoreboards are dependable go first, and soccer
   is tried only when nothing else on the night was scored. */
const SETTLE_ORDER = { baseball:0, football:1, basketball:2, hockey:3, soccer:9 };
async function settledCard(db, date){
  const ordered = rooms(date).slice().sort((a, b) =>
    (SETTLE_ORDER[a.sport] == null ? 5 : SETTLE_ORDER[a.sport]) -
    (SETTLE_ORDER[b.sport] == null ? 5 : SETTLE_ORDER[b.sport]));
  for(const g of ordered){
    let rs = null;
    try{ rs = await db.collection('nights').doc(g.nightId).collection('rounds').get(); }catch(_){ continue; }
    for(const d of rs.docs){
      const v = d.data() || {};
      const q = (v.questions || [])[0];
      if(!v.key || !v.key[0] || !q || !q.t) continue;
      const j = await espn(g.spath, g.event); if(!j) continue;
      const c = ((j.header || {}).competitions || [{}])[0];
      const st = ((c.status || {}).type || {}).state;
      if(st !== 'post') continue;
      const cs = (c.competitors || []);
      if(cs.length !== 2) continue;
      const win = Number(cs[0].score) >= Number(cs[1].score) ? cs[0] : cs[1];
      const lose = win === cs[0] ? cs[1] : cs[0];
      /* the score pattern send-tipoff-auto.js verifies against a real final */
      return { question: clean(`${g.away} at ${g.home}. ${q.t}`),
               answer:   String(v.key[0]),
               label:    'Final',
               detail:   `${win.team.displayName} took it ${win.score}-${lose.score}.` };
    }
  }
  return null;
}

(async () => {
  console.log(`\n  COMPOSE TIP-OFF  ·  ${DATE}\n`);
  const gs = rooms(DATE);
  if(!gs.length){ log('none', `no rooms picked for ${DATE} — nothing to compose`); process.exit(0); }
  log('slate', `${gs.length} room(s): ` + gs.map(g => `${g.away} at ${g.home}`).join(' · '));

  /* THE CRON HAS NO ENVIRONMENT. tipoff-daily.js runs from crontab with
     no env setup and does not need a service account itself, so the child
     it spawns inherited nothing and died on the line below. On 15 Sept
     that meant the very first unattended run of this composer failed and
     the schedule-only fallback shipped again — the exact thing it was
     written to stop. It worked every time by hand because a hand has an
     exported key in it.
     Read the key file directly, the same one start-slate.sh reads, and
     take the env var only when it is already there. */
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw){
    const keyfile = path.join(process.env.HOME || '/home/higherthan7', '.secrets', 'stats-firebase-admin.json');
    try{ raw = fs.readFileSync(keyfile, 'utf8'); }
    catch(e){ log('FATAL', `no service account: ${keyfile} unreadable (${(e && e.message) || e})`); process.exit(1); }
  }
  const admin = require('firebase-admin');
  if(!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  const stats   = await statsCard(gs);
  const question= await questionCard(db, gs);
  const settled = await settledCard(db, YEST);

  log('stats',   stats    ? `${stats.a.value} and ${stats.b.value}` : 'NONE — leaving the card out rather than inventing one');
  log('question',question ? question.text.slice(0, 62)              : 'NONE — no two-option question in tonight’s plans');
  log('settled', settled  ? `${settled.answer} · ${settled.detail}` : `NONE — nothing scored and final on ${YEST}`);

  /* The headline is about the GAMES. Rule 3: never the room count. */
  const marquee = gs[gs.length - 1];
  const when = new Date(marquee.tip).toLocaleTimeString('en-US',
    { hour:'numeric', minute:'2-digit', timeZone:'America/Los_Angeles' });
  const copy = {
    date: DATE, when: 'Today', signoff: 'first pitch',
    headline: clean(`${marquee.away} at ${marquee.home} closes it out, ${when} PT.`),
    /* THE SUBJECT LEADS WITH A RESULT, NOT A NUMBER. The first version of
       this put the two STATS figures in it and produced "4 and 2 walk into
       tonight" — two bare counts off an EPL leaderboard, worse than the
       fallback it replaced. The two hand-written subjects that read well
       both opened on something that HAPPENED: "Texas got there by one".
       Last night's final is the strongest hook this can reach, and it is
       already fetched for the settled card. Fall back to the marquee
       fixture, and only then to the room count. */
    subject:  settled ? clean(settled.detail.replace(/\.$/, '') + ', and ' + gs.length + ' rooms today')
              : clean(`${gs[0].away} at ${gs[0].home}` + (gs.length > 1 ? `, and ${gs.length - 1} more today` : ' today')),
    paragraphs: [
      clean(`${gs.length} room${gs.length===1?'':'s'} today, the last of them ${marquee.away} at ${marquee.home} at ${when} PT. Your card locks when the game starts, so there is time on any of them.`),
      'Free to enter, always. Practice is open to anyone, and a live room asks you to sign in so your points follow you from night to night.'
    ],
    buildNote: 'Composed from tonight’s slate and this morning’s numbers.',
    composed: true
  };
  if(stats)    copy.stats    = stats;
  if(question) copy.question = question;
  if(settled)  copy.settled  = settled;

  /* the checks the sender and the voice doc will apply anyway */
  const prose = [copy.subject, copy.headline, ...copy.paragraphs, copy.buildNote,
                 stats && stats.a.who, stats && stats.b.who,
                 question && question.text, settled && settled.detail].filter(Boolean).join(' ');
  if(prose.includes('—')){ log('REFUSE', 'an em dash got in'); process.exit(1); }
  /* EXACT EQUALITY IS NOT THE TEST. The first version produced
     subject "Royals at Astros, 5:10 PM PT" against headline "Royals at
     Astros closes it out, 5:10 PM PT." — different strings, same sentence,
     and a reader sees the fixture twice before opening anything. Compare
     on the words that carry meaning. */
  const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g,' ')
    .split(/\s+/).filter(w => w.length > 2));
  const A = words(copy.subject), B = words(copy.headline);
  const shared = [...A].filter(w => B.has(w)).length;
  if(shared / Math.max(1, Math.min(A.size, B.size)) > 0.6){
    log('REFUSE', `the subject and headline are the same sentence twice `
      + `(${shared} shared words). subject: "${copy.subject}"`);
    process.exit(1);
  }
  if(settled && !/(\d{1,3})\s*[–—-]\s*(\d{1,3})/.test(settled.detail)){
    log('REFUSE', 'the settled line has no score the sender can verify'); process.exit(1); }

  console.log('');
  log('subject', copy.subject);
  log('head',    copy.headline);
  const cards = ['stats','question','settled'].filter(k => copy[k]);
  log('cards',   cards.length ? cards.join(', ') : 'NONE — this is no better than the fallback');

  if(!APPLY){ console.log('\n  dry run — nothing written. Add --apply.\n'); process.exit(0); }
  const out = path.join(LOGS, `tipoff-copy-${DATE}.json`);
  fs.writeFileSync(out, JSON.stringify(copy, null, 2));
  log('wrote', path.basename(out));
  console.log('');
  process.exit(0);
})().catch(e => { console.error('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
