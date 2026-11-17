// Run: npm i jsdom && node tests/champ.test.js nan.html
// v2.57 Family Championship: standings, ties, periods (Mon-Sun weeks), movement, awards, tip strip states and saving.
process.on('unhandledRejection',()=>{});process.on('uncaughtException',()=>{});
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const T="2026-11-18"; // a Wednesday: this week = Mon 16 to Sun 22 Nov, last week = 9-15 Nov
const R=(who,kind,date,h,runner,mk,pos,pts)=>({who,kind,date,code:"H",venue:"V",race:1,jump:`${date}T0${h}:00:00Z`,runner,mk,pos,pts});
const rows=[
 R("Ben","family","2026-11-16",1,"A",2.2,1,10),R("nan","tipster","2026-11-16",1,"A",2.2,1,10),R("Mia","family","2026-11-16",1,"B",6,2,5),
 R("Ben","family","2026-11-17",2,"C",12,1,20),R("nan","tipster","2026-11-17",2,"D",3,3,3),R("Mia","family","2026-11-17",2,"C",12,1,20),
 R("Ben","family","2026-11-18",3,"E",4,null,0),R("Mia","family","2026-11-18",3,"F",5,1,15),R("pop","tipster","2026-11-18",3,"F",5,1,15),
 R("Ben","family","2026-11-12",1,"G",8,1,15),R("Mia","family","2026-11-12",1,"H",3,4,0),
];
let posted=null;
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/nan.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async(u,o)=>{u=String(u);let body={};if(/otr-champ\?board/.test(u))body={today:T,rows};else if(/otr-champ\?code/.test(u))body={name:"Ben",tips:[]};else if(/otr-champ$/.test(u)&&o&&o.method==="POST"){posted=JSON.parse(o.body);body=posted.clear?{ok:true,cleared:true}:{ok:true,name:"Runner Two",no:posted.no,mk:4.4}}
   return {ok:true,status:200,json:async()=>body,text:async()=>""}};w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,E=s=>w.eval(s);let fails=0;const t=(n,f)=>{try{const p=f();return p}catch(e){fails++;console.log("FAIL",n,e.message)}finally{}};
const ok=n=>console.log("PASS",n);
setTimeout(async()=>{
 await E("loadChamp()");const el=w.document.getElementById("champ");
 const table=()=>[...el.querySelectorAll("table.btable")[0].querySelectorAll("tbody tr")].map(r=>[...r.querySelectorAll("td")].map(x=>x.textContent));
 t("this week standings",()=>{const tb=table();assert.ok(/Mia/.test(tb[0][1])&&tb[0][2]==="40",JSON.stringify(tb[0]));assert.ok(/Ben/.test(tb[1][1])&&tb[1][2]==="30");ok("this week standings")});
 t("leader crown and tipster tag",()=>{assert.ok(table()[0][0].startsWith("👑"));assert.ok(/Tipster/.test(el.innerHTML));ok("leader crown and tipster tag")});
 t("ties share a rank",()=>{const s=E(`chStand([{who:"a",kind:"family",pts:10,pos:1},{who:"b",kind:"family",pts:10,pos:1},{who:"c",kind:"family",pts:5,pos:2}])`);assert.strictEqual(JSON.stringify(s.map(a=>a.rank)),"[1,1,3]");ok("ties share a rank")});
 t("movement arrows",()=>{assert.ok(/▲1/.test(el.innerHTML)&&/▼1/.test(el.innerHTML));ok("movement arrows")}); // before 18th Ben 30 = Mia 25? Ben led; Mia overtook
 t("week ranges Mon-Sun",()=>{assert.strictEqual(JSON.stringify(E(`chRange("week","${T}")`)),JSON.stringify(["2026-11-16","2026-11-22"]));assert.strictEqual(JSON.stringify(E(`chRange("lweek","${T}")`)),JSON.stringify(["2026-11-09","2026-11-15"]));assert.strictEqual(JSON.stringify(E(`chRange("week","2026-11-16")`)),JSON.stringify(["2026-11-16","2026-11-22"]));assert.strictEqual(JSON.stringify(E(`chRange("week","2026-11-22")`)),JSON.stringify(["2026-11-16","2026-11-22"]));ok("week ranges Mon-Sun")});
 t("month ranges",()=>{assert.strictEqual(JSON.stringify(E(`chRange("lmonth","2026-01-10")`)),JSON.stringify(["2025-12-01","2025-12-31"]));assert.strictEqual(JSON.stringify(E(`chRange("month","${T}")`)),JSON.stringify(["2026-11-01","2026-11-31"]));ok("month ranges")});
 t("last week period",()=>{E('CHAMP.per="lweek";renderChamp()');const tb=table();assert.ok(/Ben/.test(tb[0][1])&&tb[0][2]==="15");ok("last week period")});
 t("awards: outsider and streak",()=>{E('CHAMP.per="all";renderChamp()');assert.ok(/C \$12\.00/.test(el.innerHTML),"outsider");assert.ok(/3 in a row/.test(el.innerHTML),"Ben won 12,16,17");ok("awards")});
 t("last week's champion",()=>{assert.ok(/Ben \(15\)/.test(el.innerHTML));ok("last week's champion")});
 t("efficiency needs 20 tips",()=>{assert.ok(/Needs 20 settled tips/.test(el.innerHTML));ok("efficiency min 20")});
 // tip strip
 E(`window.__R={id:"H|2026-11-18_vv|3",code:"H",date:"2026-11-18",no:3,jump:new Date(Date.now()+3600e3).toISOString()};window.__RK=[{u:{no:1,name:"Runner One"}},{u:{no:2,name:"Runner Two"}}]`);
 t("strip asks for a name when not signed in",()=>{E("SYNC.name=null");assert.ok(/Pick a leaderboard name/.test(E("champStrip(__R,__RK)")));ok("strip without name")});
 t("strip shows runner buttons when named",()=>{E('SYNC.name="Ben";SYNC.code="ABCD-EFGH"');const h=E("champStrip(__R,__RK)");assert.ok((h.match(/data-ctno=/g)||[]).length===2);ok("strip buttons")});
 t("strip locked after jump",()=>{E('window.__R2={...__R,jump:new Date(Date.now()-60e3).toISOString()};CHAMP.mine.set(__R.id,{no:2,name:"Runner Two"})');assert.ok(/locked at the jump/.test(E("champStrip(__R2,__RK)")));assert.ok(!/data-ctno/.test(E("champStrip(__R2,__RK)")));E("CHAMP.mine.clear()");ok("locked after jump")});
 await E("champTip('H|2026-11-18_vv|3',2,false)");
 t("saving a tip posts and stores it",()=>{assert.strictEqual(posted.no,2);assert.strictEqual(posted.code,"ABCD-EFGH");assert.strictEqual(E("CHAMP.mine.get('H|2026-11-18_vv|3').name"),"Runner Two");assert.ok(/aria-pressed="true"[^>]*aria-label="Tip No. 2/.test(E("champStrip(__R,__RK)")));ok("save tip")});
 await E("champTip('H|2026-11-18_vv|3',0,true)");
 t("clearing a tip",()=>{assert.ok(posted.clear);assert.ok(!E("CHAMP.mine.has('H|2026-11-18_vv|3')"));ok("clear tip")});
 t("server ids for dogs",()=>{assert.strictEqual(E('srvId({id:"D|gosford|5",code:"D",date:"2026-11-17",slug:"gosford",no:5})'),"D|2026-11-17|gosford|5");ok("server ids")});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},300);
