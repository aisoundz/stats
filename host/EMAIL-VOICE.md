# How a STATS GAMETIME email is allowed to sound

Both email routines read this file before writing a word. Change the rules here,
not in the routine prompts, so the tip-off and the Sunday note can never drift
apart.

Anis, 20 Aug 2026: *"take away the dashes and use commas, make it seem less AI
and more human, no AI tells."*

---

## 1. No em dashes. Not one.

This is the rule that matters most, because it is the single strongest signal
that a machine wrote something. Every place you would reach for `—`, one of
these is better and is what a person would actually type:

| Instead of | Write |
|---|---|
| `four today — football at ten, baseball at four` | `four today. Football at ten, baseball at four` |
| `that is deliberate — four people beats four hundred` | `that is deliberate. Four people beats four hundred` |
| `Who gets more hits — Gonzales or Freeman?` | `Who gets more hits, Gonzales or Freeman?` |
| `Tap one before first pitch — it saves your call` | `Tap one before first pitch and it saves your call` |
| `Kickoff 7:00 PM ET · 4:00 PM PT — NFL Network` | `Kickoff 7:00 PM ET · 4:00 PM PT on NFL Network` |
| `— Anis` | `Anis` |

A full stop is almost always the right answer. Two short sentences read faster
than one long one with a dash holding it together, which is the actual reason
this rule makes the writing better rather than merely less detectable.

The middot `·` stays. It separates times and channels in the room cards and is
typographic furniture, not punctuation inside a sentence. En dashes stay in
scores and ranges: `4–1`, `50–77`, `.310`.

## Every clock time carries a zone. Every one.

Founder, 28 Aug 2026: *"lets add in the mail the time zone cause 7 to
someone in la is different than 7 in ny"*.

The room cards were already right — `Kickoff 6:00 PM ET · 3:00 PM PT on NFL
Network`. The prose was not, and the subject line was not:

| Sent on 28 Aug | Should have been |
|---|---|
| `kick it off at 3:00` (subject) | `kick it off at 3:00 PT` |
| `first tip at 3:00, last at 7:00` | `first tip at 3:00 PT, last at 7:00` |
| `Boston goes into the Bronx at 4:15` | `Boston goes into the Bronx at 4:15 PT` |
| `Tap one before 6:00` | `Tap one before 6:00 PT` |
| `See you at 3:00.` | `See you at 3:00 PT.` |

Every one of those is Pacific and none of them said so. A reader in New York
is three hours wrong about their own game night, and the email that was
supposed to bring them is what made them late.

**The rule.** A time in prose or in a subject line names its zone the first
time it appears in a sentence, and after that the sentence may run on
without repeating it — `first tip at 3:00 PT, last at 7:00` is fine, because
one zone governs the list. A time standing alone always carries it.

**Which zone.** PT, because the schedule is built and staggered in PT and the
room cards already give ET beside it. One zone in the prose, both in the
cards. Do not mix them in a sentence: `3:00 PT` and never `3:00 PM ET / 12:00
PT` in running text, which is a schedule pretending to be a sentence.

**The subject line is not exempt.** It is the only line most people read and
it is the one most likely to decide whether somebody turns up.

## 2. The other tells, in the order they show up

- **The tricolon.** "It is faster, cleaner, and more reliable." Three parallel
  adjectives is the house style of every model ever shipped. Use one. Two if
  you must.
- **"Not just X, but Y."** Also "It's not about X. It's about Y." Delete on
  sight and say the thing.
- **Openers that clear their throat.** "Here's the thing." "Let's be clear."
  "The truth is." Start with the sentence you were going to write next.
- **Bolding inside a paragraph** to mark the important phrase. It tells the
  reader the rest is skippable, which in a three-paragraph opening is the
  opposite of the point. Bold a heading. Not a clause.
- **"Whether it's ... or ..."** and **"from X to Y"** as a way of gesturing at
  a range instead of naming a thing.
- **Two adjectives where one works.** "A simple, clean design."
- **The same distinctive word twice** in one email. Pick the better spot.
- **Summing up at the end** what the email just said. Stop when you are done.
- **Emoji as section markers.**
- **Rhetorical questions** the email then answers itself.

## 3. The schedule goes at the top, and the reader should want to watch

Anis, 21 Aug 2026, on an edition that opened with two paragraphs about a stale
database pointer:

> *"I dont like the news letter today. It was too technical. The one from
> yesterday was better and sounded more personal. We should excite the reader.
> And we should have a header part for where we show today's schedule."*

He is right, and the open rates agree. The edition that led with the fixtures
was opened by **4 of 4**. The one that led with the engineering, **1 of 5**.

