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
/* ============ THE BACKLOG IS CLEARED, SO THE RATCHET CLOSES =========
   This defaulted to null, which means the untranslated count was PRINTED
   and never ASSERTED — the suite's own output said so: "Pass --max 0 once
   the backlog is cleared so it can never silently grow again."

   On 22 Aug the backlog reached zero, and it got there by this check
   catching two strings added the same night by the person adding them.
   That is the whole argument for closing it: coverage does not decay
   through neglect, it decays one honest new sentence at a time.

   `--max N` still works for a deliberate, temporary allowance. The
   default is now the standard. */
const MAXI   = process.argv.indexOf('--max');
const MAX    = MAXI > 0 ? Number(process.argv[MAXI + 1]) : 0;

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
  /* ?fixture=1 — hold the built-in night. Without it this suite reads
     TONIGHT'S live roster and fails at breakfast while passing at
     midnight, against identical bytes. See LOCK_FIXTURE in
     index.html. A gate whose answer depends on the hour is worse
     than a slow one. */
  await page.goto(`http://127.0.0.1:${port}/${TARGET}?fixture=1`, { waitUntil: 'domcontentloaded' });
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
    /* CFB and EPL joined this list on 2 Sept, when the schedule card
       started printing short league codes instead of "MAJOR LEAGUE
       BASEBALL" — the prose name wrapped to two lines and made every
       baseball row taller than the rest. A league code is a name, exactly
       like the six already here. */
    ['WNBA','NBA','NFL','MLB','MLS','NHL','CFB','EPL','ESPN','USA Network','ION','Apple TV','Prime Video',
     'FOX','CBS','NBC','Netflix','Peacock','Google'].forEach(x => NEVER.add(x));
    /* THE TWO-WEEK SCHEDULE IS FULL OF PROPER NOUNS TOO. NEVER was built
       from SPORTS and SLATE, which know tonight's teams and no others.
       The schedule card — invisible until 1 Sept, because its loader sat
       after a `return` and never ran — brings fourteen days of fixtures
       from six leagues, so "Boise State at Oregon" and "Major League
       Baseball" arrived on the to-do list the moment it started
       rendering. Same rule as the line above, same reason: a team is a
       name and a league is a name. Read from the page's own loaded
       schedule so a new sport inherits the exemption. */
    try {
      const S2 = (typeof SCHED !== 'undefined' && SCHED) ? SCHED : {};
      (S2.days || []).forEach(d => (d.games || []).forEach(g => {
        [g.home, g.away, g.homeAbbr, g.awayAbbr, g.leagueLabel, g.league]
          .filter(Boolean).forEach(x => NEVER.add(String(x)));
        if (g.home && g.away) NEVER.add(String(g.away) + ' at ' + String(g.home));
      }));
    } catch (_) {}
    ['Major League Baseball','college football','Premier League','major league soccer']
      .forEach(x => { NEVER.add(x); NEVER.add(x.toUpperCase()); });
    const skip = t => {
      const s = t.trim();
      if (!s) return true;
      if (NEVER.has(s)) return true;
      if (s.length < 2) return true;
      if (!/[a-zA-Z]/.test(s)) return true;
      if (/@[\w.-]+\.\w+/.test(s)) return true;      // email addresses are not copy          // numbers, times, scores
      if (/^[\d\s:.\-–—/·%+]+$/.test(s)) return true;
      /* A CLOCK IS NOT COPY. "4:40 PM PT" is a time of day: the digits are
         data and AM/PM/ET/CT/MT/PT are the zone, none of it translatable
         prose. Anchored so it cannot swallow a real sentence. */
      if (/^\d{1,2}:\d{2}\s*(AM|PM)?\s*(ET|CT|MT|PT|UTC)?$/i.test(s)) return true;
      return false;
    };

    /* ============ THE MENU IS A SCREEN AND IT IS NOT A .screen ========
       This walked `.screen` elements, which is every page of the app and
       none of its overlays. On 22 Aug six new menu labels went in and this
       suite reported 100% coverage and GREEN — a whole panel in English
       behind a check whose whole job is to find English.

       The menu is not a page, it is a sheet, so it never appeared in the
       list. Open it and give it an id the walk can see. Anything else that
       overlays the app — the share sheet, the voice check — belongs here
       too the moment it carries words. */
    try{
      if(typeof openMenu === 'function'){
        openMenu();
        await new Promise(r => setTimeout(r, 120));
        const mb = document.getElementById('menuBody') || document.getElementById('menuSheet');
        if(mb){
          /* Give it the marker the walk keys on, without making it a page. */
          const host = mb.closest('.screen') ? mb : (mb.parentElement || mb);
          host.classList.add('screen');
          if(!host.id) host.id = 's-menu';
        }
      }
    }catch(_){}
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
        /* ============ THE DICTIONARY IS NOT THE ONLY TRANSLATOR ========
           29 Aug 2026. This asked one question — "is `t` a key in the
           dictionary?" — and applyLang() answers a different one. When
           there is no exact entry it falls through to I18N_PATTERNS, the
           anchored regex list that carries a NUMBER through a sentence:
           "Question 3 of 4", "Worth 20 pts", "OUT OF 1100".

           So every string translated by a pattern was counted here as
           untranslated. It had not bitten because the patterned strings
           were not on the walked screens — until MAXPTS became per-sport
           and "OUT OF 1000" could no longer be a dictionary key, because
           the ceiling is 1100 in basketball and 1300 in baseball.

           A coverage check that does not model the thing it is measuring
           reports work that is done as work outstanding, and the fix for
           THAT is to raise --max, which quietly blinds it to the real
           gaps. Mirror applyLang() instead.

           I18N_PATTERNS.es, NOT I18N_PATTERNS[VX.lang]: this walk reads
           `I18N.es` directly and never switches the page, so VX.lang is
           still 'en' here and keying on it silently returns an empty list
           — the same silent-no-op shape as the VX.lang bug recorded in
           applyLang() itself, which turned the entire translation pass
           into a no-op that reported nothing. */
        const patterned = (() => {
          try {
            const pats = (I18N_PATTERNS && I18N_PATTERNS.es) || [];
            return pats.some(pr => pr[0].test(t));
          } catch (_) { return false; }
        })();
        if (!Object.prototype.hasOwnProperty.call(dict, t) && !patterned && !found.has(t)) {
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

  /* ============ AND THE QUESTIONS, NOT ONLY THE FURNITURE ===========
     Founder, 21 Aug, with a screenshot titled exactly that: "English
     questions in spanish section".

     The walker above covers the app's own strings and had them at 99%.
     The QUESTIONS come from TEMPLATES in admin.html and are a separate
     body of text entirely — and on that night basketball carried 19
     Spanish questions, soccer 8, and football, baseball and hockey
     carried NONE. A Spanish player picked a Spanish room and was asked,
     in English, how the opening drive ended.

     A bank that resolves is not a bank that ships. Every question a
     player can be shown must exist in both languages, or the language
     switch is a half-truth. */
  (function(){
    try{
      const fs2=require('fs'), path2=require('path');
      const admin=fs2.readFileSync(path2.join(__dirname,'..','admin.html'),'utf8');
      const cut=(a,b)=>{ const i=admin.indexOf(a), j=admin.indexOf(b,i); return (i<0||j<0)?'':admin.slice(i,j); };
      const BANKS=[['basketball','  basketball: {','  baseball: {'],
                   ['baseball',  '  baseball: {',  '  football: {'],
                   ['football',  '  football: {',  '  soccer: {'],
                   ['soccer',    '  soccer: {',    '  hockey: {']];
      const gaps=[];
      BANKS.forEach(([name,a,b])=>{
        const blk=cut(a,b); if(!blk) return;
        const q=(blk.match(/\{ t: '/g)||[]).length;
        const es=(blk.match(/t_es:/g)||[]).length;
        if(q>0 && es<q) gaps.push(name+' '+es+'/'+q);
      });
      ok('spanish.every-question-exists-in-both-languages', gaps.length===0,
         'banks with English-only questions: '+gaps.join(', ')+
         ' — a Spanish player picked a Spanish room and was asked the question in English');
    }catch(e){
      ok('spanish.every-question-exists-in-both-languages', false, 'could not read the banks: '+e.message);
    }
  })();

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
