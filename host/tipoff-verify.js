#!/usr/bin/env node
/* =====================================================================
   DID IT ACTUALLY GO OUT?
   ---------------------------------------------------------------------
   29 Aug 2026. The send fires at 09:35 and host/send-tipoff-auto.js does
   its own polling, but it reports into journald, inside a session nobody
   will be reading, and this project has twice believed a green timer that
   sent nothing. "The API returned success and ignored you" is the single
   most expensive shape of bug here: it looks exactly like working.

   So this runs at 09:45 and writes a verdict a person can find, in one
   line, where the morning report already looks.

   It answers three separate questions rather than one, because they fail
   differently and the fix is different for each:

     is there still a draft?   the send never ran, or it refused
     is the campaign sent?     the only good answer
     did it reach anybody?     a campaign can be "sent" to nobody

   IT CHANGES NOTHING. It reads, and it says what it found.
   ================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { dayPlan, hhmm } = require('./tipoff-when.js');

const LOG = path.join(process.env.HOME, 'gamenight-logs', 'tipoff-verify.log');
const VERDICT = path.join(process.env.HOME, 'gamenight-logs', 'tipoff-verdict.json');
const KEY = fs.readFileSync(path.join(process.env.HOME, '.secrets', 'mailerlite-api-key'), 'utf8').trim();

function log(l) {
  const m = `${new Date().toISOString()}  ${l}\n`;
  process.stdout.write(m);
  try { fs.appendFileSync(LOG, m); } catch (_) {}
}
const get = (p) => new Promise((res, rej) => {
  https.request('https://connect.mailerlite.com' + p, {
    headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json' },
  }, (s) => { let b = ''; s.on('data', (d) => (b += d));
    s.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} res({ status: s.statusCode, body: j }); }); })
    .on('error', rej).end();
});
const todayPT = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/* MailerLite omits the zone and means UTC. Reading these as local is how
   a 9:23 AM draft came to look like a 4:23 PM one. */
const utcDay = (s) => String(s || '').slice(0, 10);


/* ============ SUNDAY BELONGS TO THE WEEKLY NOTE ====================
   EMAIL-VOICE.md section 8: the tip-off routine stops on a Sunday
   whatever the slate says, and the weekly note owns the day at 7:00am.
   host/send-tipoff-auto.js has always known that. This did not, so on
   every Sunday it would have announced that nobody was told there was a
   game — about an email that is not supposed to exist.

   A detector that cries wolf on a schedule is worse than no detector,
   because it teaches the person to stop reading it. */
/* The only thing this file needs from the slate is when the first room
   starts, so that is all it asks for. */
const FB_PROJECT = 'stats-gametime';
const FB_KEY = 'AIzaSyB1g4u3L85sks1Phjz_Tim98urv1-IZBps'; // public web key
async function tipISOs(day) {
  /* NOT `KEY` — that is the MailerLite key in this file, and reaching for
     it here would have thrown into a catch and quietly produced an empty
     slate, which reads as "ordinary evening" and verifies at the wrong
     moment every early day. */
  const url = 'https://firestore.googleapis.com/v1/projects/' + FB_PROJECT
    + '/databases/(default)/documents/slate/' + day + '?key=' + FB_KEY;
  const r = await fetch(url);
  if (!r.ok) return [];
  const d = await r.json();
  const vals = ((((d || {}).fields || {}).games || {}).arrayValue || {}).values || [];
  return vals.map((v) => ((((v.mapValue || {}).fields || {}).tipISO) || {}).stringValue || '');
}

function isSundayPT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short',
  }).format(new Date()) === 'Sun';
}

(async () => {
  const today = todayPT();
  log(`=== tipoff-verify, ${today} ===`);
  if (isSundayPT()) {
    log('SKIP: Sunday belongs to the weekly note. No tip-off is expected today, so there is nothing to verify.');
    process.exit(0);
  }

  /* WHEN — host/tipoff-when.js. Verifying at a fixed 09:45 asks whether
     an email went out before it was ever due to; on an early Premier
     League day it asks four hours after the fact. Either way the answer
     it prints is about the wrong moment. */
  let tips = [];
  try { tips = await tipISOs(today); }
  catch (e) { log('slate unreadable (' + e.message + ') — falling back to the standing 10:45 schedule.'); }
  const PLAN = dayPlan(tips, new Date());
  log(`when: ${PLAN.describe()}`);
  if (!PLAN.verifyDue) {
    log(`SKIP: too early to verify — the send is due ${hhmm(PLAN.sendPT)} PT and this checks at ${hhmm(PLAN.verifyPT)} PT.`);
    process.exit(0);
  }

  const drafts = await get('/api/campaigns?filter[status]=draft&limit=50');
  const stillDraft = (((drafts.body || {}).data) || []).filter((c) => utcDay(c.created_at) === today);

  const sent = await get('/api/campaigns?filter[status]=sent&limit=20');
  const sentToday = (((sent.body || {}).data) || [])
    .filter((c) => utcDay(c.finished_at || c.scheduled_for || c.created_at) === today && /tip-?off/i.test(c.name || ''));

  const v = { date: today, at: new Date().toISOString(), ok: false,
              stillDraft: stillDraft.length, sent: sentToday.length, recipients: null, note: '' };

  if (sentToday.length) {
    const c = sentToday[0];
    const d = (await get('/api/campaigns/' + c.id)).body || {};
    const st = (d.data && d.data.stats) || {};
    v.recipients = (typeof st.sent === 'number') ? st.sent : null;
    v.campaign = c.id; v.name = c.name;
    /* A campaign can report "sent" and have reached nobody. The counters
       lag the status flip, so null is "too early to say", not zero. */
    v.ok = v.recipients === null ? true : v.recipients > 0;
    v.note = v.recipients === null
      ? 'SENT. Recipient count has not caught up yet, which is normal within minutes of a send.'
      : v.recipients > 0
        ? `SENT to ${v.recipients} recipient(s).`
        : 'SENT but the recipient count is zero. It went nowhere. Check the group and the segment.';
  } else if (stillDraft.length) {
    v.note = `NOT SENT. ${stillDraft.length} draft(s) from today are still sitting there. The 09:35 send either did not run or refused. Check tipoff-ensure.log and the tipoff-email-send unit.`;
  } else {
    v.note = 'NOTHING TO REPORT. No draft from today and no tip-off sent today. On a day with rooms that means nobody was told there was a game.';
  }

  log(v.note);
  log(`drafts left today: ${v.stillDraft} · tip-offs sent today: ${v.sent}`);
  try { fs.writeFileSync(VERDICT, JSON.stringify(v, null, 2)); } catch (_) {}
  process.exit(v.ok ? 0 : 2);
})().catch((e) => { log('CRASHED: ' + ((e && e.stack) || e)); process.exit(1); });
