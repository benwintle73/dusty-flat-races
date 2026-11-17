// Run: npm i jsdom && node tests/bestbets.test.js nan.html
// Tests for v2.55 Best Bets of the day: categories, value rules, independence, data gaps, scratched/jumped races.
process.on('unhandledRejection',()=>{});process.on('uncaughtException',()=>{});
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/nan.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async()=>({ok:true,status:200,json:async()=>({}),text:async()=>""});w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,E=s=>w.eval(s);let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
setTimeout(()=>{
 // mock races: each runner {no,name,win}; tipsters: who -> {name: chance}
 E(`
 const FUT=new Date(Date.now()+3600e3).toISOString(),PAST=new Date(Date.now()-3600e3).toISOString();
 const mk=(id,code,src,jump,runners,tips,scr)=>({id,code,src,venue:"V"+id,no:1,jump,runners,tips,scr:scr||[]});
 const R=[
  // A: horses, everyone on Ace, short price: Best Chance + agreement
  mk("A","H","ff",FUT,[{no:1,name:"Ace",win:1.3},{no:2,name:"Bee",win:6},{no:3,name:"Cee",win:10}],
     {nan:{Ace:.7,Bee:.2,Cee:.1},pop:{Ace:.7,Bee:.2,Cee:.1},bob:{Ace:.75,Bee:.15,Cee:.1},gran:{Ace:.7,Bee:.2,Cee:.1},kev:{Ace:.8,Bee:.2}}),
  // B: horses, Pop and Bob love Dan at $8 (value), Mob top is Eve
  mk("B","H","ff",FUT,[{no:1,name:"Eve",win:2.2},{no:2,name:"Dan",win:6},{no:3,name:"Fay",win:6}],
     {nan:{Eve:.45,Dan:.12,Fay:.43},pop:{Eve:.35,Dan:.3,Fay:.35},bob:{Eve:.3,Dan:.32,Fay:.38},gran:{Eve:.45,Dan:.12,Fay:.43}}),
  // C: only market + Kev, no independent model: not eligible
  mk("C","H","ff",FUT,[{no:1,name:"Gus",win:1.5},{no:2,name:"Hal",win:3}],{nan:{Gus:.6,Hal:.4},gran:{Gus:.65,Hal:.35},kev:{Gus:.8,Hal:.2}}),
  // D: jumped race: ignored
  mk("D","H","ff",PAST,[{no:1,name:"Ida",win:1.2},{no:2,name:"Jo",win:5}],{nan:{Ida:.9,Jo:.1},pop:{Ida:.9,Jo:.1},bob:{Ida:.9,Jo:.1},gran:{Ida:.9,Jo:.1}}),
  // E: dog, full form, only Pop as model + Nan independent; value candidate Kit with 2 independent (pop+nan)
  mk("E","D","ff",FUT,[{no:1,name:"Kit",win:4},{no:2,name:"Lou",win:1.3}],{nan:{Kit:.45,Lou:.55},pop:{Kit:.4,Lou:.6},gran:{Kit:.14,Lou:.86}}),
  // F: horse value runner only rated by Pop (1 model): no value call; scratched runner Zed must never appear
  mk("F","H","ff",FUT,[{no:1,name:"Max",win:2},{no:2,name:"Ned",win:15},{no:3,name:"Zed",win:20}],{nan:{Max:.5,Ned:.07,Zed:.43},pop:{Max:.3,Ned:.3,Zed:.4},gran:{Max:.5,Ned:.07,Zed:.43}},[{no:3,name:"Zed"}]),
 ];
 RACES.length=0;RACES.push(...R);
 ranked=function(r){return r.runners.map(u=>({u,p:(r.tips.nan||{})[u.name]||0}))};
 quickRace=function(){return null};
 panelOf=function(r){const ts=Object.entries(r.tips).map(([who,ch])=>{const m=new Map(Object.entries(ch).map(([k,v])=>[nkey(k),v]));const top=Object.entries(ch).sort((a,b)=>b[1]-a[1])[0];return {who,chance:m,pick:{name:top[0],p:top[1]}}});
   if(ts.length<2)return null;const tot=new Map();for(const u of r.runners){let v=0;for(const t of ts)v+=t.chance.get(nkey(u.name))||0;tot.set(nkey(u.name),v/ts.length)}
   const b=[...tot].sort((a,b)=>b[1]-a[1])[0],u=r.runners.find(x=>nkey(x.name)===b[0]);return {ts,chance:tot,pick:{no:u.no,name:u.name,p:b[1]},agree:ts.filter(t=>nkey(t.pick.name)===b[0]).length}};
 window.__B=bestBets(RACES);`);
 const B=w.__B,find=n=>B.picks.find(y=>y.x.u.name===n),labs=n=>(find(n)||{labs:[]}).labs;
 t("Ace is Best Chance",()=>assert.ok(labs("Ace").includes("c")));
 t("Ace also Strongest Agreement on the same card",()=>{assert.ok(labs("Ace").includes("a"));assert.strictEqual(B.picks.filter(y=>y.x.u.name==="Ace").length,1)});
 t("Dan is Best Value (biggest overlay)",()=>{const y=find("Dan");assert.ok(y&&y.labs.includes("v"))});
 t("Kit qualifies as value (Pop+Nan on a full-form dog)",()=>{const x=E('bbRace(RACES[4])').find(x=>x.u.name==="Kit");assert.ok(x&&x.value)});
 t("huge overlay rejected as likely bad data",()=>{E('RACES[1].runners[1].win=30');const x=E('bbRace(RACES[1])').find(x=>x.u.name==="Dan");assert.ok(!x||!x.value);E('RACES[1].runners[1].win=6')});
 t("labelled picks listed first",()=>{const r=B.picks.map(y=>y.labs.includes("o")&&y.labs.length===1?1:0);assert.deepStrictEqual(r,r.slice().sort())});
 t("Dan qualifies as value (Pop+Bob beat $8 by 20%+)",()=>{const x=E('bbRace(RACES[1])').find(x=>x.u.name==="Dan");assert.ok(x&&x.value&&x.edge>=.2)});
 t("value runner from lower in The Mob's order",()=>assert.ok(!find("Dan").x.isTop));
 t("no independent model: race C excluded",()=>assert.ok(!find("Gus")&&!find("Hal")));
 t("jumped race excluded",()=>assert.ok(!find("Ida")));
 t("scratched runner never shown",()=>assert.ok(!find("Zed")));
 t("one model only: no value call (Ned)",()=>{const xs=E('bbRace(RACES[5])');const ned=xs&&xs.find(x=>x.u.name==="Ned");assert.ok(!ned||!ned.value)});
 t("Nan counted independent for full-form dogs",()=>{const xs=E('bbRace(RACES[4])');assert.ok(xs[0].ind.includes("nan"));assert.ok(xs[0].groups.includes("nan"))});
 t("Nan sits with market for horses",()=>{const xs=E('bbRace(RACES[0])');assert.ok(!xs[0].ind.includes("nan"));assert.ok(!xs[0].groups.includes("nan"));assert.ok(xs[0].groups.includes("market"))});
 t("at most five picks, each runner once",()=>{assert.ok(B.picks.length<=5);const ks=B.picks.map(y=>y.x.r.id+y.x.k);assert.strictEqual(new Set(ks).size,ks.length)});
 t("score formula",()=>{assert.ok(Math.abs(E("bbScore(.5,1,.5,1)")-100)<1e-9);assert.ok(Math.abs(E("bbScore(.25,.5,0,.6)")-(100*(.45*.5+.15+.06)))<1e-9)});
 t("best bets do not change tipster data",()=>{const before=JSON.stringify(E('RACES.map(r=>r.tips)'));E("bestBets(RACES)");assert.strictEqual(JSON.stringify(E('RACES.map(r=>r.tips)')),before)});
 t("no value: says so",()=>{E(`RACES.splice(1,1);RACES.splice(3,1)`);const h=E("bestBetsHtml()");assert.ok(/No clear value selection identified/.test(h),h.slice(0,200))});
 t("card html has essentials",()=>{const h=E("bestBetsHtml()");for(const s of["Best Chance","VA R1","No. 1 Ace","market","est. chance","agree","Why this pick?","Open the race card","data-hlbet"])assert.ok(h.includes(s),s)});
 t("empty state",()=>{E("RACES.length=0");assert.ok(/Waiting on enough tipsters/.test(E("bestBetsHtml()")))});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},300);
