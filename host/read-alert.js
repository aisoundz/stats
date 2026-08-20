/* ============ THE READ BUDGET, AS SOMETHING THAT SHOUTS ==============
   Written the night of 19 Aug 2026, when the free tier's 50,000 daily
   reads ran out at 16:09 — before a single room had hosted anything — and
   every runner died at once. Four rooms, a tip-off email already sent, and
   the first anyone knew was a game that never asked a question.

   The budget was a projection in a planning document. Everything else in
   this product has a check that fails loudly; this had a paragraph. So:

     60% of 50,000 reads in a rolling 24h  ->  an email, while the night
                                               is still recoverable.

   Run once. Idempotent: it looks for its own policy by name first.  */
const fs=require("fs");
const {GoogleAuth}=require("google-auth-library");

const PROJECT = "stats-gametime";
const EMAIL   = process.argv[2];
if(!EMAIL){ console.error("usage: node host/read-alert.js <email-for-alerts>"); process.exit(1); }

/* ============ RE-AIMED, 20 AUG — THE FIRST VERSION COULD NOT FIRE ====
   This watched document READS at 30,000 in a rolling 24h. Measured after
   the fact: the worst day this project has ever had is 17,308 reads, and
   the four rooms died at 16:01 on 19 Aug with 21% of the tier spent. The
   alert was never within 12,000 of firing and would not have fired on the
   night it was written for. A smoke detector in a different building.
   What actually ran out was CONCURRENT SNAPSHOT LISTENERS: 24 at 13:00,
   climbing ~+0.6/min while the database was almost idle, 77 when the
   errors began, collapsing to 3 when a process died. The same evening,
   four rooms of real gameplay with a hundred times the reads never went
   above 39. So the ceiling is around 75-80 and it is not about load. */
const LISTEN_MAX = 55;        // ~70% of the observed 75-80 ceiling
const QUOTA = 50000, PCT = 0.60, THRESHOLD = QUOTA * PCT;   // reads: kept as a secondary, cost-only signal
const P = "projects/" + PROJECT;
const POLICY_NAME = "Firestore snapshot listeners above " + LISTEN_MAX;
const CHANNEL_NAME = "STATS read-budget alert";

(async()=>{
  const auth = new GoogleAuth({ keyFile: process.env.HOME+"/.secrets/stats-firebase-admin.json",
                                scopes:["https://www.googleapis.com/auth/cloud-platform"] });
  const c = await auth.getClient();
  const api = (m,u,d) => c.request({method:m, url:"https://monitoring.googleapis.com/v3/"+u, data:d});

  /* ---- 1. the email channel, reused if it already exists ---- */
  let chan = null;
  const existing = (await api("GET", P+"/notificationChannels")).data.notificationChannels || [];
  chan = existing.find(x => x.displayName === CHANNEL_NAME);
  if(chan){ console.log("channel: reusing " + chan.name); }
  else{
    chan = (await api("POST", P+"/notificationChannels", {
      type:"email", displayName:CHANNEL_NAME,
      description:"Where the read-budget warning goes.",
      labels:{ email_address: EMAIL }, enabled:true
    })).data;
    console.log("channel: created " + chan.name + "  -> " + EMAIL);
  }

  /* ---- 2. the policy ---- */
  const policies = (await api("GET", P+"/alertPolicies")).data.alertPolicies || [];
  const already = policies.find(x => x.displayName === POLICY_NAME);
  if(already){ console.log("policy: already exists — " + already.name); process.exit(0); }

  const policy = {
    displayName: POLICY_NAME,
    combiner: "OR",
    enabled: true,
    /* A ROLLING 24 HOURS, NOT THE CALENDAR DAY. The quota itself resets at
       midnight Pacific; this window slides. So it can warn on a busy
       evening that straddles midnight and would not actually breach. That
       is the correct direction to be wrong in — a false warning costs an
       email, a missed one costs the night. */
    conditions:[{
      displayName: "reads in the last 24h above " + THRESHOLD,
      conditionThreshold:{
        filter:'metric.type="firestore.googleapis.com/network/snapshot_listeners" resource.type="firestore_instance"',
        /* A MAX over five minutes, not a sum over a day. This is a
           concurrency level, not a volume — summing it would be the
           label-versus-expression mistake that produced the first version. */
        aggregations:[{ alignmentPeriod:"300s", perSeriesAligner:"ALIGN_MAX", crossSeriesReducer:"REDUCE_MAX" }],
        comparison:"COMPARISON_GT",
        thresholdValue: LISTEN_MAX,
        duration:"0s",
        trigger:{ count:1 }
      }
    }],
    notificationChannels:[ chan.name ],
    documentation:{
      mimeType:"text/markdown",
      content:"**Concurrent Firestore snapshot listeners have passed "+LISTEN_MAX+".**\n\n"
             +"The observed ceiling is around 75-80. On 19 Aug 2026 the count climbed from 24 to 77 between 1pm and 4:15pm — while the database was almost idle — and at 77 every runner died at once, mid-game, with four rooms up.\n\n"
             +"IT IS NOT LOAD. That same evening, four rooms with real players and a hundred times the read volume never went above 39. Gameplay is cheap; something accumulates idle listeners and it has not been located.\n\n"
             +"What to check, in order:\n"
             +"1. How many browser tabs are open on the Control Room or the player app? A tab with a bound room holds listeners for as long as it is open.\n"
             +"2. Is a QA gate run in progress? The browser suites sign in to production and open real listener streams — a full run opens dozens, torn down by a hard browser close rather than a clean unlisten.\n"
             +"3. How many rooms are hosted, and is that the number you intended?\n\n"
             +"Closing tabs is the only lever that works in the moment."
             +"On 19 Aug 2026 this limit ran out at 16:09 and every game-night runner died at once, mid-game, with no warning.\n\n"
             +"What to check, in order:\n"
             +"1. How many rooms are hosted right now, and is that the number you intended?\n"
             +"2. Is the watchdog running, and at what interval? It costs about as much as a runner.\n"
             +"3. How many browser tabs are open on the Control Room or the player app? Live listeners bill per document delivered, for as long as the tab is open.\n\n"
             +"The project is on Blaze, so passing the free tier BILLS rather than stops. This is a cost signal, not an outage — but it is also the early warning that something is reading far more than a night should."
    }
  };
  const made = (await api("POST", P+"/alertPolicies", policy)).data;
  console.log("policy: created " + made.name);
  /* SAY WHAT WAS ACTUALLY CREATED. This line still read "reads > 30000"
     after the policy had been re-aimed at listeners — a success message
     describing the previous version of itself, which is the same class of
     defect as the alert it was fixing. */
  console.log("\nAlert is live: snapshot listeners > " + LISTEN_MAX + " (5-min max) -> " + EMAIL);
})().catch(e=>{
  const r=e.response&&e.response.data&&e.response.data.error;
  console.error("FAILED: " + ((e.response&&e.response.status)||"") + " " + ((r&&r.message)||e.message));
  if(r&&/permission/i.test(r.message||"")) console.error("\n-> the service account still lacks Monitoring Editor. See the grant step.");
  process.exit(1);
});
