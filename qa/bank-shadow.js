#!/usr/bin/env node
/* =====================================================================
   SHADOW TEST — a sport's bank against real finished games.
   ---------------------------------------------------------------------
   The rule this codebase runs on: a bank does not go near a room until it
   has been resolved against games that already happened. Not the resolvers
   alone — those were validated on 17 Aug — but THIS BANK, these option
   strings, at these periods, because an option list that does not match
   what a resolver returns is a voided question and nobody reports a
   question that simply never had an answer.

   FOUR OUTCOMES, and only two of them are acceptable:
     ANSWERED  a real option came back
     SILENT    null — "I cannot read this". Legitimate and important.
     INVALID   an answer that is NOT one of the options. A bug, always.
     THREW     an exception. A bug, always.

   It also reports the SPREAD: a question that returns the same option in
   every game is a question with one answer, which is not a question.

     node qa/bank-shadow.js <sport> [n games] [dates...]

   Any sport with an entry in TEMPLATES. The feed path and the scoreboard
   come from the sport, so adding a league to TEMPLATES makes it testable
   here without touching this file.
   ================================================================== */
const fs=require('fs'), path=require('path'), vm=require('vm');
const { loadShared } = require(path.join(__dirname,'..','host','run.js'));
/* WHICH BUILD THIS GRADES. Defaults to admin.html — what host/run.js
   actually reads — so running this by hand is unchanged. qa/all.js passes
   `--file admin-test.html` during a gate, so the gate grades what is about
   to ship instead of what already shipped. Before this, SIX admin suites
   hardcoded admin.html and the gate silently graded the OLD banks: a bank
   change could pass a green gate having never once been read by it.

   The flag is STRIPPED before the positional args are read. DATES is
   `slice(4)`, so leaving `--file admin-test.html` in argv would file both
   tokens as probe dates and this suite would go looking for a game on a
   date called "--file". */
const ARGV = (function(){
  const a = process.argv.slice(2), i = a.indexOf('--file');
  if(i >= 0) a.splice(i, a[i + 1] ? 2 : 1);
  return a;
})();
const ADMIN_FILE = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  return (i >= 0 && a[i + 1]) ? a[i + 1] : 'admin.html'; })();
const SPORT = (ARGV[0] || 'baseball').toLowerCase();
const N     = Number(ARGV[1] || 8);
const DATES = ARGV.slice(2);

/* One place that knows a sport's feed path and its default probe dates. */
const LEAGUES = {
  baseball:   { path:'baseball/mlb',    dates:['20260816','20260815','20260814'] },
  football:   { path:'football/nfl',    dates:['20260816','20260815','20260809','20260808'] },
  basketball: { path:'basketball/wnba', dates:['20260816','20260815','20260814'] },
  hockey:     { path:'hockey/nhl',      dates:['20260416','20260415'] },
  soccer:     { path:'soccer/usa.1',    dates:['20260816','20260815'] }
};

function templates(){
  const src=fs.readFileSync(path.join(__dirname,'..',ADMIN_FILE),'utf8');
  const s=src.indexOf('const TEMPLATES = {');
  let d=0,end=-1; const open=src.indexOf('{',s);
  for(let j=open;j<src.length;j++){const c=src[j]; if(c==='{')d++; else if(c==='}'){d--; if(!d){end=j+1;break;}}}
  return vm.runInNewContext(src.slice(s,end)+';TEMPLATES;',{},{timeout:5000});
}

const sub=(v,h,a)=>String(v).replace(/\{HOME\}/g,h).replace(/\{AWAY\}/g,a);

