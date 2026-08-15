/* Feed fixtures. Every browser test runs against these instead of the live
   ESPN endpoint, so the suite is deterministic and works offline. Three
   states, because the app behaves differently in each and all three have
   shipped bugs: before tip, mid-game, and feed-unreachable. */
const NM=['MIN','FG','3PT','FT','OREB','DREB','REB','AST','STL','BLK','TO','PF','+/-','PTS'];
const ath=(n,pts,reb,ast,stl,blk)=>({athlete:{displayName:n},
  stats:['28','7-14','2-5','4-4','1','5',String(reb),String(ast),String(stl),String(blk),'2','3','+6',String(pts)]});

const PRE={
  header:{competitions:[{status:{type:{state:'pre',shortDetail:'8/12 - 8:00 PM EDT'}},competitors:[
    {homeAway:'away',team:{id:'131935',color:'33476D'},score:null,records:[{summary:'13-21'}]},
    {homeAway:'home',team:{id:'3',color:'002b5c'},score:null,records:[{summary:'19-14'}]}]}]},
  boxscore:{teams:[
    {team:{id:'131935',abbreviation:'TOR',displayName:'Toronto Tempo'},statistics:[
      {label:'Streak',displayValue:'L8'},{label:'Points Against',displayValue:'93.7'},
      {label:'Last Ten Games',displayValue:'1-9'},{label:'Points Per Game',displayValue:'87.4'},
      {label:'Field Goal %',displayValue:'45'},{label:'Three Point %',displayValue:'36'},
      {label:'Rebounds Per Game',displayValue:'31.2'},{label:'Assists Per Game',displayValue:'20.2'},
      {label:'Steals Per Game',displayValue:'7.1'},{label:'Total Turnovers Per Game',displayValue:'22.2'}]},
    {team:{id:'3',abbreviation:'DAL',displayName:'Dallas Wings'},statistics:[
      {label:'Streak',displayValue:'L1'},{label:'Points Against',displayValue:'85.7'},
      {label:'Last Ten Games',displayValue:'7-3'},{label:'Points Per Game',displayValue:'89.0'},
      {label:'Field Goal %',displayValue:'43'},{label:'Three Point %',displayValue:'31'},
      {label:'Rebounds Per Game',displayValue:'34.9'},{label:'Assists Per Game',displayValue:'20.6'},
      {label:'Steals Per Game',displayValue:'9.1'},{label:'Total Turnovers Per Game',displayValue:'23.6'}]}]},
  leaders:[
    {team:{abbreviation:'DAL'},leaders:[
      {name:'pointsPerGame',displayName:'Points',leaders:[{displayValue:'19.1',athlete:{displayName:'Arike Ogunbowale'}}]},
      {name:'assistsPerGame',displayName:'Assists',leaders:[{displayValue:'7.5',athlete:{displayName:'Alanna Smith'}}]}]},
    {team:{abbreviation:'TOR'},leaders:[
      {name:'pointsPerGame',displayName:'Points',leaders:[{displayValue:'15.4',athlete:{displayName:'Marina Mabrey'}}]}]}],
  injuries:[
    {team:{abbreviation:'DAL'},injuries:[{status:'Out',athlete:{displayName:'Jessica Shepard'}},
                                          {status:'Day-To-Day',athlete:{displayName:'Azzi Fudd'}}]},
    {team:{abbreviation:'TOR'},injuries:[{status:'Out',athlete:{displayName:'Brittney Sykes'}}]}]
};

const LIVE=JSON.parse(JSON.stringify(PRE));
LIVE.header.competitions[0].status.type={state:'in',shortDetail:'Q3 4:12'};
LIVE.header.competitions[0].competitors[0].score='64';
LIVE.header.competitions[0].competitors[1].score='71';
/* A REAL box score has variety in it — that is the whole point of the Deep
   Cuts engine, and a fixture where every player shot 7-14 tested none of
   it. These lines are shaped like an actual third quarter: one shooter hot
   from deep, one double-double, one guard with a clean assist-to-turnover
   ratio, one player in foul trouble, one carrying her team's scoring. */
