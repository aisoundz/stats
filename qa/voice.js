#!/usr/bin/env node
/* Voice grammar, tested against the REAL option strings out of tonight's
   published bank — not invented ones. A grammar tested on toy options is a
   grammar tested on the wrong game. */
const fs=require('fs');
const P=require('path');
/* DEFAULTS TO index.html, like qa/voice-wiring.js does. It used to read
   index-test.html while every edit went to index.html, so a run could
   report the OLD matcher's results against the NEW test cases — eleven
   red lines describing code that had already been replaced. Two files,
   one fact, and the suite testing the stale copy. */
const TARGET=process.argv[2]||P.resolve(__dirname,'..','index.html');
const src=fs.readFileSync(TARGET,'utf8');
const a=src.indexOf('var VX=(function(){'), b=src.indexOf('try{ window.VX=VX; }catch(_){}');
if(a<0||b<0) throw new Error('VX block not found in '+TARGET);
global.window={}; global.localStorage={getItem:()=>null,setItem:()=>{}};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({})};
const VX=new Function(src.slice(a,b)+'\nreturn VX;')();

// the four real option shapes in tonight's gn12 bank
const YN=['Yes','No'], TEAM=['Valkyries','Wings'],
      BAND=['None or one','Two or three','Four or five','Six or more'],
      CMP=['Valkyries','Wings','Equal'],
      SHOT=['Jump shots','Drives','Equal'];

let pass=0, fail=0;
function is(said, opts, want, why){
  const m=VX.match(said, opts);
  const got = m ? (m.kind==='pick' ? ('pick:'+opts[m.i]) : m.kind) : 'null';
  if(got===want){ pass++; console.log('  ok   "'+said+'" -> '+got); }
  else { fail++; console.log('  FAIL "'+said+'" -> '+got+'   expected '+want+(why?'   ('+why+')':'')); }
}
console.log('\nNUMBERS — the reliable path, and the one the prompt teaches');
is('one',YN,'pick:Yes'); is('two',YN,'pick:No');
is('number two',YN,'pick:No'); is('say three',BAND,'pick:Four or five');
is('I pick four',BAND,'pick:Six or more'); is('4',BAND,'pick:Six or more');

console.log('\nTHE OPTION, SAID OUT LOUD');
is('yes',YN,'pick:Yes'); is('nope',YN,'pick:No');
is('wings',TEAM,'pick:Wings'); is('the wings',TEAM,'pick:Wings');
is('valkyries',TEAM,'pick:Valkyries');
is('six or more',BAND,'pick:Six or more');
is('drives',SHOT,'pick:Drives'); is('equal',CMP,'pick:Equal');

console.log('\nCOMMANDS');
is('lock it in',YN,'lock'); is('lock',YN,'lock'); is('done',YN,'lock');
is('repeat',YN,'repeat'); is('say that again',YN,'repeat');
is('read the options',BAND,'help'); is('voice off',YN,'off');

console.log('\nREFUSALS — the important half. A wrong pick is worse than none.');
is('',YN,'null','silence');
is('uh I think maybe',YN,'null','filler is not an answer');
is('what do you reckon for this one',BAND,'null','"for" must not become 4 in a sentence');
is('go for it',BAND,'null','same trap, shorter');
is('lets go valkyries come on',TEAM,'pick:Valkyries','a shout at the TV that does name one team');
is('hello',YN,'null');
is('eleven',BAND,'null','not an option or a position');

console.log('\nFRAGMENTS — how people ACTUALLY answer. Nobody reads an option aloud in full.');
// Reported live by the founder, 17 Aug: these two did not register at all.
const FGFT=['Made field goals','Made free throws','Equal'];
is('field goal',FGFT,'pick:Made field goals','THE reported bug — a fragment of the option');
is('field goals',FGFT,'pick:Made field goals');
is('free throws',FGFT,'pick:Made free throws');
is('free throw',FGFT,'pick:Made free throws','singular, option is plural');
is('made field goals',FGFT,'pick:Made field goals','said in full');
is('made',FGFT,'ambiguous','names neither — refuse rather than toss a coin');
is('six',BAND,'pick:Six or more','fragment of a band');
is('four or five',BAND,'pick:Four or five');
is('none',BAND,'pick:None or one');
const KIND=['Layup or dunk','Mid-range jumper','Three','Free throws'];
is('layup',KIND,'pick:Layup or dunk'); is('dunk',KIND,'pick:Layup or dunk');
is('jumper',KIND,'pick:Mid-range jumper'); is('free throws',KIND,'pick:Free throws');
const CNT=['None','Once','Twice','Three or more'];
is('one',CNT,'pick:None','we TELL them to say the number — position wins');
is('once',CNT,'pick:Once'); is('twice',CNT,'pick:Twice');
is('three or more',CNT,'pick:Three or more');
const LAST=['Went in','Missed','Nobody got one off'];
is('missed',LAST,'pick:Missed'); is('went in',LAST,'pick:Went in');
is('nobody',LAST,'pick:Nobody got one off');

console.log('\nAMBIGUITY — two candidates is a refusal, never a coin toss');
is('yes or no',YN,'ambiguous','the player read the question back');
is('wings or valkyries',CMP,'ambiguous','thinking out loud names both sides');

console.log('\nOUT OF RANGE / POSITION');
is('three',YN,'null','only two options — position 3 does not exist');
is('four',TEAM,'null','out of range');

console.log('\n'+(fail?('FAIL — '+fail+' of '+(pass+fail)):('PASS — all '+pass))+' voice grammar cases');
process.exit(fail?1:0);
