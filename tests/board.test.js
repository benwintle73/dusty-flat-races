// Run: npm i jsdom && node tests/board.test.js nan.html
// Tests for the v2.54.0 tipster leaderboard: maths, periods, labels and breakdown, on mock data in jsdom.
process.on('unhandledRejection',()=>{});process.on('uncaughtException',e=>{if(!/Invalid time|Cannot read/.test(String(e)))console.log('uncaught',String(e))});
const {JSDOM}=require('jsdom');const fs=require('fs');const assert=require('assert');
const html=fs.readFileSync(process.argv[2],'utf8');
const T="2026-11-17";
const rows=[ // date, code, who, bets, won, placed, back (per $1)
 ["2026-11-17","H","nan",5,2,3,6.0],["2026-11-16","H","nan",10,3,5,9.5],["2026-11-16","D","nan",20,4,9,15.0],["2026-11-13","N","nan",4,0,1,0],
 ["2026-11-16","H","pop",3,1,2,4.0],["2026-11-17","D","gran",40,15,25,30.0],
].map(([date,code,who,bets,won,placed,back])=>({date,code,who,bets,won,placed,back,bets2:bets,placed2:1,bets3:bets,placed3:1,races3:bets,won3:won}));
const bands=[
 {date:"2026-11-17",code:"H",who:"nan",band:"a",fav:true,bets:2,won:1,placed:2,back:1.8},
 {date:"2026-11-17",code:"H",who:"nan",band:"c",fav:false,bets:3,won:1,placed:1,back:4.2},
 {date:"2026-11-16",code:"H",who:"nan",band:"b",fav:false,bets:10,won:3,placed:5,back:9.5},
 {date:"2026-11-16",code:"D",who:"nan",band:"na",fav:null,bets:20,won:4,placed:9,back:15.0},
 {date:"2026-11-13",code:"N",who:"nan",band:"na",fav:null,bets:4,won:0,placed:1,back:0},
];
const {VirtualConsole}=require("jsdom");const vc=new VirtualConsole();const dom=new JSDOM(html,{virtualConsole:vc,runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/nan.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async(u)=>{u=String(u);const body=/otr-board/.test(u)?{today:T,rows,bands}:{};return {ok:true,status:200,json:async()=>body,text:async()=>""}};
  w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}}));w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,E=s=>w.eval(s);let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
