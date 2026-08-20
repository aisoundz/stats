#!/usr/bin/env node
/* ============ HOW MANY SNAPSHOT LISTENERS ARE OPEN RIGHT NOW ==========
   The constraint that ended 19 August was NOT the daily read quota — the
   whole day spent 17,308 reads, 35% of the tier, and only 21% of it had
   been spent when the rooms died. A daily cap also cannot FLAP, and the
   wall flapped: it recovered for five minutes and failed again. What was
   actually exhausted is CONCURRENT SNAPSHOT LISTENERS, whose ceiling is
   around 75–80 on this project.

   So this is the number that decides how many rooms a Saturday can have,
   and until now there was no way to ask for it except by hand.

   Usage:
     node host/listeners.js              last 3h, 5-minute buckets
     node host/listeners.js --hours 13   a longer window
     node host/listeners.js --now        just the latest number, for scripts

   Prints newest first. Exit 0 always unless the API call itself fails —
   a high number is a finding to read, not a command to fail.            */

const {GoogleAuth} = require("google-auth-library");
const PROJECT = "stats-gametime";
const CEILING = 78;      // observed wall; the alert policy fires at 55
const ALERT   = 55;

const argN = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return (i > 0 && process.argv[i+1]) ? Number(process.argv[i+1]) : dflt;
};
const HOURS   = argN("--hours", 3);
const NOW_ONLY = process.argv.includes("--now");

(async () => {
  const auth = new GoogleAuth({ keyFile: process.env.HOME+"/.secrets/stats-firebase-admin.json",
                                scopes:["https://www.googleapis.com/auth/cloud-platform"] });
  const c = await auth.getClient();
  const end = new Date();
  const start = new Date(end.getTime() - HOURS*3600*1000);
  const url = "https://monitoring.googleapis.com/v3/projects/" + PROJECT + "/timeSeries"
    + "?filter=" + encodeURIComponent('metric.type="firestore.googleapis.com/network/snapshot_listeners"')
    + "&interval.startTime=" + start.toISOString()
    + "&interval.endTime="   + end.toISOString()
    + "&aggregation.alignmentPeriod=300s"
    + "&aggregation.perSeriesAligner=ALIGN_MAX";
  /* NO crossSeriesReducer, AND THE REASON MATTERS.
     This metric comes back as TWO series carrying identical numbers: the
     resource-typed one (database_id "(default)", location nam5) and a
     legacy duplicate whose labels are literally "__unknown__". They are
     one count reported twice, not two counts to add.

     REDUCE_SUM here would therefore report 206 where the truth is 103 —
     and this is the number that decides how many rooms a Saturday can
     have. A doubled ceiling reads as "we are already over the wall with
     nobody connected", which would have cancelled rooms that were fine.
     So: collapse by timestamp taking the MAX, never the sum. */

  const r = await c.request({url});
  const series = (r.data && r.data.timeSeries) || [];
  const nSeries = series.length;
  const byT = new Map();
  series.forEach(s => (s.points||[]).forEach(p => {
    const v = Number((p.value||{}).int64Value ?? (p.value||{}).doubleValue ?? 0);
    const k = p.interval.endTime;
    byT.set(k, Math.max(byT.get(k) ?? 0, v));
  }));
  const pts = [...byT.entries()].map(([k,v]) => ({ t: new Date(k), v }))
                                .sort((a,b) => b.t - a.t);

  if (!pts.length) { console.log("no data points in the last " + HOURS + "h"); process.exit(0); }
  if (NOW_ONLY) { console.log(pts[0].v); process.exit(0); }

  const hhmm = d => d.toLocaleTimeString("en-US",
    {hour:"2-digit", minute:"2-digit", hour12:false, timeZone:"America/Los_Angeles"});
  const peak = pts.reduce((m,p) => p.v > m.v ? p : m, pts[0]);

  console.log("\n  SNAPSHOT LISTENERS — last " + HOURS + "h, 5-min buckets, newest first");
  console.log("  alert fires at " + ALERT + " · the wall that ended 19 Aug was about " + CEILING + "\n");
  pts.forEach(p => {
    const bar = "█".repeat(Math.min(40, Math.round(p.v/3)));
    const flag = p.v >= CEILING ? "  ← at the wall" : p.v >= ALERT ? "  ← alerting" : "";
    console.log("   " + hhmm(p.t) + "  " + String(p.v).padStart(4) + "  " + bar + flag);
  });
  console.log("  " + nSeries + " series collapsed by max (they duplicate, they do not add)");
  console.log("\n  now " + pts[0].v + " · peak " + peak.v + " at " + hhmm(peak.t) +
              " · headroom to the wall " + (CEILING - pts[0].v) + "\n");
})().catch(e => { console.error("listeners: " + (e.message||e)); process.exit(1); });
