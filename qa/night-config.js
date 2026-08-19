#!/usr/bin/env node
/* =====================================================================
   THE NIGHT COMES FROM THE DATABASE — FOR EVERY LEAGUE, NOT JUST ONE.
   ---------------------------------------------------------------------
   B39. `GAME`, `roster` and `preds` are the ACTIVE sport's objects.
   hydrateNight() wrote BB_GAME / BB_ROSTER / BB_PREDS / BB_GROUPS. For
   basketball those are the same objects, so it worked, and no test that
   only ever ran basketball could have found it. For every other league
   the published config landed in basketball and the league that was
   actually being played was left on its baked-in night — which is a code
   deploy per game night, the exact thing schedule/{nightId} ended.

   WHY THIS RUNS IN A REAL BROWSER. A static read of the source cannot
   tell you which object a const binding points AT, and that is the whole
   bug. The suite loads the real file at ?sport=<league>, hands hydration
   a real config, and then asks every league what it is holding.

     node qa/night-config.js [index.html]
   ================================================================== */
const {chromium}=require('playwright'); const path=require('path');
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));

let pass=0, fail=0; const bad=[];
function ok(name, cond, detail){
  if(cond){ pass++; }
  else { fail++; bad.push(name+(detail?'  — '+detail:'')); }
}

/* A whole night, in the shape schedule/{nightId} actually stores. */
function cfg(o){
  return Object.assign({
    game:{nightId:'qa-night', espnEvent:'999999', awayName:'Away Test',
          homeName:'Home Test', awayAbbr:'AWY', homeAbbr:'HME'},
    roster:{home:['Home One','Home Two'], away:['Away One','Away Two']},
    preds:[{id:'winner', q:'Who takes it?', label:'Winner', base:100,
            opts:['Away Test','Home Test'], answer:'Home Test'}]
  }, o||{});
}

