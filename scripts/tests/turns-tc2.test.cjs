// TC2's missed attack edges
// when the priest's attack frequency falls inside the window. Isolated: a live row cannot
// end the warrior's warcry at a chosen edge.
const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {tc2}=require('../../e2e/turns-tc2.ts');
// The warcry ends at 5250 (the `ex_condition` reply), the priest's cooldown goes from
// 705.7 ms to 961.5 ms, and the accepted heals land at 4750 and 6000. The row's slot is the
// cooldown it read at its start, the median round trip (149) and one clock step (250).
const STEP=250,RTT=149,BUFFED=1000/1.417,PLAIN=1000/1.04;
const sample=(at,cooldown)=>({at,target:true,party:{},cooldown});
const samples=lo=>{const out=[];for(let at=lo;at<lo+2000;at+=100)out.push(sample(at,at<5250?BUFFED:PLAIN));return out;};
// A gap of two cooldowns is no missed
// edge only where every sample of it carries the overkill skip's record on the priest's target,
// with the damage in flight covering its HP.
const skipSamples=(lo,hi,skip)=>{const out=[];for(let at=lo;at<hi;at+=100)out.push({...sample(at,BUFFED),tid:'goo1',skip:skip(at)});return out;};
const held=at=>({target:'goo1',damage:3000,hp:100,last:at});
scenarioTable('TC2 measures missed attack edges against the cooldown the game holds then',()=>undefined,[
 ['an edge after the warcry ends is measured with the cooldown the game holds then',()=>{
  const r=tc2({actions:[4750,6000],samples:samples(4700),replies:[{at:5250,place:null,response:'ex_condition'}],spends:[],
    cooldown:BUFFED,rtt:RTT,step:STEP,busy:()=>true,from:0});
  assert.equal(r.missed,0,'the heal at the plain cooldown fills its edge');
 }],
 ['a gap of two cooldowns with no action is still a missed edge',()=>{
  const steady=[];for(let at=4700;at<7000;at+=100)steady.push(sample(at,BUFFED));
  const r=tc2({actions:[4750,6750],samples:steady,replies:[],spends:[],cooldown:BUFFED,rtt:RTT,step:STEP,busy:()=>true,from:0});
  assert.equal(r.missed,2,'the edges at 5456 and 6161');
  assert.deepEqual(r.gapsMissed.map(g=>[g.from,g.gap]),[[4750,2000]]);
 }],
 ['an empty edge with no skip record is a missed edge',()=>{
  const r=tc2({actions:[4750,6750],samples:skipSamples(4700,7000,()=>null),replies:[],spends:[],cooldown:BUFFED,rtt:RTT,step:STEP,busy:()=>true,from:0});
  assert.equal(r.missed,2,'the planted empty edges fail');
 }],
 ['edges the skip recorded on that target are no fault and are recorded',()=>{
  const r=tc2({actions:[4750,6750],samples:skipSamples(4700,7000,held),replies:[],spends:[],cooldown:BUFFED,rtt:RTT,step:STEP,busy:()=>true,from:0});
  assert.equal(r.missed,0);
  assert.equal(r.skipped.length,1,'the gap is recorded as skipped');
  assert.deepEqual([r.skipped[0].target,r.skipped[0].damage,r.skipped[0].hp],['goo1',3000,100]);
 }],
 ['a skip record on another target still misses',()=>{
  const r=tc2({actions:[4750,6750],samples:skipSamples(4700,7000,at=>({...held(at),target:'goo2'})),replies:[],spends:[],cooldown:BUFFED,rtt:RTT,step:STEP,busy:()=>true,from:0});
  assert.equal(r.missed,2);
 }],
]);
