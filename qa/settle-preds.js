/* qa/settle-preds.js — THE CARD IS GRADED EVEN IF NOBODY IS HOLDING THE PHONE.

   14 Sept 2026, den-kc, KC 31 DEN 10, total 41. Two real locked cards:

       Danthefan  Total points: Under 44.5   CORRECT      stored predPts: 0
       King       Winner: Denver Broncos     wrong        stored predPts: 0

   applySettlement() runs on the PHONE. Danthefan locked six picks in 33
   seconds, left four seconds later, and was owed a hundred points nobody
   paid him. He has played since 19 Aug and is the best returning player
   this product has.

   host/settle-preds.js grades the locked card server-side at the final
   buzzer. These checks are the rules it must keep:

     · it pays a line the final score settles
     · it does NOT invent points for a line it cannot settle
     · it RAISES ONLY, because the phone can grade lines the server cannot
       and a lane that goes down is how a good row gets destroyed
       (585 -> 470 on 30 Aug)
     · it refuses a game that is not final

       node qa/settle-preds.js
       node qa/settle-preds.js --sabotage
*/
const path = require('path');
const SAB = process.argv.includes('--sabotage');
const M = require(path.join(__dirname, '..', 'host', 'settle-preds.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \x1b[32mok\x1b[0m   ' + m); }
                       else   { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };

/* a summary shaped like ESPN's, because that is what the runner passes in */
const feed = (hs, as, state, period) => ({
  header: { competitions: [{
    status: { type: { state: state || 'post' }, period: period || 0 },
    competitors: [
      { homeAway: 'home', score: String(hs), team: { displayName: 'Home Side', shortDisplayName: 'Home', abbreviation: 'HOM' } },
      { homeAway: 'away', score: String(as), team: { displayName: 'Away Side', shortDisplayName: 'Away', abbreviation: 'AWY' } },
    ] } ] } });

const card = (qs, picks, opts) => ({
  name: 'T', qs, picks,
  banks: qs.map(() => 100),
  opts: (opts || {}),
});

console.log('\nqa/settle-preds.js\n');

/* 1. the real den-kc card, the reason this exists */
{
  const f = M.finalFacts(feed(31, 10));
  const g = M.gradeCard(
    card(['Winner', 'Total points', 'First score', 'More rush yards', 'Turnovers', 'Lead changes'],
         ['Away Side', 'Under 44.5', 'Touchdown', 'Away Side', 'One', 'Yes'],
         { '1': ['Under 44.5', 'Over 44.5'] }), f, 4);
  ok(g.pts === 100, `den-kc replay: Under 44.5 on a 41-point game pays 100 (got ${g.pts})`);
  ok(g.graded === 2, `only the two lines a final can settle are graded (got ${g.graded})`);
  ok(g.ungraded.length === 4, `the other four are reported ungraded, not scored zero (got ${g.ungraded.length})`);
}
/* 2. the winner line, both ways */
{
  const f = M.finalFacts(feed(31, 10));
  ok(M.gradeCard(card(['Winner'], ['Home Side']), f, 4).pts === 100, 'the winner is paid when right');
  ok(M.gradeCard(card(['Winner'], ['Away Side']), f, 4).pts === 0,   'and not paid when wrong');
}
/* 3. a draw is a result, and soccer can pick it */
{
  const f = M.finalFacts(feed(1, 1));
  ok(f && f.level === true, 'a level score is read as a draw rather than refused');
  ok(M.gradeCard(card(['Result'], ['Draw']), f, 2).pts === 100, 'and "Draw" is paid');
}
/* 4. regulation or not */
{
  ok(M.gradeCard(card(['Extra innings'], ['Yes']), M.finalFacts(feed(5, 4, 'post', 10)), 9).pts === 100,
     'extra innings paid when the game ran past nine');
  ok(M.gradeCard(card(['Extra innings'], ['Yes']), M.finalFacts(feed(5, 4, 'post', 9)), 9).pts === 0,
     'and not paid when it did not');
}
/* 5. both teams to score */
{
  ok(M.gradeCard(card(['Both to score'], ['Yes']), M.finalFacts(feed(2, 1)), 2).pts === 100, 'both-to-score, yes');
  ok(M.gradeCard(card(['Both to score'], ['No']),  M.finalFacts(feed(2, 0)), 2).pts === 100, 'both-to-score, no');
}
/* 6. IT MUST NOT GRADE A GAME THAT IS NOT OVER */
{
  ok(M.finalFacts(feed(3, 1, 'in')) === null, 'a game still in progress is refused outright');
  ok(M.finalFacts(feed('', '', 'post')) === null, 'and so is a final with no digits in the score');
}
/* 7. a line it does not know is never guessed */
{
  const g = M.gradeCard(card(['More corners'], ['Home Side']), M.finalFacts(feed(2, 1)), 2);
  ok(g.pts === 0 && g.graded === 0 && g.ungraded.length === 1,
     'an unknown line is left ungraded rather than scored either way');
}

/* THE SABOTAGE BREAKS THE GRADER, and the checks above must catch it.
   The first version asserted that the BROKEN behaviour was true, which
   is not a sabotage: it is a second bug agreeing with the first. */
if (SAB) {
  const f = M.finalFacts(feed(31, 10));
  /* pretend the totals line was never taught: delete it from the table */
  delete M.LINE['Total points'];
  const g = M.gradeCard(
    card(['Winner', 'Total points'], ['Away Side', 'Under 44.5'],
         { '1': ['Under 44.5', 'Over 44.5'] }), f, 4);
  ok(g.pts === 100, `SABOTAGE: with the totals line removed the card still pays 100 (got ${g.pts})`);
  ok(g.graded === 2, `SABOTAGE: it still grades two lines (got ${g.graded})`);
}
console.log(`\n${fail ? '\x1b[31mRED\x1b[0m  ' : '\x1b[32mGREEN\x1b[0m'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