const line=o=>({athlete:{displayName:o.n},stats:[
  String(o.min),o.fg,o.tp,o.ft,String(o.oreb||1),String((o.reb||0)-(o.oreb||1)),
  String(o.reb||0),String(o.ast||0),String(o.stl||0),String(o.blk||0),
  String(o.to||0),String(o.pf||0),(o.pm>=0?'+':'')+o.pm,String(o.pts)]});
LIVE.boxscore.teams[0].statistics=[{label:'Field Goal %',displayValue:'41.2'},{label:'Three Point %',displayValue:'30.0'},
  {label:'Rebounds',displayValue:'28'},{label:'Offensive Rebounds',displayValue:'7'},
  {label:'Assists',displayValue:'12'},{label:'Steals',displayValue:'4'},{label:'Blocks',displayValue:'3'},
  {label:'Turnovers',displayValue:'14'},{label:'Fouls',displayValue:'13'},
  {label:'Points in Paint',displayValue:'22'},{label:'Fast Break Points',displayValue:'6'},
  {label:'Largest Lead',displayValue:'4'},{label:'Lead Changes',displayValue:'9'},{label:'Percent Led',displayValue:'22.4'}];
LIVE.boxscore.teams[1].statistics=[{label:'Field Goal %',displayValue:'47.8'},{label:'Three Point %',displayValue:'38.5'},
  {label:'Rebounds',displayValue:'33'},{label:'Offensive Rebounds',displayValue:'11'},
  {label:'Assists',displayValue:'17'},{label:'Steals',displayValue:'8'},{label:'Blocks',displayValue:'6'},
  {label:'Turnovers',displayValue:'9'},{label:'Fouls',displayValue:'11'},
  {label:'Points in Paint',displayValue:'34'},{label:'Fast Break Points',displayValue:'13'},
  {label:'Largest Lead',displayValue:'12'},{label:'Lead Changes',displayValue:'9'},{label:'Percent Led',displayValue:'64.8'}];
LIVE.boxscore.players=[
  {team:{abbreviation:'DAL'},statistics:[{names:NM,athletes:[
    line({n:'Arike Ogunbowale', min:27,fg:'8-10',tp:'2-3',ft:'4-4',reb:5, ast:3,stl:2,blk:0,to:2,pf:2,pm:12,pts:22}),
    line({n:'Alanna Smith', min:29,fg:'5-11',tp:'0-1',ft:'2-4',reb:14,oreb:6,ast:2,stl:1,blk:1,to:3,pf:2,pm:8, pts:12}),
    line({n:'Maddy Siegrist', min:22,fg:'6-9', tp:'0-0',ft:'2-2',reb:9, ast:1,stl:0,blk:1,to:1,pf:5,pm:-2,pts:14}),
    line({n:'Paige Bueckers',min:26,fg:'4-8', tp:'1-2',ft:'0-0',reb:3, ast:8,stl:3,blk:0,to:1,pf:1,pm:6, pts:9}),
    line({n:'Aziaha James',min:19,fg:'6-11',tp:'0-0',ft:'2-3',reb:7, ast:1,stl:0,blk:2,to:2,pf:3,pm:1, pts:14})]}]},
  {team:{abbreviation:'TOR'},statistics:[{names:NM,athletes:[
    line({n:'Marina Mabrey', min:30,fg:'8-14',tp:'5-9',ft:'3-3',reb:4,ast:3,stl:1,blk:0,to:2,pf:2,pm:-4,pts:24}),
    line({n:'Nyara Sabally',     min:27,fg:'6-13',tp:'1-4',ft:'1-2',reb:4,ast:6,stl:2,blk:0,to:4,pf:3,pm:-6,pts:14}),
    line({n:'Kia Nurse',min:21,fg:'4-9', tp:'2-4',ft:'1-1',reb:3,ast:2,stl:0,blk:0,to:1,pf:2,pm:-3,pts:11}),
    line({n:'Aneesah Morrow',   min:18,fg:'3-8', tp:'1-3',ft:'1-2',reb:2,ast:1,stl:1,blk:0,to:3,pf:4,pm:-8,pts:8}),
    line({n:'Isabelle Harrison', min:20,fg:'3-7', tp:'0-0',ft:'1-2',reb:9,oreb:4,ast:1,stl:0,blk:3,to:2,pf:3,pm:-5,pts:7})]}]}];

