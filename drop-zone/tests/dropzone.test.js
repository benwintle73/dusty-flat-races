// Headless checks for DROP ZONE: NODE_PATH=/tmp/t/node_modules node tests/dropzone.test.js index.html
const fs=require('fs'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c){pass++;console.log('  ok  '+m)}else{fail++;console.log('  FAIL '+m)}};
function boot(){const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/getContext|Not implemented/.test(e.message))console.log('jsdomError',e.message)});
  return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/drop-zone/?headless',virtualConsole:vc}).window.PB}
function land(PB){let n=0;while(PB.S.phase==='drop'&&n<1000){PB.step(1/120);n++}}
console.log('DROP ZONE headless tests');
{ // damage: shield first, then health; elimination drops the gun and credits the killer
  const PB=boot(),S=PB.S;land(PB);const a=S.players[1],b=S.players[2];
  b.sh=50;b.hp=100;PB.damage(b,30,a);ok(b.sh===20&&b.hp===100,'shield absorbs damage first');
  PB.damage(b,40,a);ok(b.sh===0&&b.hp===80,'overflow goes to health');
  b.w='shotgun';const drops=S.drops.length;PB.damage(b,500,a);
  ok(b.dead&&a.kills===1,'elimination credits the shooter');
  ok(S.drops.length>drops&&S.drops.some(d=>d.w==='shotgun'),'eliminated player drops their gun');
}
{ // weapon upgrades: only better guns swap in
  const PB=boot(),S=PB.S;land(PB);const p=S.players[3];
  ok(p.w==='pistol','everyone lands with a pistol');
  ok(PB.giveWeapon(p,'ar')&&p.w==='ar','pistol to rifle upgrades');
  ok(!PB.giveWeapon(p,'shotgun')&&p.w==='ar','a worse gun does not replace a better one');
  // chest
  const c=S.chests[0];p.x=c.x;p.y=c.y;p.w='pistol';PB.loot(p);ok(c.open,'walking onto a chest opens it');
}
{ // storm hurts outside and not inside
  const PB=boot(),S=PB.S;land(PB);S.players.forEach((p,i)=>{if(i>1){p.dead=true}});
  const p=S.players[1];S.storm.r=100;S.storm.cx=0;S.storm.cy=0;S.storm.state='shrink';S.storm.timer=999;S.storm.fr=100;S.storm.nr=100;S.storm.ncx=0;S.storm.ncy=0;S.storm.fx=0;S.storm.fy=0;
  const me=S.players[0];me.x=0;me.y=0;PB.setAuto(false);
  p.x=500;p.y=0;const h0=p.hp;for(let i=0;i<120;i++){p.x=500;p.y=0;PB.step(1/120)}
  ok(p.hp<h0,'storm damages a player outside the circle ('+(h0-p.hp).toFixed(1)+' in 1s)');
  ok(me.hp===100,'player inside the circle is untouched');
}
{ // full matches with every player bot-driven
  let ends=[],kills=0,nan=false,loot=0,fights=0,stormDeaths=0,botsMoved=true,firsts=[],alive20=[];
  for(let r=0;r<12;r++){const PB=boot(),S=PB.S;PB.setAuto(true);land(PB);
    const start=S.players.map(p=>[p.x,p.y]);let t=0;
    let first=null,a20=null;
    while(!S.over&&t<200){PB.step(1/120);t+=1/120;if(first===null&&S.players.some(p=>p.dead))first=S.t;if(a20===null&&S.t>=20)a20=S.players.filter(p=>!p.dead).length}
    // keep going until one is left, to test the whole match even if the "player" died
    while(S.players.filter(p=>!p.dead).length>1&&t<220){PB.step(1/120);t+=1/120;if(first===null&&S.players.some(p=>p.dead))first=S.t;if(a20===null&&S.t>=20)a20=S.players.filter(p=>!p.dead).length}
    firsts.push(first);alive20.push(a20);
    ends.push(S.t);kills+=S.players.reduce((a,p)=>a+p.kills,0);
    loot+=S.chests.filter(c=>c.open).length;
    if(S.players.some(p=>!isFinite(p.x)||!isFinite(p.hp)&&!p.dead))nan=true;
    if(S.players.some((p,i)=>i>0&&dist(start[i],p)<5&&!p.dead))botsMoved=false;
    stormDeaths+=S.feed.length?0:0;
  }
  function dist(a,p){return Math.hypot(a[0]-p.x,a[1]-p.y)}
  const avg=ends.reduce((a,b)=>a+b)/ends.length,med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
  console.log('     match length: median '+med(ends).toFixed(0)+'s, range '+Math.min(...ends).toFixed(0)+'-'+Math.max(...ends).toFixed(0)+'s');
  console.log('     first elimination: median '+med(firsts).toFixed(1)+'s');
  console.log('     alive at 20s: '+(alive20.reduce((a,b)=>a+b)/alive20.length/12*100).toFixed(0)+'% of players');
  ok(med(ends)>=75&&med(ends)<=120,'median match length is in the 75-120s band');
  ok(med(firsts)>=12,'first elimination usually comes after the looting phase');
  ok(!nan,'no NaN');
  ok(ends.every(t=>t<180),'every match finishes with one survivor (avg '+avg.toFixed(0)+'s, max '+Math.max(...ends).toFixed(0)+'s)');
  ok(kills/12>=5,'players eliminate each other, not just the storm (avg '+(kills/12).toFixed(1)+' gun eliminations a match)');
  ok(loot/12>=6,'bots open chests (avg '+(loot/12).toFixed(1)+' a match)');
  ok(botsMoved,'every surviving bot moves');
}
{ // a human-ish test: idle player (never moves) should not win
  let wins=0,places=[];for(let r=0;r<10;r++){const PB=boot(),S=PB.S;land(PB);let t=0;while(!S.over&&t<200){PB.step(1/120);t+=1/120}
    if(S.result&&S.result.win)wins++;places.push(S.result?S.result.place:0)}
  ok(wins===0,'an idle player never wins (places '+places.join(' ')+')');
}
console.log(pass+' passed, '+fail+' failed');process.exit(fail?1:0);
