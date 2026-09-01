#!/usr/bin/env node
/* =====================================================================
   BUILD TODAY'S TIP-OFF EMAIL, FROM THE SLATE.
   ---------------------------------------------------------------------
   29 Aug 2026. Founder, on a Saturday morning with a 10:00am room:
   "Where's the email for today? It should go out before the game."

   The drafting has lived in a cloud routine that this box does not
   schedule and cannot inspect. That was fine while the only failure mode
   was wording. It stopped being fine the moment the send had to be moved
   ahead of a morning tip, because there is no way to guarantee from here
   what the draft will contain or when it will exist.

   So the mechanical half comes home. The ROOM ROWS, the times, the
   channels and the game-night numbers are read from slate/{date} and the
   marquee file, which is the same data the launcher and the rail use, so
   the email cannot disagree with the product about what is on tonight.

   THE EDITORIAL HALF IS NOT GENERATED. The headline, the two paragraphs,
   the STATS figures, the question and the settle are passed in as a JSON
   file that a person has read. This is deliberate: EMAIL-VOICE.md governs
   words, a machine that writes its own copy every morning drifts toward
   whatever was wrong last, and the founder approves an edition before it
   goes. This file assembles; it does not compose.

       node host/build-tipoff.js copy.json > out.html

   The shape is host/email-tipoff-template.html and is not to be redesigned
   here. host/email-shape.js checks the result.
   ================================================================== */
const fs = require('fs');
const https = require('https');

const COPY = process.argv[2];
if (!COPY) { console.error('usage: node host/build-tipoff.js copy.json > out.html'); process.exit(1); }
const copy = JSON.parse(fs.readFileSync(COPY, 'utf8'));

const PROJECT = 'stats-gametime';
const FIREBASE_KEY = 'AIzaSyB1g4u3L85sks1Phjz_Tim98urv1-IZBps'; // public web key
const LOGDIR = require('path').join(process.env.HOME, 'gamenight-logs');

function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
const DATE = copy.date || todayPT();

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'curl/7.81.0', Accept: '*/*' } }, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('bad JSON from ' + url)); } });
    }).on('error', rej);
  });
}

/* The rail, not the whole build. `games` is what a player is offered and
   therefore exactly what the email should name; `built` is every fixture
   that exists and naming those would promise rooms nobody hosts. */