**This reverses an earlier rule.** The tip-off template used to say "the
headline: one line, the build story, never the fixture list." That was written
when building in the open was the only interesting thing we had. It is not the
rule any more.

The order, top to bottom:

1. **TONIGHT** and the schedule. One row per room: time, matchup, channel.
   Before a single word of prose. It is what the reader opened the email for.
2. **A headline about the games.** Something a fan would repeat out loud.
   Never "shipped", never the hour you found a bug.
3. **Two short paragraphs, warm, about tonight.** Why this evening is worth
   sitting down for.
4. **The STATS and GAMETIME cards.**
5. **The build note, if there is one — ONE sentence, near the bottom.** The
   test is whether a player will *feel* it. "Voice gives you twenty seconds
   now instead of nine" earns its line. "The home page was reading a stale
   pointer" does not, however hard the night was.

**Why this matters more than it looks.** The engineering detail is genuinely
interesting to the person who wrote it and to almost nobody else. A reader who
has to scroll past a changelog to find out what is on television has been told,
politely, that the email is about us. It is supposed to be about their evening.

---

## 4. What it should sound like instead

Short declaratives. Concrete nouns. Real numbers with their source. A specific
day rather than "recently". The occasional sentence fragment, because people
write those. Somebody who watched the game and is telling one other person what
happened.

If a sentence could sit unchanged in any other company's newsletter, it is not
in this voice yet.

## 5. Everything already settled, which still holds

- **Every** email signs off `STATS GAMETIME`. No email is signed `Anis`.
  This changed on 21 Aug: the Sunday note was the last exception and he
  removed it himself, in his 20 Aug notes.
- No dash before the signature. It was removed once already.
- `STATS of the Day`, plural, always. Never `Stat of the Day`.
- The subject must not repeat the headline.
- No unverified number, no player counts, no build numbers, no test counts.
- Never quote another company's model. `predictor`, win probability, odds and
  spreads are all out. Scores, records, streaks and leaders are facts and ours.
- Never write "tonight" where it would read wrong a day later.
- The email says WHAT the answer was. It never says who got it right. The app
  does that, because it kept their tap.

## 6. Before you create the draft

Read the finished copy back and search it for `—`. If there is one, you have
not followed rule 1, and rule 1 is the one Anis asked for by name.

## 7. Every room card names where to watch

Founder, 20 Aug 2026: *"when showing the games make sure to add the network so
people know where to tune into, the one NFL game has no network. we should
always make sure of that."*

A room card without a channel fails the whole premise, which is play along with
the game you are watching. Write it as `on NFL Network`, not with a dash.

If the slate entry has no `net`, do not quietly print the card without one and
do not invent a channel. Say so in the notification to Anis instead, because a
room with no national carrier should not have been picked in the first place
(see rule 7 in `host/leagues.env`).

## 8. One email a day, and which one owns the day

Both routines fire on their own schedule and neither knew about the other. The
daily tip-off runs at 9:13am PT **every** morning and drafts whenever the slate
has games. The weekly note runs Sunday at 7am PT. So the first Sunday with a
slate would have produced two drafts and, if both were approved, two emails to
the same four people on the same day.

| Day | Who writes it | Signed |
|---|---|---|
| Monday to Saturday, games on the slate | the tip-off routine | `STATS GAMETIME` |
| Monday to Saturday, no games | nobody. Silence is correct. | |
| **Sunday, always** | **the weekly note, and only the weekly note** | `STATS GAMETIME` |

**The tip-off routine STOPS on a Sunday**, whatever the slate says. Check the
day before anything else. This is not a preference, it is the difference
between one email and two.

Which means the Sunday note carries the daily's whole job as well as its own:
the room cards with channels, STATS of the Day, and a Gametime card that settles
Saturday's question. Anis, 20 Aug: *"how would the answer get answered from
saturday and how would we know what games are on sunday."*

**Saturday's question gets settled on Sunday even when Sunday has no games.** A
question that is never answered is worse than one never asked, and the promise
printed under it says the answer is in tomorrow's edition.

Monday's tip-off then settles Sunday's question as normal, so the chain runs
unbroken through the week.

## 9. Two tells I keep producing anyway

**Uncontracted forms.** "It is", "that is", "I am", "do not", "there is". Nobody
types those in an email to four people they know. Anis does not: Week 1 read
*"Ten nights in and I'm still finding things I did to myself."* Write `it's`,
`that's`, `I'm`, `don't`, `there's`. This one is quiet enough to survive every
other pass, and it is the difference between a person and a press release.

