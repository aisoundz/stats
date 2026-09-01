#!/usr/bin/env node
/* =====================================================================
   CHECK THE DRAFT AT 09:20, WHILE THERE IS STILL TIME TO FIX IT.
   ---------------------------------------------------------------------
   28 Aug 2026. The tip-off went out missing its STATS card and its
   "Last night, settled" block. The rule for both has been in
   EMAIL-VOICE.md for weeks; nothing checked it, so half the email
   quietly disappeared and the founder found out after it had sent.

   The send-time verification catches it now — but at 10:45 the only
   choices are refuse or warn, and neither of those puts a STATS card
   back. Founder: "fix the draft check at 9:13."

   So this runs at 09:20, minutes after the drafting routine writes the
   draft and NINETY MINUTES before the send. At that hour a missing
   section is a thing that can still be added.

   IT NEVER SENDS AND IT NEVER EDITS. It reads the draft, holds it
   against the shape rules in email-shape.js — the same file the sender
   uses, so the two cannot drift — and writes a verdict where a human
   and the morning report can both find it.

       node host/check-draft.js
       node host/check-draft.js --json
   ================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');
const SHAPE = require('./email-shape.js');
const { dayPlan, hhmm } = require('./tipoff-when.js');

const KEYFILE = path.join(process.env.HOME, '.secrets', 'mailerlite-api-key');
const LOG     = path.join(process.env.HOME, 'gamenight-logs', 'check-draft.log');
const VERDICT = path.join(process.env.HOME, 'gamenight-logs', 'draft-verdict.json');
const FIREBASE_KEY = 'AIzaSyB1g4u3L85sks1Phjz_Tim98urv1-IZBps'; // public web key
const PROJECT = 'stats-gametime';

const JSON_ONLY = process.argv.includes('--json');

function log(line) {
  const msg = `${new Date().toISOString()}  ${line}\n`;
  if (!JSON_ONLY) process.stdout.write(msg);
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

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* Tonight's rooms, read the same way the sender reads them: straight
   from the published slate, so "what the email should name" is never
   an assumption. */
