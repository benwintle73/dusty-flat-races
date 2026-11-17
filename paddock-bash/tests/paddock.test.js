// Headless checks for PADDOCK BASH: run with NODE_PATH=/tmp/t/node_modules node tests/paddock.test.js index.html
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(process.argv[2]||'index.html','utf8');
let pass=0,fail=0;
function ok(c,m){if(c){pass++;console.log('  ok  '+m)}else{fail++;console.log('  FAIL '+m)}}
function boot(){
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/paddock-bash/?headless'});
  return dom.window.PB;
}
function run(PB,secs,bot){
  const S=PB.S;let t=0;
  while(t<secs&&S.phase!=='over'){
    if(bot)bot(PB);
    PB.step(1/120);t+=1/120;
  }
  return t;
}
// bot: steer at the nearest live AI car, full throttle
function chaser(PB){
  const S=PB.S,p=S.cars[0];if(p.dead)return;
  let b=null,bd=1e9;S.cars.forEach(c=>{if(c===p||c.dead)return;const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<bd){bd=d;b=c}});
  PB.input.on=!!b;PB.input.ox=0;PB.input.oy=0;
  if(b){PB.input.x=(b.x-p.x);PB.input.y=(b.y-p.y);const m=Math.hypot(PB.input.x,PB.input.y);PB.input.x*=60/m;PB.input.y*=60/m}
}

console.log('PADDOCK BASH headless tests');
// 1. damage rule unit checks
{
  const PB=boot(),S=PB.S;PB.newRound();S.phase='play';S.t=5;
  S.cars.forEach((c,i)=>{if(i>1){c.dead=true;c.x=1000+i*100;c.y=1000}});
  const A=S.cars[0],B=S.cars[1];
  function setup(aAng,bAng,aV){A.x=-40;A.y=0;A.a=aAng;A.vx=Math.cos(aAng)*aV;A.vy=Math.sin(aAng)*aV;A.hp=100;A.dead=false;A.thr=0;
    B.x=0;B.y=0;B.a=bAng;B.vx=0;B.vy=0;B.hp=100;B.dead=false;B.thr=0;B.target=null;S.cd={};}
  function hit(aAng,bAng,aV){setup(aAng,bAng,aV);
    // freeze the AI so it doesn't steer during the test
    B.pers='Rookie';for(let k=0;k<30;k++){B.think=99;B.thr=0;PB.step(1/120)}return {toB:100-B.hp,toA:100-A.hp}}
  const side=hit(0,Math.PI/2,240), rear=hit(0,0,240), front=hit(0,Math.PI,240), slow=hit(0,Math.PI/2,40);
  ok(side.toB>15,'fast nose-in to a side panel does real damage ('+side.toB.toFixed(1)+')');
  ok(rear.toB>side.toB,'rear hit hurts more than side ('+rear.toB.toFixed(1)+' > '+side.toB.toFixed(1)+')');
  ok(side.toA<side.toB*0.35,'the rammer takes much less than the victim ('+side.toA.toFixed(1)+')');
  ok(slow.toB===0&&slow.toA===0,'low-speed bump is harmless');
  // stationary car pointing at a moving car: the stationary one must not deal the big damage
  setup(0,Math.PI,0);B.vx=-240;B.a=Math.PI/2; // B slides sideways into A's parked nose
  for(let k=0;k<30;k++){B.think=99;B.thr=0;PB.step(1/120)}
  ok((100-B.hp)<(100-A.hp)*1.2+8,'a parked nose is not a weapon (B lost '+(100-B.hp).toFixed(1)+', A lost '+(100-A.hp).toFixed(1)+')');
}
// 2. AI brawls without the player
{
  let wrecks=0,rounds=8,crashes=0;
  for(let r=0;r<rounds;r++){const PB=boot(),S=PB.S;S.phase='play';
    const pl=S.cars[0];pl.x=0;pl.y=0;
    let t=0;while(t<45){pl.vx=pl.vy=0;pl.hp=100;PB.step(1/120);t+=1/120}
    wrecks+=S.cars.filter(c=>c.dead&&!c.player).length;crashes+=S.parts.length>0?1:0;}
  ok(wrecks/rounds>=1,'AI wrecks each other with an idle player (avg '+(wrecks/rounds).toFixed(1)+' AI wrecks in 45s)');
}
// 3. full rounds with a chaser bot: rounds end, no NaN, player can win but not always
{
  let wins=0,lens=[],nan=false,places=[],wreckSum=0;const N=30;
  for(let r=0;r<N;r++){const PB=boot(),S=PB.S;S.phase='play';
    run(PB,120,chaser);const t=S.t;lens.push(t);
    if(S.cars.some(c=>!isFinite(c.x)||!isFinite(c.y)||!isFinite(c.vx)))nan=true;
    if(S.result&&S.result.win)wins++;places.push(S.result?S.result.place:0);wreckSum+=S.result?S.result.wrecks:0;}
  const avg=lens.reduce((a,b)=>a+b,0)/N;
  ok(!nan,'no NaN positions');
  ok(lens.every(t=>t<=90+0.5),'every round finishes within the cap (avg '+avg.toFixed(1)+'s, max '+Math.max(...lens).toFixed(1)+'s)');
  ok(wins>=N*0.2&&wins<=N*0.9,'a simple chasing bot wins sometimes but not always ('+wins+'/'+N+')');
  ok(wreckSum/N>=0.8,'player gets wreck credit (avg '+(wreckSum/N).toFixed(2)+' a round)');
  console.log('     places: '+places.join(' '));
}
// 4. idle player usually survives a few seconds (round one is forgiving)
{
  let lens=[];for(let r=0;r<15;r++){const PB=boot(),S=PB.S;S.phase='play';const t=run(PB,120,null);lens.push(t)}
  const mn=Math.min(...lens);
  ok(mn>8,'an idle player lasts more than 8s (min '+mn.toFixed(1)+'s, avg '+(lens.reduce((a,b)=>a+b)/lens.length).toFixed(1)+'s)');
}
// 5. Again resets
{const PB=boot(),S=PB.S;S.phase='play';run(PB,120,chaser);PB.again();ok(S.phase==='count'&&S.cars.every(c=>!c.dead&&c.hp===100)&&S.score===0,'Again resets the round')}
console.log(pass+' passed, '+fail+' failed');process.exit(fail?1:0);
