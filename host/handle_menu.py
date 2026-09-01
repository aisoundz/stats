#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
handle_menu.py — A WAY FOR SOMEBODY WHO ALREADY PLAYS TO CLAIM THEIRS.

    python3 host/handle_menu.py index-test.html

Founder: "All the users now are testers and we should make a way for them
to do it as well."

The @handle can only be set on the "Grab your handle" screen, which a
person meets at the START of a night. Everyone who has already played goes
straight past it — their name is in localStorage, so the field is
prefilled and the screen scrolls by. They have no way to reach the thing.

So it goes in the ☰ menu beside sign-out and profile, "which is where a
person looks for them anyway" — the file's own words about that menu.

A SHEET, NOT A PROMPT. window.prompt() would have been three lines, and it
cannot show whether the name is already yours, cannot say WHY one was
refused, and looks like a browser rather than the product. The app has a
modal grammar already (shareModal, talkModal, roastModal) and this uses it.

IT SAYS WHAT IS TRUE BEFORE YOU TYPE. Signed out, it says so and offers
nothing — a claim needs an account, because a handle has to belong to
somebody. Already holding one, it shows it. That is the difference between
a form and an answer.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

MODAL = """
  <!-- ============ YOUR @HANDLE ====================================
       Reachable from the ☰ menu so somebody who already plays can claim
       one — the gate screen only appears at the start of a night and a
       returning player scrolls straight past it. See host/handle_menu.py. -->
  <div class="modal" id="handleModal" onclick="if(event.target===this)closeHandle()">
    <div>
      <div class="card" style="max-width:340px;text-align:left">
        <h2 style="font-size:17px;margin:0 0 4px">Your handle</h2>
        <p class="foot" id="hmState" style="margin:0 0 12px"></p>
        <label class="fld" for="hmInput">Handle</label>
        <input id="hmInput" maxlength="16" placeholder="e.g. courtsideking" autocomplete="off"
               oninput="hmTyped()" onkeydown="if(event.key==='Enter'){event.preventDefault();hmClaim();}">
        <p class="foot" id="hmNote" style="margin:6px 0 0"></p>
        <button class="btn" id="hmBtn" style="margin-top:12px" onclick="hmClaim()">Claim it</button>
        <button class="btn ghost" style="margin-top:8px" onclick="closeHandle()">Close</button>
      </div>
    </div>
  </div>
"""

JS = r"""
/* ============ CLAIM A HANDLE FROM THE MENU ===========================
   The gate screen only appears at the start of a night, so a person who
   already plays never sees it. See host/handle_menu.py. */
function hmShow(h){ return h ? ('@' + String(h).replace(/^@+/, '')) : ''; }

async function openHandle(){
  try{
    var m=document.getElementById('handleModal'); if(!m) return;
    m.classList.add('open');
    var inp=document.getElementById('hmInput');
    var st=document.getElementById('hmState');
    var btn=document.getElementById('hmBtn');
    var note=document.getElementById('hmNote'); if(note) note.textContent='';

    var signedIn=false; try{ signedIn = !!(typeof signedInNow==='function' && signedInNow()); }catch(_){}
    if(!signedIn){
      /* A handle has to belong to somebody. Say that instead of offering a
         field that cannot succeed. */
      if(st) st.textContent='Sign in first — a handle belongs to an account, so it can follow you to another phone.';
      if(inp){ inp.value=''; inp.disabled=true; }
      if(btn){ btn.disabled=true; }
      return;
    }
    if(inp){ inp.disabled=false; }
    if(btn){ btn.disabled=false; }
    if(st) st.textContent='Yours for good, on any device. Letters, numbers and underscores.';
    try{
      var p = (typeof SB!=='undefined' && SB && SB.myProfile) ? await SB.myProfile() : null;
      if(p && p.handle){
        HANDLE_MINE = p.handle;
        if(inp && !inp.value) inp.value = p.display || p.handle;
        if(st) st.textContent='You hold ' + hmShow(p.handle) + '. Change it here.';
      } else if(inp && !inp.value){
        try{ inp.value = (S && S.name) || ''; }catch(_){}
      }
    }catch(_){}
  }catch(_){}
}
function closeHandle(){ try{ document.getElementById('handleModal').classList.remove('open'); }catch(_){} }

function hmTyped(){
  try{
    var inp=document.getElementById('hmInput'), note=document.getElementById('hmNote');
    if(!inp||!note) return;
    var lower=(typeof SB!=='undefined'&&SB&&SB.handleNorm)?SB.handleNorm(inp.value):'';
    note.textContent = lower ? ('Will be ' + hmShow(lower)) : '';
  }catch(_){}
}

async function hmClaim(){
  try{
    var inp=document.getElementById('hmInput'), note=document.getElementById('hmNote'),
        btn=document.getElementById('hmBtn');
    if(!inp||!note) return;
    var typed=(inp.value||'').trim();
    if(!typed){ note.textContent='Type a handle first.'; return; }
    if(btn){ btn.disabled=true; }
    note.textContent='Checking…';
    var r = await SB.claimHandle(typed, { color: (S && S.color) || '' });
    if(btn){ btn.disabled=false; }
    if(r && r.ok){
      HANDLE_MINE = SB.handleNorm(typed);
      note.textContent = hmShow(HANDLE_MINE) + ' is yours.';
      try{ S.name = typed; rememberProfile(); }catch(_){}
    } else if(r && r.why==='taken'){
      note.textContent = hmShow(typed) + ' is taken — try another.';
    } else if(r && r.why==='invalid'){
      note.textContent = 'Three or more letters or numbers.';
    } else if(r && r.why==='noacct'){
      note.textContent = 'Sign in first to keep a handle.';
    } else {
      note.textContent = 'Could not reach the server. Nothing was changed.';
    }
  }catch(_){ }
}
try{ window.openHandle=openHandle; window.closeHandle=closeHandle; }catch(_){}
"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []
    if 'handleModal' in s:
        sys.exit('ABORT: already applied')

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # the sheet, beside the other modals
    sub('  <div class="modal" id="shareModal"', MODAL + '\n  <div class="modal" id="shareModal"', 'modal')

    # the menu row — matched from the file rather than reconstructed, so an
    # emoji cannot be mangled by an escape on the way in.
    import re as _re
    m = _re.search(r"^  row\('.{1,4}','How to play','rules'\);$", s, _re.M)
    if not m:
        sys.exit('ABORT row: could not find the How to play row')
    hp = m.group(0)
    sub(hp,
        "  /* Reachable for somebody who already plays: the gate screen only\n"
        "     appears at the start of a night and they scroll past it. */\n"
        "  row('@','Your handle','handle');\n" + hp, 'row')

    # the dispatcher entry FIRST — inserting the JS above `var MENU_GO={`
    # would otherwise move this anchor out from under it.
    sub("var MENU_GO={\n  rules:function(){ go('rules'); },",
        "var MENU_GO={\n  rules:function(){ go('rules'); },\n"
        "  handle:function(){ try{ openHandle(); }catch(_){} },", 'dispatch')

    # the code, above the dispatch table that reaches it
    sub('var MENU_GO={', JS + '\nvar MENU_GO={', 'js')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('handle menu applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
