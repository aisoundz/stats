/* =====================================================================
   THE SERVICE WORKER — the half that was missing.
   ---------------------------------------------------------------------
   The app has known how to raise an alert since long before this file
   existed. notify() fires on three things:

       🔴 Quarter 2 is live
       ✅ Quarter 2 scored
       🔥 somebody is talking

   All three worked, and none of them ever reached a phone. notify() calls
   `new Notification()`, which only runs while the PAGE is alive. Lock the
   handset, switch apps, let iOS suspend the tab, and there is no
   JavaScript left running to fire anything. On an iPhone in a Safari tab
   it is worse: window.Notification does not exist at all, so the call
   fell into its own catch and did nothing, silently, every time.

   Founder, 28 Aug: "So why do we not have notifications to our phone when
   the quarter ends?" Because a notification that needs the app awake is
   not a notification. This file is what a push has to land in.

   WHAT LIVES HERE AND WHY IT IS SMALL. A service worker is a separate
   program with no DOM and no access to the app's state. It exists to be
   woken by the push service, put a notification on the lock screen, and
   take the player to the right room when they tap it. Everything else —
   what to say, when to say it — stays with the code that knows the game.

   THREE THINGS IT MUST NOT DO, learned from every push implementation
   that has ever annoyed somebody:
     - never show an empty notification. If the payload does not parse,
       say nothing rather than "New message".
     - never open a second tab when the app is already open. Focus it.
     - never cache the app. This worker does push and nothing else; an
       offline cache here would serve a stale index.html to a live room,
       which is the worst possible bug in a product about live games.
   ================================================================== */

/* Take over as soon as we are installed rather than waiting for every
   tab to close. A player who taps "turn on alerts" should be subscribed
   on that tap, not on their next visit. */
self.addEventListener('install',  (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let d = null;
  try { d = event.data ? event.data.json() : null; } catch (_) { d = null; }
  /* NO PAYLOAD, NO NOTIFICATION. A push we cannot read is a bug on our
     side, and "New message" on somebody's lock screen teaches them to
     turn us off. */
  if (!d || !d.title) return;

  const opts = {
    body: String(d.body || ''),
    tag: String(d.tag || 'stats'),
    renotify: true,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: String(d.url || '/') },
    /* A round is open for seconds. This one should interrupt. */
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(String(d.title), opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const want = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Already open somewhere? Focus it and steer it. Opening a second tab
       on a live game is how a player ends up with two of themselves in
       one room. */
    for (const c of all) {
      if (c.url && c.url.indexOf(self.registration.scope) === 0) {
        try { await c.focus(); } catch (_) {}
        try { if ('navigate' in c) await c.navigate(want); } catch (_) {}
        return;
      }
    }
    try { await self.clients.openWindow(want); } catch (_) {}
  })());
});
