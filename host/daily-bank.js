/* =====================================================================
   THE DAILY QUESTION — the bank.
   ---------------------------------------------------------------------
   Founder, 30 Aug 2026, handing over two pages of handwritten WNBA
   questions: "Got feedback for basketball questions. Let's use these type
   of questions and similar for the WNBA coming up."

   THE FORMAT IS THE IDEA. Give a number, offer three plausible records,
   ask which one it belongs to:

       The number is 1,308
         A  most points, one player, one season
         B  most minutes played, one player, one season
         C  most attempted threes, one season

   It is a different animal from everything in question-banks.js. Those
   ask what JUST HAPPENED and are keyed by a resolver reading ESPN. These
   ask what has EVER happened, and no feed can settle them — the answer is
   fixed history, so it travels with the question.

   The engine already allows that. host/run.js:630 checks `q.k` — a
   decision that travels with the plan and is never resolved over — and it
   checks it BEFORE the no-resolver void, so a question carrying its own
   answer needs no resolver at all.

   ============ WHY EVERY ENTRY MUST CARRY A SOURCE ====================
   That same property is the danger. A resolver-keyed question is checked
   by the feed every night and the backtest measures whether it still has
   a spread. A hand-keyed record is checked by NOTHING. Get it wrong and
   it grades confidently, forever, and the one thing this product sells is
   that its grading is right.

   So: `a` is the index of the correct option and `src` is where that was
   confirmed. host/daily-pick.js REFUSES to publish an entry missing
   either. The refusal is the feature — it is not possible to ship a
   record nobody checked.

   TRANSCRIBED, NOT VERIFIED. Everything below is read off a photograph of
   the founder's notes. The questions and options are his. The ANSWERS ARE
   DELIBERATELY LEFT NULL: the margin notes name a holder and a date, but
   reading a checkmark off a phone photo is not a source, and guessing
   would be exactly the invented number the Arena Book forbids. Each needs
   a minute with wnba.com/history or basketball-reference before it can go
   out.
   ================================================================== */

/* league · n: the number as the player sees it · q: the stem
   o: three claims, exactly one true · a: index of the true one (0-2)
   who/when: the holder, shown on the reveal · src: where it was checked */
const BANK = [
  { id:'w-12',   league:'wnba', n:'12',
    o:['Maximum players on a roster',
       'Fouls committed by one player over four games',
       'Fouls by one player in one game'],
    a:null, who:'', when:'', src:'' },

  { id:'w-35',   league:'wnba', n:'35',
    o:['Most shots attempted, one player, one game',
       'Most points, one player, in one half',
       'Fewest points, one team, in one game'],
    a:null, who:'Eva Nemcova', when:'1997-05-25', src:'' },

  { id:'w-66',   league:'wnba', n:'66',
    o:['Most points scored, one player, in a game',
       'Most consecutive free throws made, one player, over multiple games',
       'Most technical fouls, one team, in a season'],
    a:null, who:'', when:'', src:'' },

  { id:'w-127',  league:'wnba', n:'127',
    o:['Most consecutive games played, one player',
       'Most shots attempted, one player, over four games',
       'Most points scored, one team, in a game'],
    a:null, who:'Phoenix', when:'2010-07-24', src:'' },

  { id:'w-73',   league:'wnba', n:'73',
    o:['Most points scored in a half, one team',
       'Most field goals, one team, over three games',
       'The length in feet of the longest three in league history'],
    a:null, who:'', when:'', src:'' },

  { id:'w-580',  league:'wnba', n:'580',
    o:['Most threes attempted, one team, one season',
       "Most games played in a player's career",
       'Most free throws made, one player, in a season'],
    a:null, who:'Diana Taurasi', when:'', src:'' },

  { id:'w-197',  league:'wnba', n:'197',
    o:['Most consecutive minutes played by a player',
       'Most points scored by one team over three games',
       'Most consecutive games, one player, with 15 or more points'],
    a:null, who:'', when:'', src:'' },

  { id:'w-23',   league:'wnba', n:'23',
    o:['Most rebounds, one player, one game',
       'Most assists, one player, one game',
       'Most consecutive field goals made, one player, over multiple games'],
    a:null, who:'New York Liberty', when:'2016-06-07..2016-06-14', src:'' },

  { id:'w-63',   league:'wnba', n:'63',
    o:['Most turnovers, one team, over three games',
       'Most rebounds, one team, one game',
       'Most free throws missed, one player, one season'],
    a:null, who:'Phoenix', when:'2012-07-07', src:'' },

  { id:'w-90',   league:'wnba', n:'90',
    o:['Most free throws missed, one player, in a season',
       'Most steals, one player, in a season',
       'Most blocks, one player, in a season'],
    a:null, who:'Yolanda Griffith', when:'1999', src:'' },

  { id:'w-1308', league:'wnba', n:'1,308',
    o:['Most points scored, one player, one season',
       'Most minutes played, one player, one season',
       'Most threes attempted, one season'],
    a:null, who:'Kelsey Plum', when:'2025', src:'' },
];

/* The stem is one sentence and it is the same every time, because the
   FORMAT is the recognisable thing — "the number is ___" is the hook, and
   varying it would make each day feel like a different game. */
const stem = (e) => `The number is ${e.n}`;

/* A question is publishable only when somebody has checked it. Both
   halves matter: `a` says which option is true, `src` says who says so.
   An answer with no source is a guess with a number next to it. */
function ready(e){
  return Number.isInteger(e.a) && e.a >= 0 && e.a < (e.o || []).length
      && typeof e.src === 'string' && e.src.trim().length > 0;
}

module.exports = { BANK, stem, ready };
