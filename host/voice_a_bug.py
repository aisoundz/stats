#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
voice_a_bug.py — "A RUN" MEANT "NONE", AND IT SETTLED INSTANTLY.

    python3 host/voice_a_bug.py index-test.html

MEASURED, against tonight's dominant baseball option set
["None","One","Two","Three or more"] — six of the nine innings:

    "a run"    -> picked None            "a few"    -> picked None
    "a couple" -> picked None            "for sure" -> picked Three or more

"A run" is the most natural thing an English speaker says about an inning,
and it selected the exact opposite. In practice it settles at once with no
read-back: confidently wrong and unrecoverable, which is the one failure
mode this product has ruled out in writing.

THE MECHANISM, AND THE DESIGN ALREADY SAW IT COMING.

    if(ntoks.length<=2 && nm[ntoks[0]]!=null){ ... }

with a comment reading "Homophones ('to','for') still only count on a
short utterance, so a sentence with 'for' in it is never an answer." The
guard is there. It is simply too loose: "a run" IS a short utterance —
two tokens — so it passes, and 'a' maps to 0.

'a' IS IN BOTH TABLES AT ONCE. NUM has 'a':0 as the LETTER A, beside
'b','c','d'. STOP has 'a' as the article, because STOP exists precisely to
say "this word carries no meaning here". The word matcher honours STOP and
drops it; the position fallback never asked. A word cannot be meaningless
in one half of the matcher and decisive in the other.

TWO CHANGES, EACH JUSTIFIED ON ITS OWN:

  1. 'a' leaves NUM, in English and in Spanish. The instruction the app
     actually speaks is "say the NUMBER of your answer" — options are
     never lettered on screen — so the letter-A reading was theoretical
     while the article reading is what people say. In Spanish "a" is a
     preposition and the case is worse.

  2. A token that is ALSO A STOP WORD can never resolve as a number, and
     the remaining ambiguous homophones ('to','for') resolve only on a
     ONE-token utterance. 'two'/'too', 'four'/'fore' are untouched: they
     are not English function words and carry no other meaning.

WHAT IS DELIBERATELY NOT CHANGED. Refusals stay refusals. "zero",
"nothing", "no runs" still resolve to nothing and the app says so — a
refusal costs a repeat, a wrong pick costs the question. Synonyms are a
separate, additive change and are not smuggled into a correctness fix.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # ---- 1. 'a' leaves NUM, both languages ---------------------------
    sub("      NUM:{ 'one':0,'won':0,'first':0,'1':0,'a':0,",
        "      /* 'a' IS GONE. It was here as the letter A, beside b/c/d — and it\n"
        "         is also in STOP, as the article, because STOP means \"this word\n"
        "         carries no meaning here\". A word cannot be meaningless to the\n"
        "         word matcher and decisive to the position fallback. Measured:\n"
        "         \"a run\" picked None on [None, One, Two, Three or more]. */\n"
        "      NUM:{ 'one':0,'won':0,'first':0,'1':0,",
        'num-en')

    sub("      NUM:{ 'uno':0,'un':0,'una':0,'primero':0,'primera':0,'primer':0,'1':0,'a':0,",
        "      /* Same removal, and worse here: in Spanish \"a\" is a preposition. */\n"
        "      NUM:{ 'uno':0,'un':0,'una':0,'primero':0,'primera':0,'primer':0,'1':0,",
        'num-es')

    # ---- 2. a stop word can never be a number ------------------------
    sub("""    var stripped=lead;
    var ntoks=stripped.split(' ');
    var nm=NUMM();
    if(ntoks.length<=2 && nm[ntoks[0]]!=null){
      var idx=nm[ntoks[0]];
      if(idx<opts.length) return {kind:'pick', i:idx};
    }""",
        """    var stripped=lead;
    var ntoks=stripped.split(' ');
    var nm=NUMM();
    /* ============ A STOP WORD IS NEVER A NUMBER ======================
       The <=2 guard above was written for exactly this and is too loose:
       "a run" is two tokens, so 'a' reached the table and picked option
       one. STOP already lists the words that carry no meaning here, and
       the word matcher already honours it — this makes the position
       fallback honour the same list, so the two halves of the matcher can
       no longer disagree about whether a word means anything.

       The remaining ambiguous homophones resolve on a ONE-token utterance
       only. "for sure" is not an answer; "for" alone still is, because a
       recogniser really does return it for "four". 'two'/'too',
       'three'/'tree', 'four'/'fore' are untouched — none of them is an
       English function word. */
    var _stop = V.L().STOP || [];
    var _amb  = { 'to':1, 'for':1, 'too':1 };
    var _t0   = ntoks[0];
    /* THE GUARD APPLIES TO PHRASES, NOT TO SINGLE WORDS. A lone "to" is a
       recogniser hearing "two" — nobody offers the preposition as a whole
       answer — so refusing it costs a repeat for nothing. The damage was
       always in the TWO-token case: "a run", "a few", "for sure". So a
       one-word utterance keeps the old permissive path, and anything
       longer must not lead with a stop word or an ambiguous homophone. */
    var _numOk = nm[_t0] != null
              && (ntoks.length === 1 || (_stop.indexOf(_t0) < 0 && !_amb[_t0]));
    if(ntoks.length<=2 && _numOk){
      var idx=nm[_t0];
      if(idx<opts.length) return {kind:'pick', i:idx};
    }""",
        'guard')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('voice "a" bug patched in %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
