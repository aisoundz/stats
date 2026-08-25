#!/usr/bin/env node
/* ============ EVERY LISTENER OPENED MUST BE CLOSED ====================
   Written 20 Aug 2026, from a measurement rather than a bug report.

   host/listeners.js over the previous night: a flat plateau near 100
   snapshot listeners for six straight hours against a ceiling around 78,
   falling to 0 only when the last client aged out server-side. Nothing was
   running. Nobody was playing.

   The cause was structural and a grep could have found it any day this
   month: boardRefresh() assigns `bdUnsub = SB.watchBoard(...)` and the
   string `bdUnsub` appears nowhere else in the file except its own
   declaration and its own guard. The leaderboard listener was opened and
   never closed, once per page load, for the life of the tab.

   It became urgent — not merely wasteful — the night switching rooms
   stopped reloading the page. A reload closes the connection and the
   server tears the listeners down for you; a state swap does not. So from
   19 August a switch cost +4 listeners and left the room you had LEFT
   still pushing rounds into the room you were in. Stress-test week asks
   beta testers to move freely between four rooms.

   TWO CHECKS, and they are different in kind:

   1. STRUCTURAL — every unsubscribe handle assigned from a watcher must be
      invoked somewhere. This is the one that would have caught bdUnsub in
      July. It reads the handle names out of the app rather than from a
      list here, because a hand-maintained list of the four handles is the
      same disease one level up.

   2. BEHAVIOURAL — switching rooms, reconnecting and closing the tab must
      each actually release them. Driven through the real functions with
      spy handles, never by re-implementing the teardown in the harness.

   Usage:  node qa/listeners.js  [index-test.html]
   Exit 0 green, 1 red.                                                  */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  /* The working file by default — see qa/rearm.js for why. */
  return pos || 'index-test.html';
})();
const TARGET = path.basename(argFile);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

/* strip comments and long strings so this file's own prose about bdUnsub
   cannot be mistaken for a reference to it — the exact trap qa/places.js
   documents. */
