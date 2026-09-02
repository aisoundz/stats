/* qa/deep-cuts.js — the Stats tab has something to say about EVERY sport.

   deepCuts() was written for basketball and only basketball: it read
   three-pointers, rebounds, assists, steals, blocks and double-doubles,
   and said "in the WNBA". On any other box score every branch failed and
   it returned an empty list — no error, no log, nothing on screen.

   Measured on a LIVE baseball game before the fix: GS.ok true, 287 plays,
   3 scoring plays, a full 19-row box, deepCuts() -> 0. Five of six leagues
   had no editorial layer at all, and the founder found it by looking:
   "I dont see the stats news and updates."

   Two failures underneath it, both confirmed against real feeds:
     - the box parser read statistics[0] ONLY, so baseball's pitching and
       football's rushing/receiving/defense were dropped
     - it read s.names ONLY, and CFB/NFL/NHL publish s.labels — so college
       football rows arrived carrying a team and an id and nothing else

   This suite drives REAL committed fixtures through the page and asserts
   each sport produces at least one cut. Fixtures, not mocks: a mock of a
   feed I misread is worth nothing, which is the whole reason this bug
   existed. */
const fs=require('fs'), path=require('path'), http=require('http');
const ROOT=path.join(__dirname,'..');
const FILE=(function(){ const a=process.argv.slice(2), i=a.indexOf('--file');
  if(i>=0&&a[i+1]) return a[i+1];
  const pos=a.filter(x=>!x.startsWith('--')&&/\.html?$/i.test(x));
  return pos.length?pos[0]:'index.html'; })();

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m);} };

/* sport family -> the fixture that exercises it */
const CASES=[
  ['basketball','wnba.json'],
  ['baseball',  'mlb.json'],
  ['football',  'cfb.json'],   /* Thursday's league, and the labels-only shape */
  ['football',  'nfl.json'],
  ['hockey',    'nhl.json'],
  /* SOCCER, and it was missing for exactly as long as soccer was broken.
     mls.json has been on disk unused since the fixtures were built, and
     soccer was asserted only by grepping the source for "soccer: cuts" —
     which passed happily while cutsSoccer() could not return a single cut
     for anybody. Its four lookups (totalShots, shotsOnTarget, wonCorners,
     possessionPct) are ESPN's `name` values, and the client's team map
     stored the `label` — "SHOTS", "ON GOAL", "Corner Kicks", "Possession".
     Every lookup was undefined. EPL and MLS had a blank Stats tab from the
     day deep cuts shipped, and nothing here noticed. */
  ['soccer',    'mls.json'],
];

