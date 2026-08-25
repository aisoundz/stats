#!/usr/bin/env node
/* ============ qa/rules.js ============================================
   DOES THE DATABASE ACTUALLY REFUSE?

   qa/acceptance.js says it plainly: "fakebase does not run
   firestore.rules. A rule that would have stopped this is not tested
   here." So the file that decides who may write what to a live game has
   been shipped on inspection alone.

   That cost something real. B-71, 21 August, the founder after the WNBA
   room finished: "after the quarter ended and the score was made i was
   able to sign into the tempo and mystics game and put in entries after
   the game." He could — and the rule's own comment claimed he could not.
   Create-only stops a player REWRITING a pick after the reveal; it never
   stopped them writing a FIRST one. Nothing enforced the timing, and no
   test could have noticed, because nothing ran the rules.

   This runs them. The Firebase Rules API compiles a ruleset and evaluates
   named requests against it — the same service account that deploys them,
   no emulator, no CLI. get()/exists() are stubbed per case, so a case can
   say "the round is scored" and see what the rules do about it.

       node qa/rules.js
   ================================================================== */
const fs = require('fs'), path = require('path');
const { GoogleAuth } = require('google-auth-library');

const PROJECT = process.env.FIREBASE_PROJECT || 'stats-gametime';
const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS
         || path.join(process.env.HOME, '.secrets/stats-firebase-admin.json');
/* RULES_FILE points this at a DIFFERENT ruleset — the one that is live, or
   the one from before a fix — so a new case can be watched failing against
   the bug it claims to catch. A check never observed failing is not a
   check, and every case below that was added after an incident was added
   because the suite was green while the incident was happening.

       RULES_FILE=/tmp/before.rules node qa/rules.js     # must go RED
       node qa/rules.js                                  # must go GREEN   */
const SRC = fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const DB   = '/databases/(default)/documents';
const NID  = 'slate-2026-08-21-min-wsh';
const RID  = 'r3';
const UID  = 'player123';
const OWNER= { uid:'owner1', token:{ email:'aisoundz9@gmail.com', email_verified:true } };
const PLAY = { uid:UID,      token:{ email:'someone@example.com', email_verified:true } };

const roundPath = `${DB}/nights/${NID}/rounds/${RID}`;
const subPath   = `${roundPath}/subs/${UID}`;
const r0Path    = `${DB}/nights/${NID}/rounds/r0`;
const cardPath  = `${DB}/nights/${NID}/rounds/rP/subs/${UID}`;

/* A stub for the get()/exists() the rule performs on the round document. */
const roundIs = (state, present) => ([
  { function:'get',    args:[{ exactValue: roundPath }],
    result:{ value:{ data:{ state } } } },
  { function:'exists', args:[{ exactValue: roundPath }],
    result:{ value: present !== false } }
]);

/* The prediction card asks one question and it is about a DIFFERENT
   document: has round one been pushed yet? `pushed` false is a room that
   has not started — the card's whole window. */
const roundOnePushed = (pushed) => ([
  { function:'exists', args:[{ exactValue: r0Path }], result:{ value: !!pushed } }
]);

const goodSub = { picks:['a','b','c','d'], banks:[1,2,3,4], name:'Sam' };

