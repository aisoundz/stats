/* qa/tape-streak.js — THE RUN IS THE WHOLE REWARD, SO IT MUST NOT LIE.

   The Tape is one question a day from a finished game. It never pays
   points and never touches the Board — the reward is the streak, and the
   streak counts DAYS PLAYED, not days right. That is the entire feature.

   20 Sept 2026, the founder at 5:29am: "I thought we get like a question
   everyday to see how many days in a row." He does. Nineteen Tapes had
   been published and he had never seen one, because:

     · tapeStreak() walked back from TODAY and stopped at the first
       unanswered day. The Tape publishes at 06:30 PT, so every morning
       before then a nineteen day run read as ZERO.
     · tapeRender() returned silently when no question was published, so
       the card stayed hidden and nothing said why — on the one surface
       whose entire job is a daily habit.

   Measured on the two builds, a 19-day run with today unanswered:
       index.html       streak 0,  card hidden
       index-test.html  streak 19, card explains when the question lands

       node qa/tape-streak.js [index-test.html]
       node qa/tape-streak.js --sabotage
*/
const { firefox } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SAB = process.argv.includes('--sabotage');
const TARGET = path.basename((process.argv.slice(2).find(a => /\.html$/.test(a))) || 'index-test.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \x1b[32mok\x1b[0m   ' + m); }
                       else   { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, ''));
    try { r.end(fs.readFileSync(f)); } catch (_) { r.statusCode = 404; r.end(''); }
  }).listen(0);
  const port = srv.address().port;

  let file = TARGET;
  if (SAB) {
    const src = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
    const out = src.replace("    if(!tapeSaved(todayKey)) d=new Date(d.getTime()-86400000);   // today is not missed yet", "");
    if (out === src) { console.log('\n  sabotage could not find the guard — it has moved'); process.exit(1); }
    file = '_sabotage-tape.html';
    fs.writeFileSync(path.join(ROOT, file), out);
  }

  const b = await firefox.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  console.log(`\nqa/tape-streak.js — [${file}]\n`);

  await p.goto(`http://127.0.0.1:${port}/${file}?fixture=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof tapeStreak === 'function' && typeof tapeRender === 'function', { timeout: 25000 });

  const r = await p.evaluate(() => {
    const key = (back) => {
      const d = new Date(Date.now() - back * 86400000);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    };
    const set = (back) => localStorage.setItem('stats_tape_' + key(back), JSON.stringify({ said: 'x' }));
    const clr = (back) => localStorage.removeItem('stats_tape_' + key(back));
    const out = {};

    /* nineteen days, today NOT answered — the morning case */
    for (let i = 0; i <= 25; i++) clr(i);
    for (let i = 1; i <= 19; i++) set(i);
    out.morning = tapeStreak();

    /* the same run, today answered — must be one more, not a reset */
    set(0);
    out.afterAnswering = tapeStreak();

    /* a genuinely broken run: yesterday missed */
    for (let i = 0; i <= 25; i++) clr(i);
    for (let i = 2; i <= 19; i++) set(i);
    out.broken = tapeStreak();

    /* no history at all */
    for (let i = 0; i <= 25; i++) clr(i);
    out.fresh = tapeStreak();

    /* the card, with nothing published */
    for (let i = 1; i <= 19; i++) set(i);
    try { TAPE = null; tapeRender();
          const el = document.getElementById('tapeCard');
          out.cardVisible = !!el && el.style.display !== 'none';
          out.cardText = el ? (el.innerText || '').replace(/\s+/g, ' ') : '';
    } catch (e) { out.cardText = 'threw ' + e.message; }
    return out;
  });

  ok(r.morning === 19, `a 19 day run still reads 19 before today's question is published (got ${r.morning})`);
  ok(r.afterAnswering === 20, `and 20 once today is answered, not a reset (got ${r.afterAnswering})`);
  ok(r.broken === 0, `a genuinely missed day DOES break the run (got ${r.broken})`);
  ok(r.fresh === 0, `and somebody with no history has no run (got ${r.fresh})`);
  ok(r.cardVisible === true, 'the card is shown even when no question is published yet');
  ok(/6:30/.test(r.cardText), `and says when the question lands: "${String(r.cardText).slice(0, 70)}"`);
  ok(/19 day/.test(r.cardText), 'and shows the run, so the habit is visible on the day it is most fragile');
  ok(errs.length === 0, 'no page errors: ' + (errs.slice(0, 2).join(' | ') || 'none'));

  await b.close(); srv.close();
  if (SAB) { try { fs.unlinkSync(path.join(ROOT, file)); } catch (_) {} }
  console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed   [${file}]\n`);
  process.exit(fail ? 1 : 0);
})();
