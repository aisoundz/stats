#!/usr/bin/env node
/* ============ WATCH THE CEILING THROUGH A REAL GAME NIGHT =============
   19 Aug 2026 ended when four rooms hit a snapshot-listener ceiling around
   78. The daily read cap was never the constraint — the whole day spent
   17,308 reads, 35% of the tier, and only 21% of it had been spent when
   the rooms died. What actually ran out was CONCURRENT LISTENERS.

   Then on 20 Aug the overnight count sat flat near 100 for six hours with
   nobody playing and no host process alive, falling to 0 only when the
   last stream timed out server-side. That was a leak, not load: the
   leaderboard listener was opened and never closed, and nothing released
   anything when a tab shut. Both fixed in build ready.173.

   So tonight is the first game night since the fix, and the question is
   worth a real measurement rather than a spot check:

       how many listeners does a room actually cost, with players in it?

   Because Saturday is four rooms, and the honest way to decide that is
   listeners-per-room measured on a night that ran, not an estimate.

   Samples every 5 minutes and records three things side by side, so the
   listener count can be read against what was happening:
     · the listener count      (max-collapsed; see host/listeners.js)
     · which rooms have a live runner
     · how many seats are in each room

   Writes one line per sample to the log AND keeps a running peak, so the
   answer survives even if nobody is watching when it happens.

   Usage:  node host/listener-watch.js --until 23:30 [--every 300]
   Log:    ~/gamenight-logs/listeners-YYYY-MM-DD.log                    */

const {GoogleAuth} = require("google-auth-library");
const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const PROJECT = "stats-gametime";
const CEILING = 78, ALERT = 55;
const KEY = process.env.HOME + "/.secrets/stats-firebase-admin.json";

const argOf = (f, d) => { const i = process.argv.indexOf(f); return (i > 0 && process.argv[i+1]) ? process.argv[i+1] : d; };
const EVERY = Number(argOf("--every", 300)) * 1000;
const UNTIL = String(argOf("--until", "23:30"));

initializeApp({credential: cert(require(KEY))});
const db = getFirestore();
const auth = new GoogleAuth({keyFile: KEY, scopes:["https://www.googleapis.com/auth/cloud-platform"]});

const stamp = d => d.toLocaleDateString("en-CA", {timeZone:"America/Los_Angeles"});
const hhmm  = d => d.toLocaleTimeString("en-US", {hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/Los_Angeles"});
const LOG = path.join(process.env.HOME, "gamenight-logs", "listeners-" + stamp(new Date()) + ".log");
const say = line => { console.log(line); try{ fs.appendFileSync(LOG, line + "\n"); }catch(_){} };

/* the listener count, collapsed by MAX across the duplicate series — the
   metric returns a resource-typed series AND a legacy "__unknown__" one
   carrying identical numbers, and SUMMING them reports double. */
async function listeners(){
  const c = await auth.getClient();
  const end = new Date(), start = new Date(end.getTime() - 20*60*1000);
  const url = "https://monitoring.googleapis.com/v3/projects/" + PROJECT + "/timeSeries"
    + "?filter=" + encodeURIComponent('metric.type="firestore.googleapis.com/network/snapshot_listeners"')
    + "&interval.startTime=" + start.toISOString()
    + "&interval.endTime=" + end.toISOString()
    + "&aggregation.alignmentPeriod=300s&aggregation.perSeriesAligner=ALIGN_MAX";
  const r = await c.request({url});
  const byT = new Map();
  ((r.data && r.data.timeSeries) || []).forEach(s => (s.points||[]).forEach(p => {
    const v = Number((p.value||{}).int64Value ?? (p.value||{}).doubleValue ?? 0);
    byT.set(p.interval.endTime, Math.max(byT.get(p.interval.endTime) ?? 0, v));
  }));
  const pts = [...byT.entries()].sort((a,b) => new Date(b[0]) - new Date(a[0]));
  return pts.length ? pts[0][1] : null;
}

/* which rooms are live, and how many seats are in them */
async function rooms(){
  const date = stamp(new Date());
  let ids = [];
  try{
    const s = await db.doc("slate/" + date).get();
    ids = ((s.data()||{}).games||[]).map(g => g.nightId).filter(Boolean);
  }catch(_){}
  const out = [];
  for(const id of ids){
    let seats = 0;
    try{ seats = (await db.collection("nights").doc(id).collection("players").count().get()).data().count; }
    catch(_){ try{ seats = (await db.collection("nights").doc(id).collection("players").get()).size; }catch(_2){ seats = -1; } }
    out.push({id, seats});
  }
  return out;
}

/* THE BRACKET IS LOAD-BEARING. `pgrep -af 'host/run.js'` matches the shell
   that is running the pgrep — its own command line contains the pattern —
   so it reported exactly 1 runner with zero runners alive, and would have
   done so all night. Caught on the smoke test at 08:25, six hours before
   first pitch, by noticing a runner that could not exist yet.
   ps + grep "[h]ost" cannot match itself, because the literal text of the
   command contains "[h]ost" and never "host". */
function runners(){
  try{
    return Number(require("child_process")
      .execSync('ps -eo cmd | grep -c "[h]ost/run\\.js" || true', {encoding:"utf8"}).trim()) || 0;
  }catch(_){ return -1; }
}

let peak = {v:-1, at:"", why:""};

(async () => {
  say("");
  say("=== LISTENER WATCH · " + stamp(new Date()) + " · build ready.173 (first game night since the leak fix)");
  say("=== ceiling ~" + CEILING + " · alert at " + ALERT + " · sampling every " + (EVERY/1000) + "s until " + UNTIL);
  say("");
  say("   time   listeners  runners  seats per room");
  say("   -----  ---------  -------  --------------");

  for(;;){
    const now = new Date();
    if(hhmm(now) >= UNTIL){ break; }
    let n = null, rs = [], rn = -1;
    try{ n = await listeners(); }catch(e){ say("   " + hhmm(now) + "   metric error: " + (e.message||e)); }
    try{ rs = await rooms(); }catch(_){}
    rn = runners();

    const seats = rs.map(r => r.id.replace(/^slate-\d{4}-\d{2}-\d{2}-/, "") + "=" + r.seats).join("  ") || "(no rooms)";
    const total = rs.reduce((a,r) => a + Math.max(0, r.seats), 0);
    const flag = n === null ? "" : n >= CEILING ? "   ← AT THE WALL" : n >= ALERT ? "   ← alerting" : "";
    say("   " + hhmm(now) + "   " + String(n === null ? "?" : n).padStart(6) + "     " +
        String(rn).padStart(4) + "     " + seats + flag);

    if(n !== null && n > peak.v){ peak = {v:n, at:hhmm(now), why:rn + " runner(s), " + total + " seat(s)"}; }
    await new Promise(r => setTimeout(r, EVERY));
  }

  say("");
  say("=== PEAK " + peak.v + " at " + peak.at + " with " + peak.why);
  say("=== headroom to the ~" + CEILING + " wall at peak: " + (CEILING - peak.v));
  say("=== watch ended " + hhmm(new Date()));
  process.exit(0);
})().catch(e => { say("listener-watch died: " + (e.message||e)); process.exit(1); });
