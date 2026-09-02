#!/usr/bin/env bash
set -e
SRC=/home/higherthan7/stats/v75/v75.html; DST="$HOME/Downloads/STATS-GAMETIME-v75.html"
H=$(md5sum "$SRC" | cut -c1-7)
sed "s/DEVBUILD/$H/g" "$SRC" > "$DST"
# REFUSE to ship an unstamped file. A plain `cp` skips the sed and the
# delivered build then reads DEVBUILD, which looks like an answer and is
# not one. This is the only path to Downloads for that reason.
if grep -q "DEVBUILD" "$DST"; then
  echo "  REFUSED: delivered file still contains DEVBUILD" >&2; rm -f "$DST"; exit 1
fi
n=$(grep -c "$H" "$DST")
echo "  delivered build $H   (stamp on $n lines, no placeholder left)"