(async()=>{
 await new Promise(r=>setTimeout(r,300));
 if(!w.document.getElementById("board")){const d=w.document.createElement("div");d.id="board";w.document.body.appendChild(d)}
 await E("loadBoard()");
 t("version bumped",()=>assert.ok(E("NAN_VERSION")>="2.54.0"));
 t("boardStats maths",()=>{const s=E(`boardStats([{bets:10,won:3,placed:5,back:9.5},{bets:5,won:2,placed:3,back:6}])`);
   assert.strictEqual(s.n,15);assert.strictEqual(s.won,5);assert.strictEqual(s.staked,150);assert.strictEqual(s.ret,155);assert.strictEqual(s.profit,5);assert.ok(Math.abs(s.roi-3.333)<.01)});
 t("boardStats empty",()=>{const s=E("boardStats([])");assert.strictEqual(s.n,0);assert.strictEqual(s.roi,null)});
 t("period starts",()=>{assert.strictEqual(E(`boardFrom("today","${T}")`),T);assert.strictEqual(E(`boardFrom("yday","${T}")`),"2026-11-16");assert.strictEqual(E(`boardFrom("week","${T}")`),"2026-11-11");
   assert.strictEqual(E(`boardFrom("d30","${T}")`),"2026-10-19");assert.strictEqual(E(`boardFrom("d90","${T}")`),"2026-08-20");assert.strictEqual(E(`boardFrom("d180","${T}")`),"2026-05-22");assert.strictEqual(E(`boardFrom("month","${T}")`),"2026-11-01")});
 t("sample labels",()=>{assert.strictEqual(E("sampleOf(29)[0]"),"Small sample");assert.strictEqual(E("sampleOf(30)[0]"),"Developing record");assert.strictEqual(E("sampleOf(100)[0]"),"Established record")});
 const el=w.document.getElementById("board");
 const go=(per,code="all")=>{E(`BOARD.per="${per}";BOARD.code="${code}";BOARD.view="top";BOARD.brk=true;BOARD.bwho="nan";renderBoard()`);return el.innerHTML};
 t("all 8 period chips",()=>{const h=go("today");for(const p of["today","yday","week","month","d30","d90","d180","since"])assert.ok(h.includes(`data-boardper="${p}"`),p)});
 t("90 days shows coverage note",()=>{const h=go("d90");assert.ok(/Records only go back to 13 Nov/.test(h),"note");assert.ok(/5 days of results, not 90/.test(h))});
 t("today has no coverage note",()=>assert.ok(!/Records only go back/.test(go("today"))));
 t("main table totals unchanged ($10 bets)",()=>{const h=go("d180");const tr=[...el.querySelectorAll("table.btable:not(.bk) tbody tr")];const nan=tr.find(r=>/Nan/.test(r.textContent));
   assert.ok(nan,"nan row");const td=[...nan.querySelectorAll("td")].map(x=>x.textContent);assert.strictEqual(td[2],"39");assert.strictEqual(td[3],"9");
   // profit 10*(30.5-39) = -85
   assert.ok(/85\.00/.test(td[7]),td[7]);assert.ok(/Developing record/.test(td[1]))});
 t("small sample label",()=>{go("d180");const pop=[...el.querySelectorAll("table.btable:not(.bk) tbody tr")].find(r=>/Pop/.test(r.textContent));assert.ok(/Small sample/.test(pop.textContent))});
 t("breakdown totals",()=>{go("d180");const b=el.querySelector("details.bbrk");assert.ok(b&&b.open);const tx=b.querySelector(".bk-tot").textContent;
   assert.ok(tx.includes("39settled"),tx);assert.ok(tx.includes("$390.00staked"));assert.ok(tx.includes("$305.00returned"));assert.ok(/-\$85\.00/.test(tx));assert.ok(/-22%ROI/.test(tx),tx)});
 t("breakdown by code",()=>{go("d180");const tabs=el.querySelectorAll("details.bbrk table.bk");const codes=tabs[0].textContent;assert.ok(/Horses15/.test(codes),codes);assert.ok(/Dogs20/.test(codes));assert.ok(/Harness4/.test(codes))});
 t("price bands and favourites",()=>{go("d180");const tabs=[...el.querySelectorAll("details.bbrk table.bk")];assert.strictEqual(tabs.length,3);
   assert.ok(/Under \$22/.test(tabs[1].textContent));assert.ok(/\$2 to \$410/.test(tabs[1].textContent));assert.ok(/\$4 to \$83/.test(tabs[1].textContent));assert.ok(/\$8 and over0/.test(tabs[1].textContent));
   assert.ok(/Favourite2/.test(tabs[2].textContent));assert.ok(/Not the favourite13/.test(tabs[2].textContent));
   assert.ok(/Data unavailable for 24 picks/.test(el.querySelector("details.bbrk").textContent))});
 t("dogs only: no price tables, data unavailable",()=>{go("d180","D");const b=el.querySelector("details.bbrk");assert.strictEqual(b.querySelectorAll("table.bk").length,1);assert.ok(/Data unavailable for 20 picks/.test(b.textContent))});
 t("tipster with no picks",()=>{E(`BOARD.bwho="kev"`);E("renderBoard()");assert.ok(/No settled picks for Kev/.test(el.innerHTML))});
 t("switch tipster via click",()=>{go("d180");const btn=el.querySelector('[data-bkwho="gran"]');btn.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));assert.strictEqual(E("BOARD.bwho"),"gran");assert.ok(/40settled/.test(el.querySelector(".bk-tot").textContent))});
 t("top 3 view has no breakdown",()=>{E(`BOARD.view="top3";renderBoard()`);assert.ok(!el.querySelector("details.bbrk"))});
 t("bands missing: price unavailable",()=>{E(`BOARD.bands=null;BOARD.view="top";BOARD.bwho="nan";renderBoard()`);assert.ok(/Price breakdown unavailable/.test(el.innerHTML))});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
})();
