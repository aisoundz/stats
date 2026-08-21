#!/usr/bin/env node
/* ============ THE ONLY THING IN THE APP THAT EXISTS TO BE FUN ========
   Founder, 21 Aug: "Think of what type of dopamine can we provide to the
   user in the game from confeti to celbrations and more… most importantly
   fun."

   Everything else in the gate asks whether the app is CORRECT. This asks
   whether the payoff still happens, because a celebration is exactly the
   kind of thing that gets quietly broken by a refactor and never noticed
   until a player says the game feels flat — which is not a bug report
   anybody files.

   Three properties, and the last two matter more than the first:
     · it fires, and it escalates with the streak;
     · it NEVER blocks the game on the television behind it;
     · prefers-reduced-motion gets the payoff without the particles.

   Usage: node qa/celebrate.js [index-test.html]
*/
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const TARGET = process.argv.find(a => /\.html$/.test(a)) || 'index.html';
let pass = 0, fail = 0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + (detail||'')); }
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
  console.log('\n  CELEBRATION — the moment being right is worth something\n');
  const { srv, port } = await serve();

  /* ---- 1. normal motion: it draws, it escalates, it cleans up ---- */
  {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport:{width:414,height:896} });
    const errs=[]; p.on('pageerror',e=>errs.push(String(e.message).slice(0,120)));
    await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
    await p.waitForTimeout(2500);

    ok('celebrate.is-exported',
       await p.evaluate(()=>typeof window.celebrate === 'function'),
       'window.celebrate is not a function — nothing can fire the payoff, and every hook ' +
       'into it is a silent no-op.');

    const small = await p.evaluate(()=>{ celebrate(1); return CELEB.parts.length; });
    const big   = await p.evaluate(()=>{ CELEB.parts.length=0; celebrate(3); return CELEB.parts.length; });
    ok('celebrate.a-right-answer-puts-something-on-screen', small > 0,
       `level 1 produced ${small} particles`);
    ok('celebrate.a-streak-is-visibly-bigger', big > small * 2,
       `level 1 produced ${small} and level 3 produced ${big}. A reward that is the same size ` +
       `every time stops being a reward, and the streak is the behaviour worth growing.`);

    /* THE ONE THAT MATTERS. This fires over a live broadcast. */
    const blocking = await p.evaluate(()=>{
      celebrate(3);
      const cv = document.getElementById('celebCv');
      if(!cv) return 'no canvas';
      const cs = getComputedStyle(cv);
      return { pe: cs.pointerEvents, pos: cs.position };
    });
    ok('celebrate.never-blocks-the-game-behind-it',
       blocking && blocking.pe === 'none',
       `the canvas computes pointer-events:${blocking && blocking.pe}. A celebration that ` +
       `swallows taps is a punishment — the player is watching a game and the card underneath ` +
       `this is on a clock.`);

    ok('celebrate.what-is-under-the-canvas-is-still-tappable',
       await p.evaluate(()=>{
         celebrate(3);
         const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight*0.62);
         return !!el && el.id !== 'celebCv';
       }),
       'the point where the burst originates hit-tests to the canvas, so whatever sits there — ' +
       'which is the scoreboard, and often a Caught It card — cannot be touched while it plays.');

    ok('celebrate.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));
    await b.close();
  }

  /* ---- 2. reduced motion: the payoff still lands, quietly ---- */
  {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport:{width:414,height:896}, reducedMotion:'reduce' });
    await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(()=>{
      celebrate(3);
      return { parts: CELEB.parts.length, canvas: !!document.getElementById('celebCv') };
    });
    ok('celebrate.reduced-motion-gets-no-particles',
       r.parts === 0 && !r.canvas,
       `with prefers-reduced-motion set it still made ${r.parts} particles / canvas=${r.canvas}. ` +
       `This fires during a live broadcast; a screenful of moving confetti is genuinely ` +
       `unpleasant for some people and the setting exists to say so.`);
    ok('celebrate.reduced-motion-still-gets-a-payoff',
       await p.evaluate(async ()=>{
         const before = document.body.children.length;
         celebrate(2);
         await new Promise(z=>setTimeout(z,60));
         return document.body.children.length > before;
       }),
       'reduced motion produced nothing at all. Quieter is the instruction, not silent — the ' +
       'moment you were right still has to register.');
    await b.close();
  }

  srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
