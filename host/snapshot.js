#!/usr/bin/env node
/* =====================================================================
   THE HALF-TIME SNAPSHOT — the one number you cannot get later.
   ---------------------------------------------------------------------
   A soccer box score is a set of FINAL totals with no per-half split, and
   soccer has no `plays` array to rebuild one from. So "how many corners in
   the first half" is answerable only if somebody wrote the box down AT THE
   BREAK. A finished match has lost it forever.

   host/backtest.js can therefore never calibrate a first-half band for
   corners, shots on target, possession or fouls — it now says `unknowable`
   rather than keying those off full-match totals, which is what it used to
   do (15 of 15 in the MLS archive). This is the other half of that fix: go
   and get the data that does not exist yet.

   It watches today's matches, and the moment one reaches half time it
   writes the box down. No rooms, no players, no Firestore — a JSONL file
   beside the backtest archive. It never loads firebase-admin, so it cannot
   touch a game night even by accident, and that is deliberate.

   Every week this runs is a week of real first-half distributions to set
   band cutoffs from. Every week it does not is a week gone.

       node host/snapshot.js                    # today, MLS, until the last match ends
       node host/snapshot.js --leagues mls,nhl  # any sport with cumulative box stats
       node host/snapshot.js --report           # what has been collected
   ================================================================== */
const fs=require('fs'), path=require('path'), vm=require('vm');

const ARG=(k,d)=>{ const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d; };
const REPORT=process.argv.includes('--report');
const LEAGUES=(ARG('leagues','mls')).split(',').map(s=>s.trim()).filter(Boolean);
const TICK_MS=Number(ARG('tick', 60000));
const OUT=path.join(process.env.HOME,'gamenight-logs','snapshots');

const PATHS={ mls:{path:'soccer/usa.1', sport:'soccer', breakAt:'HALFTIME'},
              nhl:{path:'hockey/nhl',   sport:'hockey', breakAt:'END_PERIOD'} };

const pad=s=>String(s).padEnd(7);
const log=(k,m)=>console.log(`  ${pad(k)} ${m}`);
const file=lg=>path.join(OUT, lg+'.jsonl');

function boxOf(feed){
  const out={};
  const teams=((feed.boxscore||{}).teams)||[];
  teams.forEach(t=>{
    const side=(t.homeAway||((t.team||{}).abbreviation)||'?');
    const st={};
    (t.statistics||[]).forEach(s=>{ if(s && s.name) st[s.name]=s.displayValue; });
    out[side]=st;
  });
  return out;
}

