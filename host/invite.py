#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
invite.py — YOU CAN SHARE A BRAG. YOU CANNOT HAND SOMEBODY THE ROOM.

    python3 host/invite.py index-test.html

THE GAP. openShare() has existed for weeks and it shares a RESULT CARD —
a screenshot of a score, for a group chat, after the fact. There has never
been a way to say "come play this with me, now, here is the room". 96
people have opened a room and 6 have ever scored; the product has no
mechanism at all for a person who enjoyed a night to produce a second
player. That is the whole funnel, missing.

THE LINK CARRIES THE ROOM AND THE ATTRIBUTION.

    https://statsgametime.com/?game={nightId}&src=invite

`?game=` is already how a room is opened directly — the rail uses it, and
qa/screen-copy walks every room that way. `src` is already read at boot by
TRK_SRC and stored on the telemetry document, so an invited player is
attributable the moment they arrive WITHOUT anything new being built. The
first honest answer to "does word of mouth work" comes from this line.

THREE WAYS TO SHARE, IN THE ORDER A PHONE PREFERS.
  1. navigator.share — the native sheet. On a phone this is the whole
     feature: it offers Messages, WhatsApp, whatever they actually use.
  2. clipboard.writeText — desktop, and any browser without the sheet.
  3. A prompt with the link selected. Ugly, and it always works.

Each step is tried only if the one before it is unavailable, and a user
cancelling the native sheet is NOT a failure — navigator.share rejects on
cancel, and treating that as an error would toast "could not share" at
somebody who simply changed their mind.

IT NAMES THE GAME. "Come play STATS" is an advert. "Brewers at Cubs,
4:40 PT — Game Night #49" is an invitation to a specific thing at a
specific time, which is the only kind anybody accepts. Every field is read
from the game that is actually on, never baked.

NO NEW SCREEN. It is a button beside Play and Talk trash, because the
moment to invite somebody is when you are about to play, not buried in a
menu the way voice is.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

BTN = ('      <button class="btn ghost" id="landingInviteBtn" style="display:none"\n'
       '              onclick="inviteToRoom()">\U0001F4E9 Invite a friend</button>\n')

FN = r"""
/* ============ INVITE — hand somebody the room ========================
   openShare() shares a RESULT CARD: a score, after the fact, for a group
   chat. This shares the ROOM, before or during, to somebody who is not
   here yet. They are different products and only one of them can produce
   a second player. See host/invite.py.

   The link is ?game={nightId}&src=invite. Both halves already work:
   `game` is how the rail opens a room directly, and `src` is read at boot
   by TRK_SRC and written to telemetry, so an invited arrival is
   attributable without anything new being built. */
function inviteText(){
  var g = null;
  try{ g = (typeof heroGame === 'function') ? heroGame() : null; }catch(_){}
  try{ if(!g && typeof GAME !== 'undefined') g = GAME; }catch(_){}
  if(!g) return null;
  var id = String(g.nightId || '');
  if(!id) return null;

  var away = String(g.awayNick || g.awayName || g.awayAbbr || '');
  var home = String(g.homeNick || g.homeName || g.homeAbbr || '');
  var gn = ''; try{ gn = gnOf(g) || ''; }catch(_){}
  /* THE APP'S OWN FORMATTER, not a second one. tipShort() is what the
     hero and the rail already print, so an invite says the same time the
     page says. The first draft of this called tipMsOf(), which does not
     exist — inside a try, so it would have failed in silence and every
     invite would have gone out with no time in it. */
  var when = '';
  try{
    if(typeof tipShort === 'function') when = tipShort(g.tipISO) || '';
    if(!when && g.tipISO){
      var ms = Date.parse(g.tipISO);
      if(!isNaN(ms)) when = new Date(ms).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    }
  }catch(_){}

  /* A SPECIFIC THING AT A SPECIFIC TIME. "Come play STATS" is an advert;
     this is an invitation, and only one of those gets accepted. */
  var what = (away && home) ? (away + ' at ' + home) : 'tonight’s game';
  var line = 'Play along with me — ' + what
           + (when ? (' at ' + when) : '')
           + (gn ? ('. Game Night #' + gn + '.') : '.')
           /* KEEP THIS IN STEP WITH index.html. The app fixed this line and
              this generator did not, so re-applying invite.py would have put
              the false claim back: the invite points at a LIVE room, which
              has always required an account, and it was shipping to other
              people's phones saying otherwise. Practice is the half that
              needs nothing. Free is still true and is the part worth
              saying. Divergence found 3 Sept. */
           + ' Free to play — one quick sign-in for a live room.';
  var url = 'https://statsgametime.com/?game=' + encodeURIComponent(id) + '&src=invite';
  return { title: 'STATS GAMETIME', text: line, url: url, full: line + '\n' + url };
}

function inviteToRoom(){
  var v = inviteText();
  if(!v){ try{ toast('No room to invite to yet.'); }catch(_){} return; }
  try{ trk('invite_open', { room: 1 }); }catch(_){}

  /* 1. The native sheet. On a phone this IS the feature — it offers the
        apps people actually message in. A CANCEL is not a failure:
        navigator.share rejects when the user backs out, and toasting
        "could not share" at somebody who changed their mind is worse than
        saying nothing. */
  if(navigator.share){
    navigator.share({ title: v.title, text: v.text, url: v.url })
      .then(function(){ try{ trk('invite_sent', { how: 'native' }); }catch(_){} })
      .catch(function(){ /* cancelled, or unavailable — say nothing */ });
    return;
  }
  /* 2. Clipboard — desktop and anything without the sheet. */
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(v.full).then(function(){
      try{ toast('Invite copied — paste it to a friend.'); }catch(_){}
      try{ trk('invite_sent', { how: 'clipboard' }); }catch(_){}
    }).catch(function(){ invitePrompt(v); });
    return;
  }
  /* 3. Always works. */
  invitePrompt(v);
}

function invitePrompt(v){
  try{ window.prompt('Copy this and send it to a friend:', v.full); }catch(_){}
}

/* Shown only when there IS a room to invite to. A share button that
   produces a link to nothing is worse than no share button. */
function paintInvite(){
  try{
    var b = document.getElementById('landingInviteBtn');
    if(!b) return;
    b.style.display = inviteText() ? '' : 'none';
  }catch(_){}
}
"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []
    if 'landingInviteBtn' in s:
        sys.exit('ABORT: already applied')

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # the button, beside Play and Talk trash — the action cluster
    anchor = '      <button class="btn ghost" id="landingTalkBtn" style="display:none"\n'
    if s.count(anchor) != 1:
        sys.exit('ABORT button: expected 1 landingTalkBtn, found %d' % s.count(anchor))
    s = s.replace(anchor, BTN + anchor)
    done.append('button')

    # the functions, next to openShare which they are deliberately NOT part of
    sub('function openShare(){', FN + '\nfunction openShare(){', 'fn')

    # paint it wherever the landing is painted
    sub("  try{ paintYou(); }catch(_){}\n",
        "  try{ paintYou(); }catch(_){}\n  try{ paintInvite(); }catch(_){}\n", 'paint')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('invite applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
