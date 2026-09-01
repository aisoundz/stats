#!/usr/bin/env node
/* =====================================================================
   THE FIXTURES THE RESOLVER SUITES HAVE ALWAYS BEEN MISSING.
   ---------------------------------------------------------------------
   qa/host-resolvers.js and qa/host-overtime.js both open with

       if (!DIR || !fs.existsSync(DIR)) { console.log('no fixtures dir
       — skipping.'); process.exit(0); }

   and exit ZERO. So for as long as this directory has not existed — which
   is all of it — the two suites that check whether 84 resolvers return the
   right answer, and whether every overtime period gets a round, have
   reported success while executing nothing. That is not a gap in coverage,
   it is coverage that reads as green.

   This walks BACK from a date until it finds a game that actually finished
   in each league, and saves its summary. Backwards because "yesterday" is
   wrong for any sport out of season, and a fixture set that only works in
   August is a fixture set that expires.

       node references/multisport/fetch.js            # fill what is missing
       node references/multisport/fetch.js --force    # refetch everything
   ================================================================== */
const fs=require('fs'), path=require('path');
const DIR=__dirname;
const FORCE=process.argv.includes('--force');

/* TWO OF THESE ARE PINNED, AND THAT IS DELIBERATE.
   qa/host-overtime.js does not want "a finished WNBA game" — it wants GAME
   NIGHT 11, the night that ran fully unattended straight through an
   overtime with no round behind it, and it says so in its own comment. A
   fixture set that quietly substitutes a regulation game turns four real
   assertions into vacuous ones. The suite would go green and the exact
   regression it was written for would sail through.
   So: pin the game the suite is about, and for every other league PREFER an
   overtime game, because a regulation feed cannot exercise an overtime
   code path at all. */
const LEAGUES=[
  {key:'wnba', p:'basketball/wnba', pin:'401857150'},   // GN11 — Fever @ Dream, 16 Aug 2026, went to OT
  {key:'nba',  p:'basketball/nba'},
  {key:'mlb',  p:'baseball/mlb'},
  {key:'nfl',  p:'football/nfl'},
  {key:'nhl',  p:'hockey/nhl'},
  {key:'mls',  p:'soccer/usa.1'},
  /* PINNED, and pinned for a property rather than for overtime: college
     football has no two-minute warning, and this is the game that proved
     it (SJSU @ USC, 29 Aug 2026 — 0 warning rows, 14 plays inside the
     final 2:00 of Q2, one of them a USC touchdown at 0:30). Any CFB game
     would show the missing rule; this one also has a scoring play in the
     window, so the resolver has a real answer to get right rather than
     just a "Nobody scored" to fall back on. */
  {key:'cfb',  p:'football/college-football', pin:'401864494'},
];
/* How many periods a completed game has when it did NOT go to overtime. */
const REG={wnba:4, nba:4, mlb:9, nfl:4, nhl:3, mls:2, cfb:4};

const ymd=d=>d.toISOString().slice(0,10).replace(/-/g,'');
async function get(u){
  const r=await fetch(u,{signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

(async()=>{
  for(const L of LEAGUES){
    const out=path.join(DIR, L.key+'.json');
    if(fs.existsSync(out) && !FORCE){ console.log('  keep   '+L.key+'.json'); continue; }
    const save=async(id,label,note)=>{
      const sum=await get(`https://site.api.espn.com/apis/site/v2/sports/${L.p}/summary?event=${id}`);
      fs.writeFileSync(out, JSON.stringify(sum));
      console.log('  saved  '+(L.key+'.json').padEnd(11)+String(label).padEnd(16)+note
                  +'   '+Math.round(fs.statSync(out).size/1024)+'KB');
    };
    if(L.pin){
      try{ await save(L.pin, 'event '+L.pin, '(PINNED — the suite is about this game)'); continue; }
      catch(e){ console.log('  MISS   '+L.key+'.json — pinned event '+L.pin+' would not fetch: '+e.message); continue; }
    }
    /* TWO PASSES. The first hunts for an overtime game and does NOT settle
       for the first finished one it trips over — the old single pass took
       whatever the most recent completed day offered, which for the NHL was
       a regulation game, and the overtime plan check then failed against a
       feed that had no overtime in it. The second pass accepts regulation,
       so a league with no recent overtime still gets a fixture. */
    let fallback=null;
    for(const wantOT of [true,false]){
      if(fallback && !wantOT){
        try{ await save(fallback.e.id, fallback.e.shortName, fallback.d+'  period '+fallback.per+'  (regulation)'); }
        catch(e){ console.log('  MISS   '+L.key+'.json — '+e.message); }
        break;
      }
      let done=false;
      for(let back=1; back<=400 && !done; back++){
        const d=new Date(Date.now()-back*86400000);
        let sb; try{ sb=await get(`https://site.api.espn.com/apis/site/v2/sports/${L.p}/scoreboard?dates=${ymd(d)}`); }catch(_){ continue; }
        for(const e of (sb.events||[])){
          let st; try{ st=e.competitions[0].status; }catch(_){ continue; }
          if(!(st && st.type && st.type.completed===true)) continue;
          const per=Number(st.period||0);
          if(per>REG[L.key]){
            try{ await save(e.id, e.shortName, d.toISOString().slice(0,10)+'  period '+per+'  (OVERTIME)'); done=true; break; }
            catch(_){ }
          }else if(!fallback){ fallback={e, d:d.toISOString().slice(0,10), per}; }
        }
      }
      if(done) break;
      if(wantOT) console.log('  ..     '+L.key+': no overtime game in 400 days, falling back to regulation');
    }
  }
})();
