const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const legacy=require('../convoy-navigation.cjs');
const {engageHunt,propagateHuntTarget}=require('../../runtime/coordinator/hunt/engagement.ts');
const {createConvoyEngagementRoutes}=require('../../runtime/coordinator/http/convoy-engagement.ts');
const safety=require('../hunt-safety.cjs');
const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
function fixture(){
 const original={map:'main',x:1000,y:1000,boundary:[900,900,1100,1100]}, encounter={map:'main',x:110,y:0,boundary:[80,-30,140,30]};
 const state={nextCommandId:10,leader:'A',partyFarmingMode:'default',farmingPolicy:'hunt',
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

for (const phase of ['assemble','shared-prepare','scheduled','travel']) test('Hunt route rejects early handoff during '+phase,()=>{
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
function travelFixture() {
 const r=fixture(), starts=[];
 r.state.activeConvoy=null;r.state.monsterHunt.missions[0].destinationVersion=1;
 const ports={now:()=>2000,fresh:()=>true,ownsTravel:()=>false,destination:()=>r.original,
  contains:require('../../dashboard/lib/farming-zones.ts').contains,arrivalProtected:()=>false,partyFighting:()=>true,persist(){},
  start(h,d,l,stage){starts.push(d);h.stage=stage;},advance(){throw Error('unexpected advance')}};
 r.tick=()=>createHuntTravel(r.state,ports).step(r.state.monsterHunt);r.starts=starts;return r;
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
test('client does not send a Hunt handoff request or stop an installed route',()=>{
 const {namedFunction}=require('./helpers/named-function.cjs');
 const c=vm.createContext({Date,request(){throw Error('must not request handoff')},stop(){throw Error('must not stop')}});
 vm.runInContext(namedFunction(fs.readFileSync('characters/shared.js','utf8'),'sharedConvoyEngagement'),c);
 c.sharedConvoyEngagement({}, {purpose:'monster-hunt',combatHandoffAllowed:true},()=>true,()=>{});
});
