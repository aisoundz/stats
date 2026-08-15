# Setting up a machine to run a game night

Everything needed to rebuild the operating environment from a fresh clone — so losing a
machine costs a download, not a night.

Written 15 Aug 2026, from the Jetson (arm64, Ubuntu 22.04). The steps are the same on a Mac
or an x86 box; where they differ it is called out.

---

## What is in the repo and what is not

**In the repo:** the site (`index.html`, `admin.html`), the runner (`host/run.js`), the
workflow, the Firestore rules, and — as of this commit — **the QA gate** (`qa/`).

**Never in the repo, and never should be:** the Firebase service account key. It is a
password. It lives outside the working tree, it is not committed, and it is not pasted into
any chat or log. If it ever leaks, generate a new one in the Firebase console and **delete
the old key explicitly** — creating a new key does NOT revoke existing ones, contrary to what
an earlier version of `SETUP.md` said. A service account holds up to ten independent keys.

**Not in the repo on purpose:** `package.json`. See "Dependencies" below for why.

---

## 1 · Base tools

```bash
node -v          # 18+, ideally 20 to match the GitHub Actions runner
git --version
```

A browser is only needed for the Control Room and the QA gate's browser layer — see below.

## 2 · Clone and authenticate

```bash
git clone https://github.com/aisoundz/stats.git ~/stats
cd ~/stats
gh auth login            # or a personal access token
gh auth setup-git        # required if the remote is https — otherwise push fails with
                         # "could not read Username for 'https://github.com'"
```

## 3 · Dependencies

**Install both packages in one command, or with a manifest.** This is not style advice:

```bash
npm install firebase-admin@12 playwright --no-save --no-audit --no-fund
```

`npm install <one-package> --no-save` in a directory with **no `package.json`** prunes
everything else in `node_modules`. Installing playwright on its own silently deleted
firebase-admin here, which would have failed the runner at tip with a module-not-found and no
warning beforehand. If you prefer a manifest, create a local `package.json` listing both and
keep it out of git via `.git/info/exclude` — committing one would change what
`.github/workflows/host.yml` installs in CI, since that job runs
`npm install firebase-admin@12 --no-save`.

Verify:

```bash
node -e "require('firebase-admin'); console.log('firebase-admin OK')"
```

## 4 · The service account key — yours to place

Firebase console → **stats-gametime** → ⚙️ Project settings → **Service accounts** →
**Generate new private key**. Direct link:

```
https://console.firebase.google.com/project/stats-gametime/settings/serviceaccounts/adminsdk
```

Put the downloaded JSON **outside the repo**:

```bash
mkdir -p ~/.secrets && chmod 700 ~/.secrets
mv ~/Downloads/stats-gametime-firebase-adminsdk-*.json ~/.secrets/stats-firebase-admin.json
chmod 600 ~/.secrets/stats-firebase-admin.json
```

Confirm it is the right project without printing the key:

```bash
python3 -c "import json;d=json.load(open('$HOME/.secrets/stats-firebase-admin.json'));print(d['project_id'], d['client_email'])"
```

`project_id` must read `stats-gametime`. A key for the wrong project fails silently at write
time rather than at startup.

## 5 · The QA gate

```bash
npx playwright install chromium      # ~111MB; arm64 builds exist, no sudo needed
node qa/qa.js --quick                # static + units, ~3s, no browser
node qa/qa.js --file index.html      # FULL gate, ~15 min on a Jetson
```

**Always pass `--file index.html`.** The gate defaults to `index-test.html`, which has been
stale since 10 August (build `.24` against prod's `.110`+) — it does not even contain
`ttHasRoom` or `loadGameStats`, so the browser layer crashes on it and reports far fewer
checks than it ran. The default is testing a file that no longer ships. `admin-test.html` is
current and fine.

Known-failing on a clean tree, so do not read these as your fault: `type.one-ramp`,
`board.reads-for-itself`, and the `pick.ruled-out-*` / `injuries.out-chip` cluster.

## 6 · Running a night

```bash
export FIREBASE_SERVICE_ACCOUNT="$(cat ~/.secrets/stats-firebase-admin.json)"
export NIGHT_ID="gnNN-YYYY-MM-DD-xxx-yyy"
export ESPN_EVENT="401857147"
export RUN_MINUTES="240"
node host/run.js
```

Or use `host/gamenight-start.sh`, which bakes the values in, refuses to start if another
runner is already live, and detaches so an SSH drop cannot kill it.

**Before the runner will start, the plan must be published** from the Control Room —
"Publish tonight's plan to the server" in the Autopilot card. The runner refuses to invent
questions and the refusal is the feature; see `host/SETUP.md`.

**Never run two hosts against one night.** As of `ebba4d4` the runner enforces this with a
Firestore lease and will exit at startup naming the incumbent. The lease expires after 60s so
a crashed runner can be restarted; `HOST_FORCE=1` overrides it if you know better.

## 7 · Verifying a deploy

GitHub Pages serves stale HTML for 30–90 seconds after a push, so never trust the first read:

```bash
curl -s "https://statsgametime.com/index.html?cb=$RANDOM" | grep -oE "2026-[0-9-]+[a-z.]+[0-9]+"
```

Compare **characters**, not bytes — `wc -c` counts bytes and will not match:

```bash
node -e "console.log(require('fs').readFileSync('index.html','utf8').length)"
```
