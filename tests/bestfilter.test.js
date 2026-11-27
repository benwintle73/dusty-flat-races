// Run: npm i jsdom && node tests/bestfilter.test.js best.html
// Best Bets page: result filter (All / Won / Placed / Returns) over every race with a result.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const J=Date.now()-3*3600e3,jump=new Date(J).toISOString();
const sel=(no,name)=>({no,name});
const picks=[
 {id:"a",code:"H",kind:"win",venue:"Flemington",no:1,jump,p:.5,sel:[sel(1,"Alpha")]},   // won
 {id:"b",code:"H",kind:"win",venue:"Flemington",no:2,jump,p:.45,sel:[sel(2,"Bravo")]},  // 2nd on a win bet: placed, no return
 {id:"c",code:"H",kind:"ew",venue:"Flemington",no:3,jump,price:6,sel:[sel(3,"Charlie")]},// placed each way: return
 {id:"d",code:"H",kind:"rough",venue:"Flemington",no:4,jump,price:12,sel:[sel(4,"Delta")]},// unplaced
 {id:"e",code:"H",kind:"win",venue:"Flemington",no:5,jump:new Date(Date.now()-10*60e3).toISOString(),p:.5,sel:[sel(5,"Echo")]},// just won, not yet in Finished
 {id:"f",code:"H",kind:"win",venue:"Flemington",no:6,jump:new Date(Date.now()+3600e3).toISOString(),p:.5,sel:[sel(6,"Foxtrot")]},// to run
];
const races={races:[
 {venue:"Flemington",n:1,fin:[{pos:1,name:"Alpha",win:2.4,place:1.3}]},
 {venue:"Flemington",n:2,fin:[{pos:1,name:"Zulu"},{pos:2,name:"Bravo",place:1.6}]},
 {venue:"Flemington",n:3,fin:[{pos:1,name:"Zulu"},{pos:3,name:"Charlie",place:2.1}]},
 {venue:"Flemington",n:4,fin:[{pos:1,name:"Zulu"},{pos:5,name:"Delta"}]},
 {venue:"Flemington",n:5,fin:[{pos:1,name:"Echo",win:3}]}]};
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/best.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async u=>({ok:true,status:200,json:async()=>String(u).includes("otr-best")?{picks}:races,text:async()=>""});}});
const w=dom.window,d=w.document;let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
const names=()=>[...d.querySelectorAll("#list .bd-row .bd-t")].map(e=>e.textContent.trim());
const click=k=>d.querySelector(`[data-ff="${k}"]`).dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
setTimeout(()=>{
 t("filter bar sits above the list with counts",()=>{const b=[...d.querySelectorAll("#list > .bd-ff [data-ff]")].map(x=>x.textContent);assert.deepStrictEqual(b,["All","Won2","Placed2","Returns4"])});
 t("All: normal view, upcoming races still shown",()=>assert.ok(names().includes("6Foxtrot")));
 t("Won includes a race that only just finished",()=>{click("won");assert.deepStrictEqual(names(),["1Alpha","5Echo"])});
 t("Placed",()=>{click("plc");assert.deepStrictEqual(names(),["2Bravo","3Charlie"])});
 t("Returns = won or placed, nothing else",()=>{click("ret");assert.deepStrictEqual(names(),["1Alpha","2Bravo","3Charlie","5Echo"])});
 t("filtered view hides races still to run",()=>assert.ok(!names().includes("6Foxtrot")&&!d.querySelector(".bd-fin")));
 t("choice is remembered",()=>assert.strictEqual(w.localStorage.getItem("best-fin-f"),"ret"));
 t("back to All",()=>{click("all");assert.ok(d.querySelector(".bd-fin")&&names().includes("6Foxtrot"))});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},2500);
