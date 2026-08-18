#!/usr/bin/env python3
"""Make the night config sport-generic.

THE BUG (B39). `GAME`, `roster` and `preds` at the top of the sport block are
already the sport-neutral bindings -- they ARE the active sport's objects.
hydrateNight() writes BB_GAME / BB_ROSTER / BB_PREDS / BB_GROUPS instead.
For basketball those are the same objects, so it has always worked and could
never have shown the bug. For every other league it means the schedule-in-the
database path writes into basketball and leaves that sport untouched: a
baseball night would need a code deploy, exactly the thing schedule/{nightId}
was built to end.

Two names for one fact, and hydration picked the one that names a sport.
"""
import re, sys, io

F = '/home/higherthan7/stats/index.html'
s = io.open(F, encoding='utf-8').read()
orig = s
def sub1(pat, rep, why, flags=0):
    global s
    new, n = re.subn(pat, rep, s, count=1, flags=flags)
    assert n == 1, 'NO MATCH: ' + why
    s = new

# ---- 1. every sport gets a roster object and groups that point INTO it ----
sub1(
 r'\nconst SPORTS=\{',
 '''
/* ============ EVERY SPORT GETS A ROSTER, EVEN THE EMPTY ONES =========
   Basketball built BB_ROSTER and BB_GROUPS by hand because its pick sheet
   names players. The other four sports had `roster:null`, which meant
   hydrateNight() had nowhere to put a roster -- so a published night for
   those leagues could never carry one, and their banks could never ask
   "who leads this category tonight".

   An EMPTY roster is a valid roster. It means this sheet picks teams, not
   people. What matters is that the shape is the same everywhere, so one
   hydration path serves every league.

   `groups` holds references to the very arrays in `roster`, so hydration
   splices those arrays and never reassigns them -- B26's lesson, kept. */
function sportRoster(g){
  var r = {home:[], away:[]};
  r.groups = [{ab:g.homeAbbr, name:g.homeName, names:r.home},
              {ab:g.awayAbbr, name:g.awayName, names:r.away}];
  return r;
}
const SC_ROSTER=sportRoster(SC_GAME), BA_ROSTER=sportRoster(BA_GAME),
      FO_ROSTER=sportRoster(FO_GAME), HO_ROSTER=sportRoster(HO_GAME);

const SPORTS={''', 'SPORTS literal opening')

# ---- 2. wire roster/groups/landingFromGame into each sport entry ----
sub1(r'game:BB_GAME, roster:BB_ROSTER, preds:BB_PREDS,',
     'game:BB_GAME, roster:BB_ROSTER, groups:BB_GROUPS, landingFromGame:true, preds:BB_PREDS,',
     'basketball entry')
# soccer keeps its tournament landing line -- no landingFromGame
sub1(r'game:SC_GAME, roster:null, preds:SC_PREDS,',
     'game:SC_GAME, roster:SC_ROSTER, groups:SC_ROSTER.groups, preds:SC_PREDS,',
     'soccer entry')
for ab, nm in (('BA','baseball'), ('FO','football'), ('HO','hockey')):
    sub1(r'game:%s_GAME, roster:null, preds:%s_PREDS,' % (ab, ab),
         'game:{0}_GAME, roster:{0}_ROSTER, groups:{0}_ROSTER.groups, '
         'landingFromGame:true, preds:{0}_PREDS,'.format(ab),
         nm + ' entry')

# ---- 3. hydrateNight stops naming a sport ----
old_hydrate = re.search(
    r'function hydrateNight\(cfg\)\{.*?\n\}\n', s, re.S)