const CASES = [
  /* ---- the bug he found ---- */
  { id:'a player may answer a round that is LIVE',
    want:'ALLOW', auth:PLAY, path:subPath, method:'create', data:goodSub, mocks:roundIs('live') },
  { id:'a player may NOT answer a round that is already SCORED',
    want:'DENY',  auth:PLAY, path:subPath, method:'create', data:goodSub, mocks:roundIs('scored') },
  { id:'a player may NOT answer a round that is still a DRAFT',
    want:'DENY',  auth:PLAY, path:subPath, method:'create', data:goodSub, mocks:roundIs('draft') },
  { id:'a player may NOT answer a round that does not exist',
    want:'DENY',  auth:PLAY, path:subPath, method:'create', data:goodSub, mocks:roundIs('live', false) },

  /* ---- 24 Aug, found reviewing the fix above BEFORE it shipped -------
     lockPicks() in index.html files a second kind of submission, at
     roundId + '-local', when the built-in practice deck gets answered
     instead of a round the host pushed. It never has a matching document
     in /rounds by construction, so exists() on it is always false — the
     ORIGINAL version of roundIsOpen() would have rejected every one of
     these, not just the ones for a closed round. No mocks: the point is
     that the rule must not even need to look the document up. */
  { id:'a LOCAL-only submission (practice deck inside a live room) is allowed with no round document at all',
    want:'ALLOW', auth:PLAY, path:`${roundPath}-local/subs/${UID}`, method:'create', data:goodSub, mocks:[] },
  { id:'a local submission still cannot be written as somebody else',
    want:'DENY',  auth:PLAY, path:`${roundPath}-local/subs/someoneElse`, method:'create', data:goodSub, mocks:[] },

  /* ---- 25 Aug — THE THIRD LANE ---------------------------------------
     The two cases above were written because a review caught the '-local'
     lane before it shipped. There is a third — the prediction card, at
     round id 'rP' — and no case here covered it, so this suite ran GREEN
     while the deployed rule refused every card on every night. 600 of the
     night's 1,000 points, and fourteen ok lines said the rules were fine.

     A suite that tests the lanes somebody remembered is not a suite. These
     two are the ones that were missing, and the first of them FAILS
     against the ruleset that was live between 24 and 25 August — which is
     the only reason to trust it now.

     NOTHING IS MOCKED for the first two, and that is the assertion. The
     rule must not look up a rounds/rP document, because no such document
     has ever been created by anything — the Control Room's writePush() and
     the runner both write 'r' + index. A rule that consults a document
     nobody writes is a rule that denies forever, which is what happened.
     If a future edit makes this lane consult ANY document, these two cases
     stop being able to run at all rather than quietly passing. */
  { id:'THE PREDICTION CARD lands with no rounds/rP document in existence',
    want:'ALLOW', auth:PLAY, path:cardPath, method:'create', data:goodSub, mocks:[] },
  { id:'THE PREDICTION CARD lands whatever round one is doing (deliberately ungated — see firestore.rules)',
    want:'ALLOW', auth:PLAY, path:cardPath, method:'create', data:goodSub, mocks:roundOnePushed(true) },
  { id:'a prediction card cannot be filed in somebody else’s name',
    want:'DENY',  auth:PLAY, path:`${DB}/nights/${NID}/rounds/rP/subs/someoneElse`,
    method:'create', data:goodSub, mocks:[] },
  { id:'a prediction card cannot be rewritten after it is filed',
    want:'DENY',  auth:PLAY, path:cardPath, method:'update', data:goodSub, mocks:[] },
  { id:'a signed-out visitor cannot file a prediction card',
    want:'DENY',  auth:null, path:cardPath, method:'create', data:goodSub, mocks:[] },
  { id:'a prediction card is still size-bounded',
    want:'DENY',  auth:PLAY, path:cardPath, method:'create',
    data:Object.assign({}, goodSub, {picks:new Array(13).fill('a')}), mocks:[] },

  /* ---- the properties that were already true, pinned so they stay ---- */
  { id:'a player may not rewrite a pick after the fact',
    want:'DENY',  auth:PLAY, path:subPath, method:'update', data:goodSub, mocks:roundIs('live') },
  { id:'a player may not answer as somebody else',
    want:'DENY',  auth:PLAY, path:`${roundPath}/subs/someoneElse`, method:'create', data:goodSub, mocks:roundIs('live') },
  { id:'a signed-out visitor may not answer at all',
    want:'DENY',  auth:null, path:subPath, method:'create', data:goodSub, mocks:roundIs('live') },
  { id:'a name longer than the column may not be written',
    want:'DENY',  auth:PLAY, path:subPath, method:'create',
    data:Object.assign({}, goodSub, {name:'x'.repeat(40)}), mocks:roundIs('live') },
  { id:'more picks than a round can hold may not be written',
    want:'DENY',  auth:PLAY, path:subPath, method:'create',
    data:Object.assign({}, goodSub, {picks:new Array(13).fill('a')}), mocks:roundIs('live') },

  /* ---- the answer key stays the owner's ---- */
  { id:'a player may not read the answer key',
    want:'DENY',  auth:PLAY, path:`${roundPath}/key/k1`, method:'get' },
  { id:'the owner may read the answer key',
    want:'ALLOW', auth:OWNER, path:`${roundPath}/key/k1`, method:'get' },
  { id:'a player may not write a round document',
    want:'DENY',  auth:PLAY, path:roundPath, method:'update', data:{state:'scored'} }
];