(async()=>{
  const b=await chromium.launch();

  /* Ask a page, after hydration, what EVERY league is holding. The answer
     is what separates "wrote the right one" from "wrote basketball". */
  async function run(sport, config){
    const p=await b.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.goto('file://'+TARGET+(sport?'?sport='+sport:''));
    await p.waitForFunction(()=>typeof window.hydrateNight==='function', {timeout:15000});
    const out=await p.evaluate((c)=>{
      const snap=()=>{
        const o={};
        Object.keys(window.SPORTS).forEach(k=>{
          const S=window.SPORTS[k];
          o[k]={ nightId:S.game.nightId, away:S.game.awayName, home:S.game.homeName,
                 homeAbbr:S.game.homeAbbr,
                 rosterHome:(S.roster&&S.roster.home||[]).slice(),
                 predIds:(S.preds||[]).map(q=>q.id),
                 groupName0:(S.groups&&S.groups[0]||{}).name,
                 groupNames0:((S.groups&&S.groups[0]||{}).names||[]).slice(),
                 landing:S.landing };
        });
        return o;
      };
      const before=snap();
      const ret=window.hydrateNight(c);
      return {before, after:snap(), ret, active:window.SPORT.key,
              windowGameNight:(window.GAME||{}).nightId};
    }, config);
    await p.close();
    out.errs=errs;
    return out;
  }

  const LEAGUES=['basketball','baseball','football','hockey','soccer'];

  /* ---- 1. every league hydrates ITSELF, and only itself -------------- */
  for(const sp of LEAGUES){
    const r=await run(sp, cfg());
    ok(`night-config.${sp}.accepted`, r.ret===true,
       'hydrateNight returned '+r.ret);
    ok(`night-config.${sp}.is-the-active-sport`, r.active===sp,
       '?sport='+sp+' resolved to '+r.active);
    ok(`night-config.${sp}.game-landed`,
       r.after[sp].nightId==='qa-night' && r.after[sp].home==='Home Test',
       'nightId='+r.after[sp].nightId+' home='+r.after[sp].home);
    ok(`night-config.${sp}.preds-landed`,
       r.after[sp].predIds.length===1 && r.after[sp].predIds[0]==='winner',
       'preds='+JSON.stringify(r.after[sp].predIds));
    ok(`night-config.${sp}.roster-landed`,
       r.after[sp].rosterHome.join('|')==='Home One|Home Two',
       'roster='+JSON.stringify(r.after[sp].rosterHome));
    /* THE ONE THAT WOULD HAVE CAUGHT B39. */
    const leaked=LEAGUES.filter(o=>o!==sp && r.after[o].nightId==='qa-night');
    ok(`night-config.${sp}.no-other-league-touched`, leaked.length===0,
       'also written: '+leaked.join(', '));
    /* groups point INTO the roster arrays, so the pick sheet follows. */
    ok(`night-config.${sp}.groups-follow-the-roster`,
       r.after[sp].groupNames0.join('|')==='Home One|Home Two' &&
       r.after[sp].groupName0==='Home Test',
       'group0='+r.after[sp].groupName0+' names='+JSON.stringify(r.after[sp].groupNames0));
    ok(`night-config.${sp}.window-game-is-the-active-one`,
       r.windowGameNight==='qa-night', 'window.GAME.nightId='+r.windowGameNight);
    ok(`night-config.${sp}.no-page-errors`, r.errs.length===0, r.errs.join(' / '));
  }

  /* ---- 2. the landing line ------------------------------------------ */
  {
    const r=await run('basketball', cfg());
    ok('night-config.landing-rebuilt-from-the-matchup',
       /Away Test @ Home Test/.test(r.after.basketball.landing||''),
       r.after.basketball.landing);
  }
  {
    /* REVERSED 19 Aug, AND THE OLD REASONING IS WORTH KEEPING BECAUSE IT
       WAS RIGHT AT THE TIME. Soccer's landing line used to be a tournament
       window — "MLS v LIGA MX — Aug 4 to Sep 6" — and this check asserted
       that a night config must NOT overwrite it, because rebuilding it from
       the placeholder Leagues Cup fixture would have replaced something
       true with something wrong.

       Then soccer got real rooms. On 19 Aug two live MLS matches carried
       that caption and a chip reading "Leagues Cup", and the founder found
       both. The line was no longer something true being protected; it was a
       tournament nobody was watching, printed under a fixture that had
       nothing to do with it.

       So the assertion flips: soccer rebuilds from the matchup like every
       other sport. The guard that made the old behaviour safe is still
       there and still tested below — a config with no team names cannot
       blank the line. */
    const r=await run('soccer', cfg());
    ok('night-config.soccer-landing-is-the-matchup',
       /Away Test @ Home Test/.test(r.after.soccer.landing||''),
       'before='+r.before.soccer.landing+'  after='+r.after.soccer.landing);
    ok('night-config.soccer-no-longer-advertises-a-tournament-it-is-not-in',
       !/Leagues Cup|LIGA MX/i.test(r.after.soccer.landing||''),
       r.after.soccer.landing);
  }

  /* ---- 3. what must be REFUSED -------------------------------------- */
  {
    const r=await run('baseball', cfg({game:Object.assign(cfg().game,{sport:'basketball'})}));
    ok('night-config.refuses-another-leagues-night', r.ret===false,
       'hydrateNight returned '+r.ret);
    ok('night-config.refusal-changes-nothing',
       r.after.baseball.nightId===r.before.baseball.nightId &&
       r.after.basketball.nightId===r.before.basketball.nightId,
       'a refused config still moved something');
  }
  {
    const r=await run('basketball', cfg({game:Object.assign(cfg().game,{sport:'basketball'})}));
    ok('night-config.accepts-its-own-league-by-name', r.ret===true,
       'a config naming its own sport was refused');
  }
  {
    /* Basketball's sheet names people, so a rosterless basketball night
       is the B26 failure with a network in the middle. Refuse it. */
    const r=await run('basketball', cfg({roster:{home:[],away:[]}}));
    ok('night-config.basketball-refuses-a-rosterless-night', r.ret===false,
       'hydrateNight returned '+r.ret);
  }
  {
    /* Baseball's sheet picks teams and outcomes. Demanding a roster there
       would refuse every valid baseball night — which the old check did. */
    const r=await run('baseball', cfg({roster:{home:[],away:[]}}));
    ok('night-config.baseball-accepts-a-teams-only-night', r.ret===true,
       'hydrateNight returned '+r.ret);
  }
  {
    const r=await run('basketball', cfg({game:{nightId:'x'}}));
    ok('night-config.refuses-a-half-night', r.ret===false,
       'a config with no espnEvent was accepted');
  }
  {
    const r=await run('basketball', cfg({preds:[]}));
    ok('night-config.refuses-an-empty-pick-sheet', r.ret===false,
       'a config with no preds was accepted');
  }

  await b.close();
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });
