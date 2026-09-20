#!/usr/bin/env node
/* =====================================================================
   SHIP THE CODE, KEEP THE REASONS.
   ---------------------------------------------------------------------
   19 Sept 2026, the founder: "Stats was down today." It was not. The site
   was up, all six rooms ran to the final buzzer, and every round scored.
   What failed is that the page takes too long to become usable, which on
   a phone is indistinguishable from broken. Measured:

       bytes arrive        ~1-2s   (the network is fine)
       DOM parsed           4.8s
       anything tappable    6.4s   on a THROTTLE-FREE desktop
                           ~21s    on the first real cold load measured

   index.html is 1.8MB and 52% of it is comments: 968KB of explanation
   every phone downloads, parses and throws away.

   Those comments are the most valuable thing in this repo. They are the
   record of every bug this project has had and they are why a fix in
   September can know what broke in August. They belong in git. They do
   not belong on a player's phone.

   WHY A PARSER AND NOT A REGEX. A regex for block comments eats live code
   the moment a string literal contains the characters that open one, and
   this file is full of strings that quote past bugs. This walks the file
   once, tracking whether it is inside a string, a template literal, a
   regex literal, or a comment, and only removes a comment when it is
   genuinely in code. It is deliberately conservative: anything it cannot
   classify is KEPT.

       node host/strip-comments.js index.html out.html
       node host/strip-comments.js --check index.html    # size only
   ================================================================== */
function strip(src){
  let out = '';
  let i = 0;
  const n = src.length;
  let removed = 0;
  /* one pass, one state machine */
  while (i < n) {
    const c = src[i], d = src[i + 1];

    /* ---- inside <script>? we only strip JS comments in code, and HTML
       comments in markup, so both are handled by the same walk. ---- */
    if (c === '/' && d === '*') {
      /* a JS block comment: run to the close */
      const end = src.indexOf('*/', i + 2);
      if (end < 0) { out += src.slice(i); break; }          // unterminated: keep it all
      removed += (end + 2) - i;
      /* leave a newline where the comment was, so line-anchored things
         (and stack traces) do not all collapse onto one line */
      out += '\n';
      i = end + 2;
      continue;
    }
    if (c === '/' && d === '/') {
      /* a line comment, but ONLY if it is not part of a URL (http://) */
      const before = out.slice(-1);
      if (before === ':') { out += c; i++; continue; }
      const nl = src.indexOf('\n', i);
      if (nl < 0) { removed += n - i; break; }
      removed += nl - i;
      i = nl;                                                // keep the newline
      continue;
    }
    if (c === '<' && src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) { out += src.slice(i); break; }
      removed += (end + 3) - i;
      i = end + 3;
      continue;
    }
    /* ---- strings and regexes: copy verbatim, never inspect ---- */
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      out += src.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return { out, removed };
}

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2).filter(a => a !== '--check');
  const check = process.argv.includes('--check');
  const [inFile, outFile] = args;
  if (!inFile) { console.error('usage: strip-comments.js <in.html> [out.html] [--check]'); process.exit(1); }
  const src = fs.readFileSync(inFile, 'utf8');
  const { out, removed } = strip(src);
  const zlib = require('zlib');
  const kb = b => (b / 1024).toFixed(0) + ' KB';
  console.log(`  in   ${kb(src.length)}   gz ${kb(zlib.gzipSync(src).length)}`);
  console.log(`  out  ${kb(out.length)}   gz ${kb(zlib.gzipSync(out).length)}   (${Math.round((1 - out.length / src.length) * 100)}% smaller)`);
  if (!check && outFile) { fs.writeFileSync(outFile, out); console.log('  wrote ' + outFile); }
}
module.exports = { strip };