async function rooms() {
  const j = await get(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/slate/${DATE}?key=${FIREBASE_KEY}`);
  const f = j && j.fields;
  if (!f || !f.games) throw new Error(`no slate/${DATE} — build it first`);
  return (f.games.arrayValue.values || []).map((v) => {
    const g = v.mapValue.fields || {};
    const s = (k) => (g[k] && g[k].stringValue) || '';
    /* THE NUMBER IS HERE, and this is the only place it is complete.
       build-slate.js stamps g.gn onto every room in the slate document;
       the marquee FILE records only the FEATURED ones. Reading the file
       gave the first room #49 and the other two an empty string, so the
       email rendered "Game Night #" twice on 1 Sept 2026. Firestore
       returns a number as integerValue and a string as stringValue, and
       it has been written both ways. */
    const n = (k) => (g[k] && (g[k].stringValue || g[k].integerValue)) || '';
    return { nightId: s('nightId'), away: s('away'), home: s('home'),
             tipISO: s('tipISO'), net: s('net'), league: s('league'), gn: n('gn') };
  }).filter((r) => r.nightId).sort((a, b) => new Date(a.tipISO) - new Date(b.tipISO));
}

/* THE SLATE IS THE OWNER, AND THIS COMMENT USED TO SAY THE OPPOSITE.
   It read "the number lives on the marquee file, which is where
   build-slate put it" — true once, and false since the number moved onto
   the slate document. The marquee file is a record of which rooms are
   FEATURED, and on a night with one featured room it carries one number.
   That is why two of three rooms printed "Game Night #" with nothing
   after it. rooms() already holds the complete answer; this is the
   fallback for a slate written before gn existed. */
function gnOf(nightId) {
  try {
    const txt = fs.readFileSync(`${LOGDIR}/slate-marquee-${DATE}.txt`, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\S+)/);
      if (m && m[2] === nightId) return m[1];
    }
  } catch (_) {}
  return '';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/·/g, '&middot;').replace(/’/g, '&rsquo;');
/* THE EN DASH STAYS A CHARACTER. It used to become &ndash; here, and
   host/send-tipoff-auto.js verifies the settle by stripping TAGS and
   looking for a score, which means it never sees an entity. A settle
   reading "4–4" was therefore invisible to the check that exists to
   confirm it, and the send refused twice on 29 Aug over an escape this
   file did to its own copy. UTF-8 is what the rest of the email uses. */

/* EVERY CLOCK TIME NAMES A ZONE. Both of them, every time, because 7:00 in
   Los Angeles is not 7:00 in New York and a reader has exactly one of
   those clocks. */
function times(iso) {
  const d = new Date(iso);
  const f = (tz) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d).replace(/\s/g, ' ');
  return { et: f('America/New_York'), pt: f('America/Los_Angeles') };
}

/* The verb belongs to the sport. Calling a first pitch a tip-off is the
   kind of small wrongness a fan notices immediately. */
const VERB = { wnba:'Tip-off', nba:'Tip-off', nfl:'Kickoff', cfb:'Kickoff',
               mlb:'First pitch', nhl:'Puck drop', mls:'Kick-off', epl:'Kick-off' };
const RULE = { wnba:'#ff8a3d', nba:'#ff8a3d', nfl:'#28e0d0', cfb:'#28e0d0',
               mlb:'#4d86ff', nhl:'#8fa3b8', mls:'#a97bd6', epl:'#a97bd6' };

(async () => {
  const rs = await rooms();
  if (!rs.length) throw new Error(`slate/${DATE} has no rooms on the rail`);

  const rowsHtml = rs.map((r, i) => {
    const t = times(r.tipISO);
    const lg = String(r.league || '').toLowerCase();
    const last = i === rs.length - 1;
    return `  <div style="background:#141b2b;border:1px solid #223049;border-left:4px solid ${RULE[lg] || '#28e0d0'};border-radius:0 10px 10px 0;padding:13px 15px;margin:${i === 0 ? '18px 0 8px' : (last ? '0 0 20px' : '0 0 8px')};">
    <div style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#7d8ba6;font-weight:700;">Game Night #${esc(r.gn || gnOf(r.nightId))} &middot; ${esc(lg.toUpperCase())}</div>
    <div style="font-size:18px;font-weight:800;color:#fff;margin:3px 0 2px;">${esc(r.away)} at ${esc(r.home)}</div>
    <div style="font-size:13.5px;color:#9fb0cc;">${esc(VERB[lg] || 'Start')} ${esc(t.et)} ET &middot; ${esc(t.pt)} PT on ${esc(r.net)}</div>
  </div>`;
  }).join('\n');

  /* The first tip is the default sign-off. An edition sent AFTER a room
     has already played needs to name the next one instead, so the copy
     may override it. */
  const first = times(rs[0].tipISO).pt;
  const q = copy.question;
  /* THE TEMPLATE HAS EXACTLY TWO OPTION CELLS. A three-option question
     built fine and shipped with the third option silently missing — the
     email asked "six or fewer / seven to nine / ten or more" and printed
     only the first two, so a reader who wanted the third had nowhere to
     put it. Nothing failed; the content just vanished.
     Refuse instead. Dropping copy without saying so is the same class of
     bug as a number that counts the wrong thing. */
  if (q && Array.isArray(q.options) && q.options.length !== 2) {
    console.error('FATAL: the question has ' + q.options.length + ' options and this '
      + 'template renders exactly 2. It would drop: '
      + JSON.stringify(q.options.slice(2)) + '. Rewrite the question as two options, '
      + 'or widen the template — do not ship a question missing an answer.');
    process.exit(1);
  }
  /* settled and stats are OPTIONAL. Some game nights have nothing settled
     yet — a first night, or a night after a card that has not resolved.
     Printing an empty box, or refusing to build at all, both cost the
     email. The schedule is the part that must always survive. */
  const st = copy.settled || null;

  const optCell = (label, side) => `          <td width="50%" style="padding-${side === 'l' ? 'right' : 'left'}:5px;">
            <a href="https://statsgametime.com/?gt=${esc(q.id)}&amp;pick=${esc(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" style="display:block;text-align:center;background:#16242f;border:1px solid #2f5f68;color:#8ff0e4;text-decoration:none;font-weight:800;font-size:15px;padding:14px 8px;border-radius:10px;">${esc(label)}</a>
          </td>`;

  const html = `<style type="text/css">
  :root { color-scheme: dark; supported-color-schemes: dark; }
  u + .body { background: #0a0e17 !important; }
  [data-ogsc] .sg-dark-bg { background: #0a0e17 !important; }
  [data-ogsc] .sg-dark-text { color: #c9d3e2 !important; }
  [data-ogsc] .sg-head { color: #eef2f8 !important; }
  @media (prefers-color-scheme: light) {
    .sg-dark-bg { background: #0a0e17 !important; }
    .sg-dark-text { color: #c9d3e2 !important; }
    .sg-head { color: #eef2f8 !important; }
  }
</style>
<div class="body sg-dark-bg" style="margin:0;padding:0;background:#0a0e17;">
<div style="max-width:560px;margin:0 auto;padding:26px 20px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d4e8;font-size:16px;line-height:1.6;">
  <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#28e0d0;font-weight:700;margin-bottom:20px;">Stats Gametime</div>
  <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7d8ba6;font-weight:800;margin:0 0 10px;">${esc(copy.when || 'Today')}</div>
${rowsHtml}

  <div style="font-size:25px;line-height:1.2;font-weight:800;color:#fff;margin:22px 0 16px;">${esc(copy.headline)}</div>
${(copy.paragraphs || []).map((p) => `  <p style="margin:0 0 14px;">${esc(p)}</p>`).join('\n')}

  <div style="margin:22px 0 24px;">
    <a href="https://statsgametime.com" style="display:inline-block;background:linear-gradient(92deg,#28e0d0,#4d86ff);color:#04121e;text-decoration:none;font-weight:800;font-size:16px;padding:14px 28px;border-radius:999px;">Pick your room</a>
  </div>

${copy.stats ? `  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 0;">
    <tr><td style="background:#111827;border:1px solid #2b3a52;border-top:3px solid #ffc54d;border-radius:14px;padding:20px 18px 18px;">
      <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#ffc54d;font-weight:800;margin:0 0 14px;">STATS</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
        <tr>
          <td style="text-align:center;padding-right:16px;">
            <div style="font-size:34px;line-height:1;font-weight:800;color:#fff;letter-spacing:-.02em;">${esc(copy.stats.a.value)}</div>
            <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#7d8ba6;font-weight:700;margin-top:5px;">${esc(copy.stats.a.who)}</div>
          </td>
          <td style="text-align:center;border-left:1px solid #2b3a52;padding-left:16px;">
            <div style="font-size:34px;line-height:1;font-weight:800;color:#9fb0cc;letter-spacing:-.02em;">${esc(copy.stats.b.value)}</div>
            <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#7d8ba6;font-weight:700;margin-top:5px;">${esc(copy.stats.b.who)}</div>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 10px;color:#e8eef8;font-size:16.5px;line-height:1.45;font-weight:700;">${esc(copy.stats.lead)}</p>
      <p style="margin:0 0 16px;font-size:14.5px;color:#9fb0cc;line-height:1.5;">${esc(copy.stats.detail)}</p>
      </td></tr>
  </table>` : ``}

${(q || st) ? `  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:10px 0 0;">
    <tr><td style="background:#101b24;border:1px solid #2b3a52;border-top:3px solid #28e0d0;border-radius:14px;padding:20px 18px 18px;">
      <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#28e0d0;font-weight:800;margin:0 0 14px;">Gametime</div>

${q ? `      <div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6f8f97;font-weight:700;margin-bottom:8px;">Today&rsquo;s question</div>
      <p style="margin:0 0 16px;color:#ffffff;font-size:18px;line-height:1.4;font-weight:800;">${esc(q.text)}</p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
${optCell(q.options[0], 'l')}
${optCell(q.options[1], 'r')}
        </tr>
      </table>

      <p style="margin:14px 0 0;font-size:13.5px;color:#8fa3b8;">${esc(q.note)}</p>` : ``}
${st ? `      <div style="border-top:1px solid #2b3a52;margin:18px 0 16px;"></div>

      <div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6f8f97;font-weight:700;margin:0 0 8px;">${esc(st.heading || 'Last night, settled')}</div>
      <p style="margin:0 0 12px;color:#8fa3b8;font-size:14px;line-height:1.45;">${esc(st.question)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
        <tr>
          <td style="padding-right:14px;">
            <div style="font-size:34px;line-height:1;font-weight:800;color:#63ae86;letter-spacing:-.02em;">${esc(st.answer)}</div>
          </td>
          <td style="border-left:1px solid #2b3a52;padding-left:14px;">
            <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#7d8ba6;font-weight:700;">${esc(st.label)}</div>
            <div style="font-size:14px;color:#9fb0cc;line-height:1.4;margin-top:3px;">${esc(st.detail)}</div>
          </td>
        </tr>
      </table>` : ``}
    </td></tr>
  </table>` : ``}

${copy.buildNote ? `  <p style="margin:22px 0 6px;font-size:14.5px;color:#9fb0cc;line-height:1.5;">${esc(copy.buildNote)}</p>` : ''}
  <p style="margin:26px 0 6px;">See you at ${esc(copy.signoff || (first + ' PT'))}.</p>
  <p style="margin:0 0 22px;font-weight:700;color:#c9d4e8;">STATS GAMETIME</p>
  <div style="border-top:1px solid #223049;padding-top:14px;font-size:13px;color:#6b7a94;">Free to enter, always. One email a game night.<br><a href="#" style="color:#6b7a94;">Unsubscribe</a></div>
</div></div>`;

  process.stdout.write(html);
  console.error(`  built ${DATE}: ${rs.length} room(s), ${html.length} bytes`);
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
