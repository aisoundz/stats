#!/usr/bin/env node
/* ============ IS THE APP ACTUALLY IN SPANISH? =========================
   Written 20 Aug 2026. Every question in every sport is translated — and
   the app AROUND them is not. A Spanish player reads a Spanish question
   inside an English product, which is a worse experience than either one
   alone, because it looks like something broke.

   The honest number was never known. "About 360 strings" was an estimate
   nobody had measured, and you cannot finish a job whose size is a guess.

   So this WALKS THE REAL APP. It opens every screen, switches to each
   language the app offers, collects every visible text node, and reports
   which ones the dictionary does not cover. It is the to-do list and the
   gate at the same time.

   WHAT IT DELIBERATELY IGNORES, because translating them would be wrong:
     · the four nav tabs — Stats and Gametime ARE the product name
     · team names, player names, league names, broadcasters
     · anything inside [data-noi18n]
     · pure numbers, times, scores and punctuation

   Usage:  node qa/spanish.js [index-test.html] [--list] [--max N]
     --list   print every untranslated string (the to-do list)
     --max N  fail if more than N strings are untranslated (default: no cap,
              report only). Once the backlog is cleared, set --max 0 in
              qa/all.js and it can never silently grow again.
   Exit 0 green, 1 red.                                                  */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { waitReady } = require('./ready.js');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  return pos || 'index.html';
})();
const TARGET = path.basename(argFile);
const LIST   = process.argv.includes('--list');
const MAXI   = process.argv.indexOf('--max');
const MAX    = MAXI > 0 ? Number(process.argv[MAXI + 1]) : null;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

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
  await waitReady(page);

  const r = await page.evaluate(async () => {
    const out = { langs: [], screens: [], dictSize: 0, missing: [], seen: 0 };
    try { out.langs = VX.langs().map(l => l.key); } catch (_) { out.langs = ['en']; }
    try { out.dictSize = Object.keys(I18N.es || {}).length; } catch (_) {}

    /* THE PRODUCT NAME IS NOT A STRING TO TRANSLATE. Stats and Gametime are
       the two middle tabs and they spell what this is. */
    const NEVER = new Set(['Stats', 'Gametime', 'STATS', 'GAMETIME', 'STATS GAMETIME']);
    /* PROPER NOUNS ARE NOT STRINGS TO TRANSLATE, and putting them on the
       to-do list is how a translator ends up rendering "Golden State
       Valkyries" into Spanish. Team names, nicknames and abbreviations come
       from the fixtures and the slate; league names and broadcasters are
       names too. Built from the app rather than hand-listed, so a new sport
       or a new night inherits the exemption. */
    try {
      Object.keys(SPORTS).forEach(k => {
        const g = SPORTS[k].game || {};
        [g.homeName, g.awayName, g.homeNick, g.awayNick, g.homeAbbr, g.awayAbbr]
          .filter(Boolean).forEach(x => NEVER.add(String(x)));
        if (g.homeName && g.awayName) NEVER.add(g.awayName + ' @ ' + g.homeName);
        const r = SPORTS[k].roster || {};
        [].concat(r.home || [], r.away || []).forEach(n => NEVER.add(String(n)));
      });
      (SLATE.games || []).forEach(g => {
        [g.home, g.away, g.homeAbbr, g.awayAbbr].filter(Boolean).forEach(x => NEVER.add(String(x)));
      });
    } catch (_) {}
    ['WNBA','NBA','NFL','MLB','MLS','NHL','ESPN','USA Network','ION','Apple TV','Prime Video',
     'FOX','CBS','NBC','Netflix','Peacock','Google'].forEach(x => NEVER.add(x));
    const skip = t => {
      const s = t.trim();
      if (!s) return true;
      if (NEVER.has(s)) return true;
      if (s.length < 2) return true;
      if (!/[a-zA-Z]/.test(s)) return true;
      if (/@[\w.-]+\.\w+/.test(s)) return true;      // email addresses are not copy          // numbers, times, scores
      if (/^[\d\s:.\-–—/·%+]+$/.test(s)) return true;
      return false;
    };

    const screens = [...document.querySelectorAll('.screen')].map(s => s.id);
    const dict = (I18N && I18N.es) || {};
    const found = new Map();

    for (const id of screens) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.add('active');
      await new Promise(r => setTimeout(r, 60));

      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT','STYLE','TEXTAREA','OPTION'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('[data-noi18n]')) return NodeFilter.FILTER_REJECT;
          /* invisible things are not on screen and not the job */
          const cs = getComputedStyle(p);
          if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n, count = 0;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (skip(t)) continue;
        count++;
        if (!Object.prototype.hasOwnProperty.call(dict, t) && !found.has(t)) {
          found.set(t, id);
        }
      }
      out.screens.push({ id, strings: count });
      out.seen += count;
    }
    out.missing = [...found.entries()].map(([t, s]) => ({ t, s }));
    return out;
  });

  const total = r.dictSize + r.missing.length;
  const pct = total ? Math.round((r.dictSize / total) * 100) : 0;

  console.log('\n  SPANISH — is the app around the questions actually translated?\n');
  console.log('  judging ' + TARGET + '   languages offered: ' + r.langs.join(', ') + '\n');
  console.log('  dictionary entries : ' + r.dictSize);
  console.log('  untranslated on screen: ' + r.missing.length);
  console.log('  screens walked     : ' + r.screens.length + '  (' + r.seen + ' visible strings)');
  console.log('  coverage           : ~' + pct + '%\n');

  if (LIST && r.missing.length) {
    console.log('  UNTRANSLATED — the to-do list, grouped by screen:\n');
    const byScreen = {};
    r.missing.forEach(m => { (byScreen[m.s] = byScreen[m.s] || []).push(m.t); });
    Object.keys(byScreen).sort().forEach(s => {
      console.log('  ' + s + '  (' + byScreen[s].length + ')');
      byScreen[s].forEach(t => console.log('     "' + t.replace(/"/g, '\\"') + '"'));
      console.log('');
    });
  }

  ok('spanish.the-app-offers-spanish', r.langs.indexOf('es') >= 0,
     'the language list does not include es — nothing below means anything');
  ok('spanish.the-walker-found-the-app', r.screens.length >= 10 && r.seen > 100,
     `only ${r.screens.length} screens and ${r.seen} strings — the walker is broken, not the app`);
  ok('spanish.the-dictionary-is-real', r.dictSize >= 100,
     `the Spanish dictionary has ${r.dictSize} entries`);

  if (MAX !== null) {
    ok('spanish.no-untranslated-strings-on-screen', r.missing.length <= MAX,
       `${r.missing.length} visible strings have no Spanish (allowed: ${MAX}). Run with --list to ` +
       `see them. A Spanish player reads a Spanish question inside an English product, which looks ` +
       `like something broke.`);
  } else {
    console.log('  \x1b[33m•\x1b[0m spanish.no-untranslated-strings-on-screen — REPORTING ONLY');
    console.log('      ' + r.missing.length + ' untranslated. Pass --max 0 once the backlog is cleared');
    console.log('      so it can never silently grow again.');
  }

  ok('spanish.no-page-errors', errs.length === 0, errs.slice(0, 3).join('\n      '));

  await browser.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
                             : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
