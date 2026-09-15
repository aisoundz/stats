/* =====================================================================
   SETTLE THE PREDICTION CARD ON THE SERVER.
   ---------------------------------------------------------------------
   The card settles on the PHONE. applySettlement() runs when the player
   is looking at the final screen, so a player who locks six picks and
   puts the phone down collects nothing, however well they picked.

   14 Sept 2026, den-kc, two real cards and a real final (KC 31, DEN 10):

       Danthefan  Total points: Under 44.5   -> 41 points. CORRECT.
       stored predPts: 0

   He has played since 19 Aug and is the best returning player this
   product has. He locked a full card in 33 seconds, left four seconds
   later, and was owed 100 points nobody paid him.

   The picks were never the missing piece: they are at
   nights/{id}/rounds/rP/subs with the question label, the pick and what
   each line is worth to that player. What was missing is anybody grading
   them who is not the player's own phone.

   WHAT THIS GRADES. Only the lines a FINAL SCORE can settle by itself,
   the same set index.html's settleFinalDerived() covers: the result, the
   totals line, regulation-or-not, and both-teams-to-score. First scorer,
   home runs, strikeouts, rush yards, corners and cards need the box or
   the plays and are left alone, counted, and reported as ungraded.

   IT ONLY EVER RAISES. It writes predSrv and never touches predPts, and
   it refuses to write a number lower than the phone already reported.
   The phone can see lines this cannot; the reverse is the whole point.
   A lane that can go down is how a good row gets destroyed by a reader
   that was itself wrong -- 585 -> 470 on 30 Aug.
   ================================================================== */
const LINE = {
  /* question label -> what kind of line it is. Labels come from the deck
     and are what the phone stored, so this matches on the player's own
     words rather than on an index that could shift. */
  'Winner':        'result',
  'Result':        'result',
  'Total runs':    'total',
  'Total points':  'total',
  'Total goals':   'total',
  'Extra innings': 'extra',
  'Overtime':      'extra',
  'Both to score': 'btts',
};

function finalFacts(sum){
  const c = ((sum.header || {}).competitions || [])[0] || {};
  const st = (c.status || {});
  if (((st.type || {}).state) !== 'post') return null;
  const cs = c.competitors || [];
  if (cs.length !== 2) return null;
  const digits = v => /^\d+$/.test(String(v == null ? '' : v).trim());
  if (!digits(cs[0].score) || !digits(cs[1].score)) return null;
  const home = cs.find(x => x.homeAway === 'home') || cs[0];
  const away = cs.find(x => x.homeAway === 'away') || cs[1];
  const hs = Number(home.score), as = Number(away.score);
  const names = (t) => [ (t.team || {}).displayName, (t.team || {}).shortDisplayName,
                         (t.team || {}).name, (t.team || {}).abbreviation ]
                       .filter(Boolean).map(String);
  return {
    home, away, hs, as, total: hs + as,
    level: hs === as,
    winnerNames: hs === as ? ['Draw'] : names(hs > as ? home : away),
    periods: Number(st.period) || 0,
  };
}

/* "Under 8.5" / "Over 44.5" -> the threshold, read off the player's own
   options rather than a constant here. */
function overUnder(pick, opts){
  const all = (opts || []).concat([pick]).map(String);
  for (const o of all) { const m = o.match(/(\d+(?:\.\d+)?)/); if (m) return Number(m[1]); }
  return null;
}

function gradeCard(sub, f, regulationPeriods){
  const qs    = sub.qs    || [];
  const picks = sub.picks || [];
  const banks = sub.banks || [];
  const optsM = sub.opts  || {};
  let pts = 0, graded = 0, right = 0; const ungraded = [];
  qs.forEach((label, i) => {
    const kind = LINE[String(label).trim()];
    const pick = String(picks[i] == null ? '' : picks[i]).trim();
    const worth = Number(banks[i]) || 0;
    if (!kind || !pick) { ungraded.push(String(label)); return; }
    const opts = optsM[String(i)] || [];
    let truth = null;
    if (kind === 'result') truth = f.winnerNames;
    else if (kind === 'total') {
      const line = overUnder(pick, opts);
      if (line == null) { ungraded.push(String(label)); return; }
      truth = [ f.total > line ? 'Over' : 'Under' ];
      /* compare on the word, since the option carries the number too */
      graded++;
      if (new RegExp('^' + truth[0], 'i').test(pick)) { right++; pts += worth; }
      return;
    }
    else if (kind === 'extra') truth = [ f.periods > regulationPeriods ? 'Yes' : 'No' ];
    else if (kind === 'btts')  truth = [ (f.hs > 0 && f.as > 0) ? 'Yes' : 'No' ];
    if (!truth) { ungraded.push(String(label)); return; }
    graded++;
    const hit = truth.some(t => String(t).toLowerCase() === pick.toLowerCase());
    if (hit) { right++; pts += worth; }
  });
  return { pts, graded, right, ungraded };
}

/* db, FieldValue and a log() are passed in so this module opens no
   connection of its own and can be exercised against a fixture. */
async function settlePreds(db, nightId, sum, sport, log){
  const say = log || (() => {});
  const f = finalFacts(sum);
  if (!f) { say('pred', 'not settling the cards: the feed does not say this game is final'); return null; }
  const REG = { baseball: 9, hockey: 3, basketball: 4, football: 4, soccer: 2 };
  const regulation = REG[sport] == null ? 0 : REG[sport];

  let subs;
  try { subs = await db.collection('nights').doc(nightId)
                      .collection('rounds').doc('rP').collection('subs').get(); }
  catch (e) { say('pred', 'could not read the locked cards: ' + ((e && e.message) || e)); return null; }
  if (!subs.size) { say('pred', 'no locked cards in this room'); return null; }

  const out = { cards: subs.size, paid: 0, raised: 0, ungraded: 0 };
  for (const d of subs.docs) {
    const sub = d.data() || {};
    const g = gradeCard(sub, f, regulation);
    out.ungraded = Math.max(out.ungraded, g.ungraded.length);
    /* the same template-path idiom run.js uses, so one shape means
       "a write to a player document" everywhere and qa/lane-persist.js
       can see every lane this project persists. */
    const pref = db.doc(`nights/${nightId}/players/${d.id}`);
    let had = 0;
    try { const p = await pref.get(); had = Number((p.data() || {}).predPts) || 0; } catch (_) {}
    /* RAISE ONLY. The phone can grade lines this cannot. */
    if (g.pts <= had) {
      say('pred', `${sub.name || d.id.slice(0, 8)}: server ${g.pts}, phone already ${had} — leaving it alone`);
      continue;
    }
    try {
      await pref.set({ predSrv: g.pts }, { merge: true });
      out.paid++; out.raised += (g.pts - had);
      say('pred', `${sub.name || d.id.slice(0, 8)}: ${g.right} of ${g.graded} graded lines right, `
        + `predSrv ${g.pts} (phone had ${had}); ${g.ungraded.length} line(s) need the box score`);
    } catch (e) { say('pred', `could not write predSrv for ${d.id.slice(0, 8)}: ${(e && e.message) || e}`); }
  }
  say('pred', `settled ${out.cards} card(s) on the server, raised ${out.paid} of them by ${out.raised} points in total`);
  return out;
}

module.exports = { settlePreds, gradeCard, finalFacts, LINE };
