#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v75_type_patch.py — STEP 1 OF THE v7.5 PORT: the faces, and only the faces.

    python3 host/v75_type_patch.py index-test.html

WHY A PATCH SCRIPT AND NOT AN EDIT. Two sessions have worked on this file in
one evening before, and marquee_patch.py survived .122 -> .129 underneath it
precisely because it anchored rather than forked. Every replacement below
asserts it matched EXACTLY ONCE and the script dies otherwise, so a moved
anchor is a loud failure instead of a silent half-application.

WHAT THIS PORTS
    --disp   'Archivo'        headings, team codes, the big numbers
    --ui     'Chakra Petch'   labels, chips, buttons, nav — the chrome
    --mono   'JetBrains Mono' figures, build stamps, anything tabular

WHAT THIS DELIBERATELY DOES NOT PORT — and this is the important half.
v75.html uses 21 distinct font sizes, 13 of them off the shipped ramp, and
FOUR of them below 12px (8, 9, 10, 11). The 12px floor is not a preference:
qa.js records that 142 sub-12px sizes were "most of why the app read as
amateur", on a product whose whole job is to be glanceable on a phone held
at arm's length while you are watching the television. The founder is that
reader. So the thirteen-size ramp and the floor stay exactly as they are,
and type.one-ramp / type.readable-floor are not touched.

BODY PROSE STAYS ON THE SYSTEM STACK. Chakra Petch is a squared technical
face and it is right for chrome — labels, chips, the nav — and wrong for the
rules screen, which is several hundred words somebody actually reads. The
character goes where the eye lands; the readability stays where the reading
happens. Push it further only after looking at the rules page on a phone.

THE COST, STATED. Three webfonts, six files, on a page that is otherwise a
single self-contained file. Every face carries a real fallback stack and
display=swap, so a blocked or slow fonts.googleapis.com costs a flash of
system type and nothing else. preconnect is there so the handshake overlaps
the HTML parse rather than following it.
"""
import io, sys, re

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

FONT_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2'
    '?family=Archivo:wght@700;900'
    '&family=Chakra+Petch:wght@400;600;700'
    '&family=JetBrains+Mono:wght@400;700'
    '&display=swap">\n  '
)

def main():
    s = io.open(SRC, encoding='utf-8').read()
    hits = []

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        hits.append(tag)

    # ---- 1. the faces themselves -------------------------------------
    # Anchored on the charset meta, which has been the first line of <head>
    # since the file was written and is the one tag nothing else moves.
    m = re.search(r'(<meta charset="[^"]+">\s*\n\s*)', s)
    if not m:
        sys.exit('ABORT link: no charset meta to anchor the font link to')
    if 'fonts.googleapis' in s:
        sys.exit('ABORT link: a Google Fonts link is already present')
    s = s[:m.end(1)] + FONT_LINK + s[m.end(1):]
    hits.append('link')

    # ---- 2. the tokens ------------------------------------------------
    # --f keeps the system stack ON PURPOSE (see the note above). --ui and
    # --disp are new; --mono gains a real face in front of its existing
    # fallbacks rather than being redefined, so every current consumer of
    # var(--mono) — 27 tabular-nums sites among them — inherits it free.
    sub("    --f:-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;\n"
        "    --mono:ui-monospace,'SF Mono',Menlo,monospace;",
        "    --f:-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;\n"
        "    /* v7.5 faces. --f stays the system stack because body prose is\n"
        "       read, not glanced at; the character lives in the chrome. */\n"
        "    --disp:'Archivo',Impact,system-ui,sans-serif;\n"
        "    --ui:'Chakra Petch',system-ui,-apple-system,sans-serif;\n"
        "    --mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;",
        'tokens')

    # ---- 3. put them to work, without touching a single size ----------
    # Appended as its own block at the end of the first stylesheet so the
    # cascade order is explicit and nothing here fights an earlier rule by
    # accident. Sizes, weights-by-number and colours are all left alone.
    anchor = '  /* hairlines — alpha, never solid */'
    if s.count(anchor) != 1:
        sys.exit('ABORT apply: hairline anchor is not unique')
    block = """  /* ============ v7.5 FACES, APPLIED ================================
     Headings and the marquee codes take the display face; labels, chips,
     buttons and the nav take the UI face; anything that is a FIGURE takes
     the mono. No font-size is set here — the thirteen-size ramp and the
     12px floor are the shipped design system and this patch does not get
     an opinion about them. */
  h1, h2, h3, .abig, .mq-code, .mq-cbig, .arc .v{
    font-family:var(--disp); letter-spacing:-.01em }
  .lab, .alab, .acap, .chip, .btn, .abdg, #botnav, .grLg, .mq-clab{
    font-family:var(--ui) }
  .num, .ascore, .mq-cbig, .arc .v, [style*="tabular-nums"]{
    font-family:var(--mono); font-variant-numeric:tabular-nums }

"""
    s = s.replace(anchor, block + anchor)
    hits.append('apply')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('v7.5 type patch applied to %s' % SRC)
    for h in hits:
        print('   ok  %s' % h)

if __name__ == '__main__':
    main()