assert old_hydrate, 'NO MATCH: hydrateNight body'
new_hydrate = '''function hydrateNight(cfg){
  if(!cfg || typeof cfg !== 'object') return false;
  var g = cfg.game, r = cfg.roster, p = cfg.preds;
  /* Refuse a config that is not a whole night. A half-applied night is
     precisely B26 with a network in the middle. */
  if(!g || !g.nightId || !g.espnEvent) return false;
  if(!Array.isArray(p) || !p.length) return false;

  /* B39-a: THE NIGHT NAMES ITS SPORT, OR IT DOES NOT TRAVEL.
     The sport comes from the URL and the night comes from the database --
     two copies of one fact, which is how this product breaks. A config
     that names a different sport than the page is showing is refused
     rather than half-applied over the wrong league. Older configs carry
     no `sport` and are accepted as before. */
  if(g.sport && String(g.sport) !== SPORT.key){
    try{ console.error('published config is for '+g.sport+', this page is '+SPORT.key+' — keeping the built-in night'); }catch(_){}
    return false;
  }

  /* B39-b: A ROSTER IS REQUIRED ONLY WHERE THE SHEET NAMES PEOPLE.
     Basketball picks players, so a rosterless basketball night is broken
     and must be refused. Baseball's sheet picks teams and outcomes, so
     demanding a roster there would refuse every valid baseball night --
     which is what the old unconditional check did. */
  var picksPeople = !!(roster && ((roster.home||[]).length || (roster.away||[]).length));
  if(picksPeople && (!r || !(r.home||[]).length || !(r.away||[]).length)) return false;

  try{
    /* 1. the matchup — fill the object, never rebind it.
          GAME is the ACTIVE sport's game object. Writing BB_GAME here was
          right for basketball by accident and wrong for everything else. */
    Object.keys(g).forEach(function(k){ GAME[k] = g[k]; });

    /* 2. the rosters — SPLICE, do not reassign. `groups` holds references
          to these very arrays, so replacing them would leave the pick
          sheet pointing at the old ones. */
    if(r && roster){
      if(Array.isArray(r.home)){ roster.home.length = 0; Array.prototype.push.apply(roster.home, r.home); }
      if(Array.isArray(r.away)){ roster.away.length = 0; Array.prototype.push.apply(roster.away, r.away); }
    }

    /* 3. groups captured abbreviations and names as VALUES at load. */
    try{
      var GR = SPORT.groups;
      if(GR && GR.length >= 2){
        GR[0].ab = GAME.homeAbbr; GR[0].name = GAME.homeName;
        GR[1].ab = GAME.awayAbbr; GR[1].name = GAME.awayName;
      }
    }catch(_){}

    /* 4. the pick sheet — each entry's `opts` is a NEW array built at load
          from the old roster, so it has to be rebuilt, not just refreshed. */
    preds.length = 0;
    p.forEach(function(q){
      var copy = {};
      Object.keys(q).forEach(function(k){ copy[k] = q[k]; });
      preds.push(copy);
    });

    /* 5. the landing line is a template string baked at load — but only
          for the sports whose landing line IS the matchup. Soccer's is a
          tournament window, and rebuilding it from a placeholder fixture
          would replace something true with something wrong. */
    try{
      if(SPORT.landingFromGame && GAME.awayName && GAME.homeName){
        SPORT.landing =
          '<b style="color:var(--ink)">' + GAME.awayName + ' @ ' + GAME.homeName + '</b>';
      }
    }catch(_){}

    try{ window.GAME = GAME; }catch(_){}
    NIGHT_CFG_SOURCE = 'database';
    return true;
  }catch(e){
    try{ console.error('hydrateNight failed, keeping the built-in night:', e); }catch(_){}
    return false;
  }
}
'''
s = s[:old_hydrate.start()] + new_hydrate + s[old_hydrate.end():]

# ---- 4. the two remaining basketball names in generic paths ----
sub1(r"trk\('night_cfg', \{source:NIGHT_CFG_SOURCE, night:BB_GAME\.nightId\}\)",
     "trk('night_cfg', {source:NIGHT_CFG_SOURCE, night:GAME.nightId})",
     'repaintAfterHydrate trk')
sub1(r'if\(!id\) id = BB_GAME\.nightId;',
     'if(!id) id = GAME.nightId;',
     'loadNightConfig fallback id')

# ---- 5. the in-game field leader reads the ACTIVE sport's roster ----
sub1(r'var field=\[\]\.concat\(BB_ROSTER\.home\|\|\[\], BB_ROSTER\.away\|\|\[\]\);',
     'var field=[].concat((roster&&roster.home)||[], (roster&&roster.away)||[]);',
     'field-leader concat')

assert s != orig, 'nothing changed'
io.open(F, 'w', encoding='utf-8').write(s)
print('patched OK')
