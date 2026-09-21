const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const legacy=require('../convoy-navigation.cjs');
const {engageHunt,propagateHuntTarget}=require('../../runtime/coordinator/hunt/engagement.ts');
const {createConvoyEngagementRoutes}=require('../../runtime/coordinator/http/convoy-engagement.ts');
const safety=require('../hunt-safety.cjs');
const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
function fixture(){
 const original={map:'main',x:1000,y:1000}, encounter={map:'main',x:110,y:0,boundary:[80,-30,140,30]};
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
test('hunt handoff adopts the earlier bee spawn and keeps followers and recovery there',()=>{
 const {state,body,original}=fixture();let now=2000,response;
 const routes=createConvoyEngagementRoutes(state,{now:()=>now,owned:()=>true,intent:n=>state.navigationIntents[n],group:()=>({ready:true,anchor:{map:'main'},blockers:[]}),
  engage:(body,options)=>engageHunt(state,body,options,legacy,now),acceptArrival:(c,b,t)=>safety.acceptArrival(state.monsterHunt,c,b,t),persist(){}});
 routes.engage({body},{status(code){throw new Error('HTTP '+code)},json(value){response=value;}});
 assert.equal(response.ok,true);assert.equal(state.activeConvoy,null);assert.equal(state.monsterHunt.stage,'farming');
 assert.equal(state.monsterHunt.missions[0].destination.x,110);assert.equal(response.location.x,110);
 assert.equal(state.commands.A,undefined);assert.equal(state.commands.B.location.x,110);
 assert.equal(state.location.x,110);assert.equal(state.characterLocations.B.x,110);assert.equal(original.x,1000);
 now=15000;for(const s of Object.values(state.statuses)){s.seenAt=now;s.x=110;}
 delete state.commands.B;
 const travel=createHuntTravel(state,{now:()=>now,fresh:()=>true,ownsTravel:()=>false,
  destination:h=>safety.missionDestination(h,()=>original),contains:require('../../dashboard/lib/farming-zones.ts').contains,
  arrivalProtected:()=>false,partyFighting:()=>false,start(){throw new Error('must not double back')},persist(){}});
 travel.step(state.monsterHunt);
 assert.equal(state.monsterHunt.stage,'farming');
});
test('hunt acquisition fails closed on stale identities, positions, wrong type and service travel',()=>{
 for(const change of [r=>r.body.epoch++,r=>r.body.commandId++,r=>r.body.runtimeId='old',r=>r.body.navigationRevision++,
  r=>r.body.target.mtype='goo',r=>r.body.target.in='other',r=>r.body.target.map='cave',r=>r.body.target.x=121,
  r=>r.body.target.x=NaN,r=>r.state.statuses.A.seenAt=-2000,r=>r.state.statuses.A.rip=true,
  r=>r.state.activeConvoy.phase='shared-prepare',r=>r.state.activeConvoy.combatHandoffAllowed=false,
  r=>r.state.monsterHunt.stage='returning',r=>r.state.monsterHunt.convoyId='new',r=>r.state.navigationIntents.B.cancelled=true]){
  const r=fixture();change(r);assert.equal(engageHunt(r.state,r.body,r.options,legacy,2000),false);assert.ok(r.state.activeConvoy);assert.equal(r.state.location,r.original);
 }
});
test('uncatalogued encounter retains the mission destination; duplicate cannot cancel a later route',()=>{
 const r=fixture();r.state.monsterChoices=[];const previous=r.state.activeConvoy;
 assert.equal(engageHunt(r.state,r.body,r.options,legacy,2000),true);
 assert.equal(r.state.location.x,110);
 assert.deepEqual(r.state.monsterHunt.missions[0].destination,r.original);
 assert.equal(r.state.monsterHunt.encounter.target.id,r.body.target.id);
 r.state.activeConvoy={...previous,id:'new'};
 assert.equal(engageHunt(r.state,r.body,r.options,legacy,2000),false);assert.equal(r.state.activeConvoy.id,'new');
});
test('replacement phase commands retain the hunt target',()=>{
 const r=fixture();propagateHuntTarget(r.state);assert.equal(r.state.commands.B.huntTarget,'bee');assert.equal(r.state.commands.B.combatHandoffAllowed,true);
});
test('solo hunt candidate lookup rejects claimed, wrong-type and party-assigned targets',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const c=require('./helpers/client-dependencies.cjs').passingContext({huntCombatTarget:'bee',character:{map:'main',in:'main',x:0,y:0},groupedFarming:()=>false,
  activeCombatEvent:()=>false,joinedEvent:null,travelCombatActive:()=>false,isAttackingPartyMember:t=>!!t.target,
  monsterSearchRadius:100,isAllowedTarget:t=>!t.claimed,farmingMode:'scatter',partyTargets:[{id:'assigned'}],parent:{entities:{}}});
 vm.runInContext('var routine={'+source.slice(source.indexOf('    getCloserHuntTarget: function'),source.indexOf('    getRareTarget: rareTarget'))+'};',c);
 const current={id:'old',mtype:'bee',x:80,y:0};
 const near={id:'near',type:'monster',mtype:'bee',x:30,y:0,visible:true,hp:10};
 c.parent.entities={near,claimed:{...near,id:'claimed',x:2,claimed:true},goo:{...near,id:'goo',mtype:'goo',x:1},assigned:{...near,id:'assigned',x:3}};
 assert.equal(c.routine.getCloserHuntTarget(current),near);
 current.target='A';assert.equal(c.routine.getCloserHuntTarget(current),null);
});
test('client scans around itself for reachable hunt type despite destination boundary and travel defense',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const c=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>true,character:{map:'main',in:'main',x:0,y:0},monsterFocus:['goo'],monsterSearchRadius:100,
  farmingMode:'default',monsterPriority:()=>50,isAllowedTarget:t=>!t.claimed,parent:{entities:{}},is_in_range:()=>false,can_move_to:x=>x!==10});
 vm.runInContext(source.slice(source.indexOf('  function farmingTravelTarget('),source.indexOf('  function navigationDestinationLabel(')),c);
 const command={purpose:'monster-hunt',huntTarget:'bee',combatHandoffAllowed:true,location:{map:'main',x:1000,y:1000}};
 const bee={id:'bee',type:'monster',mtype:'bee',map:'main',in:'main',visible:true,hp:100,x:50,y:0};
 c.parent.entities={bee,wall:{...bee,id:'wall',x:10},goo:{...bee,id:'goo',mtype:'goo',x:1}};
 assert.equal(c.farmingTravelTarget(command),bee);
 for(const change of [t=>t.dead=true,t=>t.hp=0,t=>t.visible=false,t=>t.claimed=true,t=>t.x=101,t=>t.in='other']){
  c.parent.entities={bad:{...bee}};change(c.parent.entities.bad);assert.equal(c.farmingTravelTarget(command),null);
 }
 c.parent.entities={bee};command.combatHandoffAllowed=false;assert.equal(c.farmingTravelTarget(command),null);
});

