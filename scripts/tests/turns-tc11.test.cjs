// Sends before their family's edge against a planted gear swap. Isolated: no gate row swaps
// gear inside the potion family's cooldown, so a live row cannot show this case on demand.
const test=require('node:test'),assert=require('node:assert/strict');
const {tc11,SELECTION_MS}=require('../../e2e/turns-tc11.ts');
const log=spends=>({ring:[],replies:[],samples:[],spends});
test('a gear equip inside the potion cooldown is no early send; a potion equip there is',()=>{
  // The potion family's edge sits 1500 ms after both sends.
  const gear={at:1000,method:'equip',item:'wand',edge:2500};
  const potion={at:1000,method:'equip',item:'hpot1',edge:2500};
  assert.deepEqual(tc11(log([gear]),0,5000,250,1000,50,false).sendsBeforeEdge,[],'the planted gear swap');
  assert.deepEqual(tc11(log([potion]),0,5000,250,1000,50,false).sendsBeforeEdge.map(s=>s.earlyMs),[1500],'a potion before its edge');
});

// An empty attack edge is no fault only where targeting's overkill skip recorded that it passed
// over the character's target on that edge, with the damage in flight that covered its HP. The
// priest's attack reply lands at 1000 and its next attack goes at 2600, past the edge at 1950 and
// one clock step of 200 ms (a pass is the clock step alone, turns-tc11.ts); every sample of the gap
// holds a target in range.
const COOLDOWN=1000,RTT=50,STEP=200,SELECTION=SELECTION_MS;
const gapLog=skip=>({ring:[],spends:[{at:0,method:'attack',edge:0},{at:2600,method:'attack',edge:0}],
  replies:[{at:1000,place:'attack',response:'data',failed:false,ms:null}],
  samples:[2000,2200,2400].map(at=>({at,target:true,inRange:true,mpAttacks:true,party:{},tid:'goo1',skip:skip(at)}))});
const held=(at,over={})=>({target:'goo1',damage:3000,hp:100,last:at,...over});
test('an empty edge with no skip record is a wait',()=>{
  const r=tc11(gapLog(()=>null),0,5000,STEP,COOLDOWN,RTT,true);
  assert.equal(r.waitsWithoutNotNow.length,1,'the planted empty edge fails');
  assert.deepEqual(r.skipped,[]);
});
test('an empty edge the skip recorded on that target, its damage covering the HP, is no fault and is recorded',()=>{
  const r=tc11(gapLog(at=>held(at)),0,5000,STEP,COOLDOWN,RTT,true);
  assert.deepEqual(r.waitsWithoutNotNow,[],'the skip held the whole gap');
  assert.deepEqual(r.skipped.map(s=>[s.target,s.damage,s.hp]),[['goo1',3000,100]],'each skipped edge is recorded with its target and damage');
  assert.ok(r.skipHeldMs>0);
});
test('a skip record on another target, with damage short of the HP, or older than one selection still fails',()=>{
  for(const [why,skip] of [['another target',at=>held(at,{target:'goo2'})],['damage short of the HP',at=>held(at,{damage:99})],['a last pass older than one selection',at=>held(at,{last:at-SELECTION-STEP-1})]])
    assert.equal(tc11(gapLog(skip),0,5000,STEP,COOLDOWN,RTT,true).waitsWithoutNotNow.length,1,why);
});
test('a skip that ends more than one pass before the send leaves a wait',()=>{
  // The skip's records stop at 2000; the family stays ready to 2600 with no skip.
  const r=tc11(gapLog(at=>at<=2000?held(at):null),0,5000,STEP,COOLDOWN,RTT,true);
  assert.equal(r.waitsWithoutNotNow.length,1,'the stretch after the skip is a fault');
});
// fix15-tc38's run: the samples come every 100 ms off the clock's steps, so the last one that read
// the skip came 48 ms before the selection pass that replaced the target, and the send went one
// step after that pass. The skip holds until one selection after its last pass, not until its last
// sample.
test('a skip holds to the selection pass after its last record, not to its last sample',()=>{
  const offStep=send=>({ring:[],spends:[{at:0,method:'attack',edge:0},{at:send,method:'attack',edge:0}],
    replies:[{at:1000,place:'attack',response:'data',failed:false,ms:null}],
    samples:[2050,2150,2250,2350].map(at=>({at,target:true,inRange:true,mpAttacks:true,party:{},tid:'goo1',skip:held(1000)}))});
  assert.deepEqual(tc11(offStep(1000+SELECTION+2*STEP),0,5000,STEP,COOLDOWN,RTT,true).waitsWithoutNotNow,[],'one step after the selection pass');
  assert.equal(tc11(offStep(1000+SELECTION+3*STEP),0,5000,STEP,COOLDOWN,RTT,true).waitsWithoutNotNow.length,1,'two steps after it');
});
test('a send 200 ms past its edge on a 0 ms clock step is a wait, with no role loop tick to excuse it',()=>{
  const log={ring:[],replies:[{at:1000,place:'attack',response:'data',failed:false,ms:null}],
    spends:[{at:0,method:'attack',edge:0},{at:2150,method:'attack',edge:0}],samples:[2000,2100].map(at=>({at,target:true,inRange:true,mpAttacks:true,party:{},tid:'goo1',skip:null}))};
  assert.equal(tc11(log,0,5000,0,COOLDOWN,RTT,true).waitsWithoutNotNow.length,1);
});
// W01's run of 2026-11-23 on c573fc423: Warcry faded on the server as the warrior's attack met a
// `cooldown` reply with 76 ms left, and the server's frequency correction (`skill_timeout` with
// reason `attack_ms`, server.js:1736-1744) moved next_skill.attack 310 ms on. The executor waits
// for that edge (executor.ts `readyAt`), so the gap runs from the edge the send carries.
test('a server skill_timeout after a cooldown reply moves the edge the gap runs from',()=>{
  const corrected=edge=>({ring:[],spends:[{at:-778,method:'attack',edge:-1563},{at:-28,method:'attack',edge:-63},{at:472,method:'attack',edge}],
    replies:[{at:-28,place:'attack',response:'cooldown',failed:true,ms:76}],
    samples:[24,124,224,324,424].map(at=>({at,target:true,inRange:true,mpAttacks:true,party:{},tid:'717',skip:null}))});
  assert.deepEqual(tc11(corrected(282),-5000,5000,250,826,48,false).waitsWithoutNotNow,[],'the send went one step after the corrected edge');
  assert.equal(tc11(corrected(-63),-5000,5000,250,826,48,false).waitsWithoutNotNow.length,1,'with no correction the same send is a wait');
});
