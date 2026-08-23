#!/usr/bin/env node
/* =====================================================================
   BACKTEST — run the whole system against real games, with nobody in it.
   ---------------------------------------------------------------------
   Founder, 18 Aug 2026:

     "even though our system is not live we should start testing all the
      games we can to make sure the system is working. So when we do turn
      it on we have data that has been collecting to improve the system…
      the key is that we are collecting all the best statistics we can.
      This is real value as well."

   That is exactly right, and it is cheap. Every finished game in every
   league is a night this product could have hosted. Resolving its bank
   against the real feed tells us three things nothing else can:

     1. DOES IT WORK — how many questions resolved, how many were
        correctly silent, how many produced an answer that was not one of
        the options (a bug, always).
     2. IS IT WORTH ASKING — the spread. A question that returns the same
        answer in ninety games out of ninety is not a question, however
        perfectly it resolves. Three have already died this way.
     3. WHAT ACTUALLY HAPPENS IN THESE GAMES — the distribution of every
        band, which is how the cutoffs stop being guesses.

   NO PLAYERS, NO ROOMS, NO WRITES TO ANY NIGHT. This reads feeds and
   appends to a local archive. It cannot touch a game night even by
   accident: it never opens the firebase-admin module.

     node host/backtest.js --days 7
     node host/backtest.js --days 30 --leagues wnba,mlb
     node host/backtest.js --report
   ================================================================== */
const fs=require('fs'), path=require('path'), vm=require('vm');
const { loadShared } = require('./run.js');

const ARG=(k,d)=>{ const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d; };
const HAS=(k)=>process.argv.includes('--'+k);
const DAYS   = Number(ARG('days',3));
const LEAGUES=(ARG('leagues','wnba,mlb,nfl,nhl,mls')).split(',').map(s=>s.trim()).filter(Boolean);
const OUT    = ARG('out', path.join(process.env.HOME||'/home/higherthan7','gamenight-logs','backtest'));
const REPORT = HAS('report');
const QUIET  = HAS('quiet');

const LEAGUE={
  wnba:{path:'basketball/wnba', sport:'basketball'},
  nba :{path:'basketball/nba',  sport:'basketball'},
  mlb :{path:'baseball/mlb',    sport:'baseball'},
  nfl :{path:'football/nfl',    sport:'football'},
  nhl :{path:'hockey/nhl',      sport:'hockey'},
  mls :{path:'soccer/usa.1',    sport:'soccer'}
};
const log=(k,m)=>{ if(!QUIET) console.log(`  ${String(k).padEnd(8)} ${m}`); };
const die=(m)=>{ console.error('FATAL: '+m); process.exit(1); };

function templates(){
  const src=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
  const i=src.indexOf('const TEMPLATES = {');
  if(i<0) die('could not find TEMPLATES in admin.html');
  let d=0,end=-1; const o=src.indexOf('{',i);
  for(let j=o;j<src.length;j++){const c=src[j]; if(c==='{')d++; else if(c==='}'){d--; if(!d){end=j+1;break;}}}
  return vm.runInNewContext(src.slice(i,end)+';TEMPLATES;',{},{timeout:5000});
}
const sub=(v,h,a)=>String(v).replace(/\{HOME\}/g,h).replace(/\{AWAY\}/g,a);
const ymd=(d)=>d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0');

/* ---- the archive: one JSON line per game, per league ---------------- */
function archivePath(lg){ return path.join(OUT, lg+'.jsonl'); }
function readArchive(lg){
  try{ return fs.readFileSync(archivePath(lg),'utf8').split('\n').filter(Boolean).map(JSON.parse); }
  catch(_){ return []; }
}
function seenIds(lg){ return new Set(readArchive(lg).map(r=>r.event)); }