(async()=>{
  const missing=CASES.filter(([,f])=>!fs.existsSync(path.join(ROOT,'references','multisport',f)));
  if(missing.length){
    console.log('NO FIXTURES: '+missing.map(m=>m[1]).join(', ')+' — run: node references/multisport/fetch.js');
    console.log('  (reporting as FAILURE — a check that cannot run has not passed)');
    process.exit(1);
  }

  /* ABSOLUTE OR RELATIVE. qa/all.js hands TARGETABLE suites an absolute
     path positionally; joining that to ROOT produced
     /home/higherthan7/stats/home/higherthan7/stats/index-test.html and the
     suite died on ENOENT inside the gate while passing by hand. Fixed in
     landing-wired.js earlier today and not carried across. */
  const ABS = path.isAbsolute(FILE) ? FILE : path.join(ROOT,FILE);
  const src=fs.readFileSync(ABS,'utf8');

  console.log('--- the table exists and covers every family we host ---');
  for(const fam of ['basketball','baseball','football','hockey','soccer']){
    ok(new RegExp('\\b'+fam+':\\s*cuts',(''),'').test(src)||new RegExp(fam+':\\s*cuts[A-Z]').test(src),
       `CUTS has an entry for ${fam}`);
  }
  ok(/CUTS\[\s*fam\s*\]/.test(src),
     'deepCuts() looks the set up by the CURRENT sport, not a literal');

  console.log('--- the parser reads labels, and every stat group ---');
  ok(/s\.names\s*\|\|\s*s\.labels/.test(src),
     'the box parser accepts s.labels (CFB/NFL/NHL publish no s.names)');
  ok(!/var s=\(g\.statistics\|\|\[\]\)\[0\];/.test(src),
     'the box parser no longer reads statistics[0] only');
  ok(/row\.g\[/.test(src)||/row\.g=/.test(src),
     'stat groups are namespaced (batting H and pitching H are different facts)');

  const {firefox}=require('playwright');
  const srv=http.createServer((q,r)=>{
    const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]).replace(/^\//,''));
    fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();} else {r.writeHead(200);r.end(d);} });
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;
  const b=await firefox.launch();
  const p=await b.newPage({viewport:{width:1100,height:900}});
  await p.goto(`http://127.0.0.1:${port}/${path.basename(ABS)}?fixture=1`,{waitUntil:'load'});
  await p.waitForFunction(()=>window.STATS_READY===true,{timeout:30000}).catch(()=>{});

  console.log('--- every sport produces at least one cut from a REAL feed ---');
  for(const [fam,fixture] of CASES){
    const summary=JSON.parse(fs.readFileSync(path.join(ROOT,'references','multisport',fixture),'utf8'));
    const r=await p.evaluate(({fam,j})=>{
      /* THE APP'S OWN PARSER, not a copy. This block re-implemented it,
         so the suite graded itself: an audit restored the real CFB bug
         (`cols = s.names` only) and this stayed 19/19 GREEN, because the
         harness was still doing it correctly. */
      const box = parsePlayerBox((j.boxscore||{}).players, {});
      GS.box=box;
      /* TEAM stats too, keyed the way the shipped parser keys them — by
         label AND name. Soccer returns ZERO player blocks from this
         endpoint (measured on both EPL and MLS), so its cuts read the team
         table and nothing else; a harness that only built GS.box could
         never have exercised them. */
      try{
        const comp=j.header.competitions[0];
        const byId={};
        ((j.boxscore||{}).teams||[]).forEach(t=>{
          /* THE APP'S OWN WRITER, not a copy of it. This block used to
             re-implement the key logic here, so the suite tested itself:
             it stayed green with the real label-only bug restored. */
          const m={};
          (t.statistics||[]).forEach(s=>{ statPut(m, s); });
          byId[(t.team||{}).id]=m;
        });
        GS.teams=(comp.competitors||[])
          .map(c=>({ab:c.team.abbreviation,nm:c.team.displayName,m:byId[c.team.id]||{}}));
      }catch(_){ GS.teams=[]; }
      /* THROUGH deepCuts(), NOT CUTS[fam] DIRECTLY. The first version of
         this suite called the set directly, so hardcoding the dispatcher
         back to basketball — the exact original bug — produced ZERO
         failures. A suite that tests the parts and skips the wiring is how
         117 suites passed over five features that never ran. */
      const _k=SPORT.key; SPORT.key=fam;
      let out=[]; try{ out=deepCuts()||[]; }catch(e){ SPORT.key=_k; return {err:String(e).slice(0,120)}; }
      SPORT.key=_k;
      return { rows:Object.keys(box).length,
               groups:[...new Set(Object.values(box).flatMap(x=>Object.keys(x.g)))].length,
               n:out.length,
               first: out.length? String(out[0].t).replace(/<[^>]+>/g,'').slice(0,64):'' };
    },{fam,j:summary});
    if(r.err){ ok(false, `${fam} (${fixture}): threw — ${r.err}`); continue; }
    /* SOCCER HAS NO PLAYER BOX. Both EPL and MLS return zero player blocks
       from this endpoint — measured, not assumed — which is why its cuts
       read the team table. Asserting player rows there would be asserting
       something ESPN does not publish, and the honest check is the
       opposite one: that it has none and still produces cuts. */
    if (fam === 'soccer') {
      ok(r.rows === 0, `${fam} (${fixture}): no player box, as expected (${r.rows} row(s))`);
    } else {
      ok(r.rows>0,  `${fam} (${fixture}): the parser produced ${r.rows} player row(s) across ${r.groups} group(s)`);
    }
    ok(r.n>0,     `${fam} (${fixture}): ${r.n} cut(s) — "${r.first}"`);
  }

  await b.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
