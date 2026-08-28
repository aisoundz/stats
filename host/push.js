/* =====================================================================
   THE SENDER — what puts a round on a locked phone.
   ---------------------------------------------------------------------
   The app has raised alerts for months and none of them ever reached a
   handset. notify() calls `new Notification()`, which only runs while the
   PAGE is alive; a locked phone runs no JavaScript. On iOS in a Safari
   tab window.Notification does not even exist, so every call fell into
   its own catch and did nothing, silently.

   sw.js is where a push lands. This is what sends one.

   Founder, 28 Aug: "So why do we not have notifications to our phone when
   the quarter ends?" Because nothing was ever sending.

   WHO IT SENDS TO. Every push subscription belonging to a uid that has a
   player document in this night. Not "everyone who ever subscribed" — a
   person in tonight's baseball room should not be pinged about a football
   round they are not in, and that mistake is the same shape as every
   one-global-two-rooms bug this codebase has already paid for.

   A DEAD SUBSCRIPTION IS NORMAL. Browsers revoke them whenever they like.
   404 and 410 mean "this browser is gone" and the row is deleted; nothing
   is retried and nothing is logged as an error, because it is not one.

   NEVER RETRIES. A push is a nice-to-have arriving beside a round the
   player can already see on screen. Retrying a send whose response was
   lost risks two notifications for one round, which is worse than none.

       node host/push.js --night <id> --title "..." --body "..." [--dry]
   ================================================================== */
const fs = require('fs');
const path = require('path');

let webpush = null;
try { webpush = require('web-push'); }
catch (_) { /* reported by the caller — see send() */ }

const KEYFILE = path.join(process.env.HOME || '/home/higherthan7', '.secrets', 'vapid.json');

function vapid() {
  try {
    const v = JSON.parse(fs.readFileSync(KEYFILE, 'utf8'));
    if (!v || !v.publicKey || !v.privateKey) return null;
    return v;
  } catch (_) { return null; }
}

/* The one entry point. Returns a plain summary so a caller can log it
   without knowing anything about web push.

   `db` is the caller's already-authenticated Firestore handle. This file
   deliberately does not initialise its own: the runner has one, and two
   admin apps in one process is a class of bug nobody needs. */
async function send(db, nightId, payload, opts) {
  opts = opts || {};
  const out = { sent: 0, pruned: 0, failed: 0, skipped: '' };

  if (!webpush) { out.skipped = 'web-push is not installed'; return out; }
  const v = vapid();
  if (!v) { out.skipped = 'no VAPID keys at ' + KEYFILE; return out; }
  if (!nightId || !payload || !payload.title) { out.skipped = 'nothing to say'; return out; }

  try {
    webpush.setVapidDetails(v.subject || 'mailto:play@statsgametime.com', v.publicKey, v.privateKey);
  } catch (e) { out.skipped = 'bad VAPID keys: ' + (e && e.message); return out; }

  /* WHO IS IN THIS ROOM. Read the players first so a subscription that
     belongs to somebody else's night is never even considered. */
  let uids = new Set();
  try {
    const pl = await db.collection(`nights/${nightId}/players`).get();
    pl.forEach(d => uids.add(d.id));
  } catch (e) { out.skipped = 'could not read players: ' + (e && e.message); return out; }
  if (!uids.size) { out.skipped = 'nobody is in this room'; return out; }

  let subs = [];
  try {
    const sn = await db.collection('push').get();
    sn.forEach(d => {
      const s = d.data() || {};
      if (s.endpoint && s.p256dh && s.auth && uids.has(s.uid)) subs.push({ id: d.id, ...s });
    });
  } catch (e) { out.skipped = 'could not read subscriptions: ' + (e && e.message); return out; }

  if (!subs.length) { out.skipped = 'no subscriptions for anybody in this room'; return out; }
  if (opts.dry) { out.skipped = `DRY RUN — would have pushed to ${subs.length}`; return out; }

  const body = JSON.stringify({
    title: String(payload.title).slice(0, 80),
    body: String(payload.body || '').slice(0, 140),
    tag: String(payload.tag || 'stats'),
    url: String(payload.url || 'https://statsgametime.com/')
  });

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 240 }   /* a round is worth minutes, not hours. Do not deliver it late. */
      );
      out.sent++;
    } catch (e) {
      const code = (e && e.statusCode) || 0;
      if (code === 404 || code === 410) {
        /* Gone. Not a failure — a browser that revoked us. */
        out.pruned++;
        try { await db.doc('push/' + s.id).delete(); } catch (_) {}
      } else {
        out.failed++;
      }
    }
  }
  return out;
}

module.exports = { send, vapid };

/* ---- hand run, for testing against your own phone ------------------- */
if (require.main === module) {
  const A = process.argv.slice(2);
  const arg = (f, d) => { const i = A.indexOf(f); return (i >= 0 && A[i + 1]) ? A[i + 1] : d; };
  const night = arg('--night', '');
  if (!night) { console.error('need --night <id>'); process.exit(1); }
  const admin = require('firebase-admin');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  send(admin.firestore(), night, {
    title: arg('--title', '🔴 Quarter 2 is open'),
    body:  arg('--body',  'Four questions. Tap to answer.'),
    tag:   arg('--tag',   'stats-round'),
    url:   'https://statsgametime.com/?game=' + night
  }, { dry: A.includes('--dry') })
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error('FAILED', e && e.message); process.exit(1); });
}