/* A realistic play sequence, free throw deliberately included — a made
   free throw is not a "bucket" and once resolved a question wrongly. */
const PLAYS=[
  {sequenceNumber:1,scoringPlay:true,scoreValue:2,team:{id:'3'},text:'Alanna Smith makes 2-foot layup',awayScore:0,homeScore:2},
  {sequenceNumber:2,scoringPlay:true,scoreValue:3,team:{id:'131935'},text:'Marina Mabrey makes 26-foot three point jumper',awayScore:3,homeScore:2},
  {sequenceNumber:3,scoringPlay:true,scoreValue:1,team:{id:'3'},text:'Arike Ogunbowale makes free throw 1 of 2',awayScore:3,homeScore:3},
  {sequenceNumber:4,scoringPlay:true,scoreValue:3,team:{id:'3'},text:'Arike Ogunbowale makes 25-foot three point jumper',awayScore:3,homeScore:6}
];
/* FINAL. The state the prediction sheet now settles itself from. It exists
   because "score your predictions" — a form asking a human to retype a box
   score the app already has — was the worst screen in the product, and the
   only way to prove it is gone is to run the end of a game against a real
   post-game feed. Two players are deliberately TIED on blocks so the grader
   is forced to prove it pays both of them. */
const POST=JSON.parse(JSON.stringify(LIVE));
POST.header.competitions[0].status.type={state:'post',shortDetail:'Final'};
POST.header.competitions[0].competitors[0].score='88';   // NY, away
POST.header.competitions[0].competitors[1].score='95';   // IND, home
POST.boxscore.players=[
  {team:{abbreviation:'DAL'},statistics:[{names:NM,athletes:[
    line({n:'Arike Ogunbowale',   min:34,fg:'11-19',tp:'4-8',ft:'5-5',reb:4, ast:5,stl:2,blk:0,to:3,pf:2,pm:11,pts:31}),
    line({n:'Alanna Smith',     min:33,fg:'8-14', tp:'0-1',ft:'4-6',reb:16,oreb:6,ast:3,stl:1,blk:3,to:3,pf:3,pm:9, pts:20}),
    line({n:'Maddy Siegrist',        min:27,fg:'7-11', tp:'2-4',ft:'2-2',reb:9, ast:2,stl:1,blk:1,to:1,pf:5,pm:4, pts:18}),
    line({n:'Paige Bueckers',     min:29,fg:'5-10', tp:'1-3',ft:'0-0',reb:3, ast:11,stl:4,blk:0,to:2,pf:1,pm:7,pts:11}),
    line({n:'Aziaha James', min:22,fg:'6-12', tp:'3-6',ft:'0-0',reb:8, ast:1,stl:0,blk:2,to:2,pf:3,pm:2, pts:15})]}]},
  {team:{abbreviation:'TOR'},statistics:[{names:NM,athletes:[
    line({n:'Marina Mabrey',  min:36,fg:'9-20',tp:'6-12',ft:'4-4',reb:5,ast:7,stl:1,blk:0,to:3,pf:2,pm:-6,pts:28}),
    line({n:'Nyara Sabally',  min:35,fg:'8-18',tp:'1-5', ft:'5-6',reb:11,oreb:2,ast:4,stl:2,blk:1,to:4,pf:3,pm:-4,pts:22}),
    line({n:'Kia Nurse',  min:24,fg:'5-11',tp:'3-7', ft:'1-1',reb:3,ast:3,stl:0,blk:0,to:1,pf:2,pm:-9,pts:14}),
    line({n:'Aneesah Morrow',    min:21,fg:'4-9', tp:'2-5', ft:'1-2',reb:4,ast:1,stl:1,blk:0,to:2,pf:4,pm:-11,pts:11}),
    /* tied on blocks with Alanna Smith, on purpose */
    line({n:'Isabelle Harrison',    min:28,fg:'5-10',tp:'0-1', ft:'3-4',reb:12,oreb:3,ast:2,stl:0,blk:3,to:2,pf:3,pm:-7,pts:13})]}]}];