if(REPORT){
  if(!fs.existsSync(OUT)){ console.log('\n  nothing collected yet — run it on a match day.\n'); process.exit(0); }
  console.log('\n  HALF-TIME SNAPSHOTS\n');
  for(const lg of fs.readdirSync(OUT).filter(f=>f.endsWith('.jsonl'))){
    const rows=fs.readFileSync(path.join(OUT,lg),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    console.log('  '+lg.replace('.jsonl','').toUpperCase()+' — '+rows.length+' match(es)');
    /* The distribution is the whole point: band cutoffs come from it. */
    const nums={};
    rows.forEach(r=>Object.values(r.box||{}).forEach(side=>{
      ['wonCorners','shotsOnTarget','totalShots','foulsCommitted','offsides'].forEach(k=>{
        const v=parseFloat(side[k]); if(isFinite(v)){ (nums[k]=nums[k]||[]).push(v); }});
    }));
    Object.keys(nums).forEach(k=>{
      const a=nums[k].sort((x,y)=>x-y);
      const q=p=>a[Math.min(a.length-1,Math.max(0,Math.round(p/100*(a.length-1))))];
      console.log(`     ${k.padEnd(16)} n=${String(a.length).padStart(3)}  p25 ${q(25)}  median ${q(50)}  p75 ${q(75)}  max ${a[a.length-1]}`);
    });
    console.log('');
  }
  process.exit(0);
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const done=new Set();
  for(const lg of LEAGUES){
    if(fs.existsSync(file(lg)))
      fs.readFileSync(file(lg),'utf8').trim().split('\n').filter(Boolean)
        .forEach(l=>{ try{ const r=JSON.parse(l); done.add(r.event+':'+(r.at_end||'HT')); }catch(_){} });
  }
  log('start', `${LEAGUES.join(', ')} · ${today} · already have ${done.size} match(es)`);

  const seenStatus=new Set();
  let alive=true, quiet=0;
  while(alive){
    alive=false;
    for(const lg of LEAGUES){
      const L=PATHS[lg]; if(!L) continue;
      let board;
      try{
        const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.path}/scoreboard?dates=${today}`);
        board=await r.json();
      }catch(e){ log('feed', lg+' — '+e.message); continue; }
      for(const ev of (board.events||[])){
        const c=(ev.competitions||[])[0]; if(!c) continue;
        const st=(c.status||{}).type||{};
        const name=String(st.name||st.description||'').toUpperCase();

        /* A match is still "live" for this loop until it is finished — that
           is what keeps the collector awake through the evening. */
        if(!st.completed) alive=true;

        /* ============ BOTH ENDS, NOT JUST THE BREAK ====================
           With half time AND full time, the second half is arithmetic:
           final minus half, for every cumulative stat in the box. That is
           worth more than doubling the sample. The soccer template says
           outright there is "deliberately NO second-half box question: it
           would need a halftime snapshot nobody has built" — so capturing
           the far end does not merely calibrate the questions that exist,
           it unlocks a half of the match nobody can ask about today.

           A finished match is therefore NOT skipped: it is exactly when
           the full-time box is readable. Each end is remembered separately
           so one is never mistaken for the other. */
        const atBreak = name.indexOf('HALFTIME')>=0 || name.indexOf('HALF_TIME')>=0
                     || name.indexOf('END_OF_PERIOD')>=0 || name.indexOf('END_PERIOD')>=0
                     || name.indexOf('END_OF_HALF')>=0;
        const atEnd   = st.completed === true || name.indexOf('FULL_TIME')>=0
                     || name.indexOf('STATUS_FINAL')>=0;
        const at  = atBreak ? 'HT' : (atEnd ? 'FT' : null);
        const key = String(ev.id)+':'+at;

        if(!at){
          /* SAY WHAT YOU ARE SEEING. This matches on ESPN's status string,
             and if that string is not what I think it is the collector
             gathers nothing and reports nothing — the silent failure this
             repo keeps paying for. Every status it declines is logged once
             per match, so one match day proves the detection works rather
             than a month of empty files revealing it never did. */
          if(!seenStatus.has(ev.id+name)){
            seenStatus.add(ev.id+name);
            log('watch', `${ev.shortName} — ${name}${st.description?' ('+st.description+')':''}`);
          }
          continue;
        }
        if(done.has(key)) continue;

        let feed;
        try{ const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.path}/summary?event=${ev.id}`);
             feed=await r.json(); }
        catch(e){ log('feed', ev.shortName+' — '+e.message); continue; }

        const row={ league:lg, sport:L.sport, event:String(ev.id), name:ev.shortName,
                    date:String(ev.date).slice(0,10), at:new Date().toISOString(),
                    at_end:at, status:name, period:(c.status||{}).period||null,
                    score:(c.competitors||[]).map(x=>({team:(x.team||{}).abbreviation, s:Number(x.score)||0})),
                    box:boxOf(feed) };
        fs.appendFileSync(file(lg), JSON.stringify(row)+'\n');
        done.add(String(ev.id));
        const sides=Object.keys(row.box);
        log('SNAP', `${ev.shortName} at ${name} — box captured (${sides.length} side(s), `
          + `${sides.length?Object.keys(row.box[sides[0]]).length:0} stats)`);
      }
    }
    if(!alive){ quiet++; if(quiet<3){ alive=true; } }   // three quiet passes before believing it
    if(alive) await new Promise(r=>setTimeout(r, TICK_MS));
  }
  log('done', 'no match still in progress — read it with --report');
})().catch(e=>{ console.error('FATAL: '+e.message); process.exit(1); });
