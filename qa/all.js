#!/usr/bin/env node
/* =====================================================================
   RUN EVERY SUITE, IN ONE COMMAND, AND RETURN ONE VERDICT.
   ---------------------------------------------------------------------
   WHY THIS EXISTS. There are twenty-six suites in this directory and no
   file anywhere in the repo that runs them all. Each one is invoked by
   hand, from memory, which means the honest description of the gate is
   "whichever suites somebody remembered tonight". A suite nobody runs is
   not a safety net — it is a file that makes you feel like you have one.
   qa/voice-lang.js was written on 19 Aug and would have been the fourth
   suite in a row that only ever ran on the day it was written.

   It also fixes a subtler thing: qa.js reports "ALL 103 CHECKS PASS —
   safe to promote", and that sentence is only true about the checks IN
   qa.js. Promoting on it while host-resolvers.js is red is exactly the
   kind of confident-and-wrong the incident catalogue is full of.

   THE TIERS, because they are not the same kind of check.
     static   no browser, no network. The default. Always runnable.
     browser  drives a real Chromium; needs playwright installed.
     live     asks ESPN or Firestore. Real answers, real flakiness, and
              it fails when the sport is out of season rather than when
              the code is wrong — so it is never in the default run.

     node qa/all.js                 # static + browser  (the gate)
     node qa/all.js --static        # no browser needed
     node qa/all.js --live          # everything, including the network
     node qa/all.js --list          # what would run

   A suite that CRASHES is reported as a failure, not skipped. That is the
   whole point: the failure mode this file exists to stop is a red suite
   that nobody was looking at.
   ================================================================== */
const {spawnSync}=require('child_process');
const fs=require('fs'), path=require('path');
const DIR=__dirname;

const ARG=process.argv.slice(2);
const ONLY_STATIC=ARG.includes('--static');
const WITH_LIVE  =ARG.includes('--live');
const LIST       =ARG.includes('--list');
let STAMP_STUCK=false;
const QUICK      =ARG.includes('--quick');
/* WHICH BUILD IS THIS GATE JUDGING? One answer, handed to every suite that
   accepts one. Found 19 Aug and it is worse than untidy: voice-pick.js
   defaulted to index-test.html while voice.js, voice-wiring.js,
   board-order.js and voice-lang.js defaulted to index.html — so a single
   "the gate is green" was four suites reading the FILE BEING PROMOTED and
   the rest reading the file ALREADY LIVE. Half the gate was grading the
   old build, and the halves swap depending on which suite you ran. That is
   ONE FACT, MANY COPIES with the fact being "the build under test".

   index-test.html is the default because that is what qa.js checks and the
   rule is build-on-test-then-promote.  --file index.html re-runs the same
   suites against what is live, which is how you tell a NEW break from an
   inherited one. */
const fi=ARG.indexOf('--file');
const TARGET=fi>=0 && ARG[fi+1] ? ARG[fi+1] : 'index-test.html';
const TARGET_ABS=path.resolve(__dirname,'..',TARGET);
/* The admin half's candidate, chosen the same way. Defaults to
   admin-test.html so a gate grades what is about to ship; pass
   --admin-file admin.html to run the suites against what is already live,
   which is how you tell a NEW break from an inherited one — the same
   reasoning as --file above. */
const afi=ARG.indexOf('--admin-file');
const ADMIN_TARGET=afi>=0 && ARG[afi+1] ? ARG[afi+1] : 'admin-test.html';
/* Only these accept a positional target; handing one to a suite that does
   not read argv[2] is harmless, but claiming it was targeted would not be. */
const TARGETABLE=new Set(['voice.js','voice-wiring.js','voice-pick.js','voice-lang.js',
  'board-order.js','payoff.js','slate.js','acceptance.js','host-sportsreg.js','localise.js','i18n.js','season.js',
  'devices.js','night-config.js','overtime.js','platforms.js','change-it.js','chrome.js','places.js','switch.js','hero.js','listeners.js','practice.js','spanish.js','marquee-order.js',
  /* Reads a positional path (absolute or relative) and defaults to
     index-test.html — verified by reading its argv handling, not assumed
     from the filename. */
  'desk-reach.js',
  /* Same argv shape as desk-reach.js: a positional path, --file, or the
     index-test.html default. Verified by reading it. */
  'pick-tap.js',
  /* Takes the first argv token ending in .html and otherwise defaults to
     index-test.html — verified by reading its argv handling. It must be
     targetable: the whole point of it is that it goes RED on index.html
     and green on the candidate, which is how you tell the fix landed. */
  'final-buzzer.js',
  /* Same argv shape again — first token ending in .html, else
     index-test.html. Verified by reading it. Targetable for the same
     reason: it goes RED on index.html, which reproduces the 32-second
     race that took Q4 off three nights in a row. */
  'fourth-quarter.js',
  /* Same argv shape. Goes RED on index.html: the pre-game sheet reopens
     mid-game there once S.place has been wiped. */
  'card-deadline.js',
  /* Same argv shape. Goes RED on index.html at 1440x788 — the founder's
     actual window once Chrome's chrome is subtracted. */
  'desk-pick-fit.js']);
/* Suites that read admin.html rather than the player file. The player half
   of the gate was split across two builds and fixed; the ADMIN half is
   split the same way and is NOT fixed — these seven read admin.html even
   when admin-test.html is the file being promoted, while qa.js reads
   admin-test.html. Named here so "green" is never read as broader than it
   is, rather than left to a filename regex to guess at. */
/* Player-side suites that genuinely ignore a passed target.
   THIS LIST WAS WRONG, and the comment above it claimed it had been
   verified by reading each file. It had not. devices.js, night-config.js
   and overtime.js all take process.argv[2] and merely DEFAULT to
   index.html — so 70+ checks, including all sixteen overtime checks on a
   night with a live OT bank, were grading the file ALREADY LIVE while the
   banner said "judging index-test.html". That is the same one-fact-many-
   copies bug this file was written to fix, half-fixed, with a comment
   asserting it was finished. Re-verified by reading argv handling in each:

     devices.js       process.argv[2] || 'index.html'                 TARGETABLE
     night-config.js  process.argv[2] || …/index.html                 TARGETABLE
     overtime.js      process.argv[2] || …/index.html                 TARGETABLE
     journey.js       ARG('url', …/index-test.html)  — no argv[2]     untargeted
     live-smoke.js    drives https://statsgametime.com/               by design */
