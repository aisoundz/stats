#!/usr/bin/env node
/* =====================================================================
   THE FEED PATH — what the runner asks ESPN for.
   ---------------------------------------------------------------------
   `basketball` is a FAMILY. `basketball/wnba` is a PATH. One picks the
   question bank; the other is the only thing ESPN answers to. They were
   one column in the slate manifest, so every slate room in every sport
   handed the runner a family, and every feed fetch 404'd.

   The failure mode is why this suite exists at all. run.js catches the
   throw, logs `err feed 404`, sleeps 30s and tries again — so the room
   stays published, the lease keeps renewing, and NO ROUND EVER OPENS,
   for four hours, in silence. A room that is up and mute looks exactly
   like a room where nothing has happened yet.

   Static by default so it runs in the gate with no network. `--live`
   additionally asks ESPN, which is the only way to prove a path is real
   rather than merely slash-shaped.

     node qa/feed-path.js
     node qa/feed-path.js --live
   ================================================================== */
const fs=require('fs'), path=require('path');
const R=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const LIVE=process.argv.includes('--live');

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

const build=R('host/build-slate.js');
const start=R('host/start-slate.sh');
const run  =R('host/run.js');

/* ---- 1. every league in the table has a path that is not its family --
   28 Aug 2026: this used to slice the `const PATHS` literal out of
   build-slate.js. There were FOUR league tables in host/ and they had
   drifted — build-slate.js and pick-national.js did not know `epl` while
   backtest.js did, which is why the Premier League was provably gradable
   and could not be given a room. host/leagues.js is the one owner now,
   so this reads the owner. It went RED on the refactor, which is the
   correct behaviour and the reason it is worth having. */
const table=R('host/leagues.js');
const PB=table.slice(table.indexOf('const LEAGUES = {'), table.indexOf('\n};', table.indexOf('const LEAGUES = {')));
const rows=[...PB.matchAll(/(\w+):\s*\{\s*path:\s*'([^']+)'\s*,\s*sport:\s*'([^']+)'/g)]
  .map(m=>({lg:m[1], p:m[2], fam:m[3]}));
ok('feedpath.every-league-declares-both', rows.length>=6, `${rows.length} league(s) parsed`);
/* AND THE CONSUMERS MUST READ THE OWNER, NOT KEEP A COPY. A fifth table
   appearing anywhere in host/ is the disease coming back, and it would be
   invisible to every other check in this file. */
['build-slate.js','backtest.js','marquee.js','pick-national.js','national.js']
  .forEach(f=>{
    ok('feedpath.reads-the-one-owner ('+f+')', /require\(['"]\.\/leagues\.js['"]\)/.test(R('host/'+f)),
       `${f} does not read host/leagues.js — if it holds its own league or national list, they will drift`);
  });
rows.forEach(r=>{
  ok('feedpath.the-path-is-a-path ('+r.lg+')', r.p.includes('/') && r.p.split('/')[0]===r.fam,
     `path=${r.p} family=${r.fam}`);
});

/* ---- 2. the manifest carries the path, not just the family --------- */
const man=build.slice(build.indexOf('if(JSONOUT)'), build.indexOf('THE SLATE DOCUMENT'));
ok('feedpath.the-manifest-carries-the-path', /x\.g\.path/.test(man),
   'build-slate emits no path column, so the launcher has nothing but the family to pass on');

/* ---- 3. the launcher reads it and gives it to the RUNNER ----------- */
const readers=[...start.matchAll(/read -r ([A-Z_ ]+); do/g)].map(m=>m[1].trim().split(/\s+/));
ok('feedpath.the-launcher-reads-the-column', readers.length>0 && readers.every(r=>r.includes('SPATH')),
   readers.map(r=>r.join(',')).join(' | '));
ok('feedpath.the-runner-is-handed-the-path', /SPORT_PATH="\$SPATH"/.test(start),
   'start-slate.sh does not pass SPATH into SPORT_PATH — the runner gets a family');
/* AND NEVER FALLS BACK TO THE FAMILY. A `${SPATH:-$SPORT}` default looks
   defensive and is the opposite: on a manifest built before the path
   column it silently restores the exact 404 this suite exists for. An
   empty path must refuse the room out loud instead. */
ok('feedpath.no-silent-fallback-to-the-family', !/SPORT_PATH="\$\{SPATH:-/.test(start),
   'SPORT_PATH defaults back to the family when the manifest is old — that is the original bug with a default around it');
ok('feedpath.a-pathless-room-is-refused-out-loud', /-z "\$SPATH"/.test(start) && /SKIP \$NIGHT_ID — no feed path/.test(start),
   'a manifest with no feed path must skip the room and say so; starting it produces a room that is up and mute for four hours');
/* …and the BANK is still handed the family, because publish.js keys
   TEMPLATES on it. Fixing one of these by breaking the other is the shape
   of half the incidents in this repo. */
ok('feedpath.the-bank-is-still-handed-the-family', /SPORT="\$SPORT"/.test(start),
   'publish.js keys TEMPLATES on the family; handing it a path finds no bank');

/* ---- 4. and the runner's own default is a path -------------------- */
const def=(run.match(/SPORT\s*=\s*process\.env\.SPORT_PATH\s*\|\|\s*'([^']+)'/)||[])[1];
ok('feedpath.the-runner-default-is-a-path', !!def && def.includes('/'), `default is ${JSON.stringify(def)}`);

(async()=>{
  if(LIVE){
    for(const [p,ev] of [['basketball/wnba','401857164'],['baseball/mlb','401816628'],['football/nfl','401873601']]){
      const fam=p.split('/')[0];
      const hit=async(u)=>{ try{ const r=await fetch('https://site.api.espn.com/apis/site/v2/sports/'+u+'/summary?event='+ev);
        return r.status; }catch(e){ return 0; } };
      const a=await hit(fam), b=await hit(p);
      ok('feedpath.live.the-path-answers ('+p+')', b===200, `HTTP ${b}`);
      ok('feedpath.live.the-family-does-not ('+fam+')', a!==200,
         `the family returned ${a} — if this ever passes, the whole distinction is gone and this suite is lying`);
    }
  }
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed'+(LIVE?'   (live)':'   (static)'));
  process.exit(fail?1:0);
})();
