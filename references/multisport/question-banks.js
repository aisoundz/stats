/* =====================================================================
   QUESTION BANKS — MLB · NFL · NHL · MLS
   ---------------------------------------------------------------------
   Written 17 Aug 2026. Every line names a resolver that exists, and every
   line has been run against a real finished game before shipping — see
   qa/host-banks.js. A question that cannot resolve is worse than no
   question: the runner refuses to invent an answer, so the round opens and
   the room stares at something nobody can score. That is B28.

   {HOME} and {AWAY} are substituted with the night's real team names at
   publish time. They are placeholders because optForTeam matches against
   the FEED's own names — a bank with hardcoded teams is a bank that is
   wrong the moment the fixture changes, which is B26 in a new costume.

   OPTION ORDER IS MEANING. Band resolvers return o[i] by index, lowest
   band first. Reordering the options silently changes every answer.

   Basketball already has its bank (admin.html BANK) and the NBA reuses the
   same 32 resolvers, so neither appears here.
   ================================================================== */

/* ---------------------------------------------------------------- MLB
   Three rounds: after the 3rd, the 6th and the 9th. Not nine — a round
   every eighteen minutes is a notification cadence, not a game. The unit
   is the at-bat, and the questions live in the pitch data nobody else
   surfaces. */
const MLB = {
  tags:  ['1st-3rd', '4th-6th', '7th-9th'],
  names: ['Innings 1–3', 'Innings 4–6', 'Innings 7–9'],
  worth: [30, 50, 70],
  rounds: [
    [ // after the 3rd
      { t: 'First hit of the game — what was it?',
        o: ['Single', 'Double', 'Triple', 'Home run'], r: 'mlbFirstHitKind' },
      { t: 'How many strikeouts through three?',
        o: ['0–2', '3–4', '5–6', '7 or more'], r: 'mlbStrikeoutsBand' },
      { t: 'Hardest pitch so far — how fast?',
        o: ['93 or under', '94–96', '97–98', '99 and up'], r: 'mlbFastestPitchBand' },
      { t: 'Who got on the board first?',
        o: ['{AWAY}', '{HOME}'], r: 'mlbFirstScoringTeam' }
    ],
    [ // after the 6th
      { t: 'Runs scored in the fourth, fifth and sixth?',
        o: ['None', '1–2', '3–4', '5 or more'], r: 'mlbRunsBand' },
      { t: 'More strikeouts or more hits in those three?',
        o: ['Strikeouts', 'Hits', 'Dead even'], r: 'mlbMoreKsOrHits' },
      { t: 'Any home runs in there?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'mlbHomeRunsBand' },
      { t: 'Was there a one-two-three inning?',
        o: ['Yes', 'No'], r: 'mlbOneTwoThreeInning' }
    ],
    [ // after the 9th
      { t: 'Who leads after nine?',
        o: ['{AWAY}', '{HOME}', 'Tied'], r: 'mlbLeadAfter' },
      { t: 'Runs in the last three innings?',
        o: ['None', '1–2', '3–4', '5 or more'], r: 'mlbRunsBand' },
      { t: 'Bases stolen late?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'mlbStolenBasesBand' },
      { t: 'Strikeouts in the last three?',
        o: ['0–2', '3–4', '5–6', '7 or more'], r: 'mlbStrikeoutsBand' }
    ]
  ]
};

/* ---------------------------------------------------------------- NFL
   REWRITTEN 21 Aug 2026 to match admin.html's TEMPLATES.football exactly,
   question for question and string for string. It had drifted — this file
   still asked "who leads at the half" long after the shipping bank stopped
   — and a QA suite checking a bank nobody publishes is a suite that passes
   for reasons unrelated to the product. If you change one of these two
   files, change both.

   Sixteen questions, sixteen different resolvers, no fact asked twice,
   nothing that is on the scoreboard and nothing off the season box score.
   Every cutoff was tuned against 78 finished games; the most lopsided line
   in here sits at 56% for its top answer.                              */
const NFL = {
  tags:  ['Q1', 'Q2', 'Q3', 'Q4'],
  names: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
  worth: [10, 20, 30, 40],
  rounds: [
    [
      { t: 'How did the opening drive end?',
        o: ['Touchdown', 'Field goal', 'Punt', 'Turnover', 'Downs', 'Missed FG'], r: 'nflFirstDriveResult' },
      { t: 'Which side had to punt it away first?',
        o: ['{HOME}', '{AWAY}', 'Nobody punted'], r: 'nflFirstPuntTeam' },
      { t: 'The longest gain of the first — how far?',
        o: ['19 yards or fewer', '20 to 29', '30 to 44', '45 or more'], r: 'nflLongestGainBand' },
      { t: 'Three-and-outs in the first, both teams — how many?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflThreeAndOutsBand' }
    ],
    [
      { t: 'The first touchdown of the second — how did it come?',
        o: ['On the ground', 'Through the air', 'Some other way', 'No touchdown in the second'], r: 'nflFirstTdKind' },
      { t: 'Gains of twenty yards or more in the second — how many?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflExplosivePlaysBand' },
      { t: 'After the two-minute warning, who put points up before the half?',
        o: ['{HOME}', '{AWAY}', 'Both of them', 'Nobody scored'], r: 'nflTwoMinuteScore' },
      { t: 'The very last play before halftime — what was it?',
        o: ['A kick', 'A kneel-down', 'A pass play', 'A run'], r: 'nflHalfEndPlay' }
    ],
    [
      { t: 'First team inside the twenty in the third — what did they get?',
        o: ['A touchdown', 'A field goal', 'They came away empty', 'Nobody got that close'], r: 'nflRedZoneFirstTrip' },
      { t: 'Who gave up the first sack of the third?',
        o: ['{HOME}', '{AWAY}', 'Nobody got sacked'], r: 'nflFirstSackTeam' },
      { t: 'Third downs picked up in the third, both teams — how many?',
        o: ['One or fewer', 'Two', 'Three', 'Four or more'], r: 'nflThirdDownConvBand' },
      { t: 'Did the second half open with points?',
        o: ['Yes', 'No'], r: 'nflHalfOpenScored' }
    ],
    [
      { t: 'Fourth down in the fourth — did anybody go for it?',
        o: ['Nobody went for it', 'Went for it and got it', 'Went for it and came up short', 'Both happened'], r: 'nflFourthDownOutcome' },
      { t: 'Who coughed it up first in the fourth?',
        o: ['{HOME}', '{AWAY}', 'Neither side turned it over'], r: 'nflFirstTurnoverTeam' },
      { t: 'Timeouts called in the fourth — how many?',
        o: ['One or fewer', 'Two or three', 'Four or five', 'Six or more'], r: 'nflTimeoutsBand' },
      { t: 'Did anybody score inside the last two minutes?',
        o: ['Yes', 'No'], r: 'nflLateScore' }
    ]
  ]
};

/* ---------------------------------------------------------------- NHL
   Three periods, and the richest physical vocabulary of any feed — hits,
   blocks, takeaways and giveaways are all their own play types, so the
   questions can be about the grind rather than just the goals. */
const NHL = {
  tags:  ['1st', '2nd', '3rd'],
  names: ['1st period', '2nd period', '3rd period'],
  worth: [15, 30, 45],
  rounds: [
    [
      { t: 'Who scored first?',
        o: ['{AWAY}', '{HOME}', 'Still scoreless'], r: 'nhlFirstGoalTeam' },
      { t: 'Shots on goal in the first?',
        o: ['0–8', '9–12', '13–16', '17 or more'], r: 'nhlShotsBand' },
      { t: 'How many hits landed?',
        o: ['0–12', '13–20', '21–28', '29 or more'], r: 'nhlHitsBand' },
      { t: 'Goals in the opening period?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nhlGoalsBand' }
    ],
    [
      { t: 'Shots blocked in the second?',
        o: ['0–4', '5–8', '9–12', '13 or more'], r: 'nhlBlockedBand' },
      { t: 'Pucks given away?',
        o: ['0–4', '5–8', '9–12', '13 or more'], r: 'nhlGiveawaysBand' },
      { t: 'Goals in the middle period?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nhlGoalsBand' },
      { t: 'Who leads after two?',
        o: ['{AWAY}', '{HOME}', 'Tied'], r: 'nhlLeadAfter' }
    ],
    [
      { t: 'Who threw more at the net tonight?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'nhlMoreShots' },
      { t: 'Who won more faceoffs?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'nhlMoreFaceoffs' },
      { t: 'Penalties called all game?',
        o: ['0–2', '3–4', '5–7', 'Eight or more'], r: 'nhlPenaltiesBand' },
      { t: 'Who was the more physical side?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'nhlMoreHits' }
    ]
  ]
};

/* ---------------------------------------------------------------- MLS
   Two rounds only, because soccer only gives you two breaks. The box score
   is CUMULATIVE, so the halftime round asks "in the first half" and the
   full-time round asks "in the match" — never "in the second half", which
   would need a halftime snapshot nobody has built. */
const MLS = {
  tags:  ['1H', 'FT'],
  names: ['Half time', 'Full time'],
  worth: [30, 50],
  rounds: [
    [ // halftime — the box IS the first half at this moment
      { t: 'Who scored first?',
        o: ['{AWAY}', '{HOME}', 'Still nil-nil'], r: 'mlsFirstGoalTeam' },
      { t: 'Goals in the first half?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'mlsGoalsBand' },
      { t: 'Corners won in the half?',
        o: ['0–3', '4–6', '7–9', 'Ten or more'], r: 'mlsCornersBand' },
      { t: 'Who saw the first card?',
        o: ['{AWAY}', '{HOME}', 'No cards yet'], r: 'mlsFirstCardTeam' }
    ],
    [ // full time — the box is now the WHOLE MATCH
      { t: 'How did it finish?',
        o: ['{AWAY}', '{HOME}', 'Draw'], r: 'mlsScoreline' },
      { t: 'Goals in the second half?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'mlsGoalsBand' },
      { t: 'Who had more of the ball?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'mlsMorePossession' },
      { t: 'Shots on target across the match?',
        o: ['0–3', '4–6', '7–9', 'Ten or more'], r: 'mlsShotsOnTargetBand' },
      { t: 'Cards shown in the second half?',
        o: ['None', 'One', '2–3', 'Four or more'], r: 'mlsCardsBand' },
      { t: 'Substitutions in the second half?',
        o: ['None', '1–2', '3–5', 'Six or more'], r: 'mlsSubsBand' }
    ]
  ]
};

const BANKS = { mlb: MLB, nfl: NFL, nhl: NHL, mls: MLS };

/* Fill {HOME}/{AWAY} from a feed. Kept here rather than in the caller so
   there is one substitution, not one per consumer. */
function fillTeams(bank, homeName, awayName) {
  const swap = (s) => String(s).replace(/\{HOME\}/g, homeName).replace(/\{AWAY\}/g, awayName);
  return {
    tags: bank.tags.slice(), names: bank.names.slice(), worth: bank.worth.slice(),
    rounds: bank.rounds.map(rd => rd.map(q => ({ t: swap(q.t), o: q.o.map(swap), r: q.r, k: null })))
  };
}

if (typeof module !== 'undefined') module.exports = { BANKS, MLB, NFL, NHL, MLS, fillTeams };