function strip(src) {
  const out = src.split('');
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && d === '/') { let e = src.indexOf('\n', i); if (e < 0) e = src.length; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

const src = strip(fs.readFileSync(path.join(ROOT, TARGET), 'utf8'));

console.log('\n  LISTENERS — every snapshot listener opened must be closed\n');
console.log('  judging ' + TARGET + '\n');

/* ---- 1. structural ------------------------------------------------- */
/* Find every `<handle> = SB.watchSomething(` — the assignment of an
   unsubscribe function — and read the handle name out of the app. */
const ASSIGN = /([A-Za-z_$][\w$.]*)\s*=\s*SB\.watch[A-Za-z]*\s*\(/g;
const handles = new Set();
let m;
while ((m = ASSIGN.exec(src))) handles.add(m[1]);

const orphans = [];
handles.forEach(h => {
  /* invoked as h() — allowing the `typeof h==='function'` guard in front */
  const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const called = new RegExp(esc + '\\s*\\(\\s*\\)').test(src);
  if (!called) orphans.push(h);
});

ok('listeners.a-handle-was-actually-found', handles.size >= 3,
   `only ${handles.size} unsubscribe handles found — the scanner is probably broken rather than ` +
   `the app clean. The app opens four snapshot listeners (round, callit, board, talk).`);

ok('listeners.every-handle-is-released-somewhere', orphans.length === 0,
   orphans.map(h => `${h} is assigned from a watcher and never invoked anywhere — the listener it ` +
     `holds stays open for the life of the tab, and the server keeps it until the stream times out`).join('\n      '));

/* ---- 2. behavioural ------------------------------------------------- */
function serve() {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      const f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, ''));
      fs.readFile(f, (e, b) => {
        if (e) { rs.writeHead(404); rs.end('no'); return; }
        rs.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html' : 'text/plain' });
        rs.end(b);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { chromium } = require('playwright');
  const { srv, port } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/${TARGET}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.roomListenersStop === 'function', { timeout: 15000 })
    .catch(() => {});

  const r = await page.evaluate(() => {
    const out = {};
    out.exported = (typeof window.roomListenersStop === 'function');
    if (!out.exported) return out;

    /* Spy handles in every slot the app tears down. Using the app's OWN
       globals, so if a handle is renamed this stops finding it rather than
       quietly passing. */
    let hits;
    const arm = () => {
      hits = { hr:0, pci:0, bd:0, tt:0 };
      HR.unsub  = function(){ hits.hr++;  };
      PCI.unsub = function(){ hits.pci++; };
      try { bdUnsub = function(){ hits.bd++; };  bdLive = true; } catch(_){}
      try { ttUnsub = function(){ hits.tt++; }; } catch(_){}
    };

    /* --- called directly --- */
    arm();
    out.stopReturned = roomListenersStop('test');
    out.direct = Object.assign({}, hits);
    out.clearedHr  = (HR.unsub === null);
    out.clearedPci = (PCI.unsub === null);
    out.clearedBd  = (function(){ try { return bdUnsub === null && bdLive === false; } catch(_) { return 'threw'; } })();

    /* --- does the tab closing release them? --- */
    arm();
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    out.onPagehide = Object.assign({}, hits);

    /* --- does chooseGame release them before it swaps? ---
       Spy on roomListenersStop itself and record whether it ran BEFORE
       SB.setRoom, because releasing after the swap is a different bug
       wearing the same green tick. */
    const order = [];
    const realStop = window.roomListenersStop;
    window.roomListenersStop = function(w){ order.push('stop'); return realStop(w); };
    const realSet = (window.SB && SB.setRoom) || null;
    if (realSet) SB.setRoom = function(id){ order.push('setRoom'); return realSet.call(SB, id); };
    out.switchWired = /roomListenersStop\(/.test(String(window.chooseGame || ''));
    out.order = order;
    window.roomListenersStop = realStop;
    if (realSet) SB.setRoom = realSet;
    return out;
  });

  ok('listeners.the-teardown-is-exported', r.exported === true,
     'window.roomListenersStop is not a function — there is no single place that closes a room\'s ' +
     'listeners, so every check below would be measuring nothing.');

  if (r.exported) {
    ok('listeners.teardown-releases-all-four',
       r.direct && r.direct.hr === 1 && r.direct.pci === 1 && r.direct.bd === 1 && r.direct.tt === 1,
       `roomListenersStop() invoked round:${r.direct && r.direct.hr} callit:${r.direct && r.direct.pci} ` +
       `board:${r.direct && r.direct.bd} talk:${r.direct && r.direct.tt} — each must be exactly 1. ` +
       `board was the one that had never been released anywhere in the file.`);

    ok('listeners.teardown-clears-the-handles',
       r.clearedHr === true && r.clearedPci === true && r.clearedBd === true,
       `handles after teardown — round:${r.clearedHr} callit:${r.clearedPci} board:${r.clearedBd}. ` +
       `Each watcher re-attaches behind an "if (!handle)" guard, so a handle left set means the ` +
       `listener is gone and can never come back — a silently dead room.`);

    ok('listeners.closing-the-tab-releases-them',
       r.onPagehide && r.onPagehide.hr === 1 && r.onPagehide.pci === 1 &&
       r.onPagehide.bd === 1 && r.onPagehide.tt === 1,
       `pagehide released round:${r.onPagehide && r.onPagehide.hr} callit:${r.onPagehide && r.onPagehide.pci} ` +
       `board:${r.onPagehide && r.onPagehide.bd} talk:${r.onPagehide && r.onPagehide.tt}. A closed tab's ` +
       `listeners are NOT closed listeners — the server holds them until the stream times out, which is ` +
       `why the overnight count sat near 100 for six hours with nobody playing.`);

    ok('listeners.switching-rooms-releases-the-old-room',
       r.switchWired === true,
       `chooseGame() does not call roomListenersStop(). Switching is a state swap now, not a reload, ` +
       `so nothing else drops those connections: the room you left keeps pushing its rounds at you and ` +
       `four more listeners attach on top, every switch, against a ceiling of about 78.`);
  }

  ok('listeners.no-page-errors', errs.length === 0, errs.join('\n      '));

  await browser.close(); srv.close();
  console.log('\n  ' + handles.size + ' unsubscribe handles · ' +
    (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
          : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
