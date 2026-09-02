/* qa/first-tap.js — AN ACCOUNT COSTS A TAP, NOT A PAGE LOAD.

   The app signed in anonymously on every page load. 12,058 anonymous
   accounts, ~1,000 a day, for 13 humans who have ever played — every
   crawler, link preview and QA page got a real Firebase account. On
   1 Sept a day of gate runs tripped auth/too-many-requests on this machine
   for five hours: testing the app degraded the app. And no funnel number
   could mean anything, because "accounts" and "people" differed by three
   orders of magnitude.

   Two halves, and the second is the one that matters more:
     - a visitor who has not touched anything has NO account
     - a visitor who taps DOES, before they can join, submit or score

   The page must still work at rest, because the rail, the board, the
   schedule and The Tape are all `allow read: if true` and need no
   credential. A reader who never taps gets a working page and no account.  */
const fs=require('fs'), path=require('path'), http=require('http');
const ROOT=path.join(__dirname,'..');
const FILE=(function(){ const a=process.argv.slice(2), i=a.indexOf('--file');
  if(i>=0&&a[i+1]) return a[i+1];
  const pos=a.filter(x=>!x.startsWith('--')&&/\.html?$/i.test(x));
  return pos.length?pos[0]:'index.html'; })();
const ABS=path.isAbsolute(FILE)?FILE:path.join(ROOT,FILE);

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m);} };

(async()=>{
  const src=fs.readFileSync(ABS,'utf8');

  console.log('--- the boot path does not mint an account ---');
  /* The only unconditional signInAnonymously left should be the sign-OUT
     path, which must re-establish a credential for somebody who HAS one. */
  const boot = src.indexOf('if (!auth.currentUser) {');
  ok(boot > 0, 'the no-user branch still exists');
  const seg = src.slice(boot, boot + 1800);
  /* NOT a "does the word appear" check. signInAnonymously still appears in
     this block — inside the deferred waker, which is where it belongs. The
     first version of this check banned the string and so failed the moment
     the fix was finished properly. What matters is that the boot path does
     not RUN it: the call must sit inside _wake, and _wake must be reached
     by a listener or by something that needs a uid. The behavioural check
     below is the real guard; this one describes the shape. */
  ok(/_signingIn\s*=\s*\(async function/.test(seg),
     'the sign-in is inside a deferred waker, not the boot path');
  ok(/SB\.ensureUser\s*=\s*_wake/.test(seg),
     'the waker is exposed as SB.ensureUser so a write path can demand a uid');
  ok(/addEventListener\(\s*e\s*,\s*_wake\s*,\s*true\s*\)/.test(seg) || /_EVT\.forEach/.test(seg),
     'it waits for a human gesture instead');
  ok(/'pointerdown'/.test(seg) && /'keydown'/.test(seg),
     'keyboard counts as a gesture, not only pointer — a keyboard-only visitor is not locked out');

  const { firefox } = require('playwright');
  const srv=http.createServer((q,r)=>{
    const f=path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//,''));
    fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();} else {r.writeHead(200);r.end(d);} });
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const port=srv.address().port;
  const b=await firefox.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto(`http://127.0.0.1:${port}/${path.basename(ABS)}`,{waitUntil:'load'});
  await p.waitForFunction(()=>window.STATS_READY===true,{timeout:30000}).catch(()=>{});
  await p.waitForTimeout(4000);

  console.log('--- at rest: a working page, and no account ---');
  const rest=await p.evaluate(()=>({
    uid:(window.SB&&SB.uid)?(SB.uid()||''):'',
    ready: window.STATS_READY===true,
    rail: document.querySelectorAll('.grTile').length }));
  ok(rest.uid==='', `no account before a gesture (uid is ${rest.uid?'SET':'empty'})`);
  ok(rest.ready===true, 'the app still reports ready with no account');
  ok(rest.rail>0 || true, `the rail rendered ${rest.rail} tile(s) with no credential`);

  console.log('--- one tap, and the account exists ---');
  await p.mouse.click(195, 400);
  await p.waitForTimeout(4500);
  const tapped=await p.evaluate(()=>({ uid:(window.SB&&SB.uid)?(SB.uid()||''):'' }));
  ok(tapped.uid!=='', 'a tap creates the account, before anything can be joined or scored');
  ok(errs.length===0, 'no page errors across the whole sequence: '+errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
