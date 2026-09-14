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

/* ---- the STATS card: two real numbers, attributed ------------------ */
async function statsCard(gs){
  for(const g of gs){
    const j = await espn(g.spath, g.event); if(!j) continue;
    const out = [];
    (j.leaders || []).forEach(t => (t.leaders || []).forEach(cat => {
      const a = (cat.leaders || [])[0];
      if(!a || !a.athlete) return;
      out.push({ value:String(a.displayValue), who:`${a.athlete.displayName}'s ${String(cat.displayName).toLowerCase()}`,
                 team:(t.team && t.team.abbreviation) || '' });
    }));
    if(out.length >= 2){
      const a = out[0], b = out.find(x => x.team !== a.team) || out[1];
      return { lead:'Both from ESPN season leaders, read this morning.',
               a:{ value:a.value, who:clean(a.who) + ' for ' + a.team + '.' },
               b:{ value:b.value, who:clean(b.who) + ' for ' + b.team + '.' } };
    }
  }
  return null;
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
async function settledCard(db, date){
  for(const g of rooms(date)){
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

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw){ log('FATAL', 'FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
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
