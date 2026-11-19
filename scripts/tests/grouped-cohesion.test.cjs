const assert=require('node:assert/strict');
require('./fixtures/coordinator-core.cjs');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,movement,cutOff}=require('./fixtures/grouped-cohesion-scenario.cjs');
function ready(m){return evaluateGroup(evaluateGroup(null,m,'W',1000),m,'W',1500);}
function nominate(m,id='A',revision=1){m[0].status.groupedCombat.candidates=[{id,mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}];Object.assign(m[0].status.combatSelection,{id,revision,map:'cave',target:{id,mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}});}
scenarioTable("the coordinator's group readiness, anchor and nomination hold the party together", ()=>fixture, [
 ['one target is committed only after every member acknowledges the exact revision', fixture=>{
  const m=fixture();nominate(m);let g=ready(m);assert.equal(g.committed,false);
  for(const member of m)member.status.groupedCombat.ack=g.selection;
  g=evaluateGroup(g,m,'W',1600);assert.equal(g.committed,true);
  m[0].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1650}];
  nominate(m,'B',2);const next=evaluateGroup(g,m,'W',1700);assert.equal(next.committed,false);
  assert.notEqual(next.selection,g.selection);assert.equal(next.target.id,'B');}],
 // targeting's queue rules on evaluateGroup: readiness, the anchor and the unfinished fight. cut
 // them with the movement rows; they are v1.5.0's rows.
 ['current attackers supersede a neutral nomination while preserving unfinished fights', fixture=>{
 const m=fixture();nominate(m,'hound');let g=ready(m);
 m[1].status.groupedCombat.threats=[{id:'boar',mtype:'boar',map:'cave',in:'cave',x:30,y:0}];
 g=evaluateGroup(g,m,'W',1600);
 assert.equal(g.target.id,'boar');assert.deepEqual(g.fights.map(f=>f.id),['boar']);
 assert.deepEqual(g.threats.map(f=>f.id),['boar']);
 m[0].status.groupedCombat.threats=[{id:'other',mtype:'boar',map:'cave',in:'cave',x:40,y:0}];
 g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'boar','retain focus among active attackers');}],
 ['wrong-map member recovers without blocking participating fighters', fixture=>{
  const m=fixture();m[2].status.map='main';
  const g=ready(m);assert.equal(g.ready,true);assert.deepEqual(g.recovering,['M']);
  m[2].status.map='cave';const reunited=evaluateGroup(g,m,'W',1600);assert.equal(reunited.ready,true);assert.deepEqual(reunited.recovering,['M']);
  assert.equal(evaluateGroup(reunited,m,'W',2100).ready,true);}],
 ['separated member does not block the next committed fight', fixture=>{
  const m=fixture();nominate(m);let g=ready(m);
  m.forEach(member=>member.status.groupedCombat.ack=g.selection);g=evaluateGroup(g,m,'W',1600);
  m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1600,action:'hit',state:'engaged'}];m[2].status.x=500;m[2].status.groupedCombat.anchorVisible=false;g=evaluateGroup(g,m,'W',1700);
  assert.equal(g.ready,true);assert.equal(g.committed,true);assert.equal(g.phase,'engaged');assert.deepEqual(g.recovering,['M']);
  m[0].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1650}];
  nominate(m,'B',2);g=evaluateGroup(g,m,'W',1800);assert.equal(g.committed,false);
  m.slice(0,2).forEach(member=>member.status.groupedCombat.ack=g.selection);
  assert.equal(evaluateGroup(g,m,'W',1900).committed,false);}],
 ['unavailable members still block new pulls while unavailable priests release healing-anchor ownership', fixture=>{
  for(const [mutate,priest] of [[m=>m[1].status=undefined,null],[m=>m[1].status.rip=true,null],[m=>m[1].status.seenAt=-5000,null],
    [m=>m[1].status.groupedCombat.protocol=0,'P'],[m=>m[1].cancelled=true,null]]) {
    const m=fixture();mutate(m);const g=ready(m);assert.equal(g.ready,false);assert.equal(g.priest,priest);
    assert.equal(g.anchor?.name,priest || 'W');
  }}],
 ['runtime replacement invalidates commitment and old acknowledgements', fixture=>{
  const m=fixture();nominate(m);let g=ready(m);m.forEach(member=>member.status.groupedCombat.ack=g.selection);
  g=evaluateGroup(g,m,'W',1600);m[2].status.combatSelection.runtimeId='new-runtime';
  const changed=evaluateGroup(g,m,'W',1700);assert.equal(changed.committed,false);assert.notEqual(changed.selection,g.selection);}],
 ['priestless groups use leader spacing; no target still reports regrouping', fixture=>{
  const m=fixture().filter(m=>m.name!=='P');m[1].status.x=300;m[1].status.groupedCombat.anchorVisible=false;
  const g=ready(m);assert.equal(g.range,150);assert.equal(g.anchor.name,'W');assert.equal(g.phase,'ready');assert.deepEqual(g.recovering,['M']);assert.equal(g.target,null);}],
 ['readiness has inward hysteresis before recovering and does not flicker at the edge', fixture=>{
  const m=fixture();let g=ready(m);m[2].status.x=198;
  g=evaluateGroup(g,m,'W',1600);assert.equal(g.ready,true);
  m[2].status.x=205;m[2].status.groupedCombat.anchorVisible=false;g=evaluateGroup(g,m,'W',1700);assert.deepEqual(g.recovering,['M']);
  m[2].status.x=198;m[2].status.groupedCombat.anchorVisible=true;g=evaluateGroup(g,m,'W',1800);assert.deepEqual(g.recovering,['M']);
  m[2].status.x=180;g=evaluateGroup(g,m,'W',1900);assert.deepEqual(g.recovering,['M']);
  assert.deepEqual(evaluateGroup(g,m,'W',2400).recovering,[]);}],
 ['separated leader retains shared selection authority and holds neutral pulls', fixture=>{const m=fixture();m[0].status.x=500;m[0].status.groupedCombat.anchorVisible=false;nominate(m);const g=ready(m);assert.equal(g.targetLeader,'W');assert.equal(g.committed,false);}],
 ['unfinished rat survives selector separation, vanished nomination and runtime replacement', fixture=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m.forEach(member=>member.status.groupedCombat.ack=g.selection);g=evaluateGroup(g,m,'W',1600);
 m[0].status.x=500;m[0].status.groupedCombat.anchorVisible=false;m[0].status.combatSelection.target=null;
 m[2].status.combatSelection={id:'rat2',revision:3,runtimeId:'mage2',map:'cave',target:{id:'rat2',mtype:'cgoo',map:'cave',in:'cave',x:20,y:0}};
 g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'rat1');assert.equal(g.targetLeader,'W');
 m[2].status.combatSelection.runtimeId='reloaded';g=evaluateGroup(g,m,'W',1800);assert.equal(g.target.id,'rat1');
 assert.equal(g.committed,true);assert.equal(g.fights.length,1);}],
 ['only matching realm, instance and target death releases the unfinished fight', fixture=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m[0].status.combatSelection.target=null;
 for(const death of [{id:'rat2'},{id:'rat1',in:'different'},{id:'rat1',server:'USIII'}]) {
  m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1600,...death}];
  g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'rat1');
 }
 m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1800}];
 assert.equal(evaluateGroup(g,m,'W',1800).target,null);}],
 ['existing attackers remain locked after the original dies; neutral nomination waits', fixture=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m[2].status.groupedCombat.threats=[{id:'rat2',mtype:'cgoo',map:'cave',in:'cave',x:40,y:0}];
 g=evaluateGroup(g,m,'W',1600);
 m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1700}];nominate(m,'rat3',3);
 g=evaluateGroup(g,m,'W',1800);assert.equal(g.target.id,'rat2');assert.equal(g.fights.length,1);
 m[0].status.groupedCombat.state=g;
 assert.equal(evaluateGroup(null,m,'W',1900).target.id,'rat2','coordinator restart restores reports');}],
 ['explicit farming reset excludes older cached fight reports', fixture=>{
 const m=fixture();nominate(m,'rat1');const g=ready(m);m[0].status.groupedCombat.state=g;
 m[0].status.combatSelection.target=null;m[0].status.groupedCombat.candidates=[];
 assert.equal(evaluateGroup(null,m,'W',2000,1900).target,null);}],
 ['full-party wipe retains confirmed engagement until explicit reset or target death', fixture=>{
 const m=fixture();nominate(m);m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];const before=ready(m);
 for(const member of m)Object.assign(member.status,{map:'main',in:'main',seenAt:2000,lastDeath:{at:1800},combatSelection:{id:null,map:null,revision:2,runtimeId:'respawn'}});
 const after=evaluateGroup(before,m,'W',2000);assert.equal(after.fights.length,1);assert.equal(after.target.id,'A');}],
 ['one death or an ongoing attack retains unfinished-fight protection', fixture=>{
 for(const caseName of ['survivor','attacker']){
  const m=fixture();nominate(m);m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];const before=ready(m);
  for(const member of m)Object.assign(member.status,{seenAt:2000,lastDeath:{at:1800}});
  if(caseName==='survivor')delete m[1].status.lastDeath;
  else m[1].status.groupedCombat.threats=[{id:'A',mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}];
  assert.equal(evaluateGroup(before,m,'W',2000).target.id,'A');
 }}],
]);

