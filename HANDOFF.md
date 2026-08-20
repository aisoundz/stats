# Switch to another machine

**If the Jetson dies, this is the page you open.** Written 20 August 2026.

The honest summary: **almost everything survives, because almost everything is already
somewhere else.** The site is on GitHub, the data is in Firestore, the email list is in
MailerLite, the documents are in Drive. What lives *only* on the Jetson is the automation that
opens rooms at night — and that is a set of cron lines you can recreate in ten minutes.

---

## What is already safe

| Thing | Where it really lives |
|---|---|
| The site (player app + Control Room) | **GitHub** — github.com/aisoundz/stats, served by GitHub Pages at statsgametime.com |
| Every night, every player, every score | **Firestore** — project `stats-gametime` |
| The journal and the timeline | GitHub (`journal/`) **and** Drive |
| Email list and campaigns | **MailerLite** |
| Decks, social content, voice notes | Drive |
| Question banks, QA suites, host scripts | GitHub, in the repo |

**Nothing above needs the Jetson.** The website keeps serving even if the machine is unplugged
mid-game — GitHub Pages does not know or care where it was pushed from.

---

## What only lives on the Jetson

1. **The cron schedule** that builds the slate each morning and starts rooms each evening.
2. **The Firebase service-account key** at `~/.secrets/stats-firebase-admin.json` — the one
   genuinely irreplaceable-feeling item, and it is not: generate a new one from the Firebase
   console at any time.
3. **`~/gamenight-logs/`** — run logs and hand-written notes. The important ones are mirrored
   into `journal/` in the repo.

---

## Standing it up somewhere else

    git clone https://github.com/aisoundz/stats.git
    cd stats && npm install

Then three things:

**1. The service-account key.** Firebase console → Project settings → Service accounts →
Generate new private key. Save as `~/.secrets/stats-firebase-admin.json`.

**2. The cron lines.** These are the whole automation:

    10 8 * * *        host/start-slate.sh --build      # build tomorrow's slate
    0,30 8-23 * * *   host/start-slate.sh              # start rooms when their window opens
    0 10 * * *        node host/snapshot.js            # daily snapshot
    20 6 * * *        node host/backtest.js --days 2   # overnight shadow run

**3. Node.** The scripts expect Node 20, and the cron wrapper sets PATH explicitly because cron
does not inherit nvm.

---

## The things that will bite you

- **`host/leagues.env` is the only place that decides which leagues are hosted and how many
  rooms run at once.** Not the cron lines — they name a schedule, not a policy.
- **The pick file decides which games become rooms.**
  `~/gamenight-logs/slate-pick-YYYY-MM-DD.txt`, one night id per line. Without one, a league
  with fifteen games a day will fill every slot with morning fixtures.
- **`MAX_ROOMS` is 4 for stress-test week and must go back to 2 on Monday 24 August.**
- **The concurrent-listener ceiling is about 78.** `node host/listeners.js` asks how many are
  open right now; `host/listener-watch.js` samples a whole night. This is the number that
  decides how many rooms a night can have.
- **Run the gate before deploying:** `node qa/all.js index-test.html`. About 25 minutes, and
  **nothing else should run while it does** — concurrent browser suites produce false failures.
- **One known red is environmental:** `feed.live.group-crashed` fails on this hardware whatever
  the build. Confirm it fails on the currently-deployed file before believing a red gate.

---

## Deploying

Build on `index-test.html`, never on the live file. Gate it. Then:

    cp index-test.html index.html
    git add -A && git commit && git push origin main

GitHub Pages takes about a minute. **Then check the live site actually changed** — it serves
with a ten-minute cache and a long-open tab can hold a stale copy.

---

## If you only remember one thing

The product is a website and a database, and both are hosted by other people. The Jetson is a
scheduler with a good memory. Losing it costs you an evening of setup, not the company.
