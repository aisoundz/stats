#!/usr/bin/env bash
# A suite that dies on a TimeoutError prints no FAIL lines. Grepping for
# FAIL then reads a crash as "the check did not catch it", which is the
# same lie as a harness that ignores its file argument.
suite="$1"; file="$2"; name="$3"
out=$(timeout 180 node "$suite" "$file" 2>&1); code=$?
fails=$(printf '%s' "$out" | grep -c "^  FAIL")
printf "\n### %s\n" "$name"
if [ "$fails" -gt 0 ]; then printf '%s\n' "$out" | grep "^  FAIL"
elif [ "$code" -ne 0 ]; then
  echo "  CRASHED (exit $code) — detected, but it killed the run:"
  printf '%s\n' "$out" | grep -oE "TimeoutError|waiting for locator\(.*\)" | head -2 | sed 's/^/      /'
else echo "  >>> NOT CAUGHT <<<"; fi
