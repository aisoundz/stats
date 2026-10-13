# Security headers on statsgametime.com

Status as of 2026-10-13. Agent Wisdom reports seven warnings on this site.
Three are fixed here. Three are not available on this host. One is drafted
below and deliberately not enabled yet.

## Fixed

| | |
|---|---|
| Referrer policy | `<meta name="referrer">` in `index.html`. Safe to set: it only limits what this page leaks in the `Referer` header and cannot block a request. |
| security.txt | `.well-known/security.txt`, at the path RFC 9116 specifies, with an `Expires` field. |
| Secret scanning | A free TruffleHog workflow, since GitHub's own secret scanning needs a paid plan on a private repo. |

`.nojekyll` was already in the root, which is what keeps `.well-known` from
being silently dropped: Jekyll excludes every path beginning with a dot or an
underscore, so without it the directory never reaches the built site and the
file 404s while the repository looks correct.

## Not available on GitHub Pages

`Strict-Transport-Security`, `X-Content-Type-Options` and `X-Frame-Options`
are header-only. Pages cannot set response headers at all, and browsers ignore
all three in a `<meta http-equiv>`. The CSP spec also requires a
meta-delivered policy to ignore `frame-ancestors`, so there is no meta route
to clickjacking protection either.

Writing those tags in anyway would turn the Agent Wisdom board green while the
browser ignored every one of them, which is worse than the warning.

**The free route, if you want these three:** put Cloudflare in front of
statsgametime.com and add the headers with Transform Rules. That is on the
free tier, the site stays on GitHub Pages, and nothing about this repository
changes.

## The CSP, drafted and NOT enabled

This is the one that can break a game night, which is why it is sitting here
rather than in `index.html`.

The risk is specific. Firebase is loaded as a **dynamic ES module import**
from `https://www.gstatic.com/firebasejs/10.12.2`, and Firestore then talks to
Google over WebChannel on origins that are not written down anywhere in this
repository. A `connect-src` that is missing one of them does not throw a
visible error on load. It fails at the moment the backend is first used,
which is mid-game, in front of players, and it looks exactly like an outage.

There is no safe way to test it from here either: `Content-Security-Policy-
Report-Only` is header-only, so on GitHub Pages there is no report-only mode
to roll out behind.

The drafted policy, from an inventory of what `index.html` actually loads:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.gstatic.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self'
    https://www.gstatic.com
    https://firestore.googleapis.com
    https://firebaseinstallations.googleapis.com
    https://identitytoolkit.googleapis.com
    https://securetoken.googleapis.com
    https://stats-gametime.firebaseapp.com
    https://stats-gametime.firebasestorage.app
    https://site.api.espn.com
    https://site.web.api.espn.com
    https://assets.mailerlite.com
    wss://*.firebaseio.com
    https://*.firebasedatabase.app;
  form-action 'self';
  base-uri 'self';
  object-src 'none'">
```

Where each origin comes from:

- `www.gstatic.com` — the Firebase SDK module, in both `script-src` and
  `connect-src` (the dynamic import is a fetch as well as a script load).
- The five `googleapis.com` hosts and the two `stats-gametime.*` hosts —
  Firestore, installations, auth and storage.
- `site.api.espn.com`, `site.web.api.espn.com` — live scores.
- `assets.mailerlite.com` — the signup hand-off POST.
- `wss://*.firebaseio.com` and `https://*.firebasedatabase.app` — included
  because Firestore falls back to long polling and Realtime Database may be in
  use on paths not exercised in a read of the source. Harmless if unused.

`'unsafe-inline'` stays in `script-src` because every script on the page is
inline. Removing it means moving them into files first.

### How to enable it safely

1. Paste the tag into `<head>` in `index.html`, right after the charset meta.
2. Open the site on a laptop with the browser console visible, **not during a
   game night**, and run a full round end to end: start a game, submit an
   answer, let a score update, and use the signup form.
3. Watch the console for `Refused to connect to …` or `Refused to load the
   script …`. Each one names the exact origin it blocked.
4. Add any named origin to the matching directive and repeat until the console
   is clean through a whole round.
5. Then commit.

If a line appears and you would rather not debug it, delete the meta tag. The
site returns to exactly its current behaviour immediately: the policy is
inert markup, so removing it is a complete rollback with no other effect.
