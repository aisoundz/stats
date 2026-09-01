#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cfb_guard.py — ONE MALFORMED ESPN EVENT MUST NOT KILL A WHOLE LEAGUE.

    python3 host/cfb_guard.py

THE 12 SEPT BUG, ROOT CAUSE, 1 Sept 2026. Reproduced with:

    DATE=2026-09-12 LEAGUE=cfb node host/build-slate.js --manifest

    game  slate-2026-09-12-buff-fiu  Bulls @ Panthers  team picks  ESPN+
    TypeError: Cannot read properties of undefined (reading '0')
        at host/build-slate.js:443:29

Line 443 is `const c = e.competitions[0];` with no guard. ESPN returned one
event on that date with no `competitions` array — and because the loop
throws rather than skipping, EIGHTY college football games died with it.
The manifest got zero cfb rows, three of four picked rooms for that
Saturday could never be hosted, and the launcher reported it as
"nothing to build today".

Note what it cost: ONE bad row out of eighty. Every other game was fine.

THE FIX IS THE PATTERN ALREADY IN THE LOOP, TWO LINES DOWN:

    if(!H || !A){ skipped.push(`${e.id}: no two sides`); continue; }

A competitor block that cannot be read is skipped with a NAMED reason and
the build carries on. The competitions block gets the same treatment. It
was almost certainly not written defensively because every other league's
feed always carries it — CFB has 80+ games a Saturday including FCS and
exhibition rows, and it is the league most likely to return something
ragged.

WHY THE STACK TRACE EXISTED TO FIND THIS. Until earlier tonight the
builder's catch kept only `e.message`, so this read as a bare TypeError
with no line number and stayed undiagnosed for a week. `.catch(e => die(...))`
now prints `e.stack` first. The diagnostic fix is what made the root cause
takeable.

NOT TRUSTED UNTIL:  DATE=2026-09-12 LEAGUE=cfb node host/build-slate.js --manifest
                    exits 0 and emits ~80 rows.
"""
import io, sys

SRC = 'host/build-slate.js'

def main():
    s = io.open(SRC, encoding='utf-8').read()

    old = """  for(const e of events){
    const c = e.competitions[0];
    const H = c.competitors.find(x => x.homeAway === 'home');
    const A = c.competitors.find(x => x.homeAway === 'away');
    if(!H || !A){ skipped.push(`${e.id}: no two sides`); continue; }"""
    if 'no competition block' in s:
        sys.exit('ABORT: already applied')
    if s.count(old) != 1:
        sys.exit('ABORT: expected exactly 1 match for the event loop, found %d' % s.count(old))

    new = """  for(const e of events){
    /* ============ ONE RAGGED ROW MUST NOT KILL THE LEAGUE ===========
       12 Sept 2026: ESPN returned one college football event with no
       `competitions` array. This line was `e.competitions[0]` with no
       guard, so it threw — and EIGHTY games died with the one bad row.
       The manifest got zero cfb rows, three of four picked rooms for that
       Saturday could never be hosted, and the launcher reported it as
       "nothing to build today".

       The loop already knew how to handle an unreadable row two lines
       down: skip it with a NAMED reason and carry on. A feed is somebody
       else's data and will be ragged eventually; CFB, with 80+ games a
       Saturday across every division, is where that shows up first. */
    const c = e.competitions && e.competitions[0];
    if(!c || !Array.isArray(c.competitors)){
      skipped.push(`${e.id}: no competition block in the feed`);
      continue;
    }
    const H = c.competitors.find(x => x.homeAway === 'home');
    const A = c.competitors.find(x => x.homeAway === 'away');
    if(!H || !A){ skipped.push(`${e.id}: no two sides`); continue; }"""

    s = s.replace(old, new)
    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('cfb guard applied to %s' % SRC)
    print('NEXT, not optional:')
    print('  DATE=2026-09-12 LEAGUE=cfb node host/build-slate.js --manifest')


if __name__ == '__main__':
    main()