(async () => {
  if (!fs.existsSync(KEY)) { console.log('  SKIP — no service account key; rules cannot be evaluated'); process.exit(0); }
  const auth = new GoogleAuth({ keyFile:KEY, scopes:['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();

  const testSuite = { testCases: CASES.map(c => ({
    expectation: c.want,
    functionMocks: c.mocks || [],
    request: Object.assign({
      auth: c.auth,
      path: c.path,
      method: c.method,
      time: new Date('2026-08-22T02:00:00Z').toISOString()
    }, c.data ? { resource:{ data:c.data } } : {})
  })) };

  const r = await client.request({
    url:`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
    method:'POST',
    data:{ source:{ files:[{ name:'firestore.rules', content:SRC }] }, testSuite },
    validateStatus:()=>true
  });

  if (r.status >= 300) {
    const msg = (r.data && r.data.error && r.data.error.message) || JSON.stringify(r.data).slice(0,300);
    /* ============ A SUITE THAT CANNOT RUN MUST SAY SO, NOT FAIL ========
       The Admin SDK service account can CREATE a ruleset and move the
       release — that is how host/deploy-rules.js works — but it is not
       granted firebaserules.releases.test, so the evaluation endpoint
       returns "The caller does not have permission".

       That is a missing capability, not a broken build, and failing the
       gate for it would teach everybody to ignore a red gate. Say plainly
       that the rules went UNCHECKED, which is the honest state, and let
       the rest of the gate proceed.

       To turn this on: grant the service account roles/firebaserules.admin
       (or the firebaserules.releases.test permission) in the Google Cloud
       console. Then this file evaluates the real ruleset on every gate run
       and B-71 can never come back silently. */
    if (/permission|PERMISSION_DENIED|forbidden/i.test(msg)) {
      console.log('  SKIP — the rules were NOT evaluated.');
      console.log('         The Rules API refused: ' + msg);
      console.log('         Grant the service account roles/firebaserules.admin to enable this suite.');
      console.log('         Until then firestore.rules ships on inspection alone — which is how B-71 shipped.');
      process.exit(0);
    }
    console.log('  FATAL — the Rules API refused: ' + msg);
    process.exit(1);
  }

  /* A ruleset that does not compile is the loudest possible failure. */
  const issues = (r.data.issues || []).filter(i => i.severity === 'ERROR');
  if (issues.length) {
    console.log('  THE RULES DO NOT COMPILE:');
    issues.forEach(i => console.log('    ' + i.description + '  (line ' + ((i.sourcePosition||{}).line) + ')'));
    process.exit(1);
  }

  const results = r.data.testResults || [];
  let pass = 0, fail = 0;
  CASES.forEach((c, i) => {
    const got = (results[i] || {}).state;      // SUCCESS = matched the expectation
    if (got === 'SUCCESS') { pass++; console.log('  ok   ' + c.id + '   [' + c.want + ']'); }
    else {
      fail++;
      console.log('  FAIL ' + c.id);
      console.log('         expected ' + c.want + ', the rules did the opposite');
      const dbg = (results[i] || {}).debugMessages;
      if (dbg && dbg.length) console.log('         ' + String(dbg[0]).slice(0,160));
    }
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed   (evaluated against the real rules)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FATAL — ' + ((e && e.message) || e)); process.exit(1); });