/* ====================== THE REPORT ================================== */
function report(){
  console.log('\n  BACKTEST ARCHIVE\n');
  /* ============ 'unknowable' IS NOT A BUG, AND CALLING IT ONE COST US
     A NIGHTLY RED THAT MEANT NOTHING. The writer records a fourth state
     with a reason attached:

       {"st":"unknowable","why":"cumulative box stat at a period boundary
        - needs a live half-time snapshot"}

     mlsMoreShots asks who had more shots in the FIRST HALF. Live, at the
     break, the box score IS the first half and the resolver is correct. A
     FINISHED game's summary carries only the whole match, so the first half
     cannot be reconstructed from it at all. The backtest knows this and says
     so; it is the most honest line in the archive.

     The report had no bucket for it, so `else { threw++ }` swept it in with
     exceptions, printed ***BUG*** against a working question, and declared
     the whole run RED — 15 of 3,045. A nightly RED that is always wrong
     trains everybody to stop reading it, which is worse than no report.

     Counted separately now. RED still means what it says: an answer that
     was not one of the options, or a resolver that threw. */
  let grand={games:0,answered:0,silent:0,invalid:0,threw:0,unknowable:0};
  for(const lg of LEAGUES){
    const rows=readArchive(lg);
    if(!rows.length){ console.log(`  ${lg.toUpperCase().padEnd(5)} — nothing archived yet`); continue; }
    const t={answered:0,silent:0,invalid:0,threw:0,unknowable:0};
    const perQ={};
    rows.forEach(r=>{
      (r.q||[]).forEach(q=>{
        const k=r.sport+' · '+q.tag+' · '+q.r;
        perQ[k]=perQ[k]||{answers:{},silent:0,invalid:0,threw:0,unknowable:0,why:'',n:0,text:q.t};
        const p=perQ[k]; p.n++;
        if(q.st==='answered'){ t.answered++; p.answers[q.a]=(p.answers[q.a]||0)+1; }
        else if(q.st==='silent'){ t.silent++; p.silent++; }
        else if(q.st==='invalid'){ t.invalid++; p.invalid++; }
        else if(q.st==='unknowable'){ t.unknowable++; p.unknowable++; if(!p.why) p.why=String(q.why||''); }
        else { t.threw++; p.threw++; }
      });
    });
    const tot=t.answered+t.silent+t.invalid+t.threw+t.unknowable;
    console.log(`\n  ══ ${lg.toUpperCase()} · ${rows.length} games · ${tot} question-resolutions ══`);
    console.log(`     ${t.answered} answered · ${t.silent} correctly silent · ` +
                (t.unknowable ? `${t.unknowable} not knowable from a finished game · ` : '') +
                `${t.invalid} INVALID · ${t.threw} THREW`);
    grand.games+=rows.length; grand.answered+=t.answered; grand.silent+=t.silent;
    grand.invalid+=t.invalid; grand.threw+=t.threw; grand.unknowable+=t.unknowable;

    console.log('\n     question                              n   spread  silent  distribution');
    Object.keys(perQ).sort().forEach(k=>{
      const p=perQ[k];
      const keys=Object.keys(p.answers).sort((a,b)=>p.answers[b]-p.answers[a]);
      const dist=keys.slice(0,4).map(a=>`${a} ${Math.round(100*p.answers[a]/Math.max(1,p.n))}%`).join(' · ');
      const spread=keys.length;
      /* THE TWO VERDICTS THAT MATTER, and they are different failures.
         DEAD = it always answers the same thing: perfect resolver, not a
         question. VOID = it often cannot read the feed at all. */
      let flag='';
      /* SILENCE IS CHECKED FIRST, and the order is the whole point. An
         overtime round on games that did not go to overtime is 17 silences
         and one answer — correct behaviour — and the spread test read that
         as "one answer every game" and called it dead. A question mostly
         cannot be judged on the few times it spoke. */
      if(p.invalid||p.threw) flag='  ***BUG***';
      /* Named, not flagged. This question works live and cannot be
         replayed; saying so every night is the point. */
      else if(p.unknowable && p.unknowable===p.n)
        flag='  <- cannot be replayed: ' + (p.why || 'needs live state');
      else if(p.unknowable) flag='  <- ' + p.unknowable + ' not replayable';
      else if(p.n>=8 && p.silent/p.n>0.5) flag='  <- mostly silent (expected for OT rounds)';
      else if(p.n>=8 && p.silent/p.n>0.25) flag='  <- VOIDS often';
      else if(p.n-p.silent>=8 && spread<=1) flag='  <- DEAD, one answer every time it speaks';
      const nm=k.split(' · ').slice(1).join(' · ');
      console.log(`     ${nm.padEnd(36).slice(0,36)} ${String(p.n).padStart(3)} ${String(spread).padStart(6)} ${String(p.silent).padStart(7)}  ${dist}${flag}`);
    });
  }
  const gt=grand.answered+grand.silent+grand.invalid+grand.threw+grand.unknowable;
  console.log(`\n  ── ${grand.games} games · ${gt} resolutions · ${grand.invalid} invalid · ${grand.threw} threw` +
              (grand.unknowable ? ` · ${grand.unknowable} not replayable` : '') + ' ──');
  console.log(grand.invalid+grand.threw ? '\n  RED — an invalid answer is a bug wherever it appears\n'
                                        : '\n  GREEN — every answer produced was one of its own options\n');
}

