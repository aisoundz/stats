#!/usr/bin/env node
/* =====================================================================
   NOBODY WHO CONSENTED IS LEFT OFF THE LIST.
   ---------------------------------------------------------------------
   30 Aug 2026. Two people typed an address into this product and got
   nothing back — a guest on 26 Aug in front of the founder, and somebody
   on the morning of the 30th. The first was written down that day as
   priority #2: "the only conversion the product has, and it may be
   broken."

   It was broken in two places. The browser could not submit at all
   (there is no <form> in the app and no key handler on any email field,
   fixed separately), and the hand-off to MailerLite was fire-and-forget
   with its failures swallowed. Measured that morning: `signups/` held 12
   documents, the mailing list held 11 subscribers, and they were not the
   same 11 — one address had reached Firestore on 29 Aug at 6:29 PM and
   never reached the list at all.

   THE BROWSER CANNOT FIX THIS. The public form endpoint is opaque to the
   page, by design, because the alternative is an API key in a static
   file on GitHub Pages. So the page does best effort and this holds the
   guarantee, with the key, on this machine.

   CONSENT IS THE ONLY THING THAT PUTS SOMEBODY ON THE LIST. A row in
   `signups/` IS the record of consent — that is what that collection is
   for. An account in Firebase Auth is NOT: somebody can sign in to play
   without ever asking to be emailed, and adding those addresses because
   we happen to hold them would be exactly the thing a mailing list must
   never do. Auth is therefore REPORTED here and never acted on.

       node host/list-reconcile.js            # say what is missing
       node host/list-reconcile.js --apply    # put them on the list
   ================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');

const APPLY = process.argv.includes('--apply');
const KEYFILE = path.join(process.env.HOME, '.secrets', 'mailerlite-api-key');
const LOG = path.join(process.env.HOME, 'gamenight-logs', 'list-reconcile.log');
const GROUP_NAME = 'STATS';

function log(line) {
  const msg = `${new Date().toISOString()}  ${line}\n`;
  process.stdout.write(msg);
  try { fs.appendFileSync(LOG, msg); } catch (_) {}
}

function api(pathname, opts, payload) {
  return new Promise((resolve, reject) => {
    const o = Object.assign({ method: 'GET' }, opts || {});
    o.headers = Object.assign({
      Authorization: 'Bearer ' + KEY,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }, o.headers || {});
    const r = https.request('https://connect.mailerlite.com' + pathname, o, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (_) {}
        resolve({ status: res.statusCode, body: j || b });
      });
    });
    r.on('error', reject);
    if (payload) r.write(JSON.stringify(payload));
    r.end();
  });
}

let KEY;
try { KEY = fs.readFileSync(KEYFILE, 'utf8').trim(); }
catch (e) { log(`REFUSE: cannot read ${KEYFILE} — ${e.message}`); process.exit(1); }

const norm = (e) => String(e || '').trim().toLowerCase();

(async () => {
  log(`=== list-reconcile ${APPLY ? '(APPLY)' : '(dry run — nothing is written)'} ===`);

  /* ---- who consented ------------------------------------------------ */
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { log('REFUSE: FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  const snap = await db.collection('signups').get();
  const consented = new Map();          // email -> {uid, name, at}
  snap.forEach((d) => {
    const v = d.data() || {};
    const e = norm(v.email || v.addr);
    if (!e || e.indexOf('@') < 0) return;
    const at = (v.at && v.at.toDate) ? v.at.toDate() : null;
    consented.set(e, { uid: d.id, name: v.name || v.handle || '', at });
  });
  log(`signups/ holds ${snap.size} document(s) · ${consented.size} distinct address(es) with consent`);

  /* ---- who is on the list ------------------------------------------- */
  const groups = await api('/api/groups?limit=100');
  const group = ((groups.body && groups.body.data) || []).find((g) => g.name === GROUP_NAME);
  if (!group) { log(`REFUSE: no MailerLite group named "${GROUP_NAME}".`); process.exit(1); }

  const onList = new Set();
  let page = 1;
  for (;;) {
    const r = await api(`/api/groups/${group.id}/subscribers?limit=100&page=${page}`);
    const rows = (r.body && r.body.data) || [];
    rows.forEach((s) => onList.add(norm(s.email)));
    if (rows.length < 100) break;
    page++;
    if (page > 40) break;                       // never loop forever
  }
  log(`group "${GROUP_NAME}" (${group.id}) holds ${onList.size} subscriber(s)`);

  /* ---- the gap ------------------------------------------------------ */
  const missing = [...consented.entries()].filter(([e]) => !onList.has(e));

  /* Reported, never acted on — see the header. An account is not consent. */
  const authOnly = [];
  try {
    let tok;
    const all = new Set();
    do {
      const r = await admin.auth().listUsers(1000, tok);
      r.users.forEach((u) => { if (u.email) all.add(norm(u.email)); });
      tok = r.pageToken;
    } while (tok);
    all.forEach((e) => { if (!onList.has(e) && !consented.has(e)) authOnly.push(e); });
  } catch (e) { log(`(could not read Auth: ${e.message})`); }

  if (authOnly.length) {
    log(`${authOnly.length} address(es) have an ACCOUNT but no consent row. NOT added — an account is not consent:`);
    authOnly.forEach((e) => log(`    ${e}`));
    log('    If any of them asked to be emailed, add the consent first, not the subscription.');
  }

  if (!missing.length) {
    log('Every consented address is on the list. Nothing to do.');
    process.exit(0);
  }

  log(`${missing.length} CONSENTED ADDRESS(ES) ARE NOT ON THE LIST:`);
  missing.forEach(([e, v]) => log(`    ${e}${v.name ? '  (' + v.name + ')' : ''}${v.at ? '  consented ' + v.at.toISOString().slice(0, 16) : ''}`));

  if (!APPLY) {
    log('Dry run. Re-run with --apply to place them on the list.');
    process.exit(2);
  }

  /* ---- put them on it ----------------------------------------------- */
  let ok = 0, bad = 0;
  for (const [email, v] of missing) {
    const r = await api('/api/subscribers', { method: 'POST' }, {
      email,
      fields: v.name ? { name: String(v.name).slice(0, 40) } : {},
      groups: [String(group.id)],
    });
    if (r.status >= 200 && r.status < 300) { ok++; log(`  added ${email}`); }
    else { bad++; log(`  FAILED ${email} — HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); }
  }

  /* VERIFY THE EFFECT, NOT THE STATUS CODE. A 2xx is not a subscriber:
     this project has twice believed an API that returned success and did
     nothing. Read the group back and count. */
  const after = new Set();
  let p2 = 1;
  for (;;) {
    const r = await api(`/api/groups/${group.id}/subscribers?limit=100&page=${p2}`);
    const rows = (r.body && r.body.data) || [];
    rows.forEach((s) => after.add(norm(s.email)));
    if (rows.length < 100) break;
    p2++; if (p2 > 40) break;
  }
  const stillMissing = missing.filter(([e]) => !after.has(e));
  log(`reported added ${ok}, failed ${bad}. Group now holds ${after.size} (was ${onList.size}).`);
  if (stillMissing.length) {
    log(`STILL MISSING AFTER THE WRITE — the API accepted these and did not add them:`);
    stillMissing.forEach(([e]) => log(`    ${e}`));
    process.exit(2);
  }
  log('Verified: every consented address is now on the list.');
  process.exit(0);
})().catch((e) => { log('CRASHED: ' + ((e && e.stack) || e)); process.exit(1); });
