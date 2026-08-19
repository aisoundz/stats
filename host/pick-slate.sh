#!/usr/bin/env bash
# =====================================================================
# PICK THE ROOMS FOR A NIGHT, BY HAND.
# ---------------------------------------------------------------------
# `MAX_ROOMS` is a GLOBAL cap and the slate is ordered by tip, so on a day
# where preseason football kicks off at 9am and the WNBA does not tip
# until 4pm, the early rooms take every slot before the league that has
# actually run a real night is even due. The honest fix is a per-league
# cap; this is the twenty-minute one, and for a night you are inviting
# people to it is the SAFER one, because curating a list by hand cannot
# misfire the way a cap interacting with tip times can.
#
# It rewrites the day's manifest to exactly the rooms you name, keeping a
# copy of the full one alongside. start-slate.sh then behaves normally —
# and that matters: this rehearses the path Saturday will actually use
# rather than a shortcut around it.
#
#   host/pick-slate.sh 2026-08-20 slate-2026-08-20-nyy-bal slate-2026-08-20-lv-hou
#   host/pick-slate.sh 2026-08-20 --show      # what is in the manifest now
#   host/pick-slate.sh 2026-08-20 --restore   # put the full slate back
# =====================================================================
set -euo pipefail
LOGDIR="${LOGDIR:-$HOME/gamenight-logs}"
DATE="${1:-}"
[ -n "$DATE" ] || { echo "usage: $0 YYYY-MM-DD <nightId> [nightId...]  |  --show  |  --restore"; exit 1; }
shift
ALL="$LOGDIR/slate-all-$DATE.tsv"
FULL="$LOGDIR/slate-all-$DATE.full.tsv"

[ -f "$ALL" ] || { echo "no manifest at $ALL — run start-slate.sh --build first"; exit 1; }

show(){
  echo "--- $ALL ---"
  awk -F'\t' '{printf "  %-6s %-34s %s\n", $1, $2, $6}' "$ALL"
  echo "  $(wc -l < "$ALL") room(s)"
}

case "${1:-}" in
  --show)    show; exit 0 ;;
  --restore) [ -f "$FULL" ] || { echo "no full copy at $FULL — nothing to restore"; exit 1; }
             cp "$FULL" "$ALL"; echo "restored the full slate"; show; exit 0 ;;
esac

# Keep the full slate ONCE, so repeated picking never loses the original.
[ -f "$FULL" ] || cp "$ALL" "$FULL"

TMP="$(mktemp)"
MISSING=""
for id in "$@"; do
  if grep -qP "^[^\t]*\t\Q$id\E\t" "$FULL" 2>/dev/null || grep -q "	$id	" "$FULL"; then
    grep "	$id	" "$FULL" >> "$TMP"
  else
    MISSING="$MISSING $id"
  fi
done

if [ -n "$MISSING" ]; then
  echo "NOT IN THE SLATE FOR $DATE:$MISSING"
  echo "Nothing written. Check the ids against: $0 $DATE --show"
  rm -f "$TMP"; exit 1
fi

# Sorted by tip, the order a person thinks about an evening in.
sort -t'	' -k6,6 "$TMP" > "$ALL"
rm -f "$TMP"
echo "picked $# room(s) for $DATE  (full slate kept at $(basename "$FULL"))"
show