async function slateRooms(date) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/slate/${date}?key=${FIREBASE_KEY}`;
  const r = await req(url, { method: 'GET' });
  const f = r.body && r.body.fields;
  if (!f || !f.games || !f.games.arrayValue) return [];
  return (f.games.arrayValue.values || []).map((v) => {
    const g = (v.mapValue && v.mapValue.fields) || {};
    const s = (k) => (g[k] && g[k].stringValue) || '';
    return { nightId: s('nightId'), away: s('away'), home: s('home'), tipISO: s('tipISO') };
  }).filter((g) => g.nightId);
}

/* =====================================================================
   DOES THE EMAIL ARRIVE BEFORE THE GAMES IT IS ABOUT?
   ---------------------------------------------------------------------
   29 Aug 2026. The send fires at 10:45 PT every day — a time chosen when
   every room was an evening room, and it has been right for weeks because
   the earliest tip all week was 15:00 PT.

   The weekend is not like that. Saturday 29 Aug opens with Sky at Liberty
   at 10:00 PT and Sunday 30 Aug with Marlins at Nationals at 09:15 PT, so
   the letter announcing the day's rooms would land 45 and 90 minutes
   AFTER the first one had already tipped. A tip-off email that arrives
   after the tip-off is not a late email, it is a wrong one — and nothing
   anywhere would have said so.

   This cannot fix it: the draft is written at 09:13 by a cloud routine
   this box does not schedule, and the send is a systemd timer. What it
   can do is refuse to let the morning pass quietly. It is a WARNING
   rather than fatal, because an email that arrives late still beats no
   email on a game night — the same line this file draws everywhere else.
   ================================================================== */
/* The send time is no longer a constant anybody may copy: it is a
   function of the day's first kickoff, owned by host/tipoff-when.js.
   The old `SEND_HOUR_PT = 10, SEND_MIN_PT = 45` lived here naming a
   timer schedule that no longer exists. */
/* Takes the day's ACTUAL send minute rather than the old fixed 10:45.
   Since 1 Sept the send targets 90 minutes before the first room, so this
   should now stay quiet — except when the 03:30 floor clamps it on a very
   early kickoff, which is exactly the case still worth warning about. */
function tipsBeforeTheSend(rooms, date, sendPT) {
  const withTips = rooms.filter((r) => r.tipISO);
  if (!withTips.length) return null;
  const send = new Date(`${date}T00:00:00-07:00`);
  send.setHours(Math.floor(sendPT / 60), sendPT % 60, 0, 0);
  const early = withTips
    .map((r) => ({ ...r, at: new Date(r.tipISO) }))
    .filter((r) => r.at < send)
    .sort((a, b) => a.at - b.at);
  if (!early.length) return null;
  const fmt = (d) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
  }).format(d);
  return {
    count: early.length,
    lines: early.map((r) => `${r.away} at ${r.home} tips ${fmt(r.at)} PT — ${Math.round((send - r.at) / 60000)} min before the send`),
  };
}


/* ============ SUNDAY BELONGS TO THE WEEKLY NOTE ====================
   EMAIL-VOICE.md section 8: the tip-off routine stops on a Sunday
   whatever the slate says, and the weekly note owns the day at 7:00am.
   host/send-tipoff-auto.js has always known that. This did not, so on
   every Sunday it would have announced that nobody was told there was a
   game — about an email that is not supposed to exist.

   A detector that cries wolf on a schedule is worse than no detector,
   because it teaches the person to stop reading it. */
function isSundayPT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short',
  }).format(new Date()) === 'Sun';
}

(async () => {
  log('=== check-draft starting ===');
  if (isSundayPT()) {
    log('SKIP: Sunday belongs to the weekly note, not the tip-off (EMAIL-VOICE.md section 8). Nothing to check.');
    process.exit(0);
  }
  let KEY;
  try { KEY = fs.readFileSync(KEYFILE, 'utf8').trim(); }
  catch (e) { log(`REFUSE: cannot read ${KEYFILE} — ${e.message}`); process.exit(1); }

  const date = todayPT();
  const rooms = await slateRooms(date).catch(() => []);

  /* WHEN — host/tipoff-when.js, the same owner the draft and send use.
     This ran at a fixed 09:28 because the draft ran at a fixed 09:13.
     Now that the draft follows the day's first kickoff, a fixed 09:28
     would shout "NO DRAFT" every ordinary evening, when the draft is not
     due until 10:23. It asks the owner instead. */
  const PLAN = dayPlan(rooms.map((g) => g.tipISO), new Date());
  log(`when: ${PLAN.describe()}`);
  if (!PLAN.checkDue) {
    log(`SKIP: nothing to check yet — the draft is not due until ${hhmm(PLAN.draftPT)} PT.`);
    process.exit(0);
  }
  log(`today (PT) = ${date} · ${rooms.length} room(s) on the slate`);

  const H = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
  const list = await req('https://connect.mailerlite.com/api/campaigns?filter[status]=draft&limit=50', { method: 'GET', headers: H });
  const drafts = ((list.body && list.body.data) || []).filter((c) => String(c.created_at || '').slice(0, 10) === date);

  if (!drafts.length) {
    /* Not a failure on a day with no games — the routine is supposed to
       stay quiet then. It IS a failure on a day with rooms. */
    const line = rooms.length
      ? `NO DRAFT. ${rooms.length} room(s) are on tonight's slate and nothing was drafted at 09:13. Nobody will be told there is a game.`
      : 'no draft, and no rooms on the slate — correct, nothing to say today.';
    log(rooms.length ? line : line);
    try { fs.writeFileSync(VERDICT, JSON.stringify({ date, ok: !rooms.length, drafts: 0, fatal: rooms.length ? [line] : [], warn: [], at: new Date().toISOString() }, null, 2)); } catch (_) {}
    if (JSON_ONLY) console.log(JSON.stringify({ ok: !rooms.length, fatal: rooms.length ? [line] : [] }));
    process.exit(rooms.length ? 2 : 0);
  }

  const draft = drafts[0];
  const detail = await req(`https://connect.mailerlite.com/api/campaigns/${draft.id}`, { method: 'GET', headers: H });
  const d = (detail.body && detail.body.data) || {};
  const email = (d.emails || [])[0] || {};
  const html = email.content || '';
  const subject = email.subject || '';

  log(`draft ${draft.id} — "${subject}" · ${html.length} bytes`);

  /* Was a question asked yesterday? If it was, today owes an answer.
     Read it rather than assume: a day with no tip-off yesterday has
     nothing to settle and demanding one would be a false alarm. */
  let settled = false;
  try {
    const sent = await req('https://connect.mailerlite.com/api/campaigns?filter[status]=sent&limit=6', { method: 'GET', headers: H });
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    settled = ((sent.body && sent.body.data) || []).some((c) =>
      String(c.finished_at || c.scheduled_for || '').slice(0, 10) === y && /tip-?off/i.test(c.name || ''));
  } catch (_) {}
  log(`yesterday asked a question: ${settled ? 'yes — today owes the answer' : 'no'}`);

  const res = SHAPE.check(html, subject, { rooms, settled });

  /* The shape can be perfect and the timing still wrong. Checked here
     rather than in email-shape.js because it is a fact about the DAY, not
     about the document — the sender asks the same question at 10:45 and
     by then the answer cannot be acted on. */
  const late = tipsBeforeTheSend(rooms, date, PLAN.sendPT);
  if (late) {
    res.warn.push(`THE SEND IS AFTER THE FIRST TIP. ${late.count} room(s) start before the ${hhmm(PLAN.sendPT)} AM PT send.`);
    late.lines.forEach((l) => res.warn.push('    ' + l));
    res.warn.push('    A tip-off email that arrives after the tip-off is a wrong email, not a late one.');
    res.warn.push('    The send already tracks the first kickoff, so this means the 03:30 floor clamped it:');
    res.warn.push('    the slate builds at 03:00 and there is no earlier email to be had. Say "already under way".');
  }

  res.ok.forEach((o) => log(`  ok    ${o}`));
  res.warn.forEach((w) => log(`  warn  ${w}`));
  res.fatal.forEach((f) => log(`  FAIL  ${f}`));

  const ok = res.fatal.length === 0;
  log(ok
    ? `DRAFT IS THE RIGHT SHAPE. ${res.warn.length} warning(s). It sends itself at ${hhmm(PLAN.sendPT)} PT.`
    : `DRAFT IS INCOMPLETE — ${res.fatal.length} section(s) missing, and there are `
      + `~${Math.max(0, PLAN.sendPT - PLAN.nowPT)} minutes to fix it before the ${hhmm(PLAN.sendPT)} PT send.`);

  try {
    fs.writeFileSync(VERDICT, JSON.stringify({
      date, ok, campaign: draft.id, subject,
      fatal: res.fatal, warn: res.warn, okChecks: res.ok,
      at: new Date().toISOString(),
    }, null, 2));
  } catch (_) {}

  if (JSON_ONLY) console.log(JSON.stringify({ ok, campaign: draft.id, fatal: res.fatal, warn: res.warn }));
  process.exit(ok ? 0 : 2);
})().catch((e) => { log('CRASHED: ' + ((e && e.stack) || e)); process.exit(1); });
