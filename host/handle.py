#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
handle.py — YOUR @HANDLE, KEPT, ACROSS DEVICES.

    python3 host/handle.py index-test.html

Founder: "I thought we were going to do @ handle so people can have the
same one forever. Right now you have to sign up and get a new name every
single time. Its exhausting."

He is right and it is worse than he thinks. savedProfile() reads
localStorage and NOTHING else, so a handle lives on one browser on one
device — a new phone, a cleared cache or a fresh profile all mean "Grab
your handle" from zero. Meanwhile the verify screen promises "sign in to
save your handle, your points and your card across phones". Signing in
saved the points. The handle was never part of it.

The code knew: savedProfile()'s own comment says "Device-local on purpose.
The durable, cross-phone version of this belongs in a users/{uid} doc, and
that needs a rules change." Those rules are deployed now.

    users/{uid}        handle, display, colour, sport — yours to write
    handles/{lower}    the RESERVATION, one document per claimed name

UNIQUENESS WITH NO TRANSACTION. Firestore refuses a create on a document
that already exists, so handles/{lower} IS the lock: `allow create` with
no update means a free name can be claimed and a held one never can. The
uid inside must be the caller's, or somebody could reserve a name and
point it at another player.

IT IS A LIVE-MODE CONCEPT, AND THAT IS THE HONEST LINE. A handle has to
belong to somebody, so it needs an account — which is exactly what the
sign-in screen has been claiming all along. Practice keeps a plain display
name and asks for nothing, because practice needs no account at all.

LOWER-CASED FOR THE LOCK, AS TYPED FOR THE SCREEN. @Smakk and @smakk must
not be two people, but the board should show what they typed.

CLAIMING NEVER BLOCKS PLAY. If the reservation fails — offline, taken,
signed out — the player continues under the name they typed and the app
says what happened. A gate that stops somebody playing because a name is
busy is worse than the problem it solves.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

READER = """  /* ============ THE @HANDLE — one name, every device ================
     users/{uid} is yours; handles/{lower} is the reservation. See
     host/handle.py. Both paths were deployed 1 Sept 2026.

     Firestore refuses a create on an existing document, so the create IS
     the uniqueness check — no transaction, no race, and a held name can
     never be taken because nothing but the owner may update one. */
  SB.handleNorm = function (h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
  };

  SB.myProfile = async function () {
    if (!SB.enabled || !F || !db) return null;
    var who = ''; try { who = uid() || ''; } catch (_) { who = ''; }
    if (!who) return null;
    try {
      var snap = await F.getDoc(F.doc(db, 'users', who));
      return (snap && snap.exists()) ? (snap.data() || null) : null;
    } catch (e) { return null; }
  };

  /* {ok:true} | {ok:false, why:'taken'|'invalid'|'noacct'|'offline'}
     NEVER throws, and never blocks play — the caller carries on either
     way and only the message changes. */
  SB.claimHandle = async function (typed, extra) {
    var lower = SB.handleNorm(typed);
    if (lower.length < 3) return { ok: false, why: 'invalid' };
    if (!SB.enabled || !F || !db) return { ok: false, why: 'offline' };
    var who = ''; try { who = uid() || ''; } catch (_) { who = ''; }
    if (!who) return { ok: false, why: 'noacct' };
    try {
      var mine = await SB.myProfile();
      if (mine && SB.handleNorm(mine.handle) === lower) {
        /* Already yours. Re-saving the display form is free and lets
           somebody fix their own capitalisation. */
        await F.setDoc(F.doc(db, 'users', who),
          Object.assign({ handle: lower, display: String(typed || '') }, extra || {}), { merge: true });
        return { ok: true, mine: true };
      }
      /* THE RULES ARE THE LOCK, NOT THIS LINE. setDoc on a document that
         does not exist is a CREATE, which the rules allow. On one that
         does, it is an UPDATE — and handles/{h} allows no update to
         anybody but the owner, so it is refused. That refusal IS "taken",
         and it is why no transaction is needed and no race exists. */
      await F.setDoc(F.doc(db, 'handles', lower),
        { uid: who, display: String(typed || ''), at: Date.now() });
      await F.setDoc(F.doc(db, 'users', who),
        Object.assign({ handle: lower, display: String(typed || '') }, extra || {}), { merge: true });
      return { ok: true };
    } catch (e) {
      /* A permission error here means the document exists and is not
         yours — which is exactly what "taken" means. */
      var code = (e && (e.code || e.message)) || '';
      return { ok: false, why: /permission|insufficient/i.test(String(code)) ? 'taken' : 'offline' };
    }
  };

"""

