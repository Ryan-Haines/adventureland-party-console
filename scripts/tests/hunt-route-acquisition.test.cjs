const test=require('node:test'),assert=require('node:assert/strict');
const {engageWalk,validReport}=require('../../runtime/movement/coordinator/walk.ts'),legacy={engage:engageWalk,validReport};
const {engageHunt,propagateHuntTarget,createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
function fixture(){
 const original={map:'main',x:1000,y:1000,boundary:[900,900,1100,1100]}, encounter={map:'main',x:110,y:0,boundary:[80,-30,140,30]};
 const state={nextCommandId:10,leader:'A',followers:{B:true},partyFarmingMode:'default',targetMode:'hunt',
  activeConvoy:{id:'c',epoch:2,phase:'travel',departAt:1000,purpose:'monster-hunt',huntTarget:'bee',combatHandoffAllowed:true,
   participants:['A','B'],completed:[],location:original,runtimes:{A:'r',B:'b'}},
  commands:{A:{id:3,type:'party-monster-travel',convoyId:'c',epoch:2,navigationRevision:7},B:{id:4,type:'party-monster-travel',convoyId:'c',epoch:2,navigationRevision:8}},
  monsterHunt:{stage:'mission-travel',cycleId:'h',convoyId:'c',currentIndex:0,target:'bee',participants:['A','B'],missions:[{target:'bee',owners:['A'],destination:original}],owner:'A',selectionLeader:'A'},
  statuses:{},navigationIntents:{A:{revision:7},B:{revision:8}},characterLocations:{},location:original,
  monsterChoices:[{id:'bee',locations:[original,encounter]}],monsterFocus:['goo'],monsterSearchRadiusByCharacter:{A:100},combatLogs:{}};
 for(const name of ['A','B'])state.statuses[name]={seenAt:2000,hp:100,server:'USII',map:'main',in:'main',x:20,y:0,monsterHunt:{id:'bee',count:10,remainingMs:900000}};
 const body={character:'A',convoyId:'c',epoch:2,commandId:3,runtimeId:'r',navigationRevision:7,target:{id:'bee1',mtype:'bee',map:'main',in:'main',x:110,y:0}};
 const options={revisions:{A:7,B:8},radius:100,focus:['bee']};
 return {state,body,options,original,encounter};
}

for (const phase of ['assemble','shared-prepare','travel']) test('Hunt route rejects early handoff during '+phase,()=>{
 const r=fixture();r.state.activeConvoy.phase=phase;
 for (const name of ['A','B']) {
  r.body.character=name;
  assert.equal(engageHunt(r.state,r.body,r.options,legacy,2000),false);
  assert.equal(r.state.activeConvoy.location,r.original);
  assert.equal(r.state.monsterHunt.stage,'mission-travel');
  assert.equal(r.state.monsterHunt.missions[0].destination,r.original);
  assert.ok(r.state.commands[name]);
 }
});
test('replacement commands disable legacy early handoff and retain the attack-while-moving target',()=>{
 const r=fixture();propagateHuntTarget(r.state);
 assert.equal(r.state.commands.B.huntTarget,'bee');assert.equal(r.state.commands.B.combatHandoffAllowed,false);
});
// The mission walk through the hunting owner's Hunt service (hunt.ts `createHunt`).
function travelFixture() {
 const r=fixture(), starts=[], names=['A','B'];
 r.state.activeConvoy=null;r.state.commands={};r.state.monsterHunt.missions[0].destinationVersion=1;
 require('./helpers/travel-observations.cjs').observeTravel(r.state.statuses);
 const service=createHunt(r.state,{now:()=>2000,participants:()=>names,online:()=>true,ownsTravel:()=>false,
  cancelConvoy(){r.state.activeConvoy=null;},persist(){},selectedDestination:()=>null,
  start(location){starts.push(location);r.state.activeConvoy={id:'c'+starts.length,purpose:'monster-hunt',phase:'assemble',location,participants:names};return true;},
  navigation:{authorize(){},intent:n=>r.state.navigationIntents[n]}});
 r.tick=()=>{service.tick();r.state.activeConvoy=null;};r.starts=starts;return r;
}
test('missing convoy is not proof of arrival; nearby bees and active combat cannot release the route',()=>{
 const r=travelFixture();r.tick();assert.equal(r.starts.length,1);assert.equal(r.state.monsterHunt.stage,'mission-travel');
});
test('all members must enter the spawn area, with fresh living same-instance positions',()=>{
 for(const invalid of ['outside','stale','dead','instance']) {
  const r=travelFixture();for(const s of Object.values(r.state.statuses))Object.assign(s,r.original);
  const b=r.state.statuses.B;
  if(invalid==='outside')b.x-=101;if(invalid==='stale')b.seenAt=-2000;
  if(invalid==='dead')b.hp=0;if(invalid==='instance')b.in='other';
  r.tick();assert.equal(r.state.monsterHunt.stage,'mission-travel',invalid);
  assert.equal(r.state.monsterHunt.originArrivedAt,undefined);
 }
});
test('whole-party spawn arrival enables free farming, which may then spread beyond the area',()=>{
 const r=travelFixture();for(const s of Object.values(r.state.statuses))Object.assign(s,r.original);
 r.tick();assert.equal(r.state.monsterHunt.stage,'farming');assert.equal(r.state.monsterHunt.originArrivedAt,2000);
 r.state.statuses.B.x-=200;r.tick();assert.equal(r.starts.length,0);
});
test('previous premature farming state repairs toward the saved origin despite nearby combat',()=>{
 const r=travelFixture();r.state.monsterHunt.stage='farming';r.tick();
 assert.equal(r.starts.length,1);assert.equal(r.starts[0],r.original);
});
// The acquisition log wrote at most one line per channel per 2 s and repeated a line after 10 s, so
// a candidate that changed inside 2 s never showed. It now writes each change of candidate or reason
// at once, and a repeat only counts, carried on the next line.
test('the Hunt acquisition log writes each change of candidate or reason with the repeat count',()=>{
 const {installHuntClient}=require('../../runtime/hunting/character/hunt.ts');
 const lines=[];
 const ports={character:()=>({name:'A',map:'main',x:0,y:0}),radius:()=>100,log:(kind,message,details)=>lines.push([message,details.candidate?.id??null,details.previousRepeats])};
 const client=installHuntClient(new Proxy(ports,{get:(t,k)=>k in t?t[k]:()=>null}));
 const command={huntTarget:'bee',convoyId:'c'},bee=id=>({id,mtype:'bee',x:1,y:0});
 client.log(command,bee('b1'),'outside search radius');
 client.log(command,bee('b1'),'outside search radius');client.log(command,bee('b1'),'outside search radius');
 client.log(command,bee('b2'),'outside search radius');
 client.log(command,bee('b2'),'not visible');
 client.log(command,bee('b2'),'not visible',{},'response');
 assert.deepEqual(lines,[['Hunt acquisition: outside search radius','b1',0],['Hunt acquisition: outside search radius','b2',2],
  ['Hunt acquisition: not visible','b2',0],['Hunt acquisition: not visible','b2',0]]);
});