/* The Feed is built from plays[], so the fixtures have to carry them or the
   endless scroll tests run against an empty game. LIVE gets the short hand-
   written sequence (the free throw in it is load-bearing — a made free throw
   is not a "bucket" and once resolved a question wrongly). POST gets a long
   generated one, because a feed is only a feed at length: it has to prove it
   interleaves deep cuts, spots lead changes, and caps its own render. */
// LIVE gets a real quarter's worth of play-by-play, assigned below once
// LONG exists — four hand-written plays is not enough for the engine to ask
// anything about "earlier in the quarter", which is the whole point of it.
const LONG=[]; {
  const cast=[['3','DAL','Arike Ogunbowale'],['3','DAL','Alanna Smith'],['3','DAL','Maddy Siegrist'],
              ['131935','TOR','Marina Mabrey'],['131935','TOR','Nyara Sabally'],['131935','TOR','Isabelle Harrison']];
  let a=0,h=0;
  for(let i=1;i<=140;i++){
    const c=cast[i%cast.length], v=[2,2,3,1,2,3][i%6], home=c[0]==='3';
    if(home) h+=v; else a+=v;
    LONG.push({id:'x'+i,sequenceNumber:i,scoringPlay:true,scoreValue:v,team:{id:c[0]},
      text:c[2]+(v===1?' makes free throw 1 of 2':v===3?' makes 25-foot three point jumper':' makes 8-foot jumper'),
      awayScore:a,homeScore:h,period:{number:Math.min(4,1+Math.floor(i/35))},
      clock:{displayValue:(9-(i%10))+':0'+(i%6)}});
    if(i%9===0) LONG.push({id:'m'+i,sequenceNumber:i+0.5,scoringPlay:false,team:{id:c[0]},
      text:c[2]+' misses 18-foot jumper',awayScore:a,homeScore:h,period:{number:Math.min(4,1+Math.floor(i/35))}});
  }
}
/* A REAL GAME ENDS ON A RUN more often than it ends on alternating
   buckets, and the synthetic sequence above never produces one — which
   meant the takeover engine had nothing to fire on and its test passed
   vacuously. Twelve unanswered to close it out. */
{
  var last=LONG[LONG.length-1], a=last.awayScore, h=last.homeScore, n=LONG.length;
  [[2,'Arike Ogunbowale makes 8-foot jumper'],[3,'Aziaha James makes 25-foot three point jumper'],
   [2,'Alanna Smith makes 2-foot layup'],[3,'Arike Ogunbowale makes 25-foot three point jumper'],
   [2,'Maddy Siegrist makes 8-foot jumper']].forEach(function(r,i){
    h+=r[0];
    LONG.push({id:'r'+i,sequenceNumber:n+i+1,scoringPlay:true,scoreValue:r[0],team:{id:'3'},
      text:r[1],awayScore:a,homeScore:h,period:{number:4},clock:{displayValue:'1:0'+i}});
  });
}
POST.plays=LONG;