const KNOWN_UNTARGETED=['journey.js','live-smoke.js'];
const ADMIN_READERS=['host-overtime.js','host-resolvers.js','host-sports.js','host-block.js',
                     'host-banks.js','host-publish-ot.js','bank-shadow.js',
                     /* These two already DEFAULT to admin-test.html, so a gate graded them
                        correctly without being listed here. They are listed anyway so that
                        `--admin-file admin.html` reaches them too — otherwise the "run it
                        against what is live to tell a NEW break from an inherited one"
                        workflow silently reports on the candidate for these two and on live
                        for the other seven, which is the worst possible answer: a mixed
                        reading that looks like one reading. They match a bare admin*.html
                        token anywhere in argv rather than reading --file, and the value we
                        push satisfies that. */
                     'inning-end.js','ci-rotation.js'];

/* The tier of each suite, stated once. A suite added to the directory and
   not named here is REPORTED, not silently ignored — see the sweep below,
   which is the difference between a manifest and a lie. */
const TIER={
  'qa.js':            {tier:'browser', args:QUICK?['--quick']:[]},
  'acceptance.js':    {tier:'static'},
  'board-order.js':   {tier:'static'},
  /* 21 Aug: a finished Caught It card came back on every tab change, and
     "usually the same one" — one stale question sat in PCI.pending and
     paintNav flushed the queue on every navigation. Static, because what
     was wrong was the RULE, not a pixel. */
  'caught-stale.js':  {tier:'static'},
  /* NOT SUITES. Both end in module.exports and print nothing; node loads
     them and exits 0, so they can never fail. Tiered as 'lib' so they are
     neither run nor reported as untiered — "ALL 16 SUITES PASS" used to be
     14 suites and 2 module loads. */
  'fakebase.js':      {tier:'lib'},
  'ready.js':         {tier:'lib'},
  'fixtures.js':      {tier:'lib'},
  'host-banks.js':    {tier:'static'},
  'host-block.js':    {tier:'static'},
  'host-overtime.js': {tier:'static'},
  'host-publish-ot.js':{tier:'static'},
  'host-resolvers.js':{tier:'static'},
  'host-runner.js':   {tier:'static'},
  'host-sports.js':   {tier:'static'},
  'launcher.js':      {tier:'static'},
  'voice.js':         {tier:'static'},
  'voice-lang.js':    {tier:'static'},
  'feed-path.js':     {tier:'static'},   // static by default; --live asks ESPN
  /* STRUCTURAL, not behavioural. Every other suite in this gate asks "does
     it do the right thing"; this one asks "can this line ever run at all".
     It exists because on 19-20 Aug the same defect — a comparison against a
     state value that is not in GAME_SCREENS — was found in the app twice
     and in five suites, and every one of those files passed its own checks
     while the code under them had never executed. */
  'places.js':        {tier:'static'},
  /* Room-switching, end to end, in a real browser. Every check in it is a
     defect that reached a live game night, and all five were sabotage-
     tested on 20 Aug: break the sport swap, the watchlist rebuild, the
     baked answer, the stats cache key or the rail collapse, and it goes
     red naming which one. */
  'switch.js':        {tier:'browser'},
  'hero.js':          {tier:'browser'},
  'listeners.js':     {tier:'browser'},
  'practice.js':      {tier:'browser'},
  /* --max 0. The backlog went to zero on 20 Aug, and a reporting-only check
     is how it got to 76 in the first place: nothing was lying, nobody was
     counting. From here a single untranslated string on any screen a player
     can reach turns the gate red. Sabotage-tested by deleting one entry, and
     it failed naming the string, so this can actually fail. */
  'spanish.js':       {tier:'browser', args:['--max','0']},
  'marquee-order.js': {tier:'browser'},
  /* NODE ONLY, and that is the point: it drives the real host engine over
     the real recorded feed for all five leagues with no browser at all, so
     it can be run during a live game night on the machine that is hosting
     it. It is also the only suite in this file that has ever asked the
     host a question about a sport that is not basketball. */
  'night-per-sport.js': {tier:'static'},
  /* The 20 Aug phantom overtime: a 70-point round for innings nobody
     played, opened 237ms after the real final round, in a game that
     ended in regulation. Static because it drives the real roundSlots()
     against synthetic feeds where the scoreboard and the plays disagree,
     which is the one condition no archived feed reproduces. */
  'phantom-ot.js': {tier:'static'},
  /* The only suite here that tests whether the game is FUN. It is in
     the gate for the same reason as the rest: a celebration that quietly
     stops firing, or starts swallowing taps over a live card, is not
     something a player will ever file a bug about. */
  'celebrate.js': {tier:'player'},
  /* "Dan is always refreshing his phone. So am I." Backgrounding the
     app tore down the round listener and nothing re-armed it, so the
     only cure was a reload. qa/listeners.js proves every listener is
     CLOSED; nothing proved one is ever re-opened. */
  'rearm.js': {tier:'player'},
  /* "Innings 1-3 open after the 3rd" — a device's FIRST ever round
     document can arrive already scored (rearm.js's own comment says
     so), and onHostedRound() rendered that round's raw index instead
     of asking roomNextRound() where the room actually is. Drives the
     real onHostedRound()/renderLobby(), unlike rearm.js which stubs
     onHostedRound() out and so never exercises this path at all. */
  'late-join.js': {tier:'player'},
  /* STATS answering the question that was asked — and staying out of
     the way of the broadcast when it was not being spoken to. */
  'stats-answers.js': {tier:'player'},
  /* "Even after the game i could still go to the home page and still
     play. It didnt stop and say the game is over." phaseNow() knew the
     whole time and nothing asked it. */
  'finished.js': {tier:'player'},
  /* Dan is on Android, and Android is where the microphone opens by
     ITSELF — so the app's own loudspeaker is in its own recogniser.
     Different platform, different failures, its own suite. */
  'voice-android.js': {tier:'player'},
  /* THREE BUGS THE FOUNDER FOUND WHILE PLAYING A LIVE GAME, 21 AUG. Each
     one was a screen reading a LOCAL variable when the ROOM already knew
     the answer: a player who joined at halftime was offered Quarter 1 and
     never shown the red "a round is open" bar; YOUR NIGHT printed 0 with
     the board beside it printing 10; and the game chooser floated on top
     of a live question. None needed new data. All three are the ordinary
     experience of anybody who arrives after tip — which is everybody we
     are trying to recruit. */
  'room-position.js': {tier:'player'},
  /* The 25 minutes between rounds used to render one disabled grey
     button. gtCardWatch() puts the live per-pick race there — "needs 3
     more to pass Atkins" — which is the sentence that makes somebody look
     up at the television. It is a MIRROR of the Stats tab's version, so
     this suite mostly exists to stop the two disagreeing. */
  'card-watch.js': {tier:'player'},
  /* "it doesnt listen to my answer until after the full question asks...
     and it doesnt take lock in or next." The echo guard that stops the app
     answering its own question was also eating the player's answer, because
     the words you answer with are the words we just read out. Order of
     tests, not new logic — and voice is the north star, so it gets a suite
     that RUNS the decision rather than reading around it. */
  'bargein.js': {tier:'player'},
  /* "The game night is wrong, it says 13 but its 16." The app ships with a
     night baked in and that night gets older every day; this is the third
     time a stale constant has been reported as a bug. */
  'stale-default.js': {tier:'player'},
  /* "after I go to the stats page I cant go back to the game time page it
     gets stuck." Three of navGo's five branches rendered before they
     navigated, so a throwing render trapped the player. This BREAKS a
     render on purpose and demands they can still leave. */
  'nav-escape.js': {tier:'browser'},
  /* "the stats for baseball and nfl have nothing." Baseball's team stats
     were never read at all — ESPN nests them and the reader only knew the
     flat shape. Drives the real page against real fixtures for three
     leagues and demands CONTENT, not wiring. */
  'stats-page.js': {tier:'browser'},
  /* B-71: "after the quarter ended and the score was made i was able to
     sign into the tempo and mystics game and put in entries after the
     game." firestore.rules had never been executed by anything — the
     acceptance suite says so in terms — so the file deciding who may write
     to a live game shipped on reading alone. This evaluates the real
     ruleset. It skipped, loudly, until 24 Aug, when the service account
     was granted roles/firebaserules.admin in the console — no code
     change, an IAM grant — and it started actually running: 14 passed,
     0 failed against the live rules, including both B-71 `-local` cases. */
  'rules.js': {tier:'static'},
  /* "We need more questions for caught it in baseball." There were four
     and it could only ever ask one: the rotation divided a counter that
     resets every period, and baseball gets about one question a period.
     Counts DISTINCT kinds reached across a night, which is the thing
     every existing check was blind to. */
  'ci-rotation.js': {tier:'static'},
  /* "I have 2 user that show they are both 3 of 3 on their card" and "The
     share screen looks wrong" — the same mistake twice: a fact about the
     ROOM printed under a personal label. The denominator counted what the
     room graded, and the share headline read GAME.night, which holds the
     matchup on a real night and the number on the fallback. */
  'your-own-card.js': {tier:'static'},
  /* "We added a game last minute yesterday. All the games should be in
     order." Two files owned Game Night #N — build-slate derived it from
     tip order, marquee.js invented it from the marquee FILES and stamped
     it into the slate afterwards. A number remembered from a file cannot
     survive a game being added late; one recomputed from the series can. */
  'night-numbers.js': {tier:'static'},
  /* The AI beta tester, on a 393pt phone: the ☰ button was cutting a
     38x39 hole out of the top-right corner of a live Caught It card —
     which is exactly where the ✕ and the countdown sit, so the two
     controls you reach for during a question were the two the button ate.
     Only on the three screens with no score strip; on gametime the
     scoreboard already pushed the card clear, which is why it survived
     every previous look. Geometric, both engines, four screens. */
  'ci-clearance.js': {tier:'browser'},
  /* The 25 Aug Caught It batch. Registered here at the same time as the
     suites themselves, because `all.js` treats an unlisted suite as a
     FAILURE, not a note — "a suite nobody runs is not a safety net". These
     three were written, were green standalone, and would have shipped
     never having been run by the gate. */
  'ci-deaf.js':    {tier:'browser'},
  'ci-surface.js': {tier:'browser'},
  'ci-window.js':  {tier:'browser'},
  /* Same tester, same session: pressed Practice inside a Giants-Dolphins
     room and was asked to choose between Denver and Atlanta. hydrateNight
     replaces the GAME's team names but not the question STRINGS, so the
     scoreboard and the questions were reading two different games. Drives
     setSport -> hydrate -> startDemo for three sports and reads the words. */
  'practice-teams.js': {tier:'browser'},
  /* "Scoreboard check — who is ahead right now?" arrived with the score
     on screen; the tester answered without looking up. Free points teach
     a player that watching is optional. The score reads are not deleted
     (early in a quarter they are all there is) — they are ordered last,
     behind everything that requires having watched. */
  'ci-order.js': {tier:'browser'},
  /* From the 22 Aug archive: a player answered two of Q2's four questions
     three minutes after Q2 closed and Q3 opened. The write was filed safely
     to 'r1-local' — but the receipt was keyed to 'r1', found no status for
     a document nobody wrote, and hid itself. He did the work and was told
     nothing at all. His own note the night before: "I could submit answers
     after the game ended." The write was made safe then; the sentence
     was not. */
  'sub-receipt.js': {tier:'browser'},
  /* The other half of the same 22 Aug finding: he should not have been
     able to OPEN Q2 at 22:37 at all. The round listener holds exactly one
     document — the newest — so hostedDoc() cannot see that the host served
     a past round, and the built-in deck opened as though nobody were
     hosting. The host's own index settles it: anything before HR.doc.idx
     is finished. Guards the three exceptions as hard as the rule. */
  'closed-round.js': {tier:'browser'},
  /* Stats tab, from the beta tester: the 3rd-down bar answered a different
     question from its label and Penalties had no 'lower is better' note.
     One cause — both arrive as "N-M" and both were tagged 'frac', so
     5-of-16 (31%) was shown beating 4-of-8 (50%) and more penalties read as
     leading. The numbers beside them were right the whole time; only the
     verdict was wrong, which is why nobody caught it. */
  'team-bars.js': {tier:'browser'},
  /* "For baseball we should do question at the end of every [inning]."
     The scoring rounds cover innings 1-3, 4-6 and 7-9, so between them sit
     forty-minute stretches with nothing to answer. Fires on the turn of the
     period, about the inning that just ENDED — at that instant the new one
     has no plays in it. Checked against every inning of a real 604-play
     game, plus a two-run homer, which is the case that separates counting
     RUNS from counting scoring PLAYS. */
  'inning-end.js': {tier:'static'},
  /* His phone, 22 Aug, in the Portland-LAFC room AT HALF-TIME: "FINAL
     WHISTLE · Score your predictions". The room was read while still live —
     r0 "First half", state=live, four questions. They existed and he was
     walked past them. The route was never proven; the rule that makes every
     candidate harmless is that the HOST decides when a night is over, and
     while a round is live there is nothing to settle. Checks both doors,
     and checks just as hard that a finished night can still settle. */
  'not-final-yet.js': {tier:'browser'},
  /* debrief.js prints "Zero errors is a FINDING, not a clean bill of
     health" over every night. This is the difference between those two
     sentences. SB.logError stamped window.STATS_BUILD_ID, which nothing has
     ever set, so every crash report ever written said build:"" — the first
     question anyone asks of one, unanswerable from the report itself. */
  'error-log.js': {tier:'browser'},
  /* NFL Week 1 is 6 September and regular-season games go to overtime;
     publish.js had been logging "football does not have an OT-tagged
     template yet" on every NFL night. It has one now — and nothing in the
     2026 schedule can exercise it, because preseason has no overtime. The
     fixture turned out to BE an overtime game (Rams 20, Bears 17: punt,
     interception, winning field goal), so the round is checked against a
     real one rather than an invention. */
  'nfl-overtime.js': {tier:'static'},
  /* "The question for baseball it's tough to say what was the last pitch
     because the time is different — it has to be something related to the
     game, who was the second strikeout etc." That is a fairness bug: the
     feed runs AHEAD of the television, so "who is at the plate right now"
     flipped at every half-inning boundary and a person watching carefully
     answered wrong. An ordinal cannot be reached by any delay — provided
     it waits until the event is safely in the past, which is the whole
     point of the lag buffer. */
  'ordinal-question.js': {tier:'static'},
  /* 23 Aug, real 9-inning game watched live: 12 Caught It questions
     fired (exactly 'normal' pace's per-game cap), then NOTHING for the
     last 85 minutes — no 9th inning, nothing else. Two ordinary
     at-bat/pitch questions shared the same 12-question pool as the
     end-of-inning guarantee, so the pool ran dry three innings early.
     "A question at the end of every inning" is a promise, not a pacing
     preference, and cannot share a budget with something competing for
     the same slots. Sabotage-verified: a plausible-looking one-line
     regression (reuse askedTotal for inning-end) is caught. */
  'inning-end-budget.js': {tier:'static'},
  /* "When the caught it question was done and I missed it, it just
     stayed stuck on the screen." Confirmed in the code: the locked/missed
     branch never scheduled a hide of its own — it depended entirely on the
     server's 'resolved' write arriving and triggering a fresh render. A
     missed snapshot, a slow resolve, a listener hiccup, and the card sat
     there with disabled buttons forever. Now self-clears 15s after lock
     if no resolve has taken over by then. */
  'ci-missed-card.js': {tier:'browser'},
  /* "The points didn't add up in all the pages. In one page Dan the fan
     has 480 and another page he has 190." Two listeners fed the same
     client cache: SB.top() composed the true total via nightTotal(), and
     SB.watchBoard() read the raw legacy `pts` field straight off the
     document. renderBoard() showed .total when present and silently fell
     back to .pts when not — whichever listener wrote last decided which
     number a player saw. The fixture used the exact numbers reported. */
  'board-total.js': {tier:'browser'},
  /* A device showed a round as "not open yet" nine minutes after it had
     genuinely opened server-side. roomNextRound()/hostedDoc() read correctly
     on a static trace; the remaining suspect is a round-watch listener that
     LOOKS attached but has quietly stopped receiving pushes, which nothing
     detected. A real fix needs the feed's period as a number, which the
     client only has as free text — not a guess to ship overnight. This is
     the safe half: SB.lastRoundWatchAt is now recorded at the exact moment
     a player sees the wait screen, so the next occurrence is one number in
     the trk stream instead of an hour reconstructing Firestore timestamps. */
  'round-wait-diagnostic.js': {tier:'browser'},
  /* "The heard: ..." debug text — ambient TV dialogue, misrecognised — sat
     on screen UNCHANGED across two entirely different questions, with two
     different manually-tapped answers in between. V.lastHeard was written
     once and never cleared. First attempt at the fix referenced the wrong
     variable name (V, private inside the VX closure, instead of VX, the
     name that closure is actually exposed under) — silently swallowed by
     its own try/catch, would have shipped doing nothing. This suite drove
     the real code path and caught it before it went out. */
  'voice-heard-clear.js': {tier:'browser'},
  /* From the demo: "they had to scroll to the bottom of the page for
     locked in or next... The user shouldn't scroll down to find next or
     lock." A twelve-name roster is 2,000px tall on a phone and the way
     forward sat under all of it. Measures WHERE the control is when you
     need it, which is the question no existing check asked. */
  'pick-reach.js': {tier:'browser'},
  /* The same question one viewport to the right. pick-reach.js proved the
     22 Aug pinning at 375x667 and 393x852 and nothing else, so the two
     media queries whose whole job was to change behaviour ABOVE those
     sizes — min-width:560px and min-height:860px — were never once
     evaluated, and the founder hit the original bug again on a desktop on
     24 Aug. Runs the reported case at the reported size, on two engines,
     with the phone alongside it in the same file. */
  'desk-reach.js': {tier:'browser'},
  /* A TAP MUST SURVIVE A REBUILD. The prediction sheet lost 43% of normal
     thumb taps in production because buildPred() rewrote innerHTML between
     mousedown and mouseup and the browser then dispatched no click at all.
     Drives pointerdown, holds, forces the rebuild, then pointerup — an
     instant click reproduces only 7% of it and makes a broken build look
     nearly fine, which is why this could not be a page.click() suite.
     Covers Caught It too: same shape, twenty-second clock, no retry. */
  'pick-tap.js':   {tier:'browser'},
  /* Reads source, not a browser. Guards the shape of bug this repo produces
     more than any other: something that fails and tells nobody. */
  'silence.js':       {tier:'static'},
  'bank-shadow.js':   {tier:'static'},
  'devices.js':       {tier:'browser'},
  'host-sportsreg.js':{tier:'browser'},
  'live-smoke.js':    {tier:'browser'},
  'night-config.js':  {tier:'browser'},
  'overtime.js':      {tier:'browser'},
  'slate.js':         {tier:'browser'},
  'voice-pick.js':    {tier:'browser'},
  'voice-wiring.js':  {tier:'browser'},
  'payoff.js':        {tier:'browser'},
  /* THE LAST SCREEN OF THE NIGHT. 25 Aug: a stranger played practice end
     to end and the final buzzer told them, at once, that they scored 380,
     finished "#8", beat "99% of players", and were not on a six-name board
     where every listed player was above them — then called 380/1000 "38
     Season pts" and promised prizes for a practice run. Five surfaces, no
     two counting the same population, on the screen where somebody decides
     whether this product knows what their score is.

     Asserts agreement between rendered numbers rather than the wording of
     any one of them, so a build that computes nonsense politely still goes
     red. Two engines; WebKit crashes on this Jetson and is not claimed. */
  'final-buzzer.js':  {tier:'browser'},
  /* THE LAST ROUND OF THE NIGHT. Three nights in three sports, all within
     one runner poll cycle: 23 Aug WNBA Final -> Q4 34s later, 25 Aug WNBA
     Final -> Q4 32s later, 25 Aug MLB Final -> "7th-9th" 34s later. The
     feed flips to final BEFORE the last round opens, essentially always,
     and the round it removes is the most valuable one on the card — 70 of
     150 round points in tonight's baseball plan.

     nightRoundsOutstanding() had known this since 23 Aug and had ONE
     caller: the settle decision. Every render decision answered the
     question itself, so the Home tab's banner said "🔴 Q4 is open" while
     the Gametime tab painted the final card over the top of the answer
     button. Asserts the decider, the RENDERED tab, and lockPicks()
     together, plus the 45-minute abandonment valve walked across its
     boundary so a night can still always end. Two engines. */
  'fourth-quarter.js':{tier:'browser'},
  /* THE SEALED CARD. The pre-game sheet is 600 of a night's 1,000 points
     and its only lock was S.place — a localStorage field the app itself
     deletes on sign-out, on a room switch, and for the first 60ms of
     every boot. Founder, live, at 4:03 in the fourth: "all it takes is a
     refresh." Drives the real path — live phase, S.place wiped the way a
     reload wipes it, startPredict() — through all three doors into the
     deck. Two engines. */
  'card-deadline.js': {tier:'browser'},
  /* THE PICK SHEET ON A LAPTOP. desk-reach.js proved 1850x1050, where the
     deck fits; the founder presents from a 1440x900 Mac, which is 788px
     of viewport once the menu bar, tab strip and address bar are gone,
     and there it did not. Measures the rendered rectangles at six desk
     sizes AND on a phone, so a desk fix that moves the phone goes red. */
  'desk-pick-fit.js': {tier:'browser'},
  'localise.js':      {tier:'browser'},
  'i18n.js':          {tier:'browser'},
  'season.js':        {tier:'browser'},
  'change-it.js':     {tier:'browser'},
  /* Three engines x 11 device profiles — the slowest suite by far, so it
     is browser-tier and runs in the full gate rather than --static. */
  'platforms.js':     {tier:'browser'},
  /* THE CHROME BUDGET. Browser-tier and in the default gate, because the
     bug it catches — 41% of an iPad given to three sticky bars that know
     nothing about each other — was live through 538 green checks. */
  'chrome.js':        {tier:'browser'},
  'claims.js':        {tier:'live'},
  /* THE ONLY SUITE THAT READS THE WORDS. Live-tier because a placeholder
     that only appears once the real slate is on the page is exactly the one
     that got through — "swap this", on two soccer cards, to the founder's
     phone. A stubbed backend cannot see it. */
  'screen-copy.js':   {tier:'live'},
  'journey.js':       {tier:'browser'},
  'live-path.js':     {tier:'live'},
  /* Founder screenshot, 24 Aug, TB @ DET, Top 2nd: "1 of 3 rounds settled
     so far" and "0 of 5 leading", both fabricated — checkQuarterLeadBonus
     and stYourCard's live race were written for basketball, where the
     Nth period IS the Nth round and every pick is a player stat. Neither
     is true for baseball/football/hockey/soccer. Two independent levers,
     each sabotage-verified on its own. */
  'round-lead.js':    {tier:'browser'},
  /* Founder screenshot, 24 Aug, TB @ DET, Top 7th: the header read
     "35 pts · #2" and the "Your room tonight" card directly beneath it
     showed the same player on 0. stRoomCard() was the last score surface
     still keeping its OWN board copy instead of reading `lastStand` —
     ROOMSTAT.ok was set true on the first fetch and NOTHING in the file
     ever set it back, so the card was a snapshot of whatever the board
     said the first time the Stats tab was opened that night, and it was
     never room-scoped either. It also read `p.pts` where six other
     readers take `total ?? pts`, so a row carrying `total` rendered 0
     with perfectly fresh data. Seven levers, each sabotage-verified alone,
     including the two that guard the ~2,400/sec microtask redraw chain
     the ok-guard exists to prevent. */
  'room-stale.js':    {tier:'browser'},
};

