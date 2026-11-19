// No member of these fixtures is at an event: The tasks owner's `presence` answers none.
require('./helpers/requesters.cjs').publishPresence();
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRareRouteDistance}=require('../../runtime/movement/coordinator/planner-service.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/phoenix-patrol-regression-scenario.cjs');

scenarioTable('a Phoenix scan leg ends on every acknowledgement, survives a reload and ranks regions by planned length (MOV-150 to MOV-152)', fixture, [
 ['region transition waits for every convoy acknowledgement instead of cancelling the leader arrival', r=>{
 r.move({map:'main',x:0,y:0});r.controller().tick();
  const convoy=r.party.activeConvoy;r.move(r.controller().control('W').destination);
  r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.activeConvoy,convoy);assert.equal(r.party.rareHuntState.patrol.index,0);
  r.party.activeConvoy=null;r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,1);
 }],
 ['Steam runtime reload retries the same waypoint without consuming geometry fallback attempts', r=>{
 r.move({map:'main',x:804,y:-107});r.controller().tick();
  const destination=r.controller().control('W').destination;
  for(let i=0;i<3;i++) {
    r.party.activeConvoy={purpose:'phoenix-patrol',phase:'failed',failureCode:'runtime-lost'};
    r.controller().tick();assert.equal(r.controller().control('W'),null);
    const starts=r.starts();r.controller().tick();assert.equal(r.starts(),starts);assert.equal(r.controller().control('W'),null);
    r.advance(1);r.controller().tick();assert.deepEqual(r.controller().control('W').destination,destination);
    assert.equal(r.party.rareHuntState.patrol.index,0);assert.deepEqual(r.party.rareHuntState.patrol.incomplete,[]);
  }
 }],
 ['planner distance excludes incomplete routes and includes transition cost', async ()=>{
  const from={map:'main',x:0,y:0},to={map:'cave',x:30,y:40};
  const measure=createRareRouteDistance(async()=>({plot:[{map:'main',x:0,y:100},{map:'cave',x:0,y:0},to]}),()=>({version:1,fingerprint:'g'}));
  assert.equal(await measure(from,to),550);
  const bad=createRareRouteDistance(async()=>({plot:[]}),()=>({version:1,fingerprint:'g'}));
  await assert.rejects(bad(from,to),/Incomplete/);
 }],
]);