/* ==================================================================
   THE ARENA'S DATA, IN THE FIXTURES

   Four things arrive in the real summary payload and were never in these
   fixtures, so four Arena blocks could not be tested: shot coordinates,
   per-play win probability, the game info (crowd, venue, crew) and the
   betting line. All four were verified against the live Aug 11 payload
   before being modelled here — 277 of 378 real plays carried a usable
   coordinate, and 378 win-probability readings existed for 378 plays.

   ESPN sends -214748364 for "no coordinate" — an int32 minimum wearing a
   number's clothes — so a share of the fixture plays carry that value on
   purpose. A shot chart that has never been handed a poisoned coordinate
   has not been tested.
   ================================================================== */
{
  var seed=7;
  var rnd=function(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  LONG.forEach(function(pl,i){
    var isShot = /makes|misses/.test(pl.text||'') && !/free throw/.test(pl.text||'');
    pl.shootingPlay = isShot;
    if(!isShot){ return; }
    if(i%9===3){ pl.coordinate={x:-214748340,y:-214748365}; return; }   // the poison
    var three=/three/.test(pl.text||'');
    pl.coordinate = three
      ? { x: Math.round(rnd()*50), y: Math.round(14+rnd()*15) }
      : { x: Math.round(14+rnd()*22), y: Math.round(rnd()*12) };
  });
  // every fourth make is assisted, so the assist network has something real
  LONG.forEach(function(pl,i){
    if(i%4===0 && /makes/.test(pl.text||'') && !/free throw/.test(pl.text||'') && !/assists/.test(pl.text||''))
      pl.text = pl.text + ' (Jessica Shepard assists)';
    else if(i%7===0 && /makes/.test(pl.text||'') && !/assists/.test(pl.text||''))
      pl.text = pl.text + ' (Marina Mabrey assists)';
  });
}
function wpFor(plays){
  /* A believable curve rather than a straight line: it has to start near
     even, wander, and settle — a flat 50% would let a broken sparkline
     pass by drawing nothing. */
  var out=[], v=0.5;
  plays.forEach(function(pl,i){
    v += ((pl.homeScore-pl.awayScore)>0 ? 0.004 : -0.003) + (Math.sin(i/7)*0.012);
    v = Math.max(0.02, Math.min(0.98, v));
    out.push({ playId:String(pl.id), homeWinPercentage:Number(v.toFixed(4)), tiePercentage:0 });
  });
  return out;
}
var GAMEINFO={ attendance:16507, venue:{fullName:'Gainbridge Fieldhouse'},
               officials:[{displayName:'Roy Gulbeyan'},{displayName:'Clare Simmons'},
                          {displayName:'Catherine Chang'}] };
/* A benchmark, never a pick. See gtLine(). */
var PICKCENTER=[{ details:'IND -3.5', overUnder:190.5, provider:{name:'DraftKings'} }];
/* WHAT HAS ALREADY HAPPENED. Both of these are in every real summary
   payload and neither was in the fixtures, so the pre-tip Call It bank —
   the only questions a player sees before the ball goes up — could not be
   tested at all. Modelled on the live Aug 12 response: two previous
   meetings with real scores, and each side's recent form. */
const CAST={
  home:{ab:'DAL', name:'Dallas Wings', id:'3',
        top:'Arike Ogunbowale', dd:'Alanna Smith', foul:'Maddy Siegrist',
        dime:'Paige Bueckers', bench:'Aziaha James'},
  away:{ab:'TOR', name:'Toronto Tempo', id:'131935',
        vol:'Marina Mabrey', second:'Nyara Sabally', third:'Kia Nurse',
        fourth:'Aneesah Morrow', blk2:'Isabelle Harrison'},
  out:{home:'Jessica Shepard', away:'Brittney Sykes'}
};
var SERIES=[{ team:{abbreviation:CAST.home.ab}, summary:CAST.home.ab+' leads series 2-0',
  events:[
    {date:'2026-07-05T19:00:00Z',competitors:[
      {team:{abbreviation:CAST.away.ab},score:'76',winner:false},
      {team:{abbreviation:CAST.home.ab},score:'89',winner:true}]},
    {date:'2026-07-10T23:30:00Z',competitors:[
      {team:{abbreviation:CAST.away.ab},score:'95',winner:false},
      {team:{abbreviation:CAST.home.ab},score:'108',winner:true}]}
  ]}];
var LASTFIVE=[
  {team:{abbreviation:CAST.home.ab},events:[
    {gameResult:'L',score:'81-75',opponent:{abbreviation:'WSH'},gameDate:'2026-07-31T23:30Z'},
    {gameResult:'W',score:'83-63',opponent:{abbreviation:'CON'},gameDate:'2026-08-02T23:00Z'},
    {gameResult:'L',score:'103-90',opponent:{abbreviation:'MIN'},gameDate:'2026-08-09T23:30Z'}]},
  {team:{abbreviation:CAST.away.ab},events:[
    {gameResult:'L',score:'104-72',opponent:{abbreviation:'MIN'},gameDate:'2026-07-31T00:00Z'},
    {gameResult:'L',score:'96-79',opponent:{abbreviation:'GS'},gameDate:'2026-08-03T00:30Z'},
    {gameResult:'L',score:'107-95',opponent:{abbreviation:'ATL'},gameDate:'2026-08-10T02:00Z'}]}
];
[PRE,LIVE,POST].forEach(function(F){ F.seasonseries=SERIES; F.lastFiveGames=LASTFIVE; });
POST.gameInfo=GAMEINFO; POST.pickcenter=PICKCENTER;
LIVE.gameInfo=GAMEINFO; LIVE.pickcenter=PICKCENTER;
PRE.gameInfo=GAMEINFO;  PRE.pickcenter=PICKCENTER;
POST.winprobability=wpFor(LONG);
/* Everything up to the end of Q3, since LIVE is mid-third-quarter. The
   quarter-retrospective question engine needs at least a handful of scoring
   plays inside the CURRENT period before it will ask anything, which is
   correct behaviour and has to be exercised with data that satisfies it. */
LIVE.plays=LONG.filter(function(p){ return (p.period&&p.period.number)<=3; });
LIVE.winprobability=wpFor(LIVE.plays);
/* PRE DOES CARRY WIN-PROBABILITY ENTRIES, and that is the whole point.

   The first version of this fixture set `PRE.winprobability=[]`, and the
   "no probability before tip" check passed — for the wrong reason. It was
   passing on the empty-array guard, not on the phase guard, so deleting
   the phase guard entirely did not fail the test. Sabotage caught it.
   (B-49: proving a test CAN fail does not prove it is pointed at the right
   case.) A real pre-game payload can carry a seeded entry, so this one does
   too, and now the only thing standing between a pre-game screen and a
   probability bar is the check we actually want to enforce. */
PRE.winprobability=[
  {playId:'pre1',homeWinPercentage:0.58,tiePercentage:0},
  {playId:'pre2',homeWinPercentage:0.58,tiePercentage:0}
];
/* ==================================================================
   THE CAST IS EXPORTED, SO THE CHECKS STOP HARD-CODING NAMES

   Every game night used to break the suite: the fixtures were written
   around one specific matchup and forty assertions named its players, so
   changing the configured game turned the gate red for reasons that had
   nothing to do with the app. The names now live in ONE place and the
   checks read them from here.

   Roles are stable even when the names change, which is what lets the
   assertions stay meaningful across nights:
     top     the leading scorer
     dd      the double-double, and one half of the deliberate blocks tie
     foul    the player in foul trouble
     dime    the assists and steals leader
     bench   the bench scorer
     vol     the away side's volume scorer, hot from three
     blk2    the other half of the blocks tie
   ================================================================== */

module.exports={PRE,LIVE,POST,PLAYS,LONG,NM,CAST};
