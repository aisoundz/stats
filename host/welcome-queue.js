#!/usr/bin/env node
/* =====================================================================
   THE WELCOME QUEUE — a draft waiting whenever somebody new signs up.
   ---------------------------------------------------------------------
   27 Aug 2026. MailerLite has an automation that would do this by itself
   — "Welcome — new signup", trigger `subscriber_joins_group` on STATS,
   one email, "You're in". It is built, its email is complete, its
   trigger is valid, and it CANNOT BE SWITCHED ON FROM THE API.

   That is not a guess. PUT /api/automations/{id} with {"enabled":true}
   returns HTTP 200 and leaves `enabled` false; there is no
   /activate route; PATCH and POST are 405. The workflow reports
   `complete: false` and only MailerLite's own builder can flip that.
   An API that answers 200 and changes nothing is the exact failure this
   shop has been bitten by before, so it is written down here rather
   than rediscovered.

   So this is the manual path, made reliable. Every morning it asks who
   is in the STATS group that has never been welcomed, and if there is
   anyone it leaves a DRAFT campaign addressed to exactly those people.

   IT SENDS. That is a deliberate exception to the rule every other
   outward email here follows, granted explicitly on 27 Aug: "yes make it
   send automatically". A welcome that waits for a human is not a welcome,
   it is a delay, and the person who just signed up is the one person
   guaranteed to be paying attention right now.

   THE EXCEPTION IS PAID FOR WITH FOUR GUARDS, because a machine sending
   mail in the founder's name with nobody reading it first is exactly how
   a list gets burned:

     1. MAX_PER_RUN. More new people than this in one run means something
        is wrong with the reckoning — a state file lost, a group
        re-imported — and mailing the whole list a second welcome is not
        recoverable. Over the cap it DRAFTS and shouts, and a human looks.
     2. Never a retry on the send. A timeout on the schedule call is
        ambiguous: it may already have gone. Retrying an ambiguous send
        risks sending twice, which is worse than sending zero times.
        [[signal_double_send]] is what that costs.
     3. Nobody is marked welcomed until MailerLite reports the campaign
        `sent`. Attempting is not delivering.
     4. Active addresses only, and only people absent from `welcomed`.

   --draft-only restores the old behaviour for testing without mailing a
   living person. When the founder switches the real automation on in the
   dashboard, delete the cron line and this file stops mattering.

   WHY A GROUP AND NOT A LIST OF ADDRESSES. A MailerLite campaign is
   addressed to a group or a segment, never to an array of emails. So
   the new arrivals are put into one reusable group, WELCOME_GROUP, and
   the draft is addressed to that. The group is emptied at the start of
   every run that builds a draft, so it only ever holds the people the
   current draft is for.

   WHAT STOPS A SECOND WELCOME. Two things, because one is not enough:

     1. `welcomed` in the state file — everyone who has provably been
        sent one. On the very first run this is seeded with whoever is
        in STATS already, because campaign 196932195877651746 went to
        all seven of them on 27 Aug. Seeding is the difference between
        "nobody is new" and "everybody is new", and getting it wrong
        would mail the whole list a second welcome.

     2. A pending draft blocks another. If last run left a draft and it
        has not been sent yet, this run adds nothing and changes
        nothing. Otherwise a week of unsent drafts becomes a week of
        duplicate welcomes the day someone finally clicks send.

   A person only moves into `welcomed` once the campaign carrying them
   reports status `sent`. Drafting is not delivering, and this file is
   not allowed to confuse the two.

       node host/welcome-queue.js
       node host/welcome-queue.js --dry-run    # decides, writes nothing
   ================================================================== */

const fs = require('fs');
const path = require('path');
const https = require('https');

const KEYFILE      = path.join(process.env.HOME, '.secrets', 'mailerlite-api-key');
const TEMPLATE     = path.join(__dirname, 'email-welcome-template.html');
const LOG          = path.join(process.env.HOME, 'gamenight-logs', 'welcome-queue.log');
const STATE        = path.join(process.env.HOME, 'gamenight-logs', 'welcome-state.json');

const STATS_GROUP  = '194583072792904930';          // the group the signup form files into
const WELCOME_GROUP_NAME = 'Welcome pending';
const SUBJECT      = 'Welcome to STATS GAMETIME';

const DRY = process.argv.includes('--dry-run');
const DRAFT_ONLY = process.argv.includes('--draft-only');

/* More than this many new people in one run is not a good week, it is a
   broken reckoning — a lost state file, a re-imported group. Mailing a
   list a second welcome cannot be taken back, so over the cap this
   refuses to send, leaves a draft, and says so loudly. */
const MAX_PER_RUN = 25;

function log(line) {
  const msg = `${new Date().toISOString()}  ${line}\n`;
  process.stdout.write(msg);
  try { fs.appendFileSync(LOG, msg); } catch (_) {}
}

function req(url, opts) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, opts || {}, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed || body });
      });
    });
    r.on('error', reject);
    if (opts && opts._payload) r.write(opts._payload);
    r.end();
  });
}

