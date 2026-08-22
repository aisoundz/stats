/* ============ qa/your-own-card.js ====================================
   A NUMBER LABELLED "YOURS" HAS TO BE ABOUT YOU.

   Two reports from 21 August that turned out to be the same mistake made
   twice — a fact about the ROOM printed under a personal label.

   "I have 2 user that show they are both 3 of 3 on their card."
     countGraded() counted every question the room GRADED, and the room
     grades the same questions for everybody. The denominator was
     identical for every player in it by construction, so two people who
     each got everything right on that shared subset both read "3 of 3" —
     and a player who joined at halftime was credited with rounds they
     were never present for.

   "The share screen looks wrong."
     The headline read LYNX @ MYSTICS · MYSTICS VS LYNX · AUG 21 — the
     matchup, then the matchup again with the teams reversed, and no game
     number. `GAME.night` holds the MATCHUP on a published night and the
     NUMBER on the built-in fallback, so the line read correctly in
     practice and wrongly in every real room.
   ================================================================== */
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let pass=0, fail=0;
const ok =(n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
const t=(n,f)=>{ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } };

/* ---- run the real counters ----------------------------------------- */
const cg = SRC.match(/function countGraded\(\)\{[\s\S]*?\n\}/);
const gh = SRC.match(/function gradedHits\(\)\{[\s\S]*?\n\}/);
if(!cg || !gh){ bad('both counters exist'); console.log('\n  '+pass+' passed, '+fail+' failed'); process.exit(1); }

const build = (S, rounds) => ({
  countGraded: new Function('S','rounds', cg[0]+'; return countGraded;')(S, rounds),
  gradedHits:  new Function('S',          gh[0]+'; return gradedHits;')(S)
});
const R4 = [{q:[1,2,3,4]},{q:[1,2,3,4]},{q:[1,2,3,4]},{q:[1,2,3,4]}];
const A = (...picks) => picks.map(p => p===null ? null : {choice:p, bank:0});

/* A player who ANSWERED one round of four, and got three of its four right. */
const late = {
  results:     [ [true,true,true,false], [true,true,true,true], [true,true,true,true], [] ],
  liveAnswers: [ A('a','b','c','d'),     [],                    [],                    [] ]
};
/* Another player in the SAME room who answered a different round perfectly. */
const other = {
  results:     [ [true,true,true,false], [true,true,true,true], [true,true,true,true], [] ],
  liveAnswers: [ [],                     A('a','b','c','d'),    [],                    [] ]
};

t('a late arrival is not credited with rounds they never saw', ()=>{
  const g=build(late,R4).countGraded();
  if(g.total!==4){ console.log('         counted '+g.total+' questions; they answered 4'); return false; }
  return g.hits===3;
});
t('two players in one room do not get the same score', ()=>{
  const a=build(late,R4).countGraded(), b=build(other,R4).countGraded();
  const same = (a.hits===b.hits && a.total===b.total);
  if(same) console.log('         both read '+a.hits+' of '+a.total+' — this is the reported bug');
  return !same;
});
t('answering nothing is nought of nought, not a perfect night', ()=>{
  const none={ results:[[true,true,true,true],[],[],[]], liveAnswers:[[],[],[],[]] };
  const g=build(none,R4).countGraded();
  return g.total===0 && g.hits===0;
});
t('a question the room never settled is not counted', ()=>{
  const un={ results:[[true,undefined,null,false],[],[],[]], liveAnswers:[A('a','b','c','d'),[],[],[]] };
  const g=build(un,R4).countGraded();
  return g.total===2 && g.hits===1;
});
t('gradedHits counts only hits you answered', ()=>
  build(late,R4).gradedHits()===3);
t('gradedHits ignores a hit you were not there for', ()=>{
  const none={ results:[[true,true,true,true],[],[],[]], liveAnswers:[[],[],[],[]] };
  return build(none,R4).gradedHits()===0;
});

/* ---- the share card names the night once, and correctly ------------- */
const os = SRC.match(/function openShare\(\)\{[\s\S]*?\n\}/);
if(!os) bad('openShare exists');
else {
  t('the headline no longer prints GAME.night', ()=>{
    /* MATCH THE CODE, NOT THE PROSE. The fix's own comment quotes
       `GAME.night` to explain why it went, and a bare search cannot tell
       an explanation from an instruction — the identical mistake was made
       in qa.js's host check the same night, and that file's comment warns
       about it in terms. Assert the TEMPLATE the headline is built from. */
    const line = (os[0].match(/scGameLine'\)\.textContent=[\s\S]{0,400}?;/)||[''])[0];
    if(/GAME\.night/.test(line)){ console.log('         the headline still reads GAME.night'); return false; }
    return line.length>0;
  });
  t('it asks gnOf for the number', ()=> /gnOf\(GAME\)/.test(os[0]));
  t('it says the matchup once, away at home', ()=>
    /_away\+' AT '\+_home/.test(os[0]) && !/ vs /.test(os[0]));
  t('an expired default contributes no number rather than a wrong one', ()=>
    /_gn \? \('GAME NIGHT #'\+_gn\) : ''/.test(os[0]));
  t('the points match the ring, not this device\'s counter', ()=>
    /shownTotal\(\)/.test(os[0]) && !/\$\{S\.pts\} <span/.test(os[0]));
}

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
