#!/usr/bin/env node
/* =====================================================================
   EXACTLY ONE DRAFT TODAY, CARRYING THE COPY A HUMAN APPROVED.
   ---------------------------------------------------------------------
   29 Aug 2026. Founder, on the approved preview: "I like it. Make sure to
   send it on time."

   "On time" is the hard part, and it is not a wording problem. The draft
   is written at 09:13 by a cloud routine this box does not schedule and
   cannot inspect, and the send now fires at 09:35 because Saturday's
   first room is at 10:00. Between those two moments nobody was
   guaranteeing what the draft said. Relying on a person being at a
   keyboard at 09:26 to check is not a guarantee, it is a hope.

   So this runs at 09:26 and leaves the account in exactly one state:
   ONE draft, created today, carrying the approved HTML.

     0 drafts   the cloud routine did not run. Create one, because a
                missing email is the failure that actually costs a night.
     1 draft    overwrite its content and subject with the approved copy.
     2 or more  keep the oldest, delete the rest, then overwrite. This is
                the state host/send-tipoff-auto.js REFUSES to send from,
                and refusing means no email at all, so resolving it is
                the whole point of running.

   IT NEVER SENDS. send-tipoff-auto.js at 09:35 does that, and it does its
   own verification. This only guarantees what that finds.

   A 2xx IS NOT A WRITE. Every mutation is read back and compared before
   this reports success, because a PUT with `content` at the top level
   returns 200 and changes nothing: the content lives under emails[].
   That exact call has already cost this project a silent morning.

       node host/tipoff-ensure.js <html-file> <copy-json> [--apply]
   ================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');

const APPLY = process.argv.includes('--apply');
const args = process.argv.slice(2).filter((a) => a[0] !== '-');
const HTML_FILE = args[0];
const COPY_FILE = args[1];
const LOG = path.join(process.env.HOME, 'gamenight-logs', 'tipoff-ensure.log');
const KEYFILE = path.join(process.env.HOME, '.secrets', 'mailerlite-api-key');
const STATS_GROUP = '194583072792904930';
const FROM = 'play@statsgametime.com';
const FROM_NAME = 'STATS GAMETIME';

function log(line) {
  const m = `${new Date().toISOString()}  ${line}\n`;
  process.stdout.write(m);
  try { fs.appendFileSync(LOG, m); } catch (_) {}
}

if (!HTML_FILE || !COPY_FILE) {
  console.error('usage: node host/tipoff-ensure.js <html-file> <copy-json> [--apply]');
  process.exit(1);
}

const KEY = fs.readFileSync(KEYFILE, 'utf8').trim();
const HTML = fs.readFileSync(HTML_FILE, 'utf8');
const COPY = JSON.parse(fs.readFileSync(COPY_FILE, 'utf8'));

function req(method, p, body) {
  return new Promise((res, rej) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = https.request('https://connect.mailerlite.com' + p, {
      method,
      headers: Object.assign({
        Authorization: 'Bearer ' + KEY, Accept: 'application/json',
      }, payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    }, (s) => {
      let b = ''; s.on('data', (d) => (b += d));
      s.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {}
        res({ status: s.statusCode, body: j, raw: b }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* MailerLite returns timestamps with no zone and they are UTC. Read as
   local they say 4:23 PM for a 9:23 AM draft, which is how the draft
   check came to be scheduled ahead of the thing it checks. */
const utcDay = (s) => String(s || '').slice(0, 10);

