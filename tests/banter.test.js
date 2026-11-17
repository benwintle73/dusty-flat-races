// Run: npm i jsdom && node tests/banter.test.js nan.html
// v2.58 Around Nan's table: lines only from real facts, streaks, slumps, outsiders, overtakes, favourites, rivalries,
// championship quips, stable picks, no repeats on a screen, and the Funny comments switch.
process.on('unhandledRejection',()=>{});process.on('uncaughtException',()=>{});
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/nan.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async()=>({ok:true,status:200,json:async()=>({}),text:async()=>""});w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,E=s=>w.eval(s);let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
setTimeout(()=>{
 E(`const H=m=>new Date(Date.now()-m*60e3).toISOString();
  const P=(who,m,runner,pos,mk,fmk)=>({who,race_id:who+m,jump:H(m),code:"H",venue:"Flemington",race:m%9+1,runner,pos,scr:false,mk,fmk});
  window.__REC=[P("nan",300,"A",1,3,2),P("nan",200,"B",1,4,2),P("nan",100,"C",1,2.5,2.5),
   ...[600,500,400,300,200].map((m,i)=>P("pop",m,"Pd"+i,5,6,2)),
   P("bob",50,"Longshot",1,12,2), P("gran",40,"Fav",4,2.1,2.1), P("kev",30,"Close",2,5,2)];
  BOARD.today="2026-11-17";BOARD.recent=__REC;
  BOARD.rows=[{date:"2026-11-16",code:"H",who:"pop",bets:10,won:2,placed:4,back:12},{date:"2026-11-16",code:"H",who:"nan",bets:10,won:3,placed:5,back:9},
   {date:"2026-11-17",code:"H",who:"nan",bets:10,won:5,placed:6,back:14},{date:"2026-11-17",code:"H",who:"pop",bets:10,won:1,placed:3,back:3},
   {date:"2026-11-16",code:"H",who:"gran",bets:10,won:6,placed:8,back:8},{date:"2026-11-17",code:"H",who:"gran",bets:10,won:6,placed:8,back:8}];
  JOKES=true;window.__TT=tableTalk();`);
 const L=w.__TT,by=x=>L.find(o=>o.who===x);
 t("at most four lines, one per tipster",()=>{assert.ok(L.length<=4&&L.length>=3);assert.strictEqual(new Set(L.map(o=>o.who)).size,L.length)});
 t("Nan's 3-win streak",()=>{const o=by("nan");assert.ok(o&&/3/.test(o.t)&&/3 winning top picks in a row/.test(o.why),o&&o.t)});
 t("Bob's winning outsider at $12",()=>{const o=by("bob");assert.ok(o&&/Longshot/.test(o.t)&&/\$12\.00/.test(o.t))});
 t("Pop's 5-loss slump or overtaken",()=>{const o=by("pop");assert.ok(!o||/5|Pop/.test(o.t))});
 t("why line backs every claim",()=>L.forEach(o=>assert.ok(o.why&&o.why.length>5)));
 t("stable on refresh",()=>{const again=E("tableTalk()");assert.strictEqual(JSON.stringify(again),JSON.stringify(L))});
 t("Gran's favourite beaten when no stronger fact",()=>{E(`BOARD.recent=[{who:"gran",race_id:"g1",jump:new Date(Date.now()-60e3).toISOString(),code:"H",venue:"Rosehill",race:3,runner:"Fav",pos:4,scr:false,mk:2.1,fmk:2.1}];BOARD.rows=[]`);const o=E("tableTalk()")[0];assert.ok(o&&o.who==="gran"&&/Fav/.test(o.t)&&/favourite Fav beaten/.test(o.why))});
 t("no facts, no lines",()=>{E("BOARD.recent=[];BOARD.rows=[]");assert.strictEqual(E("tableTalk().length"),0)});
 t("old results don't trigger 'fresh' lines",()=>{E(`BOARD.recent=[{who:"kev",race_id:"k",jump:new Date(Date.now()-50*3600e3).toISOString(),code:"H",venue:"V",race:1,runner:"Old",pos:1,scr:false,mk:15,fmk:2}]`);assert.strictEqual(E("tableTalk().length"),0)});
 t("scratched picks ignored",()=>{E(`BOARD.recent=[{who:"kev",race_id:"k",jump:new Date(Date.now()-60e3).toISOString(),code:"H",venue:"V",race:1,runner:"Scr",pos:null,scr:true,mk:15,fmk:2}]`);assert.strictEqual(E("tableTalk().length"),0)});
 t("overtake detected from leaderboard",()=>{E(`BOARD.recent=[];BOARD.rows=[{date:"2026-11-16",code:"H",who:"pop",bets:10,won:3,placed:4,back:12},{date:"2026-11-16",code:"H",who:"nan",bets:10,won:3,placed:5,back:9},{date:"2026-11-17",code:"H",who:"nan",bets:10,won:5,placed:6,back:14}]`);const o=E("tableTalk()").find(x=>x.who==="nan");assert.ok(o&&/Pop/.test(o.t)&&/up from 2nd/.test(o.why),JSON.stringify(E("tableTalk()")))});
 t("funny comments off hides banter",()=>{E("JOKES=false");assert.strictEqual(E("tableTalk().length"),0);assert.strictEqual(E(`champQuip([],[],[],"2026-11-17")`),"");E("JOKES=true")});
 t("streak/slump counts",()=>{const f=E(`btFacts([{who:"x",jump:"2026-11-17T01:00:00Z",pos:1},{who:"x",jump:"2026-11-17T02:00:00Z",pos:3},{who:"x",jump:"2026-11-17T03:00:00Z",pos:1},{who:"x",jump:"2026-11-17T04:00:00Z",pos:1}])`);assert.strictEqual(f.x.win,2);assert.strictEqual(f.x.lose,0)});
 // rivalries
 E(`window.__R={id:"H|t|1",code:"H",jump:new Date(Date.now()+3600e3).toISOString()};
  tipsters=function(){return [{who:"nan",pick:{name:"Alpha"}},{who:"gran",pick:{name:"Beta"}},{who:"pop",pick:{name:"Alpha"}},{who:"bob",pick:{name:"Alpha"}}]};
  panelOf=function(){return {pick:{name:"Alpha"}}};`);
 t("rivalry only where they disagree (Nan v Gran)",()=>{let shown=0;for(let i=0;i<40;i++){const h=E(`rivalryHtml({...__R,id:"H|t|${i}"})`);if(h){shown++;assert.ok(/Alpha/.test(h)&&/Beta/.test(h)&&/Gran/.test(h),h)}}assert.ok(shown>5&&shown<35,"about half the races: "+shown)});
 t("no rivalry when everyone agrees",()=>{E(`tipsters=function(){return [{who:"nan",pick:{name:"Alpha"}},{who:"gran",pick:{name:"Alpha"}},{who:"pop",pick:{name:"Alpha"}}]}`);for(let i=0;i<20;i++)assert.strictEqual(E(`rivalryHtml({...__R,id:"H|t|${i}"})`),"")});
 t("no rivalry after the jump",()=>assert.strictEqual(E(`rivalryHtml({...__R,jump:new Date(Date.now()-1e3).toISOString()})`),""));
 // championship
 t("championship: nobody yet",()=>assert.ok(/No settled tips yet/.test(E(`champQuip([],[],[],"2026-11-17")`))));
 t("championship: close contest",()=>assert.ok(/Ben/.test(E(`champQuip([{who:"Ben",kind:"family",pts:30},{who:"Mia",kind:"family",pts:27}],[],[{}],"2026-11-17")`))&&/3 point/.test(E(`champQuip([{who:"Ben",kind:"family",pts:30},{who:"Mia",kind:"family",pts:27}],[],[{}],"2026-11-17")`))));
 t("championship: tipster leading",()=>assert.ok(/Nan/.test(E(`champQuip([{who:"nan",kind:"tipster",pts:40},{who:"Mia",kind:"family",pts:10}],[],[{}],"2026-11-17")`))));
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},300);