/* Connection failures only, never a real HTTP answer — the same rule
   send-tipoff-auto.js follows and for the same reason. Every call in
   this file is safe to retry: the writes are idempotent (assigning a
   subscriber to a group twice is the same as once) and the one call
   that would not be — a send — does not exist here. */
const RETRYABLE = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);
async function reqRetry(url, opts, tries) {
  tries = tries || 3;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await req(url, opts); }
    catch (e) {
      const code = (e && e.code) || (e && e.cause && e.cause.code) || '';
      if (attempt === tries || !RETRYABLE.has(code)) throw e;
      log(`  (${code || e.message} on attempt ${attempt}/${tries} — retrying in ${attempt}s)`);
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch (_) { return null; }
}
function writeState(s) {
  if (DRY) { log('  (dry run — state not written)'); return; }
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

(async () => {
  log('=== welcome-queue starting ===' + (DRY ? '  (DRY RUN)' : ''));

  let KEY;
  try { KEY = fs.readFileSync(KEYFILE, 'utf8').trim(); }
  catch (e) { log(`REFUSE: cannot read ${KEYFILE} — ${e.message}`); process.exit(1); }

  const H = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
  const HJ = Object.assign({ 'Content-Type': 'application/json' }, H);
  const get = (u) => reqRetry(u, { method: 'GET', headers: H });
  const post = (u, o) => reqRetry(u, { method: 'POST', headers: HJ, _payload: JSON.stringify(o || {}) });
  const del = (u) => reqRetry(u, { method: 'DELETE', headers: H });

  /* ---- 1. who is in STATS right now -------------------------------- */
  const gr = await get(`https://connect.mailerlite.com/api/groups/${STATS_GROUP}/subscribers?limit=200`);
  if (gr.status !== 200 || !gr.body || !Array.isArray(gr.body.data)) {
    log(`REFUSE: could not read the STATS group (status ${gr.status}). Nothing drafted.`);
    process.exit(1);
  }
  /* Active only. A bounced address is not a person waiting to be
     welcomed, and `you@email.com` — a placeholder somebody typed into
     the form — is exactly why this filter is here. */
  const members = gr.body.data
    .filter((s) => s.status === 'active')
    .map((s) => ({ id: String(s.id), email: String(s.email || '').toLowerCase() }))
    .filter((s) => s.email);
  log(`STATS group: ${members.length} active`);

  /* ---- 2. seed, or load ------------------------------------------- */
  let state = readState();
  if (!state) {
    state = { welcomed: members.map((m) => m.email), pending: null, seededAt: new Date().toISOString() };
    log(`first run — seeding ${state.welcomed.length} already-welcomed address(es); campaign`);
    log('  196932195877651746 went to all of them on 27 Aug. Nothing drafted this run.');
    writeState(state);
    process.exit(0);
  }
  state.welcomed = state.welcomed || [];

  /* ---- 3. settle a pending draft before making another ------------- */
  if (state.pending && state.pending.campaignId) {
    const c = await get(`https://connect.mailerlite.com/api/campaigns/${state.pending.campaignId}`);
    const status = c.status === 200 && c.body && c.body.data ? c.body.data.status : null;
    if (status === 'sent') {
      const n = (state.pending.emails || []).length;
      state.welcomed = state.welcomed.concat(state.pending.emails || []);
      log(`the pending draft was sent — ${n} address(es) now recorded as welcomed`);
      state.pending = null;
      writeState(state);
    } else if (status === null) {
      /* Deleted from the dashboard, or unreadable. Either way it will
         never be sent, so the people on it are still owed a welcome and
         must NOT be marked welcomed. Drop the pointer and let the next
         block re-draft for them. */
      log('the pending campaign is gone — dropping the pointer, those people stay unwelcomed');
      state.pending = null;
      writeState(state);
    } else {
      log(`a draft from ${state.pending.createdAt} is still waiting to be sent `
        + `(campaign ${state.pending.campaignId}, ${(state.pending.emails || []).length} person(s)).`);
      log('SKIP: not stacking a second draft on top of it. Send or delete that one first.');
      process.exit(0);
    }
  }

  /* ---- 4. anyone new? --------------------------------------------- */
  const known = new Set(state.welcomed.map((e) => String(e).toLowerCase()));
  const fresh = members.filter((m) => !known.has(m.email));
  if (!fresh.length) {
    log('no new subscribers since the last welcome. Nothing drafted.');
    process.exit(0);
  }
  log(`${fresh.length} new subscriber(s): ${fresh.map((f) => f.email).join(', ')}`);
  if (DRY) { log('dry run — stopping before any write.'); process.exit(0); }

  /* ---- 5. the group the draft is addressed to ---------------------- */
  const gl = await get('https://connect.mailerlite.com/api/groups?limit=100');
  let wg = ((gl.body && gl.body.data) || []).find((g) => g.name === WELCOME_GROUP_NAME);
  if (!wg) {
    const mk = await post('https://connect.mailerlite.com/api/groups', { name: WELCOME_GROUP_NAME });
    wg = mk.body && mk.body.data;
    if (!wg) { log(`REFUSE: could not create the "${WELCOME_GROUP_NAME}" group. Nothing drafted.`); process.exit(1); }
    log(`created the "${WELCOME_GROUP_NAME}" group (${wg.id})`);
  }

  /* Empty it first. It holds the audience for ONE draft; anyone left in
     from a previous run would be welcomed twice. */
  const cur = await get(`https://connect.mailerlite.com/api/groups/${wg.id}/subscribers?limit=200`);
  for (const s of ((cur.body && cur.body.data) || [])) {
    await del(`https://connect.mailerlite.com/api/subscribers/${s.id}/groups/${wg.id}`);
  }
  for (const f of fresh) {
    const a = await post(`https://connect.mailerlite.com/api/subscribers/${f.id}/groups/${wg.id}`, {});
    if (a.status >= 300) log(`  WARN: could not add ${f.email} to the group (status ${a.status})`);
  }
  log(`"${WELCOME_GROUP_NAME}" now holds exactly the ${fresh.length} new person(s)`);

  /* ---- 6. the draft ------------------------------------------------ */
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); }
  catch (e) { log(`REFUSE: cannot read the welcome template — ${e.message}`); process.exit(1); }

  const made = await post('https://connect.mailerlite.com/api/campaigns', {
    name: `Welcome — ${fresh.length} new signup(s), ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())}`,
    type: 'regular',
    groups: [String(wg.id)],
    emails: [{ subject: SUBJECT, from: 'play@statsgametime.com', from_name: 'STATS GAMETIME', content: html }]
  });
  const camp = made.body && made.body.data;
  if (made.status >= 300 || !camp) {
    log(`REFUSE: campaign creation failed (status ${made.status}) — ${JSON.stringify(made.body).slice(0, 300)}`);
    process.exit(1);
  }

  /* An API that answers 200 and does nothing is the reason this file
     exists at all, so the draft is read back rather than assumed. */
  const back = await get(`https://connect.mailerlite.com/api/campaigns/${camp.id}`);
  const bd = back.body && back.body.data;
  const gotContent = ((bd && bd.emails && bd.emails[0] && bd.emails[0].content) || '').length;
  log(`campaign ${camp.id} — "${SUBJECT}" to ${fresh.length} person(s), ${gotContent} bytes of content`);

  state.pending = {
    campaignId: String(camp.id),
    emails: fresh.map((f) => f.email),
    createdAt: new Date().toISOString()
  };
  writeState(state);

  /* ---- 7. send it, or refuse and leave it for a human -------------- */
  if (!gotContent) {
    log('REFUSE TO SEND: the campaign read back with NO content. Left as a draft for a human.');
    process.exit(1);
  }
  if (DRAFT_ONLY) { log('--draft-only: leaving it as a draft.'); process.exit(0); }
  if (fresh.length > MAX_PER_RUN) {
    log(`REFUSE TO SEND: ${fresh.length} new people in one run is over the cap of ${MAX_PER_RUN}.`);
    log('  That is a broken reckoning, not a good week. Left as a draft — a human should look.');
    process.exit(1);
  }

  /* NO RETRY HERE, DELIBERATELY, and this is the one call in the file
     that uses req() instead of reqRetry(). A timeout on a send is
     ambiguous: MailerLite may already have acted on it before the
     response was lost. Sending twice is unrecoverable; sending zero
     times leaves a draft and a log line a human can act on. */
  const sent = await req(`https://connect.mailerlite.com/api/campaigns/${camp.id}/schedule`, {
    method: 'POST', headers: HJ, _payload: JSON.stringify({ delivery: 'instant' })
  });
  if (sent.status >= 300) {
    log(`send failed (status ${sent.status}) — ${JSON.stringify(sent.body).slice(0, 200)}`);
    log('  left as a draft. Nobody was marked welcomed.');
    process.exit(1);
  }
  log(`sent — ${fresh.length} welcome(s) on their way`);

  /* ---- 8. and nobody is welcomed until MailerLite says so ---------- */
  /* `status: sent` flips before the counters populate — measured on the
     27 Aug tip-off, which read "sent, 0 delivered" for a minute before
     settling at 7/7. So this waits for finished_at, which is the field
     that actually means the send drained, and reports what it finds
     rather than what it hoped. */
  let done = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const c = await get(`https://connect.mailerlite.com/api/campaigns/${camp.id}`);
    const cd = c.body && c.body.data;
    if (cd && cd.finished_at) { done = cd; break; }
  }
  if (!done) {
    log('the send has not reported finished after two minutes. NOT marking anyone welcomed —');
    log('  the next run will settle it from the campaign status rather than guess.');
    process.exit(0);
  }
  const st = done.stats || {};
  log(`delivered ${st.deliveries_count}/${st.sent}  ·  bounces ${st.hard_bounces_count} hard`);
  state.welcomed = state.welcomed.concat(state.pending.emails || []);
  state.pending = null;
  writeState(state);
  log(`${(done.stats || {}).sent || 0} address(es) recorded as welcomed. Done.`);
  process.exit(0);
})().catch((e) => { log(`CRASHED: ${(e && e.stack) || e}`); process.exit(1); });