CLIENT = r"""
/* ============ THE @HANDLE, ON THE SCREEN =============================
   Restores the name a signed-in player already owns, on any device, and
   reserves a new one when they choose it. See host/handle.py.

   Practice never touches this: a handle has to belong to somebody, and
   practice deliberately needs no account. */
var HANDLE_MINE = null;

function handleShow(h){ return h ? ('@' + String(h).replace(/^@+/, '')) : ''; }

/* Fill the name field from the SERVER when we know who they are. Runs
   after boot, and quietly does nothing when signed out. */
async function handleRestore(){
  try{
    if(typeof SB==='undefined' || !SB || typeof SB.myProfile!=='function') return;
    var p = await SB.myProfile();
    if(!p || !p.handle) return;
    HANDLE_MINE = p.handle;
    var el = document.getElementById('playerName');
    /* Never overwrite something the player is in the middle of typing. */
    if(el && !((el.value||'').trim())){
      el.value = p.display || p.handle;
      try{ S.name = el.value; }catch(_){}
    }
    try{ if(!colorTouched && p.color) S.color = p.color; }catch(_){}
    var note = document.getElementById('handleNote');
    if(note){ note.textContent = 'Signed in as ' + handleShow(p.handle) + ' — this follows you to any device.'; note.style.display=''; }
    try{ checkName(); }catch(_){}
  }catch(_){}
}

/* Reserve it on the way into the game. Never blocks: a busy name or a bad
   connection changes the message, not the outcome. */
async function handleClaim(){
  try{
    if(typeof gateNeeded==='function' && !gateNeeded()) return;   /* practice */
    if(typeof SB==='undefined' || !SB || typeof SB.claimHandle!=='function') return;
    var el = document.getElementById('playerName');
    var typed = el ? (el.value||'').trim() : '';
    if(!typed) return;
    if(HANDLE_MINE && SB.handleNorm(typed) === HANDLE_MINE) return;  /* already yours */
    var r = await SB.claimHandle(typed, { color: (S && S.color) || '' });
    var note = document.getElementById('handleNote');
    if(!note) return;
    note.style.display = '';
    if(r && r.ok){
      HANDLE_MINE = SB.handleNorm(typed);
      note.textContent = handleShow(HANDLE_MINE) + ' is yours. It will follow you to any device.';
    } else if(r && r.why === 'taken'){
      note.textContent = handleShow(typed) + ' is taken. You are playing as ' + esc(typed) + ' tonight — pick another to keep it for good.';
    } else if(r && r.why === 'noacct'){
      note.textContent = 'Sign in to keep ' + handleShow(typed) + ' for good. You are playing as ' + esc(typed) + ' tonight either way.';
    } else if(r && r.why === 'invalid'){
      note.textContent = 'A handle needs three or more letters or numbers.';
    } else {
      note.style.display = 'none';
    }
  }catch(_){}
}
"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []
    if 'handleClaim' in s:
        sys.exit('ABORT: already applied')

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # the SB reader
    sub("  SB.watchCallIt = function (cb) {", READER + "  SB.watchCallIt = function (cb) {", 'reader')

    # the client
    sub("function prefillGate(){", CLIENT + "\nfunction prefillGate(){", 'client')

    # a place to say what happened, under the name field
    sub('      <label class="fld">Display name</label>\n',
        '      <label class="fld">Display name</label>\n'
        '      <!-- What the SERVER knows about this name: whether it is yours,\n'
        '           whether it is taken, whether signing in would keep it. Empty\n'
        '           and hidden until there is something true to say. -->\n', 'label')

    old_note = ('      <p class="foot" style="margin:6px 0 0" id="gateNote">')
    if s.count(old_note) != 1:
        sys.exit('ABORT note: expected 1 gateNote, found %d' % s.count(old_note))
    s = s.replace(old_note,
        '      <p class="foot" id="handleNote" style="margin:6px 0 0;display:none;color:var(--teal)"></p>\n'
        + old_note)
    done.append('note')

    # reserve it on the way in. Fire-and-forget: the claim must never
    # delay the pick sheet, and it never blocks either way.
    sub("function startPredict(){\n  try{ trk('card_start'); }catch(_){}",
        "function startPredict(){\n  try{ trk('card_start'); }catch(_){}\n"
        "  /* RESERVE THE HANDLE ON THE WAY IN, and do not wait for it. A busy\n"
        "     name or a dead connection changes the message under the field, not\n"
        "     whether this player gets to play. */\n"
        "  try{ handleClaim(); }catch(_){}", 'claim')

    # restore on boot, beside the other landing painters
    sub("  try{ tapeLoad(); }catch(_){}\n",
        "  try{ tapeLoad(); }catch(_){}\n  try{ handleRestore(); }catch(_){}\n", 'restore')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('@handle applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
