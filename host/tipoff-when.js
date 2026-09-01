/* ============================ tipoff-when.js ============================
   THE ONE OWNER of "when does today's tip-off email happen".

   Until 1 Sept the whole chain was nailed to fixed clock times:

       09:13  tipoff-daily.js --apply   writes the draft
       09:28  check-draft.js            shouts if it is thin
       09:35  send (timer, 1st chance)
       09:45  tipoff-verify.js
       10:45  send (timer, 2nd chance)

   That is a fine schedule for a product that plays basketball at 7pm and
   MLS at 1:30pm — the earliest room in the entire MLS archive. It is the
   wrong schedule for football. Every Premier League room this product has
   ever hosted, by kickoff, Pacific:

       4:30 AM  x2      8:30 AM  x2
       6:00 AM  x4      9:30 AM  x3
       7:00 AM  x12    12:00 PM  x3

   TWENTY-THREE OF TWENTY-SIX kicked off before the 10:45 send, and
   twenty-one before the 09:13 draft was even written. The email would
   have invited somebody to a match that had already finished. The one
   that worked — Arsenal at Villa, 31 Aug — was the noon exception.
   College football has the same shape: 5 and 12 Sept both open 9:00 AM PT.

   Founder's call, 1 Sept: SEND EARLY ON EARLY DAYS. The target is ninety
   minutes before the first room of the day, and never later than the old
   10:45, so an ordinary evening slate behaves exactly as it does today.

   WHY THIS IS A MODULE AND NOT AN `if` IN THE SEND SCRIPT.
   Moving only the send is worse than useless. On a 7:00 AM Premier League
   day the send would come due at 5:30 and find NO DRAFT, because the
   draft job does not run until 09:13. It would report "nothing to send"
   and the day would go dark — the same silent no-email the fixed schedule
   already produces, arrived at by a new route. The draft has to move with
   the send, both have to read the same slate, and the offset between them
   has to be one fact in one file. This codebase's named disease is "one
   fact, many copies"; two scripts each doing their own timezone
   arithmetic off the same feed is exactly that disease.

   THE FLOOR IS NOT DECORATION. The slate is not built until 03:00 PT, so
   a 4:30 AM kickoff cannot have its email prepared at 2:38 — there is no
   slate to write it from. The floor holds the draft at 03:30 and the send
   at 03:52, which is a shorter lead than we would like and still an email
   that arrives before the whistle.                                     */

const DEFAULT_SEND_PT = 10 * 60 + 45;  /* the long-standing 10:45 */
const LEAD_MIN        = 90;            /* how far ahead of the first room */
const DRAFT_OFFSET    = 22;            /* 09:35 send - 09:13 draft, preserved */
const CHECK_OFFSET    = 15;            /* 09:28 check  - 09:13 draft, preserved */
const VERIFY_OFFSET   = 10;            /* 09:45 verify - 09:35 send,  preserved */
const FLOOR_DRAFT_PT  =  3 * 60 + 30;  /* the 03:00 slate build, plus margin */

function ptMinutes(d) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => Number((p.find((x) => x.type === t) || {}).value || 0);
  return (g('hour') % 24) * 60 + g('minute');
}

function ptDay(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/* tipISOs: whatever the slate had. Junk and blanks are ignored rather
   than thrown, because one ragged feed row must never decide that the
   whole day gets no email — that is the CFB crash all over again. */
function dayPlan(tipISOs, now) {
  const tips = (tipISOs || [])
    .map((s) => Date.parse(s || ''))
    .filter((t) => isFinite(t))
    .map((t) => ptMinutes(new Date(t)));

  let send = DEFAULT_SEND_PT;
  let first = null;
  if (tips.length) {
    first = Math.min(...tips);
    send = Math.min(DEFAULT_SEND_PT, first - LEAD_MIN);
  }
  let draft = send - DRAFT_OFFSET;
  if (draft < FLOOR_DRAFT_PT) { draft = FLOOR_DRAFT_PT; send = draft + DRAFT_OFFSET; }

  /* ALL FOUR JOBS MOVE TOGETHER OR NONE DO. check-draft shouts when no
     draft exists and tipoff-verify inspects the one that was sent; both
     were pinned to the 09:13 draft by a fixed 15 and 10 minute gap. Move
     only the draft and check-draft cries "NO DRAFT" at 09:28 every
     ordinary evening, because the draft is not due until 10:23. A
     detector that cries wolf on a schedule teaches the person to stop
     reading it, which costs more than the bug it was built to catch. */
  const check  = draft + CHECK_OFFSET;
  const verify = send  + VERIFY_OFFSET;

  const nowPT = ptMinutes(now || new Date());
  return {
    firstTipPT: first, draftPT: draft, sendPT: send, checkPT: check, verifyPT: verify, nowPT,
    day: ptDay(now || new Date()),
    early: send < DEFAULT_SEND_PT,
    draftDue: nowPT >= draft,
    sendDue: nowPT >= send,
    checkDue: nowPT >= check,
    verifyDue: nowPT >= verify,
    describe() {
      return (first == null ? 'no tip times in the slate' : `first room ${hhmm(first)} PT`)
        + ` · draft ${hhmm(draft)} · send ${hhmm(send)} · now ${hhmm(nowPT)}`
        + (this.early ? ' · EARLY DAY' : '');
    },
  };
}

/* The marker the send writes to claim the day. One file per Pacific day,
   read by every job in the chain so none of them acts twice. */
function sentMarkPath(day) {
  return `${process.env.HOME}/gamenight-logs/tipoff-sent-${day || ptDay(new Date())}.txt`;
}

module.exports = { dayPlan, ptMinutes, ptDay, hhmm, sentMarkPath,
                   DEFAULT_SEND_PT, LEAD_MIN, DRAFT_OFFSET,
                   CHECK_OFFSET, VERIFY_OFFSET, FLOOR_DRAFT_PT };
