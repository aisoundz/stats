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
   The drive is the unit and it grades itself: displayResult is a clean
   enum, so football is the cheapest bank of the six. Ten seconds between
   possessions is the natural rhythm. */
const NFL = {
  tags:  ['Q1', 'Q2', 'Q3', 'Q4'],
  names: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
  worth: [10, 20, 30, 40],
  rounds: [
    [
      { t: 'How did the opening drive end?',
        o: ['Touchdown', 'Field goal', 'Punt', 'Turnover', 'Downs', 'Missed FG'], r: 'nflFirstDriveResult' },
      { t: 'Punts in the first?',
        o: ['0–1', 'Two', 'Three', 'Four or more'], r: 'nflPuntsBand' },
      { t: 'More runs or more passes?',
        o: ['Rush', 'Pass', 'Dead even'], r: 'nflMoreRushOrPass' },
      { t: 'First points of the game came how?',
        o: ['Touchdown', 'Field goal', 'Safety', 'Nobody scored'], r: 'nflFirstScoreKind' }
    ],
    [
      { t: 'Touchdowns in the second?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflTouchdownsBand' },
      { t: 'Flags thrown in the second?',
        o: ['0–1', '2–3', '4–5', 'Six or more'], r: 'nflPenaltiesBand' },
      { t: 'Longest drive of the quarter?',
        o: ['Under 20 yards', '21–45', '46–70', '71 or more'], r: 'nflLongestDriveBand' },
      { t: 'Who leads at the half?',
        o: ['{AWAY}', '{HOME}', 'Tied'], r: 'nflLeadAfter' }
    ],
    [
      { t: 'Turnovers in the third?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflTurnoversBand' },
      { t: 'Drives that ended in points?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflScoringDrivesBand' },
      { t: 'How did the first drive of the half end?',
        o: ['Touchdown', 'Field goal', 'Punt', 'Turnover', 'Downs', 'Missed FG'], r: 'nflFirstDriveResult' },
      { t: 'More runs or more passes in the third?',
        o: ['Rush', 'Pass', 'Dead even'], r: 'nflMoreRushOrPass' }
    ],
    [
      { t: 'Touchdowns in the fourth?',
        o: ['None', 'One', 'Two', 'Three or more'], r: 'nflTouchdownsBand' },
      { t: 'Who moved the ball further tonight?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'nflMoreTotalYards' },
      { t: 'Who picked up more first downs?',
        o: ['{AWAY}', '{HOME}', 'Dead even'], r: 'nflMoreFirstDowns' },
      { t: 'Who leads after four?',
        o: ['{AWAY}', '{HOME}', 'Tied'], r: 'nflLeadAfter' }
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
