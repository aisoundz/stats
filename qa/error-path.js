#!/usr/bin/env node
/* ============ qa/error-path.js =======================================
   THE ERROR LOG MUST BE ABLE TO WRITE, AND IT NEVER COULD.

   Measured 30 Aug 2026 against production, before anything was changed:

       312 nights checked · 0 with any error doc · 0 error documents total

   Not one, ever. SB.logError() wrote to nights/{nightId}/errors, and NO
   RULE IN firestore.rules HAD EVER NAMED THAT PATH — so the catch-all
   `match /{document=**} { allow read, write: if false; }` denied every
   write, and the `.catch(function(){})` on it swallowed the denial. Every
   "0 error document(s)" line in every night debrief was a permission
   failure wearing the costume of a quiet night. The debrief's own comment
   had already flagged that zero was a finding rather than a clean bill of
   health; it was the stronger reading the whole time.

   And it could only ever have reported from INSIDE a night. `if (!nightId)
   return false` meant the home page, the landing page, the signup form,
   sign-in and every email field — every place a stranger actually is —
   could not report a failure even in principle. That is why a signup that
   could not be submitted survived four days and two people.

   This suite guards the three things that made the silence possible. It
   reads the rules file and the app source, so it runs static and cannot
   be fooled by a browser that happens to be online.
   ================================================================== */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = process.env.ERR_APP || path.join(ROOT, 'index-test.html');
const RULES = process.env.ERR_RULES || path.join(ROOT, 'firestore.rules');

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? '   ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

console.log('qa/error-path.js — a failure that cannot be written down did not happen');

let app = '', rules = '';
try { app = fs.readFileSync(APP, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + APP); process.exit(1); }
try { rules = fs.readFileSync(RULES, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + RULES); process.exit(1); }

/* Comments in both files quote the old broken code on purpose. */
const code = app.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const rcode = rules.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                   .replace(/^(\s*)\/\/.*$/gm, (m, s) => s);

/* ---- THE RULES ------------------------------------------------------ */

t('the in-night error path is named by a rule', () =>
  /match \/nights\/\{nightId\}\/errors\/\{[A-Za-z]+\}/.test(rcode) ||
  'nothing in firestore.rules names nights/{nightId}/errors, so the catch-all denies every '
  + 'write — which is how 312 nights produced zero error documents');

t('the front door has an error path of its own', () =>
  /match \/errors\/\{[A-Za-z]+\}/.test(rcode) ||
  'there is no top-level errors collection, so nothing that happens before somebody joins a '
  + 'night — the home page, the signup form, sign-in — can be reported at all');

t('players may write an error and may never read one back', () => {
  const blocks = rcode.match(/match \/(nights\/\{nightId\}\/)?errors\/\{[A-Za-z]+\}[\s\S]*?\n    \}/g) || [];
  if (blocks.length < 2) return `expected 2 error rule blocks, found ${blocks.length}`;
  const badOnes = blocks.filter(b => !/allow read:\s*if isOwner\(\)/.test(b));
  return badOnes.length
    ? 'an error rule allows a read by somebody other than the owner — an error row carries '
      + "another person's uid and user agent"
    : true;
});

t('the catch-all is still last and still closed', () => {
  const i = rcode.indexOf('match /{document=**}');
  if (i < 0) return 'the catch-all is gone — everything not named is now undefined, not closed';
  const after = rcode.slice(i);
  if (!/allow read, write: if false/.test(after)) return 'the catch-all no longer denies';
  const later = (rcode.slice(i).match(/match \//g) || []).length;
  return later === 1 ? true : 'a match block was added AFTER the catch-all, where it cannot take effect';
});

/* ---- THE CLIENT ----------------------------------------------------- */

t('no night is no longer a reason to stay silent', () => {
  const fn = (code.match(/SB\.logError = function[\s\S]*?\n  \};/) || [''])[0];
  if (!fn) return 'cannot find SB.logError';
  if (/if \(!SB\.enabled \|\| !nightId\) return false;/.test(fn))
    return 'SB.logError still bails when there is no night, so every failure at the front door '
         + 'is unreportable by design';
  return true;
});

t('it falls back to the top-level collection', () => {
  const fn = (code.match(/SB\.logError = function[\s\S]*?\n  \};/) || [''])[0];
  return /F\.collection\(db, 'errors'\)/.test(fn) ||
    "SB.logError never targets the top-level 'errors' collection, so a report outside a night "
    + 'has nowhere to go';
});

t('a rejected error write is not swallowed', () => {
  const fn = (code.match(/SB\.logError = function[\s\S]*?\n  \};/) || [''])[0];
  if (/\}\)\.catch\(function \(\) \{\}\);/.test(fn))
    return 'the write still ends in an empty catch — this is the exact line that hid 312 nights '
         + 'of permission denials';
  return /catch\(function \(e\) \{[\s\S]{0,400}?console\.error/.test(fn) ||
    'the error-log write does not report its own failure. If the error log cannot write, that is '
    + 'the one failure that must never be quiet — it makes every other failure invisible';
});

t('a failed signup files a report', () =>
  /SB\.logError\('signup'/.test(code) ||
  'a failed signup still only writes to the browser console, which is not a place anybody will '
  + 'look. It is the only conversion this product has');

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
