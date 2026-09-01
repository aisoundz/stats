/* =====================================================================
   IS THIS EMAIL THE SHAPE AN EMAIL IS SUPPOSED TO BE?
   ---------------------------------------------------------------------
   28 Aug 2026. The tip-off went out missing two of its four sections —
   no STATS card, no "Last night, settled". Founder: "You're also missing
   the unique stats section. Please be consistent."

   The rule was not missing. EMAIL-VOICE.md has said for weeks:

       4. **The STATS and GAMETIME cards.**

   Nothing checked it, so the drafting routine quietly dropped half the
   email and the first person to notice was the founder, after it had
   been sent. A rule in a document that nothing enforces is a rule that
   lasts exactly as long as whoever wrote it is paying attention.

   WHY THIS EXISTS AS ITS OWN FILE. Two things need these answers and
   they must not drift apart:

     check-draft.js   runs at 09:20, minutes after the draft is written,
                      while there are ninety minutes to fix it
     send-tipoff-auto runs at 10:45 and can only refuse or warn

   Same questions, one owner. A second copy is how the two ended up
   disagreeing about everything else in this codebase.

   WHAT IS FATAL AND WHAT IS A WARNING, and the line is deliberate:
   a missing SECTION is fatal at 09:20 because there is time to add it,
   and a warning at 10:45 because an incomplete email still beats no
   email on a game night. Only the caller decides which; this file just
   reports what it found.
   ================================================================== */

/* Strip tags but keep the text, and normalise the entities that make a
   naive string match miss things that are plainly there. */
function textOf(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* The room cards are ALLOWED to carry "6:00 PM ET · 3:00 PM PT" and
   would otherwise satisfy the zone check on their own, so they come out
   before prose is examined. */
const CARD_TIME = /(Kick ?off|First pitch|Tip[- ]off|Puck drop)[^<]{0,60}?\d{1,2}:\d{2}\s*(AM|PM)?\s*(ET|PT)/gi;

function proseOf(html) {
  return textOf(String(html || '').replace(CARD_TIME, ' '));
}

/* ---------------------------------------------------------------------
   check(html, subject, opts) -> { fatal:[], warn:[], ok:[] }

   opts.rooms      array of {nightId, away, home} expected on the rail
   opts.settled    true if yesterday asked a question that can be settled
   ------------------------------------------------------------------ */
function check(html, subject, opts) {
  opts = opts || {};
  const out = { fatal: [], warn: [], ok: [] };
  const raw = String(html || '');
  const t = textOf(raw);
  const subj = String(subject || '');

  /* ---- 1. the four sections ------------------------------------- */
  /* "TONIGHT" OR "TODAY", AND THE DIFFERENCE MATTERS. This demanded the
     literal word "Tonight", which was right for every edition until the
     weekend: the earliest tip all week was 15:00 PT. Saturday 29 Aug opens
     with Sky at Liberty at 10:00 AM PT, and calling that "Tonight" is the
     stale-tonight tell EMAIL-VOICE.md rule 5 bans in the same breath
     ("Never write 'tonight' where it would read wrong a day later"). One
     rule was forcing a word another rule forbids. */
  const hasSchedule = /\b(Tonight|Today)\b/i.test(t) && /Game Night #\d+/i.test(t);
  hasSchedule ? out.ok.push('the schedule is at the top')
              : out.fatal.push('NO SCHEDULE. "Tonight" or "Today" and the room rows are the thing the reader opened this for.');

  /* The STATS card is not just the word — it is the two big figures.
     A heading with nothing under it passed the first version of this. */
  /* WHITESPACE, BECAUSE MAILERLITE PRETTY-PRINTS WHAT IT STORES.
     This was /font-size:34px[^>]*>\s*([^<]{1,14})</ and it matched three
     figures in the file we build and ZERO in the draft read back. The
     leading \s* handled the newline; nothing handled the TRAILING one.
     MailerLite rewraps

         ...-.02em;">1.73</div>
     into
         ...-.02em;">\n                      1.73\n                    </div>

     so the capture had to cross "1.73" plus a newline and twenty spaces —
     25 characters against a cap of 14 — and never reached the closing tag.
     The card was there every time. The check could not see it, and told
     the founder his complete email was missing a section, which is the
     way a guard teaches somebody to stop reading it.

     Capture lazily to the tag, trim, then apply the length rule to the
     TEXT rather than to the text plus its indentation. */
  const bigFigures = (raw.match(/font-size:34px[^>]*>([\s\S]{0,80}?)</g) || [])
    .map((m) => m.replace(/^[\s\S]*?>/, '').replace(/<$/, '').trim())
    .filter((v) => v.length >= 1 && v.length <= 14).length;
  const hasStats = /\bSTATS\b/.test(t) && bigFigures >= 2;
  hasStats ? out.ok.push(`the STATS card is there, with ${bigFigures} figure(s)`)
           : out.fatal.push(`NO STATS CARD. EMAIL-VOICE.md rule 4. Found ${bigFigures} big figure(s); it needs two with attribution.`);

  const hasGametime = /Gametime/i.test(t) && /(Today.s question|question)/i.test(t);
  hasGametime ? out.ok.push('the GAMETIME card is there')
              : out.fatal.push('NO GAMETIME CARD. EMAIL-VOICE.md rule 4.');

  if (opts.settled) {
    /(Last night, settled)/i.test(t)
      ? out.ok.push('yesterday\'s question is settled')
      : out.fatal.push('NO "Last night, settled". A question was asked yesterday and this is where it gets answered — the promise and the proof of it.');
  }

  /* ---- 2. every clock time names a zone -------------------------- */
  const bare = [];
  const scan = (text, where) => {
    String(text).split(/(?<=[.!?])\s+/).forEach((sen) => {
      if (!/\d{1,2}:\d{2}/.test(sen)) return;
      if (/\b(ET|PT|EST|PST|CT|MT)\b/.test(sen)) return;
      bare.push(`${where}: "${sen.trim().slice(0, 66)}"`);
    });
  };
  scan(subj, 'subject');
  scan(proseOf(raw), 'body');
  if (bare.length) {
    out.warn.push(`${bare.length} clock time(s) with no zone. 7:00 in LA is not 7:00 in NY.`);
    bare.slice(0, 5).forEach((b) => out.warn.push('    ' + b));
  } else {
    out.ok.push('every clock time names its zone');
  }

  /* ---- 3. the tells EMAIL-VOICE bans ---------------------------- */
  /* Em dash. Rule 1, and the most reliable tell there is. Score ranges
     use an EN dash and are not this. */
  const em = (t.match(/—/g) || []).length;
  em ? out.warn.push(`${em} em dash(es). EMAIL-VOICE.md rule 1: not one.`)
     : out.ok.push('no em dashes');

  /(Signed )?STATS GAMETIME/i.test(t)
    ? out.ok.push('signed STATS GAMETIME')
    : out.warn.push('not signed "STATS GAMETIME".');

  /* ---- 4. every room on the slate is named ---------------------- */
  const rooms = opts.rooms || [];
  const missing = rooms.filter((r) => {
    const names = [r.home, r.away].filter(Boolean).map(String);
    return names.length && !names.every((n) => t.indexOf(n) >= 0);
  });
  if (rooms.length) {
    missing.length
      ? out.fatal.push(`${missing.length} room(s) on tonight's slate are not named in the email: `
          + missing.map((r) => `${r.away} at ${r.home}`).join(', '))
      : out.ok.push(`all ${rooms.length} room(s) are named`);
  }

  return out;
}

module.exports = { check, textOf, proseOf };
