#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
practice_no_email.py — PRACTICE ASKS FOR AN EMAIL. IT SHOULD ASK FOR A NAME.

    python3 host/practice_no_email.py index-test.html

Founder, looking at the practice handle screen: "we dont need the email in
the practice round. It should be quick to use and test."

He is right and the app already agrees with him everywhere else.
gateNeeded() is `S.mode==='live'`, and the verify row (Google / email link)
already hides itself in practice on exactly that test. Two things were
never given the same treatment:

    #emailFieldWrap   the Email label and input
    #gateConsent      "Email me when the next game night is on"

So practice — the two-minute, no-account path this product tells people to
try first — renders as a signup form. B14 was reversed on 18 Aug precisely
so practice needs no account; this screen never got the message.

THE NOTE CHANGES TOO. "So your card has a name on it when the host settles
the night" is live-night language. Nobody settles a practice run.

NOTHING IS DELETED. Both blocks stay in the DOM and come back the moment
the mode is live — the same pattern the verify row already uses. A removed
id turns its writer into a silent no-op, which is the oldest failure in
this file.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

def main():
    s = io.open(SRC, encoding='utf-8').read()
    if 'practiceGateTrim' in s:
        sys.exit('ABORT: already applied')

    anchor = "function prefillGate(){\n  const e=document.getElementById('gateEmail'); if(!e) return;"
    if s.count(anchor) != 1:
        sys.exit('ABORT: expected exactly 1 prefillGate opening, found %d' % s.count(anchor))

    new = """/* ============ PRACTICE ASKS FOR A NAME, AND NOTHING ELSE ==========
   Founder: "we dont need the email in the practice round. It should be
   quick to use and test."

   The app already knows: gateNeeded() is S.mode==='live', and the verify
   row hides itself on that same test. The email field and the mailing-list
   box never got the same treatment, so the two-minute no-account path —
   the one this product tells a stranger to try FIRST — rendered as a
   signup form. B14 was reversed on 18 Aug so practice needs no account;
   this screen never heard about it.

   Hidden, never removed: both come back the instant the mode is live. A
   removed id turns its writer into a silent no-op. */
function practiceGateTrim(){
  try{
    var live = gateNeeded();
    var wrap = document.getElementById('emailFieldWrap');
    if(wrap) wrap.style.display = live ? '' : 'none';
    var box = document.getElementById('gateConsent');
    var lbl = box && box.closest ? box.closest('label') : null;
    if(lbl) lbl.style.display = live ? '' : 'none';
    var note = document.getElementById('gateNote');
    /* Live-night language on a practice run: nobody settles a practice
       run, so the sentence about the host is simply not true here. */
    if(note && !live) note.textContent = 'Just a name and a colour. Nothing is saved and nobody is emailed.';
  }catch(_){}
}

function prefillGate(){
  const e=document.getElementById('gateEmail'); if(!e) return;
  try{ practiceGateTrim(); }catch(_){}"""

    s = s.replace(anchor, new)
    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('practice gate trimmed in %s' % SRC)

if __name__ == '__main__':
    main()