function groupedClient(){
 const source=fs.readFileSync('characters/shared.js','utf8'),logs=[];
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{},character:{name:'A',map:'main',in:'main',x:20,y:0},parent:{entities:{}},
  groupedFarming:()=>true,groupedCombat:{protocol:4,target:null,fights:[],committed:false},groupedFresh:()=>true,
  reunionRealm:()=> 'USII',travelCombatActive:()=>true,departureTargetEngaged:()=>false,
  isExternallyClaimedMonster:t=>!!t.claimed,isAttackingPartyMember:()=>false,farmApproach:{failed:{}},
  convoyTraveling:null,monsterSearchRadius:100,farmingMode:'default',monsterFocus:['goo'],
  is_in_range:()=>false,can_move_to:x=>x!==40,queueCombatEvent:(...args)=>logs.push(args)});
 for(const [start,end] of [
  ['  function leaderLockAllows(', '  function publishCombatSelection('],
  ['  function unfinishedFight()', '  function unfinishedFight()'],
  ['  function isAllowedTarget(', '  function sameEventTeamMember('],
  ['  function groupedAttackAllowed(', '  var groupRegroup ='],
  ['  function farmingTravelTarget(', '  function navigationDestinationLabel('],
  ['  function sharedConvoyEngagement(', '  async function prepareSharedConvoyRoute('],
 ]) {
  const from=source.indexOf(start);
  const to=start===end?source.indexOf('\n',from):source.indexOf(end,from+start.length);
  assert.ok(from>=0 && to>from, start+' source boundaries');
  vm.runInContext(source.slice(from,to),c);
 }
 return {c,logs};
}