// The regroup's walk is the task round (protocol/ladder.ts taskRound). Once its native steps'
// walking try stalls, a cut-off member climbs it toward its anchor, by the saved farm spot when the
// direct way fails, and no count holds new pulls.
scenarioTable("a member's regroup walks back to its group and climbs its task ladder when cut off", ()=>movement, [
 ['a cut-off member keeps climbing toward its group by the saved farm spot', async ()=>{
  // The member's first regroup, then `times` more after its walking try stalled.
  const stalled=f=>{f.c.groupedMovement();f.at(4000);
    return async times=>{for(let i=0;i<times;i++){f.c.groupedMovement();await new Promise(resolve=>setImmediate(resolve));}};};
  const f=cutOff(),ladders=f.ladders;
  await stalled(f)(7);
  assert.deepEqual(f.paths.map(p=>[p.map,p.x]),[['cave',200],['main',500],['cave',200],['cave',200],['cave',200]]);
  assert.equal(Object.keys(ladders).length,1,'one climb per anchor and navigation revision');
  // Held new pulls after three regroup routes; five failed routes later the member still
  // reads as regrouping, with no count in its reason.
  assert.equal(f.c.root.partyCombatPosition.mode,'group-regrouping');
  assert.doesNotMatch(String(f.c.root.partyCombatPosition.reason),/holding new pulls|attempts/);
  // Progress returns the climb to its first rung: the walk by the farm spot reaches the
  // anchor's map, a map the climb has not visited.
  const progress=cutOff(),climb=stalled(progress);
  progress.c.smart_move=destination=>{progress.paths.push(destination);
    if(destination.map==='main')Object.assign(progress.c.character,{map:'cave',in:'cave',x:0,y:0});return Promise.reject(Error('no route'));};
  await climb(2);
  assert.deepEqual(progress.paths.map(p=>[p.map,p.x]),[['cave',200],['main',500]]);
  const {rung,index,failures}=Object.values(progress.ladders)[0].report();
  assert.deepEqual({rung,index,failures},{rung:'walk',index:0,failures:0});}],
 // W rows shared.js:14634:14656: a member standing short of its anchor climbs once its walking try
 // stalls, one measured round trip after its last progress, not after a fixed 3 s.
 ['a stalled regroup climbs on its walking try, not after a fixed window', async ()=>{
  const f=cutOff({roundTrip:()=>200,reportInterval:()=>1000}),ladders=f.ladders;
  f.c.groupedMovement();f.at(1150);f.c.groupedMovement();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(Object.keys(ladders).length,0,'within one round trip of its last progress');
  f.at(1250);f.c.groupedMovement();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(Object.keys(ladders).length,1,'a round trip later the climb starts (red: waits 3 s)');}],
 ['lost visibility delegates to local recovery without smart routing and resets on reacquisition', movement=>{
 const f=movement();let calls=0,resets=0;
 f.c.root.partyQueueClient={sight:{tick(){calls++;return true;},reset(){resets++;}}};
 Object.assign(f.c.groupedCombat,{selection:'rat',fights:[{id:'rat'}],target:{id:'rat',x:200,y:200,map:'main',in:'main',server:'USII'}});
 f.c.groupedMovement();f.at(10000);f.c.groupedMovement();assert.equal(calls,2);assert.equal(f.paths.length,0);
 f.c.get_entity=()=>({id:'rat',visible:true});f.c.is_in_range=()=>true;f.c.groupedMovement();assert.equal(resets,1);}],
 ['announced convoy owns movement before its local command arrives', movement=>{
  const f=movement();f.c.partyConvoyActive=true;
  f.c.character.name='P';f.c.character.moving=true;
  let stops=0;f.c.stop=()=>{stops++;return Promise.resolve();};
  assert.equal(f.c.groupedMovement(),true);f.at(10000);f.c.groupedMovement();
  assert.equal(stops,0);assert.equal(f.moves.length,0);assert.equal(f.paths.length,0);}],
]);