Semicolons belong to the same family. A full stop is nearly always better.

**British collective plurals.** "Seattle have won seven games", "Indiana walk
into Chicago". A team is singular in American English, which is the English
this product is written in: *Seattle has won seven*, *Indiana walks into
Chicago*. This slips in constantly and reads as foreign rather than as wrong,
which is why it survives.

## 10. The three asks are numbered

Anis, 20 Aug 2026: *"the three things that help use a number or bullet point."*

Number them 1, 2, 3. The numeral goes in the asks section's amber (`#ffc54d`),
hanging in its own narrow table column so the text lines up under itself rather
than wrapping back under the digit.

**This overrides the older instruction in the weekly routine** that said the
asks should not be "a bolded numbered marketing listicle". The objection there
was to the *bolding*, which is gone, and to marketing-copy phrasing, which still
stands. The numbering was never the problem: without it the only thing dividing
one ask from the next was where a sentence happened to break.

The copy inside each one stays plain and in the founder's voice, worded fresh
every week, never copy-pasted from the last edition.

## 11. The gold card is called STATS. Not "STATS of the Day".

Anis, 20 Aug 2026, having weighed both: **STATS**.

**This supersedes rule 4 above and every mention of "STATS of the Day" in either
routine prompt.** Wherever a routine says that phrase, read `STATS`. This file
is read first and outranks them, which is the whole reason it exists.

Two reasons it is better:

1. **The two cards are the wordmark.** Read down the page and you get STATS,
   then GAMETIME, which is the product's name and also the middle two tabs of
   the nav. The email and the app now use identical vocabulary, and a reader
   sees the brand every day without being sold anything.
2. **They finally balance.** One four-word eyebrow beside a one-word partner is
   why the pair still read uneven even after they were given matching frames.
   Two single words in gold and teal read as deliberate.

The daily cadence is not lost. It lives where it always did, in the Gametime
card's closing line, "the answer is in tomorrow's edition."

The heading is exactly `STATS`, uppercase, in the gold eyebrow style. Never
`Stat`, never `Stats of the Day`, never `TONIGHT'S STATS`.

## 12. The design comes from a FILE, not from the last thing we sent

Both routine prompts say to fetch the most recent sent campaign and copy its
HTML as the template. **Ignore that. Read the file instead.**

| Email | Template |
|---|---|
| Tip-off, Mon to Sat | `host/email-tipoff-template.html` |
| Sunday note | `host/email-weekly-template.html` |

A routine that learns its design from its own last output can only ever be one
edition behind, and it drifts toward whatever was wrong. Every correction made
today, the STATS heading, the matched card frames, the numbered asks, the
Gametime card existing at all, would have to be re-made every single morning
from a stale copy, and the first morning one of them was missed it would be
baked in for good.

The files carry the finished shape, with comments marking what to replace. Copy
the file, change the content, change nothing structural.

**Still check the sent campaigns** for the subject lines and names already used,
so a subject is not repeated and the Weekly number is right. Just do not take
the design from them.

## 13. What the cloud can and cannot see

The routines do not run on the Jetson. They run in a fresh cloud sandbox that
clones the public repo and has nothing else: **no `~/gamenight-logs`, no
`~/.secrets`, no Firebase admin key, no runner logs.**

So anything a routine needs must be either in the repo or readable without
credentials.

| What you need | Where to get it |
|---|---|
| Tonight's rooms | `slate/{YYYY-MM-DD}` over the Firestore REST API. The `slate` collection is world-readable, and the web API key is in `index.html` under `window.STATS_FIREBASE`. |
| **The Game Night number** | **the `gn` field on each entry in that same slate document.** |
| What shipped | `journal/` in the repo, and `git log`. The clone is shallow, so `git fetch --unshallow` first if you need more than a day. |
| Broadcast, records, leaders | the ESPN summary for that event |

**Do NOT try to read `~/gamenight-logs/slate-marquee-*.txt` or the pick files.**
They are the Jetson's own working files and they do not exist where you are
running. An earlier instruction in the weekly routine's STEP 2 named them as the
source for game night numbers, and that instruction is wrong: take `gn` from the
slate.

Found by test-firing the tip-off routine on 20 Aug rather than assuming it
worked. It reached for those files, found nothing, and had to work it out.

---

## 12. Times are numerals. Never spelled out.

Anis, 25 Aug 2026: *"Let it show numbers when you say at a quarter passed
anything."*

The draft that morning said *"Dodgers and Braves get it going at quarter past
seven"*, and the subject line said *"tip in Dallas at five"*. Both became `7:15`
and `5:00`.

