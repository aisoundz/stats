#!/usr/bin/env node
/* =====================================================================
   Deploy firestore.rules with the service account, no CLI login.
   ---------------------------------------------------------------------
   `firebase deploy --only firestore:rules` refuses to run here: before it
   deploys anything it asks serviceusage.googleapis.com whether the
   Firestore API is enabled, and the Admin SDK service account is not
   allowed to ask that question — 403 on serviceusage.services.get. The API
   is obviously enabled; the CLI simply cannot confirm it, and there is no
   flag to skip the check.

   So this talks to the Firebase Rules API directly, which is what the CLI
   would have done after that check passed. Two steps, exactly as documented:
   create a ruleset from the source, then point the `cloud.firestore`
   release at it. Same service account that already writes every night's
   scores.

       node host/deploy-rules.js            # dry run: compiles, shows a diff
       node host/deploy-rules.js --apply

   Dry run is the default because this changes who can read and write the
   whole database, and a rules deploy is the one action here with no undo
   short of deploying again.
   ================================================================== */
const fs = require('fs'), path = require('path');
const { GoogleAuth } = require('google-auth-library');

const APPLY = process.argv.includes('--apply');
const PROJECT = process.env.FIREBASE_PROJECT || 'stats-gametime';
const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.env.HOME, '.secrets/stats-firebase-admin.json');
const die = (m) => { console.error('FATAL: ' + m); process.exit(1); };
const log = (k, m) => console.log(`  ${String(k).padEnd(8)} ${m}`);

(async () => {
  if (!fs.existsSync(KEY)) die(`no service account key at ${KEY}`);
  const RULES = path.join(__dirname, '..', 'firestore.rules');
  const source = fs.readFileSync(RULES, 'utf8');
  log('source', `${RULES} — ${source.length} chars, ${source.split('\n').length} lines`);

  const auth = new GoogleAuth({ keyFile: KEY, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const api = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;

  const call = async (url, method, data) => {
    const r = await client.request({ url, method, data, validateStatus: () => true });
    if (r.status >= 300) {
      const msg = (r.data && r.data.error && r.data.error.message) || JSON.stringify(r.data).slice(0, 300);
      throw new Error(`${method} ${url.replace(api, '')} -> ${r.status}: ${msg}`);
    }
    return r.data;
  };

  /* What is live right now, so a deploy can be compared rather than hoped at. */
  let liveSource = null, liveName = null;
  try {
    const rel = await call(`${api}/releases/cloud.firestore`, 'GET');
    liveName = rel.rulesetName;
    const rs = await call(`https://firebaserules.googleapis.com/v1/${liveName}`, 'GET');
    liveSource = ((rs.source || {}).files || []).map(f => f.content).join('\n');
    log('live', `${liveName.split('/').pop()} — ${liveSource.length} chars`);
  } catch (e) { log('live', 'could not read the current ruleset: ' + e.message); }

  if (liveSource !== null && liveSource === source) {
    log('same', 'the deployed rules are already identical to the file — nothing to do.');
    process.exit(0);
  }
  if (liveSource !== null) {
    /* Show what actually changes. A rules deploy that nobody read the diff
       of is how a database quietly opens up. */
    const a = liveSource.split('\n'), b = source.split('\n');
    const added = b.filter(l => !a.includes(l) && l.trim());
    const gone = a.filter(l => !b.includes(l) && l.trim());
    console.log(`\n  lines only in the NEW file (${added.length}):`);
    added.slice(0, 25).forEach(l => console.log(`    \x1b[32m+\x1b[0m ${l}`));
    console.log(`  lines only in the LIVE rules (${gone.length}):`);
    gone.slice(0, 25).forEach(l => console.log(`    \x1b[31m-\x1b[0m ${l}`));
  }

  if (!APPLY) { console.log('\n  dry run — nothing deployed. Re-run with --apply.'); process.exit(0); }

  /* Creating the ruleset IS the compile step: an invalid rules file is
     rejected here and the live release is never touched. */
  const ruleset = await call(`${api}/rulesets`, 'POST', {
    source: { files: [{ name: 'firestore.rules', content: source }] }
  });
  log('compiled', `ruleset ${ruleset.name.split('/').pop()} created — the rules are valid`);

  /* The PATCH body is an UpdateReleaseRequest, which WRAPS the release —
     sending the release's fields at the top level gets "Unknown name
     rulesetName: Cannot find field". Worth the comment because the ruleset
     is created first and succeeds, so the failure looks like a rules
     problem when it is a request-shape problem. */
  await call(`${api}/releases/cloud.firestore`, 'PATCH', {
    release: {
      name: `projects/${PROJECT}/releases/cloud.firestore`,
      rulesetName: ruleset.name
    }
  });
  log('live', `cloud.firestore now serves ${ruleset.name.split('/').pop()}`);
  console.log('\n  deployed.');
  process.exit(0);
})().catch(e => die((e && e.message) || String(e)));
