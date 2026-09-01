/* ============ qa/invite.js ===========================================
   YOU CAN SHARE A BRAG. CAN YOU HAND SOMEBODY THE ROOM?

   openShare() has existed for weeks and shares a RESULT CARD — a score,
   after the fact, for a group chat. 96 people have opened a room and 6
   have ever scored, and until now the product had no mechanism at all for
   a person who enjoyed a night to produce a SECOND player. That is the
   whole funnel, and it was missing.

   These check the things that make an invite an invite rather than an
   advert, and each one is a mistake that would look fine on screen.

       node qa/invite.js
       node qa/invite.js index-test.html
*/
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
let SRC = (fi >= 0 && argv[fi+1]) ? argv[fi+1] : (argv.find(a => !a.startsWith('-')) || 'index-test.html');
SRC = path.isAbsolute(SRC) ? SRC : path.join(__dirname, '..', SRC);

let pass = 0, fail = 0;
const ok  = (n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad = (n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
const t   = (n,f)=>{ try{ const r=f(); r===true?ok(n):bad(n,r||undefined);}catch(e){bad(n,e.message);} };

let s;
try { s = fs.readFileSync(SRC,'utf8'); }
catch(e){ console.log('  FAIL cannot read '+SRC+' — '+e.message); process.exit(1); }

console.log('\n  invite — can a player hand somebody the room?');
console.log('  file  '+path.basename(SRC)+'\n');

const body = (() => {
  const i = s.indexOf('function inviteText()');
  if (i < 0) return '';
  const j = s.indexOf('function openShare(){', i);
  return j > i ? s.slice(i, j) : '';
})();

t('there is an invite control at all', () =>
  s.includes('id="landingInviteBtn"') && body ? true : 'no invite button or no inviteText()');

t('the link opens the ROOM, not the front door', () => {
  /* A link to statsgametime.com drops an invited person on whatever the
     hero happens to be showing. ?game= is how the rail opens a specific
     room and how qa/screen-copy walks them. */
  return /\?game=' \+ encodeURIComponent\(id\)/.test(body) || /\?game=/.test(body)
    ? true : 'the invite link does not carry ?game= — an invited player lands on the front door';
});

t('the link is attributable', () => {
  /* src is read at boot by TRK_SRC and written to telemetry. Without it
     the first honest answer to "does word of mouth work" is unavailable,
     and this feature exists to produce that answer. */
  return /src=invite/.test(body) ? true : 'no src=invite — an invited arrival would be indistinguishable from a direct one';
});

t('it names the game, not the product', () => {
  /* "Come play STATS" is an advert. A specific thing at a specific time
     is an invitation, and only one of those gets accepted. */
  const namesTeams = /away/.test(body) && /home/.test(body);
  const namesTime  = /tipShort|toLocaleTimeString/.test(body);
  return (namesTeams && namesTime) ? true
    : `the invite text does not name ${!namesTeams ? 'the teams' : ''}${!namesTeams && !namesTime ? ' or ' : ''}${!namesTime ? 'the time' : ''}`;
});

t('a cancelled share is not reported as a failure', () => {
  /* navigator.share REJECTS when the user backs out. Toasting "could not
     share" at somebody who simply changed their mind is worse than
     silence. */
  const i = body.indexOf('navigator.share');
  const seg = body.slice(i, i + 500);
  return /\.catch\(function\(\)\{\s*\/\*/.test(seg) || /cancelled/.test(seg)
    ? true : 'the navigator.share catch does not distinguish a cancel from an error';
});

t('it degrades all the way down', () => {
  /* Native sheet, then clipboard, then a prompt. The last one is ugly and
     always works, which is the point. */
  const steps = ['navigator.share', 'clipboard', 'prompt'];
  const miss = steps.filter(x => !body.includes(x));
  return miss.length ? 'no fallback for: ' + miss.join(', ') : true;
});

t('no room, no button', () => {
  /* A share control that produces a link to nothing is worse than none. */
  return /function paintInvite\(\)/.test(s) && /inviteText\(\) \? '' : 'none'/.test(s)
    ? true : 'the button is not hidden when there is no room to invite to';
});

t('it is not the result card wearing a new hat', () => {
  /* openShare shares a SCORE. This shares a ROOM. If inviteText ever
     starts reading the score, the two have collapsed into one feature and
     the funnel half is gone again. */
  const banned = ['scPts', 'finalPts', 'S.pts', 'scGrid'];
  const hit = banned.filter(w => body.includes(w));
  return hit.length ? 'inviteText references ' + hit.join(', ') + ' — that is the result card, not an invitation' : true;
});

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