test('real grouped lock permits travel nomination and handoff but still gates attacks',async()=>{
 const {c,logs}=groupedClient(),r=fixture();
 r.state.monsterHunt.target='cgoo';r.state.monsterHunt.missions[0].target='cgoo';r.state.activeConvoy.huntTarget='cgoo';
 const command={...r.state.commands.A,purpose:'monster-hunt',huntTarget:'cgoo',combatHandoffAllowed:true,location:r.original};
 const target={...r.body.target,id:'cgoo1',mtype:'cgoo',type:'monster',visible:true,hp:100};
 c.parent.entities={target};
 assert.equal(c.leaderLockAllows(target),false);
 assert.equal(c.farmingTravelTarget(command),target);
 assert.equal(c.groupedAttackAllowed(target),false);
 let stops=0,detached=0,requests=0;
 const convoy={detachRoute(){detached++;}};
 const routes=createConvoyEngagementRoutes(r.state,{now:()=>2000,owned:()=>true,intent:n=>r.state.navigationIntents[n],
  group:()=>({ready:true,anchor:{map:'main'},blockers:[]}),engage:(b,o)=>engageHunt(r.state,b,o,legacy,2000),
  acceptArrival:(cv,b,t)=>safety.acceptArrival(r.state.monsterHunt,cv,b,t),persist(){}});
 Object.assign(c,{sharedConvoyIdentity:()=>({...r.body,target:undefined}),releaseConvoyCruise(){},stop:()=>{stops++;},
  request:(path,options)=>{requests++;assert.equal(path,'/convoy-engage');return new Promise((resolve,reject)=>{
   routes.engage(options,{status(code){return {json(value){reject(new Error(code+': '+value.error));}};},json:resolve});
  });}});
 c.sharedConvoyEngagement(convoy,command,()=>!convoy.cancelled,()=>{});
 await new Promise(setImmediate);
 assert.equal(requests,1);assert.equal(convoy.engaged,true);assert.equal(detached,1);assert.equal(stops,1);
 assert.equal(r.state.activeConvoy,null);assert.equal(r.state.monsterHunt.stage,'farming');
 assert.equal(c.partyLocation.x,110);assert.equal(c.combatTargetId,'cgoo1');
 c.travelCombatActive=()=>false;
 assert.equal(c.groupedAttackAllowed(target),false,'handoff alone does not authorize an attack');
 c.groupedCombat.target={...target,server:'USII',state:'selected'};
 assert.equal(c.groupedAttackAllowed(target),false,'uncommitted selection stays gated');
 c.groupedCombat.committed=true;assert.equal(c.groupedAttackAllowed(target),true);
 assert.ok(logs.some(e=>e[1]==='Hunt acquisition: handoff accepted'));
});

