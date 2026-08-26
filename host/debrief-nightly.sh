#!/usr/bin/env bash
# =====================================================================
# THE TWO NUMBERS, EVERY NIGHT, WITHOUT ANYBODY REMEMBERING TO ASK.
# ---------------------------------------------------------------------
# Round completion and score agreement were the product's two headline
# metrics. Both stopped being reported after 19 Aug 2026 — the last
# figure on record anywhere is "1 of 4 players agree", from GN13. On
# 26 Aug the whole month had to be reconstructed out of runner logs to
# answer "how have we been doing", which is what a missing ledger costs.
#
# host/debrief.js already computes both, correctly, from each night's own
# archive. It had no cron and took one night at a time from an env var,
# so it only ever ran when somebody typed it. This sweeps every room that
# actually ran on a date and appends one line per room to a ledger.
#
# Default date is YESTERDAY, because a night that tips at 7pm PT archives
# after midnight UTC and this runs in the morning.
#
#   host/debrief-nightly.sh              # yesterday
#   host/debrief-nightly.sh 2026-08-25   # a specific date
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$HOME/gamenight-logs"
LEDGER="$LOGS/metrics.tsv"
KEY="$HOME/.secrets/stats-firebase-admin.json"
NODE="$(command -v node || echo "$HOME/.nvm/versions/node/v20.20.2/bin/node")"

DATE="${1:-$(date -u -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)}"

if [ ! -r "$KEY" ]; then
  echo "$(date -u +%FT%TZ)  debrief-nightly: no service account at $KEY — refusing to run" >&2
  exit 1
fi
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"

# Which rooms actually ran that date. The runner writes a `save` line at
# its final buzzer, so a log carrying one is a room that hosted; a log
# without one was built and never picked up. Counting built rooms would
# put permanent "unknown" rows in the ledger for games nobody hosted.
mapfile -t ROOMS < <(
  grep -l "  save " "$LOGS"/slate-"$DATE"-*.log 2>/dev/null |
  sed 's#.*/##; s#\.log$##'
)

# The pre-slate era used gn<N>-<date>-<teams> ids and has no slate- log.
if [ "${#ROOMS[@]}" -eq 0 ]; then
  echo "$(date -u +%FT%TZ)  debrief-nightly: no hosted rooms found for $DATE"
  exit 0
fi

# One header, once, so the file is readable without a schema note.
if [ ! -f "$LEDGER" ]; then
  printf 'run_at\tdate\tnight\trounds\tcompletion\tseats\tagree\terrors\n' > "$LEDGER"
fi

echo "$(date -u +%FT%TZ)  debrief-nightly: $DATE — ${#ROOMS[@]} room(s)"

for NIGHT in "${ROOMS[@]}"; do
  OUT="$LOGS/debrief-$NIGHT.txt"
  # Full human-readable debrief kept per room; the ledger is the summary.
  if NIGHT_ID="$NIGHT" "$NODE" "$ROOT/host/debrief.js" > "$OUT" 2>&1; then
    LINE="$(grep -m1 '^METRICS' "$OUT" || true)"
    if [ -n "$LINE" ]; then
      # METRICS<TAB>night<TAB>rounds=a/b<TAB>completion=n%<TAB>seats=n<TAB>agree=a/b<TAB>errors=n
      printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$DATE" \
        "$(printf '%s' "$LINE" | cut -f2- | sed 's/[a-z]*=//g')" >> "$LEDGER"
      echo "  $NIGHT  $(printf '%s' "$LINE" | cut -f3-)"
    else
      # A debrief that exits 0 without a METRICS line has told us nothing.
      # Say so in the ledger rather than leaving a silent gap — "I could
      # not check" and "I checked and it is fine" are different sentences.
      printf '%s\t%s\t%s\tunknown\tunknown\tunknown\tunknown\tunknown\n' \
        "$(date -u +%FT%TZ)" "$DATE" "$NIGHT" >> "$LEDGER"
      echo "  $NIGHT  NO METRICS LINE — see $OUT"
    fi
  else
    printf '%s\t%s\t%s\tfailed\tfailed\tfailed\tfailed\tfailed\n' \
      "$(date -u +%FT%TZ)" "$DATE" "$NIGHT" >> "$LEDGER"
    echo "  $NIGHT  DEBRIEF FAILED — see $OUT"
  fi
done

echo "  ledger: $LEDGER"