(async () => {
  log('=== tipoff-ensure starting ' + (APPLY ? '(APPLY)' : '(dry run)') + ' ===');
  const today = todayPT();

  /* ============ THE COPY MUST BE FOR TODAY ==========================
     This is armed by a cron line and the approved HTML is a file on
     disk. Left alone, it would cheerfully push Saturday's email into
     Sunday's draft and send it: yesterday's rooms, yesterday's question,
     a settle that settles nothing. That is the precise failure
     send-tipoff-auto.js already refuses on ("Never send yesterday's
     draft"), and it would arrive here through the door meant to make
     today's send reliable.

     So the copy names its own day and this refuses if it is not today.
     Silence on the wrong day is correct; a wrong email is not. */
  if (COPY.date && COPY.date !== today) {
    log(`REFUSE: this copy is dated ${COPY.date} and today is ${today}. Nothing changed.`);
    log('That is correct behaviour, not a fault: an edition is for one day.');
    process.exit(0);
  }

  const wantSubject = COPY.subject;
  const wantName = COPY.name || `Tip-off, ${new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  log(`today (PT) = ${today} · approved html = ${HTML.length} bytes`);

  const list = await req('GET', '/api/campaigns?filter[status]=draft&limit=50');
  if (list.status !== 200 || !list.body || !Array.isArray(list.body.data)) {
    log(`REFUSE: could not list drafts (status ${list.status}). Nothing changed.`);
    process.exit(2);
  }
  const mine = list.body.data
    .filter((c) => utcDay(c.created_at) === today)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  log(`drafts created today: ${mine.length}${mine.length ? ' — ' + mine.map((c) => c.id).join(', ') : ''}`);

  if (!APPLY) {
    log(mine.length === 0 ? 'would CREATE one draft with the approved copy'
      : mine.length === 1 ? `would OVERWRITE ${mine[0].id} with the approved copy`
      : `would DELETE ${mine.length - 1} extra draft(s) and overwrite ${mine[0].id}`);
    log('dry run — nothing written. Add --apply.');
    return;
  }

  /* More than one is the state the sender refuses on. Keep the oldest,
     which is the cloud routine's, so the campaign the account already
     knows about is the one that survives. */
  for (const extra of mine.slice(1)) {
    const d = await req('DELETE', '/api/campaigns/' + extra.id);
    log(`deleted extra draft ${extra.id} — status ${d.status}`);
  }

  let id = mine.length ? mine[0].id : null;

  if (!id) {
    const created = await req('POST', '/api/campaigns', {
      name: wantName, type: 'regular', groups: [STATS_GROUP],
      emails: [{ subject: wantSubject, from: FROM, from_name: FROM_NAME, reply_to: FROM, content: HTML }],
    });
    if (created.status >= 300 || !created.body || !created.body.data) {
      log(`REFUSE: create failed (status ${created.status}) ${String(created.raw).slice(0, 300)}`);
      process.exit(2);
    }
    id = created.body.data.id;
    log(`created draft ${id}`);
  } else {
    /* ============ THE AUDIENCE MUST BE RESTATED ====================
       29 Aug 2026. This update omitted `groups`, and MailerLite treats an
       update as the whole campaign: it cleared the recipient list. The
       send then reported "SENT AND CONFIRMED" and reached ZERO people,
       against 10 the day before. An email that goes nowhere is worse than
       one that does not go, because everything downstream says it worked.
       Every field the campaign needs is restated on every write. */
    const upd = await req('PUT', '/api/campaigns/' + id, {
      name: wantName,
      groups: [STATS_GROUP],
      emails: [{ subject: wantSubject, from: FROM, from_name: FROM_NAME, reply_to: FROM, content: HTML }],
    });
    if (upd.status >= 300) {
      log(`REFUSE: update failed (status ${upd.status}) ${String(upd.raw).slice(0, 300)}`);
      process.exit(2);
    }
    log(`updated draft ${id} — status ${upd.status}`);
  }

  /* ============ READ IT BACK. A 2xx IS NOT A WRITE. ================== */
  const back = await req('GET', '/api/campaigns/' + id);
  const email = ((back.body && back.body.data && back.body.data.emails) || [])[0] || {};
  const gotHtml = String(email.content || '');
  const okSubject = email.subject === wantSubject;
  /* NOT byte equality. MailerLite rewraps what it stores (8,662 in ->
     11,690 held), so comparing lengths reported a mismatch on a write
     that had worked perfectly, twice. What matters is that OUR copy is
     what is in there, so check a distinctive line from the approved
     edition and that the audience survived. */
  const marker = String((COPY.question && COPY.question.text) || '').slice(0, 40);
  const okHtml = !!marker && gotHtml.indexOf(marker) >= 0;

  log(`read back: subject ${okSubject ? 'matches' : 'DOES NOT MATCH — "' + email.subject + '"'}`);
  log(`read back: content ${okHtml ? 'is ours (' + gotHtml.length + ' bytes after MailerLite rewrap)' : 'IS NOT OURS — the approved question is not in the stored draft'}`);
  /* `groups` is NOT populated by this endpoint, on a draft or on a sent
     campaign, so checking it reported an empty audience on a campaign
     that was correctly addressed to ten people. The field that actually
     answers "who will this reach" is recipients_count, with the filter
     as the human-readable version of the same thing. */
  const rc = Number((back.body && back.body.data && back.body.data.recipients_count) || 0);
  const who = ((back.body && back.body.data && back.body.data.filter_for_humans) || []).flat().join(', ');
  const okAudience = rc > 0;
  log(`read back: audience ${okAudience ? rc + ' recipient(s) — ' + (who || 'filter set') : 'ZERO RECIPIENTS — this would send to nobody'}`);

  const after = await req('GET', '/api/campaigns?filter[status]=draft&limit=50');
  const n = ((after.body && after.body.data) || []).filter((c) => utcDay(c.created_at) === today).length;
  log(`drafts created today, after: ${n}`);

  if (!okSubject || !okHtml || !okAudience || n !== 1) {
    log('NOT SETTLED. The 09:35 send may refuse or send the wrong copy. Fix by hand.');
    process.exit(2);
  }
  log(`SETTLED: exactly one draft (${id}) carrying the approved copy. The send fires at 09:35 PT.`);
})().catch((e) => { log('CRASHED: ' + ((e && e.stack) || e)); process.exit(1); });