test('grouped hunt scan retains safety, chooses a new nearest candidate, and rate limits rejection logs',()=>{
 const {c,logs}=groupedClient();let now=10000;c.Date={now:()=>now};
 const command={purpose:'monster-hunt',huntTarget:'cgoo',combatHandoffAllowed:true,location:{map:'main',x:1000,y:1000}};
 const target={id:'c1',type:'monster',mtype:'cgoo',map:'main',in:'main',visible:true,hp:100,x:100,y:0};
 c.parent.entities={target};assert.equal(c.farmingTravelTarget(command),target);
 const closer={...target,id:'c2',x:60};c.parent.entities.closer=closer;
 assert.equal(c.farmingTravelTarget(command),closer);
 for(const change of [t=>t.claimed=true,t=>t.hp=-1,t=>t.dead=true,t=>t.in='other',t=>t.x=121,t=>t.x=40,
  ()=>c.farmApproach.failed.c1=now+10000,()=>c.groupedCombat.fights=[{id:'old'}],
  ()=>c.navigationIntent={cancelled:true},()=>c.escapeOwns=()=>true,()=>c.activeCombatEvent=()=>true]){
  // Apply each mutation to the same runtime, restoring all independent safety flags afterward.
  c.parent.entities={target:{...target}};change(c.parent.entities.target);
  assert.equal(c.farmingTravelTarget(command),null);
  c.farmApproach.failed={};c.groupedCombat.fights=[];c.navigationIntent={};c.escapeOwns=()=>false;c.activeCombatEvent=()=>false;
 }
 c.parent.entities={target:{...target,x:40}};now+=10000;
 assert.equal(c.farmingTravelTarget(command),null);const count=logs.length;
 for(let i=0;i<50;i++)c.farmingTravelTarget(command);
 assert.equal(logs.length,count);assert.equal(logs.at(-1)[1],'Hunt acquisition: attack position unreachable');
 now+=10000;c.farmingTravelTarget(command);assert.equal(logs.length,count+1);
});

test('a delayed handoff response cannot stop a newer client journey',async()=>{
 const {c}=groupedClient();let respond,stops=0;
 const command={purpose:'monster-hunt',huntTarget:'cgoo',combatHandoffAllowed:true,location:{map:'main',x:1000,y:1000}};
 c.parent.entities={target:{id:'c1',type:'monster',mtype:'cgoo',map:'main',in:'main',visible:true,hp:100,x:100,y:0}};
 const convoy={detachRoute(){throw Error('must retain newer route');}};
 let owns=true;Object.assign(c,{sharedConvoyIdentity:()=>({}),releaseConvoyCruise(){},stop(){stops++;},request:()=>new Promise(resolve=>respond=resolve)});
 c.sharedConvoyEngagement(convoy,command,()=>owns,()=>{});owns=false;
 respond({ok:true,handoff:'temporary',location:{map:'main',x:100,y:0},serverNow:2000});
 await new Promise(setImmediate);assert.equal(stops,0);assert.equal(convoy.engaged,undefined);
});

 test('handoff success is logged even immediately after a rejected attempt',()=>{
  const {c,logs}=groupedClient(),command={huntTarget:'cgoo'};c.Date={now:()=>1000};
  c.huntAcquisitionLog(command,null,'handoff rejected',null,'response');
  c.huntAcquisitionLog(command,null,'handoff accepted',null,'response');
  assert.deepEqual(logs.map(e=>e[1]),['Hunt acquisition: handoff rejected','Hunt acquisition: handoff accepted']);
 });

test('conflict relocation keeps acquisition disabled on every Hunt travel tick and rejects stale requests',()=>{
 const r=fixture(),h=r.state.monsterHunt,c=r.state.activeConvoy;c.cause='farming-conflict';h.travelCause='farming-conflict';
 const travel=createHuntTravel(r.state,{fresh:()=>true,now:()=>2000,ownsTravel:()=>false});
 travel.step(h);assert.equal(c.combatHandoffAllowed,false);assert.equal(r.state.commands.A.combatHandoffAllowed,false);
 c.combatHandoffAllowed=true;assert.equal(engageHunt(r.state,r.body,r.options,legacy,2000),false);assert.equal(r.state.activeConvoy,c);
 c.combatHandoffAllowed=false;propagateHuntTarget(r.state);assert.equal(r.state.commands.B.combatHandoffAllowed,false);
});
