/* ============ ONE PLACE THAT KNOWS WHEN THE APP IS UP =================
   Written 20 Aug 2026, after three false reds in one morning.

   Nineteen browser suites across twelve files each waited a hardcoded
   number of milliseconds after load and then reached for app globals:
   900, 1200, 1400, 1500, 1800, 2200, 2500, 4000, 6000. Nineteen different
   guesses at a single fact, every one of them a bet that boot had
   finished. On a loaded machine the bet loses — qa/switch.js went red on a
   real check twice and qa/devices.js crashed, all three while another gate
   was running, and each time the first instinct was to hunt for a product
   defect that was not there.

   The app now states it (window.STATS_READY, the last statement in its
   last script block). This is the one place that waits on the statement.

   waitReady() FAILS LOUDLY rather than continuing. A helper that swallows
   the timeout and lets the suite carry on would reproduce the original bug
   exactly: the checks would run against a half-built page and blame the
   product. If this throws, the message says so in those words.            */

async function waitReady(page, opts) {
  const o = opts || {};
  const ms = o.timeout || 30000;
  try {
    await page.waitForFunction(() => window.STATS_READY === true, { timeout: ms });
  } catch (e) {
    const seen = await page.evaluate(() => ({
      ready: (typeof window.STATS_READY !== 'undefined') ? window.STATS_READY : '(never set)',
      hasSports: (typeof window.SPORTS !== 'undefined'),
      readyState: document.readyState,
      url: location.href
    })).catch(() => null);
    throw new Error(
      'the app never reported ready within ' + ms + 'ms — this is a BOOT failure, not a check ' +
      'failure, so do not go looking for a defect in the feature under test. Saw: ' +
      JSON.stringify(seen));
  }
  /* An optional settle for suites that need a specific thing beyond boot —
     a rail that depends on Firestore, say. Named, so it is never mistaken
     for the boot guess this file exists to delete. */
  if (o.thenWaitFor) await page.waitForFunction(o.thenWaitFor, { timeout: o.thenTimeout || 20000 });
  return true;
}

module.exports = { waitReady };
