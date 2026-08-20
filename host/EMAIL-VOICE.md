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

## 3. What it should sound like instead

Short declaratives. Concrete nouns. Real numbers with their source. A specific
day rather than "recently". The occasional sentence fragment, because people
write those. Somebody who watched the game and is telling one other person what
happened.

If a sentence could sit unchanged in any other company's newsletter, it is not
in this voice yet.

## 4. Everything already settled, which still holds

- Tip-off email signs off `STATS GAMETIME`. Only the Sunday note is `Anis`.
- No dash before the signature. It was removed once already.
- `STATS of the Day`, plural, always. Never `Stat of the Day`.
- The subject must not repeat the headline.
- No unverified number, no player counts, no build numbers, no test counts.
- Never quote another company's model. `predictor`, win probability, odds and
  spreads are all out. Scores, records, streaks and leaders are facts and ours.
- Never write "tonight" where it would read wrong a day later.
- The email says WHAT the answer was. It never says who got it right. The app
  does that, because it kept their tap.

## 5. Before you create the draft

Read the finished copy back and search it for `—`. If there is one, you have
not followed rule 1, and rule 1 is the one Anis asked for by name.

## 6. Every room card names where to watch

Founder, 20 Aug 2026: *"when showing the games make sure to add the network so
people know where to tune into, the one NFL game has no network. we should
always make sure of that."*

A room card without a channel fails the whole premise, which is play along with
the game you are watching. Write it as `on NFL Network`, not with a dash.

If the slate entry has no `net`, do not quietly print the card without one and
do not invent a channel. Say so in the notification to Anis instead, because a
room with no national carrier should not have been picked in the first place
(see rule 7 in `host/leagues.env`).

## 7. One email a day, and which one owns the day

Both routines fire on their own schedule and neither knew about the other. The
daily tip-off runs at 9:13am PT **every** morning and drafts whenever the slate
has games. The weekly note runs Sunday at 7am PT. So the first Sunday with a
slate would have produced two drafts and, if both were approved, two emails to
the same four people on the same day.

| Day | Who writes it | Signed |
|---|---|---|
| Monday to Saturday, games on the slate | the tip-off routine | `STATS GAMETIME` |
| Monday to Saturday, no games | nobody. Silence is correct. | |
| **Sunday, always** | **the weekly note, and only the weekly note** | `Anis` |

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

## 8. Two tells I keep producing anyway

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
