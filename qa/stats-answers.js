#!/usr/bin/env node
/* ============ STATS ANSWERS, OR SAYS IT DOES NOT KNOW ================
   Founder, 21 August 2026, naming the voice: "the name of the voice, his
   name is STATS... Dan is the best beta tester, old guy who loves sports
   and not so tech savvy. How can they engage with this game and not worry
   about it acting up and they say 'I hate this thing'."

   Two defects sat underneath that, and both are the same shape — the app
   answering a question nobody asked.

   1. "What's the score" and "how am I doing" shared one branch, and both
      returned the PLAYER'S points. So a man watching a basketball game
      asked for the score and was told he had 135 points and was second of
      two. A confident answer to the wrong question is worse than none: it
      teaches you the thing cannot understand you.

   2. Anything unrecognised incremented a counter and returned into a void.
      A real question, asked out loud, to a thing with a name, got silence.

   The fix for (2) has a trap in it, and this suite guards both sides of
   it: the microphone is open in a room with a live broadcast playing, so
   "never silent" must not become "argues with the television". STATS
   speaks when it was plainly spoken TO, and stays out of the way otherwise.

   Usage: node qa/stats-answers.js [index-test.html]
*/
const { chromium } = require('playwright');
const { waitReady } = require('./ready.js');
const http = require('http'), fs = require('fs'), path = require('path');

const TARGET = process.argv.find(a => /\.html$/.test(a)) || 'index.html';
let pass = 0, fail = 0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + (detail || '')); }
}
function serve(){
  const srv = http.createServer((q,r)=>{
    const f = path.join(process.cwd(), q.url.split('?')[0] === '/' ? TARGET : q.url.split('?')[0]);
    try{ r.writeHead(200,{'content-type':'text/html'}); r.end(fs.readFileSync(f)); }
    catch(_){ r.writeHead(404); r.end(''); }
  });
  return new Promise(res=>{ srv.listen(0,()=>res({srv, port:srv.address().port})); });
}

