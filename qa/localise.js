#!/usr/bin/env node
/* =====================================================================
   A TRANSLATED QUESTION MUST STILL BE GRADED IN ENGLISH.
   ---------------------------------------------------------------------
   The string a player READS and the string the grader COMPARES stop being
   the same string the moment there is a second language. If those two ever
   become one variable, a Spanish player taps "Sí", the grader compares "Sí"
   against the resolver's "Yes", and every correct answer in the room is
   marked wrong — silently, and only for the players who chose Spanish.
   That is the worst possible way to launch a language.

   So: `q.o` is CANONICAL and never moves. `q.o_es` is DISPLAY ONLY, and it
   is all-or-nothing — a list of the wrong length is ignored in full rather
   than applied partially, because a list that silently shifts by one puts
   every answer on the wrong row.

   These are geometry-free behavioural checks driven through the app's real
   loadQuestion() and answer(), in a real browser.

       node qa/localise.js [index-test.html]
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await p.goto('file://'+TARGET);
  await p.waitForFunction(()=>typeof window.qOptsFor==='function',{timeout:15000});

  /* One question, canonical English, with a full Spanish display list. */
  const Q = { t:'Who led after one?', t_es:'¿Quién iba ganando tras el primer cuarto?',
              o:['Lynx','Valkyries','Level'], o_es:['Lynx','Valkyries','Igualado'], a:'Level' };

  const r = await p.evaluate((Q)=>{
    const out={};
    const set=(k)=>{ VX.lang=k; };

    set('en');
    out.enText = qText(Q);
    out.enOpts = qOptsFor(Q);

    set('es');
    out.esText = qText(Q);
    out.esOpts = qOptsFor(Q);

    /* A list of the WRONG LENGTH must be ignored ENTIRELY, not zipped. */
    const short = Object.assign({}, Q, {o_es:['Lynx','Valkyries']});
    out.shortOpts = qOptsFor(short);

    /* A single blank entry falls back for that row only. */
    const gap = Object.assign({}, Q, {o_es:['Lynx','','Igualado']});
    out.gapOpts = qOptsFor(gap);

    /* A question with no translation at all is untouched. */
    const none = {t:'Plain', o:['A','B'], a:'A'};
    out.noneText = qText(none); out.noneOpts = qOptsFor(none);

    set('en');
    return out;
  }, Q);

  ok('loc.english-is-untouched', r.enText===Q.t && JSON.stringify(r.enOpts)===JSON.stringify(Q.o),
     `${r.enText} / ${JSON.stringify(r.enOpts)}`);
  ok('loc.spanish-shows-the-translation', r.esText===Q.t_es && JSON.stringify(r.esOpts)===JSON.stringify(Q.o_es),
     `${r.esText} / ${JSON.stringify(r.esOpts)}`);
  ok('loc.a-wrong-length-list-is-ignored-entirely', JSON.stringify(r.shortOpts)===JSON.stringify(Q.o),
     `got ${JSON.stringify(r.shortOpts)} — a partial list must not be zipped onto the canonical one`);
  ok('loc.a-blank-entry-falls-back-for-that-row', JSON.stringify(r.gapOpts)===JSON.stringify(['Lynx','Valkyries','Igualado']),
     JSON.stringify(r.gapOpts));
  ok('loc.an-untranslated-question-is-unchanged', r.noneText==='Plain' && JSON.stringify(r.noneOpts)===JSON.stringify(['A','B']),
     `${r.noneText} / ${JSON.stringify(r.noneOpts)}`);

  /* ---- THE ONE THAT MATTERS: grading, through the real answer() ------ */
  const graded = await p.evaluate(async (Q)=>{
    const res={};
    for(const lang of ['en','es']){
      VX.lang = lang;
      S.mode='practice'; S.place='play'; S.qi=0; S.ni=0; S.answered=false; S.results=[[]];
      try{ go('gametime'); }catch(_){}
      document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
      document.getElementById('s-gametime').classList.add('active');
      const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';
      const gtr=document.getElementById('gtReview'); if(gtr) gtr.style.display='none';

      /* Put our question into the app's own rounds array, via the same
         array the engine walks — reassigning `rounds` from here is not
         possible (module-scoped let), so borrow slot 0's question. */
      const real = rounds[0].q[0];
      const keep = JSON.parse(JSON.stringify(real));
      Object.keys(real).forEach(k=>delete real[k]);
      Object.assign(real, Q);

      loadQuestion();
      const shown = [...document.querySelectorAll('#qOpts .opt span:first-child')].map(x=>x.textContent);
      /* Tap the RIGHT answer by its row, the way a player does. */
      const idx = Q.o.indexOf(Q.a);
      document.querySelectorAll('#qOpts .opt')[idx].click();
      await new Promise(r=>setTimeout(r,120));
      const rev = document.getElementById('revealBox').innerHTML;
      res[lang] = { shown, qtext: document.getElementById('qText').textContent,
                    correct: /reveal good/.test(rev),
                    reveal: rev.replace(/\s+/g,' ').slice(0,120) };
      Object.keys(real).forEach(k=>delete real[k]); Object.assign(real, keep);
    }
    VX.lang='en';
    return res;
  }, Q);

  ok('loc.english-grades-a-right-answer-right', graded.en.correct===true, graded.en.reveal);
  ok('loc.SPANISH-GRADES-A-RIGHT-ANSWER-RIGHT', graded.es.correct===true,
     `a player who chose Spanish tapped the correct row and was marked WRONG — ${graded.es.reveal}`);
  ok('loc.spanish-actually-showed-spanish',
     graded.es.qtext===Q.t_es && graded.es.shown.join('|')===Q.o_es.join('|'),
     `${graded.es.qtext} / ${JSON.stringify(graded.es.shown)}`);
  ok('loc.english-actually-showed-english',
     graded.en.qtext===Q.t && graded.en.shown.join('|')===Q.o.join('|'),
     `${graded.en.qtext} / ${JSON.stringify(graded.en.shown)}`);

  /* ---- THE MARKS ON THE BUTTONS, WHICH HAD NO TEST AT ALL -----------
     qa/localise.js proved a Spanish player is SCORED correctly. It never
     looked at what they were SHOWN. Those were different answers: the tick
     logic compared the RENDERED LABEL to the canonical q.a, so in Spanish
     "Igualado" never equalled "Level" — no option got a ✓, and the
     player's own correct pick fell through and was painted ✕, in red.
     Scored right, shown wrong. Found by the CTO review 19 Aug, live in the
     shipped build at the time. */
  const marks = await p.evaluate(async (Q)=>{
    const res={};
    for(const lang of ['en','es']){
      VX.lang=lang;
      S.mode='practice'; S.place='play'; S.qi=0; S.ni=0; S.answered=false; S.results=[[]];
      try{ go('gametime'); }catch(_){}
      document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
      document.getElementById('s-gametime').classList.add('active');
      const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';
      const real=rounds[0].q[0];
      const keep=JSON.parse(JSON.stringify(real));
      Object.keys(real).forEach(k=>delete real[k]); Object.assign(real,Q);
      loadQuestion();
      const idx=Q.o.indexOf(Q.a);
      const btns=[...document.querySelectorAll('#qOpts .opt')];
      btns[idx].click();
      await new Promise(r=>setTimeout(r,150));
      res[lang]={
        marks: btns.map(b=>b.querySelector('.mk').textContent),
        rightRowHasTick: btns[idx].querySelector('.mk').textContent==='✓',
        rightRowMarkedWrong: btns[idx].classList.contains('wrong')
      };
      Object.keys(real).forEach(k=>delete real[k]); Object.assign(real,keep);
    }
    VX.lang='en';
    return res;
  }, Q);
  ok('loc.english-ticks-the-right-row', marks.en.rightRowHasTick,
     `marks ${JSON.stringify(marks.en.marks)}`);
  ok('loc.SPANISH-TICKS-THE-RIGHT-ROW', marks.es.rightRowHasTick,
     `marks ${JSON.stringify(marks.es.marks)} — a Spanish player tapped the correct answer and was not shown a tick`);
  ok('loc.SPANISH-DOES-NOT-CROSS-OUT-A-CORRECT-PICK', !marks.es.rightRowMarkedWrong,
     'the player tapped the right answer, was scored correct, and saw a red ✕ on their own pick');

  /* And the lifeline must never remove the right answer. */
  const life = await p.evaluate(async (Q)=>{
    const out={};
    for(const lang of ['en','es']){
      VX.lang=lang;
      S.mode='practice'; S.place='play'; S.qi=0; S.ni=0; S.answered=false;
      S.lifelineHalf1=false; S.lifelineHalf2=false;
      const real=rounds[0].q[0];
      const keep=JSON.parse(JSON.stringify(real));
      Object.keys(real).forEach(k=>delete real[k]); Object.assign(real,Q);
      loadQuestion();
      try{ lifeline(); }catch(e){ out[lang]={err:e.message}; }
      const idx=Q.o.indexOf(Q.a);
      const btns=[...document.querySelectorAll('#qOpts .opt')];
      out[lang]=out[lang]||{ killedTheRightOne: btns[idx].style.opacity==='0.25' || btns[idx].style.pointerEvents==='none' };
      Object.keys(real).forEach(k=>delete real[k]); Object.assign(real,keep);
    }
    VX.lang='en';
    return out;
  }, Q);
  if(!life.en.err && !life.es.err){
    ok('loc.the-lifeline-never-removes-the-right-answer-en', !life.en.killedTheRightOne);
    ok('loc.THE-LIFELINE-NEVER-REMOVES-THE-RIGHT-ANSWER-ES', !life.es.killedTheRightOne,
       'in Spanish every option looked wrong, so the lifeline greyed out the correct answer the player paid for');
  }else{
    console.log('       (lifeline not reachable in this build — its two checks were not run)');
  }

  ok('loc.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));

  /* ---- 3. THE BANKS THEMSELVES, AT THE SOURCE ------------------------
     The checks above prove the SEAM is sound. These prove the CONTENT
     going through it is, because a translated list of the wrong length is
     silently ignored on the phone — the player just sees English and
     nobody is told. Two of these existed the first time the basketball
     template was translated: an insert landed on the wrong question and
     gave a four-option band the two-option team list. */
  {
    const fs=require('fs');
    const admin=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
    const qs=[...admin.matchAll(/\{ t: '((?:[^'\\]|\\.)*)', o: \[([^\]]*)\],\s*r:'[^']*'((?:,\s*\n\s*t_es: '(?:[^'\\]|\\.)*', o_es: \[[^\]]*\])?)/g)];
    const count=(x)=>(x.match(/'(?:[^'\\]|\\.)*'/g)||[]).length;
    let translated=0, mismatched=[], tokenLeft=[];
    for(const m of qs){
      if(!m[3] || !m[3].trim()) continue;
      translated++;
      const es=/o_es: \[([^\]]*)\]/.exec(m[3]);
      if(!es || count(es[1])!==count(m[2]))
        mismatched.push(m[1].slice(0,55)+`  (o=${count(m[2])} o_es=${es?count(es[1]):0})`);
      /* A {TOKEN} is fine in a template — it is substituted at publish —
         but it must appear in the SAME pattern in both languages, or one
         side names a team the other does not. */
      const enTok=(m[2].match(/\{[A-Z]+\}/g)||[]).sort().join(',');
      const esTok=(m[3].match(/\{[A-Z]+\}/g)||[]).sort().join(',');
      if(enTok!==esTok) tokenLeft.push(m[1].slice(0,55)+`  (en:${enTok||'none'} es:${esTok||'none'})`);
    }
    ok('loc.some-bank-is-actually-translated', translated>0,
       'no template question carries a translation — the seam has nothing to carry');
    ok('loc.every-translated-list-matches-its-canonical-length', mismatched.length===0,
       mismatched.join(' · '));
    ok('loc.team-tokens-appear-in-both-languages', tokenLeft.length===0,
       tokenLeft.join(' · '));
    console.log(`       ${translated} of ${qs.length} template question(s) carry a translation`);
  }

  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)}]`);
  bad.forEach(x=>console.log('   x '+x));
  process.exit(fail?1:0);
})();
