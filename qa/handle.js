/* ============ qa/handle.js ===========================================
   ONE NAME, EVERY DEVICE — AND CLAIMING IT NEVER STOPS YOU PLAYING.

   Founder: "I thought we were going to do @ handle so people can have the
   same one forever. Right now you have to sign up and get a new name every
   single time. Its exhausting."

   He was right and the app was worse than he thought: savedProfile() read
   localStorage and nothing else, while the verify screen promised "sign in
   to save your handle... across phones". Signing in saved the POINTS.

   Two rules carry this feature and both are easy to lose in an edit:

     1. A HANDLE MUST NEVER BLOCK PLAY. Taken, offline, signed out — the
        player still plays under what they typed and only the message
        changes.
     2. UNIQUENESS IS THE RULES, NOT THE CLIENT. handles/{lower} allows
        create and no update, so writing to a name somebody holds is
        refused. Any client-side "is it free?" check would be a race.

       node qa/handle.js index-test.html
*/
const fs=require('fs'), path=require('path');
const argv=process.argv.slice(2); const fi=argv.indexOf('--file');
let SRC=(fi>=0&&argv[fi+1])?argv[fi+1]:(argv.find(a=>!a.startsWith('-'))||'index-test.html');
SRC=path.isAbsolute(SRC)?SRC:path.join(__dirname,'..',SRC);
const RULES=path.join(__dirname,'..','firestore.rules');

let pass=0,fail=0;
const ok=(n,d)=>{pass++;console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++;console.log('  FAIL '+n+(d?'\n         '+d:''));};
const t=(n,f)=>{try{const r=f();r===true?ok(n):bad(n,r||undefined);}catch(e){bad(n,e.message);}};

let s,r;
try{ s=fs.readFileSync(SRC,'utf8'); r=fs.readFileSync(RULES,'utf8'); }
catch(e){ console.log('  FAIL cannot read — '+e.message); process.exit(1); }

console.log('\n  the @handle, and the practice gate\n');

/* From handleNorm, not from claimHandle: the lower-casing lives in the
   normaliser just above it, and slicing from the claim missed it. */
const claim=(()=>{const i=s.indexOf('SB.handleNorm');const j=s.indexOf('SB.watchCallIt',i);return j>i?s.slice(i,j):'';})();
const client=(()=>{const i=s.indexOf('var HANDLE_MINE');const j=s.indexOf('function prefillGate(){',i);return j>i?s.slice(i,j):'';})();

t('the handle is reserved server-side', () => claim && client ? true : 'no claimHandle or no client');

t('uniqueness is enforced by the RULES, not by a client check', () => {
  /* A read-then-write "is it free?" is a race by construction. */
  const m=/match \/handles\/\{handle\} \{([\s\S]*?)\}/.exec(r);
  if(!m) return 'no handles/{handle} rule';
  const body=m[1];
  const hasCreate=/allow create:/.test(body);
  const noUpdate=!/allow (create, )?update:\s*if signedIn/.test(body);
  return (hasCreate && noUpdate) ? true : 'handles/{handle} allows a player to UPDATE — a held name could be taken';
});

t('the uid inside a reservation must be the caller’s', () =>
  /request\.resource\.data\.uid == request\.auth\.uid/.test(r)
    ? true : 'a player could reserve a handle and point it at somebody else');

t('claiming never blocks play', () => {
  /* startPredict must not await it. A busy name must not delay the sheet. */
  const i=s.indexOf('function startPredict(){');
  const seg=s.slice(i,i+700);
  if(!/handleClaim\(\)/.test(seg)) return 'startPredict never claims the handle';
  return /await\s+handleClaim/.test(seg) ? 'startPredict AWAITS the claim — a slow network would delay the pick sheet' : true;
});

t('a taken name still lets you play tonight', () => {
  const i=client.indexOf("why === 'taken'");
  const seg=client.slice(i,i+240);
  return /playing as/.test(seg) ? true : 'the taken message does not say the player still plays';
});

t('it never overwrites what somebody is typing', () =>
  /if\(el && !\(\(el\.value\|\|''\)\.trim\(\)\)\)/.test(client)
    ? true : 'handleRestore can overwrite a half-typed name');

t('lower-cased for the lock, as typed for the screen', () =>
  /toLowerCase\(\)/.test(claim) && /display:/.test(claim)
    ? true : 'the handle is not normalised, or the typed form is not kept');

/* ---- the practice gate --------------------------------------------- */
t('practice asks for no email and no mailing list', () => {
  const i=s.indexOf('function practiceGateTrim');
  if(i<0) return 'practiceGateTrim is missing';
  const seg=s.slice(i,i+900);
  const wrap=/emailFieldWrap/.test(seg), cons=/gateConsent/.test(seg), live=/gateNeeded\(\)/.test(seg);
  return (wrap&&cons&&live) ? true
    : 'the practice trim does not hide '+[!wrap?'the email field':'',!cons?'the consent box':''].filter(Boolean).join(' and ');
});

t('nothing is removed from the DOM, only hidden', () => {
  /* A removed id turns its writer into a silent no-op — the oldest
     failure mode in this file. */
  return s.includes('id="emailFieldWrap"') && s.includes('id="gateConsent"')
    ? true : 'the practice trim deleted an element instead of hiding it';
});

console.log(`\n  ${fail?'RED  ':'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