scenarioTable('the Phoenix patrol scans its regions, waits out respawns and yields to sightings (MOV-150, MOV-151)', fixture, [
 ['real snapshot selects a convoy-visible Phoenix over nearer passive chickens', ()=>{
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/targeting/snapshot.ts');
 const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
 const r=fixture();r.move({map:'main',x:-160,y:-181});
 Object.assign(r.party,{headlessSlots:['W','M','P'],steamMembers:[],merchantCharacter:null,partyFarmingMode:'default',combatLogs:{}});
 const hen={id:'chicken',mtype:'hen',map:'main',in:'main',x:-150,y:-181,priority:100,passiveRare:true};
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4,anchorVisible:true,candidates:[hen]};
 const ports={now:r.time,recoveryGroup:()=>null,intent:()=>({revision:1}),owned:()=>undefined,rareRejections:()=>[],
  prepare:x=>x,evaluate:evaluateGroup,pullsHeld:()=>false,patrolAcquisitionAllowed:()=>true};
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'chicken');
 r.party.statuses.P.rareSightings=[{id:'221923',mtype:'phoenix',x:-1215,y:338,hp:100,visible:true}];
 // The normal client candidate lists still contain only chickens: convoy nomination is suppressed.
 const selected=coordinatorGroupedSnapshot(r.party,ports);
 assert.equal(selected.target.id,'221923');assert.equal(selected.target.state,'planned');
 r.party.groupedCombat=null;ports.patrolAcquisitionAllowed=()=>false;
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'chicken');
 r.party.groupedCombat=null;ports.patrolAcquisitionAllowed=()=>true;
 r.party.statuses.W.groupedCombat.candidates.push({...hen,id:'fairy',mtype:'tinyp',priority:101});
 assert.equal(coordinatorGroupedSnapshot(r.party,ports).target.id,'fairy');
 }],
 ['fast report interrupts convoy and actual client nomination produces a selected Phoenix ring', ()=>{
 const {createCombatIntake}=require('../../runtime/status/coordinator/channel.ts');
 const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
 const r=fixture();r.move({map:'main',x:0,y:0});r.party.partyFarmingMode='default';
 for(const s of Object.values(r.party.statuses))s.groupedCombat={protocol:4,anchorVisible:true,candidates:[]};
 r.controller().tick();assert.ok(r.party.activeConvoy);
 const target={id:'seen-now',mtype:'phoenix',type:'monster',visible:true,hp:100,x:60,y:0,map:'main',in:'main',server:'USII'};
 const ingest=createCombatIntake(r.party.statuses,{now:r.time,groupedCombat(){},rareReport:(n,s)=>r.controller().report(n,s),rareTick:()=>r.controller().tick(),
  // The status owner's reply (reply.ts `createReply`): the combat sections, read or sent.
  reply:(()=>{const build=()=>({serverNow:r.time(),rareControl:r.controller().control('M'),convoySignal:r.party.activeConvoy,groupedCombat:null});return {read:build,send:build};})()});
 const res={status(){return this;},json(v){this.body=v;return this;}};
 ingest.handle('M',{combatSelection:{runtimeId:'M'},rareObservation:{at:r.time(),runtimeId:'M',map:'main',in:'main',server:'USII',x:0,y:0,sightings:[target]}},res);
 assert.equal(r.party.activeConvoy,null);assert.equal(res.body.rareControl.target.id,target.id);assert.equal(res.body.convoySignal,null);
 const c=require('./helpers/rare-client.cjs').rareQueueContext({entities:{p:target},character:{name:'M',map:'main',in:'main'},focus:['phoenix'],hunts:{},
  values:{isPassingEncounter:()=>false,passiveHunting:{rules:{}},groupedEntityReport:e=>({...e,priority:100}),monsterPriority:()=>100,isExternallyClaimedMonster:()=>false,get_entity:()=>target}});
 const candidates=c.queueCandidates();assert.equal(candidates[0].id,target.id);
 const members=Object.values(r.party.statuses).map(s=>({name:s.name,ctype:s.ctype,revision:1,status:{...s,range:200,groupedCombat:{protocol:4,anchorVisible:true,candidates:s.name==='M'?candidates:[]}}}));
 c.groupedCombat=evaluateGroup(null,members,'W',r.time(),0,false);
 assert.equal(c.groupedCombat.target.id,target.id);
 require('./helpers/queue-markers.cjs').installQueueMarkers(c);
 assert.equal(c.queueMarkers()[0].role,'current');assert.equal(c.queueMarkers()[0].visible,true);
 }],
 ['a full five-region circuit completes with real positions and endpoint dwell', r=>{
 let prior=0;const visited=[];
  for(let i=0;i<80 && visited.length<5;i++) {
    r.controller().tick();const control=r.controller().control('W');assert.ok(control);
    r.move(control.destination);r.party.activeConvoy=null;
    r.controller().tick();r.advance(1001);r.controller().tick();
    const next=r.party.rareHuntState.patrol.index;
    if(next!==prior){visited.push(prior);prior=next;}
  }
  assert.deepEqual(visited,[0,1,2,3,4]);assert.equal(prior,0);
 }],
 ['assisted kill stays in current region, waits from death through delayed loot and restart, then follows successor', r=>{
 const at=r.kill({map:'cave',x:-180,y:-1164},true);
  assert.equal(r.controller().control('W').allowPhoenixAssist,true);
  r.advance(18000);r.loot();
  assert.equal(r.party.phoenixPatrolCheckpoint.regionId,r.order[1]);
  // The game respawns a Phoenix up to 0.9 s after its 32 s respawn time.
  const ready=at+32900;assert.equal(r.party.phoenixPatrolCheckpoint.readyAt,ready);
  r.restart();assert.equal(r.party.rareHuntState.patrol.index,1);
  r.move(r.controller().control('W').destination);r.party.activeConvoy=null;
  r.advance(ready-r.time()-1);r.controller().tick();assert.equal(r.party.rareHuntState.patrol.index,1);
  r.advance(1);r.controller().tick();r.advance(1001);r.controller().tick();
  assert.equal(r.party.rareHuntState.patrol.index,2);
 }],
]);