/* ====================== THE SWEEP =================================== */
(async()=>{
  if(REPORT) return report();
  fs.mkdirSync(OUT,{recursive:true});
  const AUTO=loadShared();
  const T=templates();
  console.log(`\n  BACKTEST · ${DAYS} day(s) back · ${LEAGUES.join(', ')}\n`);

  for(const lg of LEAGUES){
    const L=LEAGUE[lg]; if(!L){ log('skip',`${lg} — unknown league`); continue; }
    const tpl=T[L.sport];
    if(!tpl){ log('skip',`${lg} — no ${L.sport} template to test with`); continue; }
    const seen=seenIds(lg);
    let added=0, games=0, tally={answered:0,silent:0,invalid:0,threw:0};
    const lines=[];

    for(let d=1; d<=DAYS; d++){
      const day=new Date(Date.now()-d*86400000);
      let board;
      try{ board=await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.path}/scoreboard?dates=${ymd(day)}`)).json(); }
      catch(e){ log('feed',`${lg} ${ymd(day)} — ${e.message}`); continue; }
      for(const e of (board.events||[])){
        const c=e.competitions[0];
        if(!((c.status||{}).type||{}).completed) continue;
        games++;
        if(seen.has(String(e.id))) continue;     // already archived; never re-fetch
        const H=c.competitors.find(x=>x.homeAway==='home');
        const A=c.competitors.find(x=>x.homeAway==='away');
        if(!H||!A) continue;

        let feed;
        try{ feed=await AUTO.fetchFeed(e.id, L.path); }
        catch(err){ log('feed',`${e.shortName} — ${err.message}`); continue; }

        const row={ league:lg, sport:L.sport, event:String(e.id), name:e.shortName,
                    date:String(e.date).slice(0,10),
                    home:H.team.name, away:A.team.name,
                    homeScore:Number(H.score)||0, awayScore:Number(A.score)||0, q:[] };

        /* ============ WHAT A FINISHED GAME CANNOT TELL YOU ==============
           A soccer box score is a set of FINAL totals — `{"name":
           "wonCorners", "displayValue": "7"}` — with no per-half split, and
           soccer has no `plays` array to rebuild one from. In a LIVE match
           that is fine: at half time the cumulative box IS the first half,
           which is exactly why the template asks these only at 1H.

           A backtest has no half time. It reads a finished match, so every
           box-based first-half question here was being keyed off FULL-MATCH
           totals and archived as `answered` — 15 of 15 in the MLS archive.
           Not merely useless: actively dangerous, because band cutoffs get
           calibrated from this archive. Corners over a full match run about
           double a half, so `[3,6,9]` tuned on this data would put nearly
           every real first-half answer in the bottom band and the question
           would be born dead.

           So say what is true: unknowable, not answered. The only way to
           get real first-half box data is to snapshot it live at the break
           — see host/snapshot.js, which is why that exists. */
        const BOX_CUMULATIVE = ['mlsMoreShots','mlsMorePossession','mlsMoreCorners',
                                'mlsMoreFouls','mlsCornersBand','mlsShotsOnTargetBand'];
        const cannotKnow = (resolver, tagIdx) =>
          L.sport === 'soccer' && tagIdx === 0 && BOX_CUMULATIVE.indexOf(resolver) >= 0;

        tpl.rounds.forEach((rd,i)=>{
          const p=(tpl.periods && tpl.periods[i]!=null) ? tpl.periods[i] : (i+1);
          rd.forEach(q=>{
            const opts=q.o.map(o=>sub(o,H.team.name,A.team.name));
            const rec={tag:tpl.tags[i], r:q.r, t:q.t};
            if(cannotKnow(q.r, i)){
              rec.st='unknowable';
              rec.why='cumulative box stat at a period boundary — needs a live half-time snapshot';
              row.q.push(rec); tally.unknowable=(tally.unknowable||0)+1; return;
            }
            let res=null;
            try{ res=AUTO.resolve(q.r, feed, p, opts); }
            catch(err){ rec.st='threw'; rec.why=String(err.message).slice(0,80); row.q.push(rec); tally.threw++; return; }
            if(!res || !res.ok || res.answer==null || res.answer===''){ rec.st='silent'; row.q.push(rec); tally.silent++; return; }
            if(opts.indexOf(String(res.answer))<0){
              rec.st='invalid'; rec.a=String(res.answer); row.q.push(rec); tally.invalid++;
              log('INVALID',`${e.shortName} ${q.r} -> ${res.answer}`); return;
            }
            rec.st='answered'; rec.a=String(res.answer);
            /* The number behind the band. Without it the archive can be read
               but not RETUNED — and a cutoff nobody can retune is a cutoff
               that stays at its first guess forever. */
            if(typeof res.n === 'number') rec.n = res.n;
            row.q.push(rec); tally.answered++;
          });
        });
        lines.push(JSON.stringify(row)); added++;
      }
    }
    if(lines.length) fs.appendFileSync(archivePath(lg), lines.join('\n')+'\n');
    const unk=tally.unknowable||0;
    const tot=tally.answered+tally.silent+tally.invalid+tally.threw+unk;
    log(lg.toUpperCase(), `${games} finished · ${added} newly archived · ${tot} resolutions · `
      + `${tally.answered} answered, ${tally.silent} silent, ${tally.invalid} invalid, ${tally.threw} threw`
      + (unk ? `, ${unk} unknowable from a finished game` : ''));
  }
  console.log('\n  archive: '+OUT);
  console.log('  read it: node host/backtest.js --report\n');
})().catch(e=>die(e.message));
