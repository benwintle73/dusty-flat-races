// Run: npm i jsdom && node tests/lab.test.js nan.html
// v2.56 Strategy Lab: filters, matched races, live-only, eligibility, warnings, no strategy left out.
process.on('unhandledRejection',()=>{});process.on('uncaughtException',()=>{});
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');
const T="2026-11-17";
const rows=[ // date, code, strategy, source, band, matched, bets, won, placed, back
 ["2026-11-17","H","nan","live","b",true,10,3,6,9],["2026-11-17","H","form","live","b",true,10,4,6,14],["2026-11-17","H","market","live","a",true,10,5,8,8],["2026-11-17","H","consensus","live","a",true,10,4,7,9],
 ["2026-11-14","D","nan","backfill","na",false,40,10,20,30],["2026-11-14","D","form","backfill","na",false,30,9,15,28],["2026-11-14","D","value","backfill","na",false,2,0,0,0],["2026-11-15","N","bestbets","backfill","na",false,20,8,12,15],
].map(([date,code,strategy,source,band,matched,bets,won,placed,back])=>({date,code,strategy,source,band,matched,bets,won,placed,back}));
const seen=[{date:"2026-11-17",code:"H",source:"live",races:12},{date:"2026-11-14",code:"D",source:"backfill",races:50},{date:"2026-11-15",code:"N",source:"backfill",races:30}];
const dom=new JSDOM(fs.readFileSync(process.argv[2],'utf8'),{virtualConsole:new VirtualConsole(),runScripts:"dangerously",url:"https://benwintle73.github.io/dusty-flat-races/nan.html",pretendToBeVisual:true,
 beforeParse(w){w.fetch=async(u)=>({ok:true,status:200,json:async()=>(/otr-lab/.test(String(u))?{today:T,rows,seen}:{}),text:async()=>""});w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,E=s=>w.eval(s);let fails=0;const t=(n,f)=>{try{f();console.log("PASS",n)}catch(e){fails++;console.log("FAIL",n,e.message)}};
setTimeout(async()=>{
 await E("loadLab()");const el=w.document.getElementById("lab");const tr=n=>[...el.querySelectorAll("table.lab:not(.bk) tbody tr")].find(r=>r.querySelector("td b")&&r.querySelector("td b").textContent===n);
 const tds=n=>[...tr(n).querySelectorAll("td")].map(x=>x.textContent);
 t("labelled experimental",()=>assert.ok(/Experimental/.test(el.innerHTML)&&/not used for live tips/.test(el.innerHTML)));
 t("all six strategies listed",()=>{for(const n of["Current Nan","Form-focused","Market-focused","Consensus","Value-focused","Best Bets"])assert.ok(tr(n),n)});
 t("all available: Nan totals",()=>{const d=tds("Current Nan");assert.strictEqual(d[1],"50");assert.strictEqual(d[2],"26%");assert.ok(/-\$110\.00/.test(d[4]),d[4]);assert.strictEqual(d[5],"-22%")});
 t("eligibility = picks / races looked at",()=>assert.strictEqual(tds("Current Nan")[6],"54%"));
 t("value with no wins shows 0%",()=>{const d=tds("Value-focused");assert.strictEqual(d[2],"0%");assert.strictEqual(d[5],"-100%")});
 t("preliminary warning when samples small",()=>assert.ok(/preliminary/.test(el.innerHTML)));
 t("same races only",()=>{el.querySelector("[data-labmatch]").checked=true;el.querySelector("[data-labmatch]").dispatchEvent(new w.Event("change",{bubbles:true}));assert.strictEqual(tds("Current Nan")[1],"10");assert.ok(/No settled picks/.test(tr("Best Bets").textContent));E("LAB.match=false")});
 t("recorded live only",()=>{E("LAB.live=true;renderLab()");assert.strictEqual(tds("Current Nan")[1],"10");assert.ok(/No settled picks/.test(tr("Value-focused").textContent));E("LAB.live=false")});
 t("code filter",()=>{E('LAB.code="D";renderLab()');assert.strictEqual(tds("Current Nan")[1],"40");assert.ok(/No settled picks/.test(tr("Market-focused").textContent));E('LAB.code="all"')});
 t("period filter (last 7 days includes 11-17 Nov)",()=>{const b=el.querySelector('[data-labper="d7"]');b.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));assert.strictEqual(E("LAB.per"),"d7");assert.strictEqual(tds("Current Nan")[1],"50")});
 t("code and price tables",()=>{E('LAB.per="all";renderLab()');const bk=el.querySelectorAll("table.lab.bk");assert.strictEqual(bk.length,2);assert.ok(/Under \$2/.test(bk[1].textContent));assert.ok(/No price/.test(bk[1].textContent))});
 t("error state",()=>{E("LAB.rows=null;LAB.err=true;renderLab()");assert.ok(/unavailable/.test(el.innerHTML))});
 console.log(fails?`${fails} FAILED`:"ALL PASSED");process.exit(fails?1:0);
},300);
