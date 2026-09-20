#!/usr/bin/env bash
# =====================================================================
# THE ONE WAY A BUILD REACHES A PLAYER.
#
# Promotion used to be `cp index-test.html index.html`, and its honesty
# rested on one property: the file players get is byte-identical to the
# file the gate graded.
#
# 20 Sept 2026 that stopped being enough. index.html is 1.8MB and 52% of
# it is comments, and the page took 6.4s to become tappable on a
# throttle-free desktop and ~21s on a real cold load. The founder read
# that as "Stats was down today". It was not down; it was unusable.
#
# So the shipped file is now STRIPPED. That breaks byte-identity, which
# means the gate must grade THE STRIPPED FILE and not the source, or the
# property that has kept every promotion in this project honest is gone.
# This script is the only place that knows the order:
#
#     1. build the stripped artifact from index-test.html
#     2. prove it still boots and behaves (host/strip-verify.js)
#     3. the CALLER gates that artifact  <- not this script's job
#     4. promote the exact bytes that were gated
#
# It refuses to promote anything it did not just build, and it prints the
# md5 of what it wrote so the gate's fingerprint can be checked against
# the thing that actually shipped.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SRC="index-test.html"
OUT="_promote.html"
NODE="${NODE:-$(command -v node)}"

say(){ echo "  $*"; }

[ -s "$SRC" ] || { say "FATAL: $SRC missing"; exit 1; }

say "building the stripped artifact from $SRC"
"$NODE" host/strip-comments.js "$SRC" "$OUT" || { say "FATAL: strip failed"; exit 1; }
[ -s "$OUT" ] || { say "FATAL: strip produced nothing"; exit 1; }

say "proving it still works"
"$NODE" host/strip-verify.js "$SRC" "$OUT" || { say "FATAL: the stripped build did not verify — NOT promoting"; rm -f "$OUT"; exit 1; }

md5sum "$OUT" | sed 's/^/  artifact  /'
say "gate THIS file, then run: $0 --promote"