/* NAME THE SUITES THAT EXIST BUT ARE NOT IN THE TABLE. A manifest that
   silently covers a subset is the same bug as a gate that runs a subset. */
const onDisk=fs.readdirSync(DIR).filter(f=>/\.js$/.test(f) && f!=='all.js').sort();
const unlisted=onDisk.filter(f=>!TIER[f]);
const missing =Object.keys(TIER).filter(f=>!onDisk.includes(f));

function wanted(f){
  const t=TIER[f].tier;
  if(t==='lib')     return false;          // a helper module, not a suite
  if(t==='live')    return WITH_LIVE;
  if(t==='browser') return !ONLY_STATIC;
  return true;
}
const run=onDisk.filter(f=>TIER[f] && wanted(f));

if(LIST){
  console.log('\nwould run '+run.length+' of '+onDisk.length+' suites, judging '+TARGET+':');
  run.forEach(f=>console.log('  '+TIER[f].tier.padEnd(8)+f));
  if(unlisted.length) console.log('\nNOT IN THE TABLE (never run): '+unlisted.join(', '));
  process.exit(0);
}

/* ---- A PROMOTION NO PHONE CAN DETECT --------------------------------
   index.html carries the build the player is running; the app compares the
   SERVED stamp against the LOADED one and only offers "↻ New version ready"
   when they differ. Promote a candidate whose stamp equals the live one and
   nobody with the page already open is ever told — half the room plays the
   old build all night, and nothing on any screen, in the Control Room, or
   in live-smoke can tell them apart. qa.js checks a stamp EXISTS, not that
   it MOVED, so the gate could not catch this. Now it can. */