Write `7:15`, `4:15`, `8:00`. Never "quarter past seven", "half past", "a
quarter to", "at five". A time is the single most operational fact in a tip-off
email, the reader is deciding whether they can be on the sofa for it, and a
numeral is read at a glance while a spelled-out time has to be translated. It is
also, plainly, how a person texts a time to a friend.

This generalises: **anywhere a number is the fact, print the number.** "4 taps in
10", "600 of the 1,000 points", "6 times", "a 7-point game". Not "most", "the
majority", "several", "a handful".

---

## 13. The Gametime question is a STAT, not a prediction

Anis, 25 Aug 2026: *"ask more stats related questions, not who is going to win.
Thats predication."*

The 25 Aug draft asked *"Dodgers at Braves tonight. Who wins it?"* That is a
sportsbook question wearing our clothes. It became *"Dodgers at Braves. Which
pitching staff piles up more strikeouts?"*

**Why this is a rule and not a preference.** The product is called STATS
GAMETIME and its tagline is "the game that pays to pay attention". A
who-wins question is answered by a hunch before the game and never rewards
watching; a stat comparison is a thing you find out BY watching. Asking the
sportsbook question in the email teaches the reader the wrong thing about what
the app is, in the one place the app introduces itself.

Good shapes, all two-option so the tappable card still works: which side records
more strikeouts, more hits, more rebounds, more shots on target, more takeaways.
Bad shapes: who wins, who covers, will they score over N.

**Rename the `gt=` id to match the question.** It is a free-form string
(`gametimeFromLink()` in index.html reads it straight from the URL and uses it
as a key), so `gt=gn30-strikeouts` is correct and `gt=gn30-winner` on a
strikeouts question files the tap as something it is not.

---

## 14. The build note may be longer when the platform actually moved

**This qualifies rule 3, item 5** ("the build note, ONE sentence, near the
bottom"). Anis, 25 Aug 2026: *"Let's also talk about how the platform
improved."*

Rule 3's test does not change and is still the gate: **would a player FEEL it?**
What changes is that when several things pass that test at once, they may have
their own block instead of being cut to one line. The 25 Aug email carried four,
each of which a reader had personally suffered: the pick card was not saving at
all, roughly 4 taps in 10 on a player's name did nothing, Caught It went silent
for a whole room, and the buttons sat below the fold on a laptop.

**Still forbidden, and this is the part that matters:** internals nobody feels.
"The rounds listener now attaches on its own guard" fails the test however hard
the night was. Write what the player gets, not what the engineer fixed.

**And say what was broken, plainly.** "Your pick card saves again. It hadn't
been." reads as honest; "we've made improvements to reliability" reads as a
company hiding something. The weekly note already names a real failure every
week on purpose, and a tip-off can borrow that when there is one worth naming.

---

## 15. Every Sunday note carries its edition number, and the reader can see it

Anis, 29 Aug 2026: *"We should number the weekly emails."*

They were already numbered where only we could see it. The MailerLite campaigns
have read `Weekly #1` and `Weekly #2` since 16 August; the eyebrow the reader
actually sees said `The Build · Week 2 · 23 August`. Same number, different word,
in two places, which is this codebase's oldest disease wearing a newsletter.

**The rule.** One number, written the same way in both:

| Where | Exactly |
|---|---|
| The eyebrow, first line of the letter | `The Build · Weekly #3 · 30 August` |
| The campaign name | `Weekly #3 — Sunday 30 Aug — <the theme>` |

`Weekly #N`, with the hash. Never `Week N`, never `Edition N`, never `#N` alone.

**Where N comes from.** The count of Sunday notes actually SENT, not the number
of Sundays that have passed and not the week of the year. Read it off the sent
campaigns, which is the only record of what a reader received:

    Weekly #1  Sunday 16 Aug 2026   sent to 4
    Weekly #2  Sunday 23 Aug 2026   sent to 5
    Weekly #3  Sunday 30 Aug 2026

A Sunday that produces no letter does not consume a number. If a Sunday is ever
missed, the next one is still the next integer, because the number counts what
went out rather than what was owed.

**Check it before writing, not after.** The routine already fetches the sent
campaigns to avoid repeating a subject line (rule 12). While it is there, take
the highest `Weekly #N` and add one. Do not count the drafts: an unsent draft
has a number and a reader has never seen it, and two drafts for one Sunday is a
thing that has already happened.

**The tip-off emails are NOT numbered this way.** They carry Game Night numbers,
which come from the `gn` field on the slate and count rooms, not letters. GN #44
and Weekly #3 can and do sit in the same email. They are different counters of
different things and neither is derived from the other.