(async () => {
  console.log('\n  STATS — answers the question that was asked\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:393,height:852} });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,120)));
  await p.addInitScript(()=>{ window.__said=[];
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
      speak(u){ window.__said.push(u.text); setTimeout(()=>u.onend&&u.onend(),4); },
      cancel(){}, paused:false, resume(){}, getVoices(){return[];} }});
  });
  await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
  /* waitReady(), not a guess. On 22 Aug qa/stats-page.js was found
     skipping an entire sport per run because its fixed boot sleep
     sometimes expired before the app existed — and it had been
     reporting full coverage on the runs where it did not. */
  await waitReady(p);

  /* A real game in memory: Lynx 68, Valkyries 61, third quarter. */
  const r = await p.evaluate(async ()=>{
    const out = {};
    VX.enable();
    GS.ok = true; GS.state = 'in';
    GS.teams = [{ab:'MIN', name:'Lynx', score:68, home:false},
                {ab:'GS',  name:'Valkyries', score:61, home:true}];
    GS.detail = 'Third quarter';
    GS.plays = [{scoring:true, text:'Napheesa Collier makes a three point jumper', clock:'4:12'}];
    S.pts = 135; S.streak = 3;

    const say = async (phrase)=>{ window.__said=[]; VX.heard(phrase);
      await new Promise(z=>setTimeout(z,40)); return (window.__said||[]).join(' '); };

    out.score      = await say('what is the score');
    out.mine       = await say('how am i doing');
    /* CONTEXT. The same two words mean different things depending on where
       the player is standing, and both readings are legitimate. */
    S.screen = 'gametime';
    out.winningInGame = await say('who is winning');
    S.screen = 'board';
    lastStand = [{name:'Smakk', total:440, pts:440}, {name:'You', total:135, pts:135, me:true}];
    out.winningOnBoard = await say('who is winning');
    S.screen = 'gametime';

    out.lastScore  = await say('who scored last');
    out.streak     = await say('what is my streak');
    out.hello      = await say('are you there');

    /* Unrecognised, but plainly addressed to us. */
    VX.lastUnknownAt = 0; VX.gestureEar = false;
    window.__said=[]; VX.unknown('who has the most rebounds in nineteen ninety eight');
    await new Promise(z=>setTimeout(z,40));
    out.unknownAsked = (window.__said||[]).join(' ');

    /* Unrecognised, and NOT addressed to us — the television talking. */
    VX.lastUnknownAt = 0;
    window.__said=[];
    VX.unknown('and the pass inside to the big man down on the low block');
    await new Promise(z=>setTimeout(z,40));
    out.unknownTv = (window.__said||[]).join(' ');

    /* Twice in a row, addressed to us: must not lecture. */
    VX.lastUnknownAt = 0;
    VX.unknown('who won the title in eighty six');
    /* LET THE FIRST ONE LAND FIRST. V.say speaks on the next tick now, so
       clearing the buffer immediately catches the FIRST reply after the
       clear and reads it as a second one. */
    await new Promise(z=>setTimeout(z,60));
    window.__said=[];
    VX.unknown('who won the title in eighty seven');
    await new Promise(z=>setTimeout(z,60));
    out.unknownTwice = (window.__said||[]).join(' ');
    return out;
  });

  ok('stats.the-score-means-the-game-score',
     /68/.test(r.score) && /61/.test(r.score) && !/135/.test(r.score),
     `"what is the score" answered: ${JSON.stringify(r.score)}. It must name the two teams' ` +
     `points, not the player's. This branch used to be shared with "how am I doing" and returned ` +
     `135 — a confident answer to a question nobody asked.`);

  ok('stats.and-my-score-still-means-mine',
     /135/.test(r.mine),
     `"how am I doing" answered: ${JSON.stringify(r.mine)}. Splitting the branch must not cost ` +
     `the player their own number.`);

  ok('stats.who-is-winning-in-a-game-means-the-teams',
     /68/.test(r.winningInGame) && /61/.test(r.winningInGame) && !/135/.test(r.winningInGame),
     `asked while watching the game it answered: ${JSON.stringify(r.winningInGame)}. A man with ` +
     `a broadcast in front of him who asks who is winning does not mean his own points.`);

  ok('stats.but-on-the-leaderboard-it-means-the-room',
     /135|Smakk|number 2/.test(r.winningOnBoard) && !/68/.test(r.winningOnBoard),
     `asked from the Board it answered: ${JSON.stringify(r.winningOnBoard)}. On the screen full ` +
     `of names, the same two words mean the room — answering with the game score there would be ` +
     `the same category of wrong, pointing the other way.`);

  ok('stats.it-can-say-who-scored-last',
     /Collier/i.test(r.lastScore),
     `"who scored last" answered: ${JSON.stringify(r.lastScore)}`);

  ok('stats.it-knows-your-streak',
     /3/.test(r.streak),
     `"what is my streak" answered: ${JSON.stringify(r.streak)}`);

  ok('stats.it-answers-when-you-ask-if-it-is-there',
     /listening|here/i.test(r.hello),
     `"are you there" answered: ${JSON.stringify(r.hello)}. This is the sentence a non-technical ` +
     `person says at the exact moment before they give up on a device, and it used to be met ` +
     `with more silence.`);

  ok('stats.an-unknown-question-still-gets-an-answer',
     /do not have that one|don't have that one/i.test(r.unknownAsked) &&
     /nineteen ninety eight/i.test(r.unknownAsked),
     `a question it cannot answer produced: ${JSON.stringify(r.unknownAsked)}. It must say it ` +
     `does not know AND repeat what it heard — the transcript is what tells a person whether it ` +
     `mis-heard them or simply does not know, and those have completely different fixes.`);

  ok('stats.it-does-not-argue-with-the-television',
     r.unknownTv === '',
     `commentary from the broadcast produced: ${JSON.stringify(r.unknownTv)}. The microphone is ` +
     `open in a room with a live game on. An assistant that says "I did not catch that" at the ` +
     `commentary every twenty seconds is worse than one that says nothing at all.`);

  ok('stats.it-says-it-once-not-in-a-loop',
     r.unknownTwice === '',
     `two unknown questions in a row produced a second reply: ${JSON.stringify(r.unknownTwice)}. ` +
     `A bad run of recognition must not turn into a lecture.`);

  ok('stats.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