(async()=>{
  const AUTO=loadShared();
  const T=templates()[SPORT];
  if(!T){ console.error(`no ${SPORT} template — known: ` + Object.keys(templates()).join(', ')); process.exit(2); }
  const L=LEAGUES[SPORT];
  if(!L){ console.error(`no feed path for ${SPORT}`); process.exit(2); }
  const probeDates = DATES.length ? DATES : L.dates;

  /* ============ A BLIP IS NOT A BROKEN BANK =========================
     This fetch was bare, so a single connect timeout threw out of the
     whole script and the gate printed `XX bank-shadow.js` with a stack
     trace — which reads as "the question bank is broken" when what
     actually happened is that the box could not reach ESPN for ten
     seconds. It happened on 22 Aug while the same machine was polling the
     feed every twenty seconds for a live match, which is precisely when
     this suite is most likely to run.

     Three attempts with a short backoff. If the feed is genuinely
     unreachable this still FAILS — a suite that cannot run has not passed,
     which is the rule this whole file exists under — but it says which of
     the two things went wrong. The per-game fetch below has always caught
     and carried on; only this one could kill the run. */
  const getJSON = async (url) => {
    let last;
    for(let attempt=1; attempt<=3; attempt++){
      try{ return await (await fetch(url)).json(); }
      catch(e){
        last = e;
        const why = (e && e.cause && e.cause.code) || (e && e.message) || 'unknown';
        console.log(`  net   attempt ${attempt}/3 failed (${why})` + (attempt<3 ? ' — retrying' : ''));
        if(attempt<3) await new Promise(r=>setTimeout(r, attempt*2000));
      }
    }
    console.error(`\n  COULD NOT REACH THE FEED after 3 attempts: ${url}`);
    console.error('  This suite did NOT run. That is a network failure on this machine,');
    console.error('  not a finding about the question bank — but it is still not a pass.');
    throw last;
  };

  /* Finished games, from real scoreboards. */
  const games=[];
  for(const d of probeDates){
    const j=await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${L.path}/scoreboard?dates=${d}`);
    for(const e of (j.events||[])){
      const c=e.competitions[0];
      if(!(c.status.type||{}).completed) continue;
      const H=c.competitors.find(x=>x.homeAway==='home'), A=c.competitors.find(x=>x.homeAway==='away');
      games.push({id:e.id, name:e.shortName, home:H.team.name, away:A.team.name});
      if(games.length>=N) break;
    }
    if(games.length>=N) break;
  }
  if(!games.length){ console.error(`no finished ${SPORT} games on ${probeDates.join(', ')}`); process.exit(2); }
  console.log(`\n  SHADOW — ${SPORT} bank vs ${games.length} finished games\n`);

  const tally={answered:0,silent:0,invalid:0,threw:0};
  const perQ={};   // resolver+round -> {answers:Set, silent, invalid, threw, text}

  for(const g of games){
    let feed;
    try{ feed = await AUTO.fetchFeed(g.id, L.path); }
    catch(e){ console.log(`  FEED  ${g.name} — ${e.message}`); continue; }

    const line=[];
    T.rounds.forEach((rd, i) => {
      /* The same fallback run.js uses: a sport that does not declare
         periods is asking about period index+1. */
      const p = (T.periods && T.periods[i] != null) ? T.periods[i] : (i + 1);
      rd.forEach((q, x) => {
        const opts = q.o.map(o=>sub(o, g.home, g.away));
        const k = `${T.tags[i]}·${q.r}`;
        perQ[k] = perQ[k] || {answers:new Set(), silent:0, invalid:0, threw:0, text:q.t};
        let res=null;
        try{ res = AUTO.resolve(q.r, feed, p, opts); }
        catch(e){ tally.threw++; perQ[k].threw++; line.push('THREW'); return; }
        if(!res || !res.ok || res.answer==null || res.answer===''){
          tally.silent++; perQ[k].silent++; line.push('·'); return;
        }
        if(opts.indexOf(String(res.answer))<0){
          tally.invalid++; perQ[k].invalid++;
          console.log(`  INVALID ${g.name} ${k} -> ${JSON.stringify(res.answer)} not in ${JSON.stringify(opts)}`);
          line.push('BAD'); return;
        }
        tally.answered++; perQ[k].answers.add(String(res.answer)); line.push('✓');
      });
    });
    console.log(`  ${g.name.padEnd(12)} ${line.join('')}`);
  }

  console.log('\n  ── per question ──');
  Object.keys(perQ).forEach(k=>{
    const q=perQ[k];
    const flag = q.invalid||q.threw ? ' ***BUG***'
               : q.answers.size<=1 && q.silent===0 ? '  <- one answer every game'
               : q.silent>=games.length ? '  <- never answered'
               : '';
    console.log(`  ${k.padEnd(28)} answered ${String(q.answers.size).padStart(2)} distinct · silent ${q.silent} · invalid ${q.invalid} · threw ${q.threw}${flag}`);
  });

  const total=tally.answered+tally.silent+tally.invalid+tally.threw;
  console.log(`\n  ${tally.answered} answered / ${tally.silent} correctly silent / ${tally.invalid} INVALID / ${tally.threw} THREW   (of ${total})`);
  const bad = tally.invalid + tally.threw;
  console.log(bad ? '\n  RED — a bank with an invalid answer in it does not ship\n'
                  : '\n  GREEN — every answer the bank produced was one of its own options\n');
  process.exit(bad?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });
