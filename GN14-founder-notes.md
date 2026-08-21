# Game Night #14/#15 — the founder's own notes, 20 August 2026

Source: `Notes.docx` inside `20-20260821T052352Z-1-001.zip`, with ~100 screenshots
alongside it. Transcribed verbatim into items on 21 Aug 05:30 PT. The zip was
still a `.part` file when he first referenced it, which is why this ledger did
not exist until now — the nine-bug list in `GN14-15-live-bugs.md` was built from
what he typed into chat, and it turns out that was a fifth of what he wrote down.

**45 items. His words are quoted. Nothing here is paraphrased into something
milder than he said it.**

Status vocabulary:
- **FIXED** — changed, gated, and in the build being deployed this morning.
- **OPEN** — real, reproduced or credible, not yet fixed.
- **DESIGN** — not a bug; a direction he is asking for.
- **UNREPRODUCED** — reported, looked for, could not be made to happen.

---

## A. Things that were already on the nine-bug list

| # | Item | Status |
|---|---|---|
| 1 | "When you pick a question it automatically moves you to the next question without letting you change or press next. It moves it fast" | **FIXED** — 220ms → 1100ms, cancellable |
| 2 | "When the questions come up there's no way to get the menu or go back home. The tabs disappear" | **UNREPRODUCED** — `NAV_HIDE_ON = ['tally']` only. See item 44 |
| 3 | "When we do in spanish some of the words are still in english" | **PARTIAL** — 100% of the 17 walked screens; the live round flow is not walked |
| 4 | "It starts with question 6 and then goes to question 1" | **FIXED** — `startPredict()` resets to first unanswered |
| 5 | "For the control room there is no way to tell which caught it game you have on in the run tab" | **FIXED** |
| 6 | "Baseball didn't work at all… scores wrong, questions didn't pop up, nor the caught it… stats tab nothing shows up" | **FIXED** — four separate causes |
| 7 | "Same thing happens when you go between tabs it gets stuck" | **FIXED** — 15s feed cache |
| 8 | "The transition between games and rooms makes it buggy… I had to hard refresh close and sign out" | **FIXED** — per-room store, but **never proven by a human on the fixed build** |

## B. Items that were NOT on the list — the ones I missed

| # | His words | Status | Note |
|---|---|---|---|
| 9 | **"In the control room the tonight tab shows another day"** | **FIXED 21 Aug 05:10** | He wrote this Thursday. He re-reported it at 4:46am Friday. The Control Room's opening night came from `NIGHTS[0]`, a hand-edited array literal in `admin.html` |
| 10 | "When you go back home there's so many bugs where it takes you to all games" | **OPEN** | |
| 11 | "Did a refresh and the quarters are messed up" | **OPEN** | |
| 12 | **"The home page should have the score while it's going. It should be live"** | **OPEN** | Direct product ask |
| 13 | "On the home page it says in between quarters when it's innings" | **OPEN** | Round-word fix landed in the Stats tab; the home page was not covered |
| 14 | **"On the menu there's no way to sign out"** | **OPEN** | |
| 15 | "When you answer questions there's no back buttons in between quarters" | **OPEN** | Related to 2 |
| 16 | "On my iPad in the football game it sent out the end of Q1 and we answered the questions for Q1 when it was still going on" | **FIXED** | `playedTo` guard |
| 17 | **"The stats page on NFL and MLB and MLS is very bad it doesn't look anything like the WNBA"** | **OPEN** | MLB has no `leaders` key; NFL/MLS never got a designed Stats tab |
| 18 | "The score at the top stopped working" | **OPEN** | |
| 19 | **"Caught it happened faster than was on the TV… give it a little time to make sure we get it on the tv and then ask"** | **OPEN** | Needs a deliberate broadcast-lag delay. He explicitly wants the fast signal kept, just held |
| 20 | "It said extra innings is live when extra innings was not live" | **FIXED** | |
| 21 | "The final questions for baseball never came" | **FIXED** | Same root as 6 |
| 22 | **"Even after the game I could still go to the home page and still play. It didn't stop and say the game is over"** | **OPEN** | No end-of-night state |
| 23 | "When I sign out and then sign back in it takes me to the questions, when I already did it" | **OPEN** | |
| 24 | **"The practice rooms are all out of whack… points in it's different sports or different teams"** | **OPEN** | |
| 25 | "The try it now and tester… the way it's lined up on the home page is misaligned" | **OPEN** | |
| 26 | **"I think my points decreased from the your night section of gametime"** | **OPEN — SEVERE** | A score going *down* is the worst class of bug this product can have |
| 27 | "The caught it questions decreased in the second quarter" | **FIXED** | Pacing now 8/game (6 hockey) |
| 28 | **"We should have the game # besides each game especially the ones at the top"** | **OPEN** | |
| 29 | **"On the caught it the voice acceptance does not work"** | **OPEN** | |
| 30 | **"The questions for caught it is wrong. It asked a question that never happened, or it might've happened when it was on commercial"** | **OPEN — SEVERE** | |
| 31 | **"The points on the football switches between players… one of the points went from one user to the other"** | **OPEN — SEVERE** | Points crossing between people |
| 32 | "Multiple times and scores on the NFL home page that is not aligned with the actual game" | **OPEN** | |
| 33 | **"When I'm on another page or tab I don't get an alert when there is another question"** | **OPEN** | |
| 34 | **"When we have call it and you answer a question with voice it automatically says you didn't answer in time"** | **OPEN — SEVERE** | Voice answer counted as no answer |
| 35 | **"The questions did send out to my iPad and other computer. It only did to the laptop"** | **OPEN — SEVERE** | Rounds not reaching every device |
| 36 | "I sat through the whole baseball game and it didn't work well" | — | Summary |

## C. Question quality — his editorial notes

| # | His words | Status |
|---|---|---|
| 37 | "Stop asking question for NFL who is leading when the score is directly above the questions" | **OPEN** — a question whose answer is on screen is not a question |
| 38 | "The question should be who made that interception in the 3rd, so it's more specific" | **DESIGN** |
| 39 | "If it's something that happened early it should be like 'you made the 84 yard catch in the beginning of the 2nd quarter'. Things that are more clear" | **DESIGN** — time-anchor every retrospective question |

## D. Direction, not defects

| # | His words | Status |
|---|---|---|
| 40 | **"Let's write out all the steps that it takes for the user and the automation and the control room for each sport in particular and design it that way… so it's intuitive even the button and how they light up… we keep missing things"** | **DESIGN — the biggest ask in the document** |
| 41 | "We need to do something more interactive or solid with the home page" | **DESIGN** |
| 42 | **"Could someone use a bot and have it play and win the game all the time when we have prizes? How do we prevent that?"** | **DESIGN — unanswered.** Becomes urgent the day a prize is real |
| 43 | "For my weekly newsletter that goes out on Sunday, instead of having my name at the end use STATS GAMETIME like the other days, so it's consistent. We don't need my name, let's build STATS GAMETIME" | **FIXED 21 Aug** |
| 44 | "We need to think growth… but we gotta get it working properly first and then we can get a community because people won't use it unless it works" | **His own sequencing call** |
| 45 | "Baseball is a failure… we have to get baseball right. It's all off so now we have time to fix it before the next game tomorrow" | The mandate |

---

## The count

- **13 FIXED** and in this morning's build
- **1 PARTIAL** (Spanish in the live round flow)
- **1 UNREPRODUCED** (nav during questions)
- **22 OPEN**, of which **6 are severe**: 26, 30, 31, 34, 35, and 19
- **6 DESIGN** asks
- **2** are his own summary judgements

**The six severe ones share a shape.** Points moving between players (31), points going down (26), a voice answer scored as no answer (34), rounds reaching one device out of three (35), a question about a play that never happened (30) — every one of them is *the scoring or delivery layer being wrong in front of a human*. None of them is a rendering bug. This is the layer that has to be right before anyone is invited, and it is the layer the 508-check gate does not cover, because the gate has no concept of two people in a room on three devices.