function stampOf(f){
  try{ return (fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')
                 .match(/const STATS_BUILD='([^']+)'/)||[])[1]||null; }catch(_){ return null; }
}
/* THE QUESTION THIS ASKS HAD GONE STALE WITH THE WORKFLOW.
   It compared index-test.html against index.html and warned when they
   matched. That was right when the loop was build-on-test-then-promote.
   The loop is now edit-index-directly and keep index-test as a synced
   copy, so the two ALWAYS matched and this fired on every single run.
   A warning that always fires is exactly as useless as one that never
   fires, and it trains you to scroll past the line above it.

   The real question is: has this working tree changed the player app
   WITHOUT moving the build stamp? A phone only offers "new version
   ready" when the stamp moves, so an edited file on an unchanged stamp
   ships a fix no open phone can detect. Ask git, which knows what the
   last committed build was.

   NEVER READ THE FILE THROUGH execSync. The first version of this ran
   `git show HEAD:index.html` and compared the whole text. execSync
   defaults to a 1MB buffer, index.html is 1.38MB, so it threw ENOBUFS
   on every run, the catch swallowed it, and the check sat silent while
   reporting nothing — the exact failure it exists to prevent, inside
   itself. Both commands below return a few bytes. */
if(!LIST){
  const cp=require('child_process');
  const RT=path.resolve(__dirname,'..');
  const git=(cmd)=>cp.execSync(cmd,{cwd:RT,stdio:['ignore','pipe','ignore']}).toString().trim();
  /* "no git here" and "git is broken here" are different sentences and only
     the first one is allowed to be quiet. git exits 128 when the directory is
     not a repository, and the spawn throws ENOENT when there is no binary at
     all; both are legitimate reasons to skip. ANY OTHER failure means the
     tool that answers this question is broken, and a broken tool must not
     read as a pass. */
  let isRepo=true, gitBroken=null;
  try{ git('git rev-parse --git-dir'); }
  catch(e){
    isRepo=false;
    if(e.code!=='ENOENT' && e.status!==128) gitBroken=(e.message||'').split('\n')[0];
  }
  if(gitBroken){
    console.log('\n  !! git is present but not answering, so the build stamp was never');
    console.log('     checked: '+gitBroken);
    console.log('     Treating that as a failure, not as a pass.\n');
    STAMP_STUCK = true;
  }
  if(isRepo){
    /* Past this point a failure is a FINDING, not a shrug. A bare catch
       here is how the ENOBUFS bug hid. */
    let changed=null, headStamp=null, why=null;
    try{
      changed = git('git diff --name-only HEAD -- index.html').length > 0;
      headStamp = git("git show HEAD:index.html | grep -m1 -o \"const STATS_BUILD='[^']*'\" || true")
                    .replace(/^const STATS_BUILD='/,'').replace(/'$/,'') || null;
    }catch(e){ why = e.message.split('\n')[0]; }
    const nowStamp = stampOf('index.html');
    if(why){
      console.log('\n  !! could not ask git whether the build stamp moved: '+why);
      console.log('     Treating that as a failure, not as a pass. "I could not check"');
      console.log('     and "I checked and it is fine" are not the same sentence.\n');
      STAMP_STUCK = true;
    }else if(changed && headStamp && nowStamp && nowStamp===headStamp){
      console.log('\n  !! index.html has changed since the last commit and still says '+nowStamp);
      console.log('     A phone only offers "new version ready" when the stamp MOVES, so');
      console.log('     shipping this would be a fix no open phone can detect.');
      console.log('     Bump STATS_BUILD.\n');
      STAMP_STUCK = true;
    }
  }
}

if(!fs.existsSync(TARGET_ABS)){ console.log('  the file under test does not exist: '+TARGET_ABS); process.exit(1); }
/* Say which suites are NOT reading that file, so "green" is never read as
   broader than it is. */
/* SAY WHICH SUITES ARE NOT READING THE TARGET — from a LIST, not a regex
   over filenames. The regex version was wrong in both directions: it
   omitted acceptance.js and host-sportsreg.js (both of which really did
   hardcode index.html) and it named journey.js, which does not. A note
   about honesty that is itself guessing is worse than no note. */
const untargeted=run.filter(f=>!TARGETABLE.has(f) && !ADMIN_READERS.includes(f) && KNOWN_UNTARGETED.includes(f));
if(untargeted.length)
  console.log('  player-side suites reading their OWN default build, not '+TARGET+': '+untargeted.join(', '));
const adminRun=run.filter(f=>ADMIN_READERS.includes(f));
if(adminRun.length)
  console.log('  admin-side suites graded against '+ADMIN_TARGET+': '+adminRun.join(', '));
if(untargeted.length||adminRun.length) console.log('');
if(missing.length)  console.log('  ! named in the table but not on disk: '+missing.join(', ')+'\n');
if(unlisted.length) console.log('  ! on disk but in no tier, so never run: '+unlisted.join(', ')+'\n');

const results=[];
for(const f of run){
  const t0=Date.now();
  const argv=[path.join(DIR,f), ...(TIER[f].args||[])];
  if(TARGETABLE.has(f)) argv.push(TARGET_ABS);
  /* THE ADMIN HALF NOW GRADES THE CANDIDATE TOO. Every suite in
     ADMIN_READERS used to read admin.html unconditionally, so a full gate
     could go green having never once read the banks it was about to
     promote — the same one-fact-many-copies disease this file exists to
     catch, sitting inside the catcher. Found 25 Aug, when a promoted bank
     change had to be re-verified by hand afterwards.
     All seven take a NAMED --file (positional argv is already the fixtures
     directory in most of them) and each strips the pair before reading its
     own positionals. Each was checked with a negative control — a bogus
     filename must FAIL — because a flag that is silently ignored would let
     this line claim coverage it does not have, which is worse than the gap
     it replaces. */
  if(ADMIN_READERS.includes(f)) argv.push('--file', ADMIN_TARGET);
  const r=spawnSync('node',argv,{encoding:'utf8', timeout:20*60*1000, maxBuffer:64*1024*1024});
  const ms=Date.now()-t0;
  const out=(r.stdout||'')+(r.stderr||'');
  /* A timeout or a crash has no exit status; treat both as failure and say
     which, because "suite hung" and "suite failed" are different repairs. */
  let how = r.error && r.error.code==='ETIMEDOUT' ? 'TIMEOUT'
            : r.status===0 ? 'PASS'
            : (r.status==null ? 'CRASH' : 'FAIL');
  /* A SUITE THAT ANNOUNCES IT RAN NOTHING IS NOT A PASS.
     qa/rules.js exits 0 after printing "SKIP -- the rules were NOT evaluated.
     The Rules API refused: The caller does not have permission", and names its
     own consequence in the next line: "which is how B-71 shipped". The gate
     counted it inside ALL 32 SUITES PASS. That is the same defect as the three
     suites that printed "no fixtures dir -- skipping" and exited 0, which this
     file was written to eliminate, surviving in a suite nobody re-read.
     "I could not check" and "I checked and it is fine" are different
     sentences. */
  /* ANCHORED, because an unanchored pattern is a substring match and this
     repo has been bitten by that before (indexOf('NBA') matches inside WNBA).
     The first version flagged phantom-ot.js, which logs lowercase "skip" as
     TEST DATA -- the code under test correctly declining to invent an
     overtime. That is the suite working. What we want is a suite's own
     VERDICT that it ran nothing, which appears at the start of a line. */
  const skipped = /^\s*SKIP\b/m.test(out)
               || /were NOT evaluated/i.test(out)
               || /^\s*(no fixtures dir|skipping)\b/im.test(out);
  if(how==='PASS' && skipped) how='RAN NOTHING';
  /* The last non-empty line is every suite's verdict line, by convention. */
  const line=(out.trim().split('\n').filter(x=>x.trim()).pop()||'').replace(/\x1b\[[0-9;]*m/g,'').trim();
  results.push({f, how, ms, line, out});
  const mark = how==='PASS' ? '  ok  ' : (how==='RAN NOTHING' ? '  --  ' : '  XX  ');
  console.log(mark+f.padEnd(20)+String(ms+'ms').padStart(8)+'   '+line.slice(0,90));
}

/* ---- COVERAGE DOES NOT SILENTLY SHRINK ------------------------------
   A suite that reports "GREEN 31 passed, 0 failed" where it used to report
   34 has not got better — it has quietly stopped running three checks, and
   every one of those is now unguarded while the line still says GREEN.
   Seen for real on 19 Aug: qa/journey.js reported 34 during one run and 31
   in the next, on identical source, differing only in how loaded the
   machine was. Nothing anywhere would have noticed.

   So the count is remembered. A DROP is reported as a failure; a rise
   updates the baseline, because adding checks is the thing we want. This
   is deliberately a floor and not an equality: suites legitimately gain
   checks, and a gate that goes red when you write a new test is a gate
   people stop running. */
/* KNOWN-VARIABLE SUITES, each for a stated reason. A floor on these would
   be noise, and a noisy gate is one people stop reading — but "we do not
   know why it moves" is not a reason, so anything added here has to come
   with one.

     journey.js     emits some assertions through railOk() at call sites
                    inside conditional blocks, so the total moves with which
                    branches a run takes: 34 idle, 31 under load, identical
                    source. A loaded machine getting LESS coverage is
                    backwards and worth fixing properly.
     live-smoke.js  drives the real https://statsgametime.com/ over the
                    network, so a check can go unrun because something was
                    unreachable rather than because the code changed. Seen
                    10 -> 8 -> 10 within minutes.

   Both should become deterministic and come off this list. Everything else
   is floored. This list should get SHORTER, not longer. */
const COUNT_UNSTABLE=new Set(['journey.js','live-smoke.js']);
const BASE_FILE=path.join(DIR,'.counts.json');
let base={}; try{ base=JSON.parse(fs.readFileSync(BASE_FILE,'utf8')); }catch(_){}
const shrunk=[];
for(const r of results){
  /* ============ READ THE WHOLE SUITE, NOT ITS LAST LINE ==============
     21 Aug: the gate reported "qa.js floor was 103, this run reported no
     number" and told me to treat the run as RED. qa.js had in fact printed
     `537 CHECKS PASS, no build failures` — and then four more lines, the
     standing note about the live-feed group wedging on this machine, which
     is a known Jetson condition. The count was there; only the tail was
     looked at.

     That is a false red on a mechanism whose entire job is to be believed.
     A ratchet that cries wolf on a green build is how somebody learns to
     promote through a warning, which is the failure the honesty work was
     doing before it — so the parser looks at everything the suite said and
     takes the LAST count it finds, rather than hoping the count is the
     last thing printed. */
  /* `all 40 chrome checks pass`, `all 16 overtime checks`, `all 78 voice
     wiring checks` — the number and the word "checks" are separated by the
     suite's own name, so a pattern that demands them adjacent misses all
     three. Rewriting this list on 22 Aug dropped the loose `all N …` form
     and three suites fell out of the ratchet the same night. Keep it last,
     so the precise forms win when they are present. */
  const pat=[/(\d+)\s+(?:passed|promise\(s\) held|voice grammar cases|checks?)/ig,
             /ALL\s+(\d+)\s+CHECKS/ig,
             /(\d+)\s+CHECKS\s+PASS/ig,
             /\ball\s+(\d+)\s+\S/ig];
  const findIn=(txt)=>{
    if(!txt) return null;
    for(const re of pat){
      re.lastIndex=0;
      const all=[...String(txt).matchAll(re)];
      if(all.length) return all[all.length-1];
    }
    return null;
  };
  const m = findIn(r.line) || findIn(r.out);
  if(!m) continue;
  const n=Number(m[1]);
  if(!isFinite(n) || n<=0) continue;
  r.count=n;
  if(COUNT_UNSTABLE.has(r.f)) continue;
  const was=base[r.f];
  if(r.how==='PASS'){
    if(typeof was==='number' && n<was) shrunk.push({f:r.f, was, now:n});
    if(typeof was!=='number' || n>was) base[r.f]=n;
  }
}
if(!process.argv.includes('--no-baseline')){
  try{ fs.writeFileSync(BASE_FILE, JSON.stringify(base,null,2)+'\n'); }catch(_){}
}

/* A RATCHET THAT CANNOT SEE A SUITE IS NOT PROTECTING IT.
   The shrink check above only works on suites whose summary line contains a
   number it can parse. Ten of the static suites end with "all good", "block
   loads clean" or a sentence, so their check counts have never been recorded
   and every one of them could quietly drop to a single assertion while the
   line still said GREEN. That is the same shape as the three suites that
   printed "no fixtures dir — skipping" and exited 0.

   Two different findings, and only one of them is a failure:

   REGRESSION, and it fails the gate. A suite that HAS a floor and stopped
   producing a parseable count has just slipped out of the ratchet's hands.
   Nothing on screen would say so: it still prints ok, and the recorded floor
   simply stops being compared against anything.

   NEVER COUNTABLE, and it is a note. These have no floor because none was
   ever recorded. Failing on them would go red for work that is not the
   change under test, so they are listed with their number and the number is
   meant to go DOWN. Only suites that actually RAN this tier are listed, so
   the note says nothing about browser suites during a --static run. */
const lostCount = results.filter(r => r.how==='PASS' && !r.count
                                   && typeof base[r.f]==='number'
                                   && !COUNT_UNSTABLE.has(r.f));
const neverCount = results.filter(r => r.how==='PASS' && !r.count
                                    && typeof base[r.f]!=='number'
                                    && !COUNT_UNSTABLE.has(r.f));

/* RAN NOTHING is its own bucket, deliberately not in `bad`.
   It must never be counted as a pass, because it is not one. But blocking a
   promotion on a Firebase permissions grant that only the founder can make
   would be a gate nobody can clear, and a gate nobody can clear gets bypassed.
   So it is named, counted, and kept out of the all-pass claim. If the number
   grows, that is a real regression and the line below says so. */
const ranNothing=results.filter(r=>r.how==='RAN NOTHING');
const bad=results.filter(r=>r.how!=='PASS' && r.how!=='RAN NOTHING');
console.log('\n'+'-'.repeat(62));
if(lostCount.length){
  console.log('A SUITE FELL OUT OF THE COVERAGE RATCHET — it had a recorded check');
  console.log('count and no longer reports one, so its floor is now compared against');
  console.log('nothing. It still prints ok. Restore a countable summary line:');
  lostCount.forEach(r=>console.log('   ! '+r.f+'   floor was '+base[r.f]+', this run reported no number'));
  console.log('     the line it printed: '+(lostCount[0].line||'').slice(0,70));
  console.log('');
}
if(neverCount.length){
  console.log('NOT COVERED BY THE SHRINK RATCHET — '+neverCount.length+' suite(s) that ran here');
  console.log('end with a sentence rather than a count, so their coverage has no floor');
  console.log('and could drop to one assertion while still printing ok. Not a failure,');
  console.log('but this number is meant to go DOWN:');
  console.log('   '+neverCount.map(r=>r.f).join(', '));
  console.log('');
}
if(shrunk.length){
  console.log('COVERAGE SHRANK — these suites ran FEWER checks than they have before:');
  shrunk.forEach(x=>console.log('   ! '+x.f+'  '+x.was+' -> '+x.now+'   ('+(x.was-x.now)+' check(s) did not run; the line still said GREEN)'));
  console.log('');
}
if(ranNothing.length){
  console.log('SUITES THAT RAN NOTHING AND STILL EXITED 0 — not passes, and not');
  console.log('counted as any. Each says so in its own output and was believed anyway:');
  ranNothing.forEach(r=>console.log('   -- '+r.f+'   '+(r.line||'').slice(0,84)));
  console.log('');
}
if(!bad.length && !shrunk.length && !lostCount.length){
  console.log('ALL '+(results.length-ranNothing.length)+' RUNNABLE SUITES PASS'
    +(ranNothing.length?('  ('+ranNothing.length+' ran nothing)'):'')+(ONLY_STATIC?'  (static only — browser suites not run)':''));
}else if(!bad.length){
  console.log('every suite passed, but coverage shrank — treat as RED until explained');
}else{
  console.log(bad.length+' of '+results.length+' SUITES RED — DO NOT PROMOTE');
  bad.forEach(r=>{
    console.log('\n--- '+r.f+'  ['+r.how+'] ---');
    /* ============ A RED GATE MUST NAME WHAT FAILED ==================
       25 Aug: voice-wiring.js went red in the gate as "FAIL - 1 of 78"
       and the last 14 lines were all passing checks, so the one line
       that mattered - the name of the failing check - had scrolled off
       the top of its own failure report. Naming it took five re-runs
       and a reproduction attempt, and it still was not named.

       A failure report that omits the failure is the same disease this
       file already caught once above ("READ THE WHOLE SUITE, NOT ITS
       LAST LINE"): looking at a fixed window of a suite's output and
       hoping the important part landed inside it. The cure is the same.
       Pull the lines that ANNOUNCE a failure wherever they sit, then
       show the tail for context. */
    const clean=r.out.replace(/\x1b\[[0-9;]*m/g,'').trim().split('\n');
    const named=clean.filter(x=>/^\s*(?:[\u2717\u2718x]|not ok|FAIL[: ]|MISSING|ILLEGAL|THREW)/i.test(x)
                              || /\bFAILED\b/.test(x));
    if(named.length){
      console.log('    failing check(s):');
      console.log(named.slice(0,40).map(x=>'      '+x.trim()).join('\n'));
      if(named.length>40) console.log('      ... and '+(named.length-40)+' more');
      console.log('    --- tail ---');
    }
    console.log(clean.slice(-14).map(x=>'    '+x).join('\n'));
  });
}
/* A SUITE ON DISK IN NO TIER IS A FAILURE, NOT A FOOTNOTE.
   This file's own thesis is that a suite nobody runs is not a safety net.
   It then printed exactly that situation as a NOTE and exited 0 — so
   dropping a new, failing suite into qa/ and forgetting the tier entry
   produced a green run. The whole disease, reproduced inside the cure. */
if(unlisted.length){
  console.log('\nUNTIERED SUITES — on disk, in no tier, and therefore never run:');
  unlisted.forEach(f=>console.log('   ! '+f+'   (add it to TIER in qa/all.js)'));
  console.log('   a suite nobody runs is not a safety net; this is a failure, not a note.');
}
if(STAMP_STUCK) console.log('\nBUILD STAMP UNCHANGED — bump STATS_BUILD before promoting.');
process.exit((bad.length||shrunk.length||lostCount.length||unlisted.length||STAMP_STUCK)?1:0);
