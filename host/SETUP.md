# The autonomous host — setup

**Two steps, both involving a credential, and both yours to do.** I built the runner and the
workflow; I will not create or handle the service account key. Once these two are done the
laptop never needs to be open again.

Budget about ten minutes.

---

## Step 1 · Make a service account key

The runner writes to Firestore from a machine that has nobody signed in on it, so it needs an
identity of its own.

1. Go to the Firebase console → your project → **⚙️ Project settings → Service accounts**.
2. Press **Generate new private key**. It downloads a `.json` file.
3. Open that file and copy **the whole thing**, braces included.

That file is a password. Do not commit it, do not paste it into a chat, and if it ever leaks,
press **Generate new private key** again — that invalidates the old one.

## Step 2 · Put it in GitHub

1. `github.com/aisoundz/stats` → **Settings → Secrets and variables → Actions**.
2. **New repository secret.**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: the entire JSON you copied.
3. On the same page, switch to the **Variables** tab and add two:
   - `NIGHT_ID` → `gn8-2026-08-14-dal-ind`
   - `ESPN_EVENT` → `401857143`

The variables are just defaults for the scheduled run. A manual run asks for both, so you can
point it at any game without editing anything.

---

## Before each night: press Publish

Open the Control Room, pick the night, make sure the question bank is written, and press
**"Publish tonight's plan to the server"** in the Autopilot card at the top of the RUN tab.

The runner refuses to start without this, and the refusal is deliberate. A runner carrying its
own copy of the bank could open a round asking different questions from the ones the phones
were shown — which is not hypothetical, it is exactly what cost a player his entire night on
Game Night #7. One bank, published from the room that owns it.

If any question has no resolver and no hand-set answer, Publish tells you which one. That
round will stop and wait for a human rather than being guessed at.

---

## Testing it, which you should do before Friday

`Actions → Autonomous host → Run workflow`, and give it Wednesday's finished game:

- night: `gn7-2026-08-12-tor-dal`
- event: `401857137`
- minutes: `3`

Against a finished game every quarter reads as complete immediately, so it will work through
all four in about a minute and then exit. The log shows every decision. Nothing is invented:
if it posts four keys, those are the sixteen resolvers agreeing with the game that was played.

**Careful:** that writes to Game Night #7's real room. Either clear that night first with the
Control Room's reset, or make a throwaway night id to point it at. It will not damage Friday
either way — different night, different documents.

---

## What actually happens on Friday

The schedule fires at **23:00 UTC (7:00pm ET)**, half an hour before tip. That half hour is
the jitter budget: GitHub's scheduler has a five-minute floor and can be twenty minutes late
when the fleet is busy.

Which is why this is one long job rather than a cron every minute. The schedule only has to be
roughly right **once** — the job then holds its own twenty-second loop for the length of the
game. Late by ten minutes at the start is survivable. Late by ten minutes on every tick would
miss the exact moments the thing exists for.

Then, every twenty seconds:

- a quarter finishes → it waits twenty seconds for the feed to settle, then pushes that round
- the room answers, or two and a half minutes pass → it resolves all four questions
- all four resolve → it posts the key and everybody scores
- **any one of them doesn't → the round stays open, it writes `needsHuman` onto that round, and
  it says which question and why**

That last line is the whole design. A key that is right about three questions and invented
about the fourth marks every player wrong while looking, on every screen, exactly like a key
that was correct. A missing score is a bad night. A confidently wrong one is the end of being
believed.

It exits itself when the last quarter is scored.

---

## Cost

GitHub Actions is free for public repositories. If `aisoundz/stats` is private, the free tier
is 2,000 minutes a month and a four-hour night is 240 of them — about eight nights. Two ways
to stay inside it if that ever bites: set `minutes` to `180` (a WNBA game is closer to two and
a half hours), or make the repo public, which it effectively already is since it serves a
public website.

---

## What this does not fix

The runner replaces the laptop for **opening, closing and scoring quarters**. It does not yet
write the live score into the room — that is still the ESPN auto panel in the Control Room tab.
Moving it is a ten-line change to `host/run.js` and it should happen next, because it is the
last thing keeping a tab open.
