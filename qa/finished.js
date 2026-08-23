#!/usr/bin/env node
/* ============ A GAME THAT IS OVER TAKES NO MORE PICKS ================
   Founder, 20 August 2026: "I sat through the whole baseball game and it
   didn't work well. Even after the game i could still go to the home page
   and still play. It didnt stop and say the game is over."

   phaseNow() has known the answer the whole time — it reads the feed's own
   status and returns 'final' — and nothing ever asked it. So a decided
   room stayed as inviting as a live one: the pick sheet opened, picks were
   taken, and they settled against a result that was already public.

   Not hypothetical. At 08:48 on 21 August somebody filed a prediction card
   into the previous night's completed football room.

   It matters more from tonight than it ever has: three rooms an hour
   apart, so finishing the football and wandering back into it during the
   basketball is the shape of the evening, not an edge case.

   PRACTICE MUST STAY REPLAYABLE. A practice deck has no real game behind
   it, and locking somebody out of it because a fixture from a fictional
   night is "over" would be a worse bug than the one being fixed.

   Usage: node qa/finished.js [index-test.html]
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
  console.log('\n  FINISHED — a decided game stops asking\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:393,height:852} });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,120)));
  await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
  /* waitReady(), not a guess. On 22 Aug qa/stats-page.js was found
     skipping an entire sport per run because its fixed boot sleep
     sometimes expired before the app existed — and it had been
     reporting full coverage on the runs where it did not. */
  await waitReady(p);

  ok('finished.the-question-is-answerable',
     await p.evaluate(()=>typeof window.nightIsOver === 'function'),
     'window.nightIsOver is not a function — there is no single place that answers "is this ' +
     'night decided", so every check below measures nothing.');

  const r = await p.evaluate(()=>{
    const out = {};
    /* A real finished game: the feed says post, the score is in, AND the
       feed is about the room we are standing in. That last part is not
       decoration — nightIsOver refuses to answer on somebody else's feed,
       so a fixture that does not line the event up is testing the guard
       rather than the rule. */
    GS.ok = true; GS.state = 'post'; GS.ev = '401816609';
    try{ GAME = Object.assign({}, GAME, { espnEvent:'401816609' }); }catch(_){}
    GS.teams = [{ab:'WSH', name:'Nationals', score:0, home:false},
                {ab:'TEX', name:'Rangers',   score:2, home:true}];
    try{ PHASE.v = 'final'; }catch(_){}

    S.mode = 'live';
    out.liveSaysOver = nightIsOver();
    out.says = (typeof overSay === 'function') ? overSay() : '';

    /* PRACTICE MUST NOT BE LOCKED OUT. */
    S.mode = 'demo';
    out.practiceStillOpen = (nightIsOver() === false);

    /* And a game still in progress is obviously not over. */
    S.mode = 'live';
    GS.state = 'in'; try{ PHASE.v = 'live'; }catch(_){}
    out.liveGameNotOver = (nightIsOver() === false);

    /* ============ ANOTHER ROOM'S FEED PROVES NOTHING ================
       The football ends at 7:15 and the basketball tips at 7:00. A player
       walking from one to the other carries a finished football feed into
       a live basketball room for the seconds before loadGameStats catches
       up. If "final" is read off that feed, the app locks somebody out of
       a game that has barely started — which is worse than the bug this
       whole suite exists for. */
    GS.state = 'post'; try{ PHASE.v = 'final'; }catch(_){}
    GS.ev = '401816609';                        // the finished ballgame
    try{ GAME = Object.assign({}, GAME, { espnEvent:'401857163' }); }catch(_){}   // a different, live room
    out.otherRoomsFeedIgnored = (nightIsOver() === false);
    try{ GAME = Object.assign({}, GAME, { espnEvent:'401816609' }); }catch(_){}   // back to this room
    out.thisRoomsFeedStillCounts = (nightIsOver() === true);

    /* The submission door, independently of the screen. */
    GS.state = 'post'; try{ PHASE.v = 'final'; }catch(_){}
    try{ LOCKED = {}; }catch(_){}
    out.lockRefused = (typeof lockPicks === 'function') ? (lockPicks(0) === false) : 'no-fn';
    return out;
  });

  ok('finished.a-decided-game-knows-it',
     r.liveSaysOver === true,
     `with the feed reporting post and the phase final, nightIsOver() said ${r.liveSaysOver}.`);

  ok('finished.it-can-say-how-it-ended',
     /finished/i.test(r.says) && /2/.test(r.says),
     `overSay() produced ${JSON.stringify(r.says)}. "This game is over" and "this game finished ` +
     `2 to 0" are different sentences to somebody who just walked in, and we have the score.`);

  ok('finished.practice-is-still-replayable',
     r.practiceStillOpen === true,
     'practice reports itself as over. A practice deck has no real game behind it and is meant to ' +
     'be played again — locking somebody out of it would be a worse bug than the one being fixed.');

  ok('finished.a-game-in-progress-is-not-over',
     r.liveGameNotOver === true,
     'a live game reported itself finished, which would shut the door in the middle of the night.');

  ok('finished.another-rooms-final-does-not-shut-this-one',
     r.otherRoomsFeedIgnored === true,
     'a finished feed from a DIFFERENT event closed this room. GS is one global keyed to one ' +
     'event, so "final" without an event guard means "the feed we happen to be holding says ' +
     'final". On a night with rooms an hour apart that locks players out of live games.');

  ok('finished.but-this-rooms-final-still-counts',
     r.thisRoomsFeedStillCounts === true,
     'guarding on the event must not disable the check entirely — when the feed IS about this ' +
     'room and says final, the door still shuts.');

  ok('finished.no-submission-lands-after-the-buzzer',
     r.lockRefused === true,
     `lockPicks() returned ${JSON.stringify(r.lockRefused)} on a decided game. Shutting the pick ` +
     `sheet is not enough on its own — a stale timer or a listener that re-armed after the final ` +
     `whistle comes through this door instead.`);

  ok('finished.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
