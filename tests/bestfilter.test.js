// Run: npm i jsdom && node tests/bestfilter.test.js best.html
// Best Bets page: Finished races filter (All / Won / Placed / Returns).
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const J=Date.now()-3*3600e3,jump=new Date(J).toISOString();
const sel=(no,name)=>({no,name});
const picks=[
 {id:"a",code:"H",kind:"win",venue:"Flemington",no:1,jump,p:.5,sel:[sel(1,"Alpha")]},   // won
 {id:"b",code:"H",kind:"win",venue:"Flemington",no:2,jump,p:.45,sel:[sel(2,"Bravo")]},  // 2nd on a win bet: placed, no return
 {id:"c",code:"H",kind:"ew",venue:"Flemington",no:3,jump,price:6,sel:[sel(3,"Charlie")]},// placed each way: return
 {id:"d",code:"H",kind:"rough",venue:"Flemington",no:4,jump,price:12,sel:[sel(4,"Delta")]},// unplaced
];
const races={races:[
 {venue:"Flemington",n:1,fin:[{pos:1,name:"Alpha",win:2.4,place:1.3}]},
 {venue:"Flemington",n:2,fin:[{pos:1,name:"Zulu"},{pos:2,name:"Bravo",place:1.6}]},
 {venue:"Flemington",n:3,fin:[{pos:1,name:"Zulu"},{pos:3,name:"Charlie",place:2.1}]},
 {venue:"Flemington",n:4,fin:[{pos:1,name:"Zulu"},{pos:5,name:"Delta"}]}]};
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/best.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async u=>({ok:true,status:200,json:async()=>String(u).includes("otr-best")?{picks}:races,text:async()=>""});}});
const w=dom.window,d=w.document;let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
const names=()=>[...d.querySelectorAll(".bd-fin .bd-row .bd-t")].map(e=>e.textContent.trim());
const click=k=>d.querySelector(`[data-ff="${k}"]`).dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
setTimeout(()=>{
 t("filter bar shows with counts",()=>{const b=[...d.querySelectorAll("[data-ff]")].map(x=>x.textContent);assert.deepStrictEqual(b,["All4","Won1","Placed2","Returns2"])});
 t("All lists every finished race",()=>assert.deepStrictEqual(names(),["1Alpha","2Bravo","3Charlie","4Delta"]));
 t("Won",()=>{click("won");assert.deepStrictEqual(names(),["1Alpha"])});
 t("Placed",()=>{click("plc");assert.deepStrictEqual(names(),["2Bravo","3Charlie"])});
 t("Returns: win, or a placing on each way",()=>{click("ret");assert.deepStrictEqual(names(),["1Alpha","3Charlie"])});
 t("choice is remembered",()=>assert.strictEqual(w.localStorage.getItem("best-fin-f"),"ret"));
 t("pressed state",()=>assert.strictEqual(d.querySelector('[data-ff="ret"]').getAttribute("aria-pressed"),"true"));
 t("tap does not close the section",()=>{d.querySelector(".bd-fin").open=true;click("all");assert.ok(d.querySelector(".bd-fin")!==null)});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},2500);
