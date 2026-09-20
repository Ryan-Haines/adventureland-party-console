const test = require('node:test'), assert = require('node:assert/strict');
const {classifyTravelDefense, retireTravelTargets, travelCombatFor} = require('../../runtime/coordinator/navigation/travel-defense.ts');
const defense = require('../../runtime/coordinator/navigation/convoy-defense.ts');
const {evaluateGroup} = require('../../runtime/combat/grouped.ts');
const {createHuntConvoy} = require('../../runtime/coordinator/hunt/convoy.ts');
const {huntLootPending} = require('../../runtime/coordinator/hunt/loot.ts');
const target = {id:'bee1',mtype:'bee',server:'USII',map:'main',in:'main',x:580,y:750,hp:100,target:'GermanicHP',state:'engaged',startedAt:100,fighter:'GDroidPT'};
function status(name, at=1000) { return {name,seenAt:at,map:'main',in:'main',server:'USII',x:580,y:750,hp:100,convoyProtocol:4,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,epoch:0,reportedAt:at,observationAt:at,currentAttackersAt:at,currentAttackers:[],threats:[],sightings:[target],evidence:[],deaths:[],anchorVisible:true}}; }
function fixture(){
  const names=['GDroidPT','GermanicHP','QwenTina'];
  const p={nextCommandId:1,leader:names[0],commands:{},navigationIntents:{},statuses:Object.fromEntries(names.map(n=>[n,status(n)])),
    activeConvoy:{id:'trip',epoch:1,phase:'travel',purpose:'monster-hunt',participants:names,leader:names[0],completed:[],location:{map:'main',x:-100,y:-50}},
    groupedCombat:{fights:[target],queue:[target],evidence:[{...target,at:999,action:'old-hit'}],threats:[],deaths:[],target,selection:'old',committed:true,lostTargets:[]}};
  const issue=(_p,c,phase,name)=>({id:p.nextCommandId++,convoyId:c.id,epoch:c.epoch,phase,name});
  return {p,names,issue};
}
test('visible historic fight and recent outgoing evidence do not block normal travel',()=>{
  const {p,names,issue}=fixture();
  p.statuses.GDroidPT.groupedCombat.evidence=[{...target,at:1000,state:'engaged'}];
  p.statuses.GDroidPT.groupedCombat.threats=[target]; // cached hit is not authoritative
  assert.equal(classifyTravelDefense(p,names,1000).state,'clear');
  assert.equal(defense.step(p,1000,issue),false);assert.equal(p.activeConvoy.phase,'travel');
});
test('follower attack blocks; deaggro releases without a death after confirmed loot',()=>{
  const {p,names,issue}=fixture(),destination=p.activeConvoy.location;
  p.statuses.GermanicHP.groupedCombat.currentAttackers=[target];
  assert.match(classifyTravelDefense(p,names,1000).message,/Defending GermanicHP from bee/);
  defense.step(p,1000,issue);assert.equal(p.activeConvoy.phase,'defending');
  p.statuses.GermanicHP.groupedCombat.currentAttackers=[];
  defense.step(p,1100,issue);assert.match(p.activeConvoy.defenseReason,/loot/);
  p.statuses.GDroidPT.convoyLoot={...p.activeConvoy.loot,complete:true,observedAt:1101};
  defense.step(p,1101,issue);assert.equal(p.activeConvoy.phase,'assemble');
  assert.equal(p.activeConvoy.location,destination);assert.equal(p.activeConvoy.epoch,2);assert.deepEqual(p.groupedCombat.deaths,[]);
});
test('outside targets and different realms or instances cannot block travel',()=>{
  const {p,names}=fixture();
  for(const change of [{target:'outsider'},{server:'EUI'},{in:'other'},{map:'cave'},{hp:0}]){
    p.statuses.GDroidPT.groupedCombat.currentAttackers=[{...target,...change}];
    assert.equal(classifyTravelDefense(p,names,1000).state,'clear');
  }
});
test('a confirmed dead monster left in a client entity cache cannot hold return',()=>{
 const {p,names}=fixture();p.statuses.GermanicHP.groupedCombat.currentAttackers=[target];
 p.groupedCombat.deaths=[{...target,at:900}];
 assert.equal(classifyTravelDefense(p,names,1000).state,'clear');
 p.groupedCombat.deaths[0].in='another-instance';
 assert.equal(classifyTravelDefense(p,names,1000).state,'defending');
});
test('fresh empty travel observations authorize departure even when the last monster packet is old',()=>{
 const {p,names}=fixture();
 for(const s of Object.values(p.statuses))s.groupedCombat.observationAt=-30000;
 assert.equal(classifyTravelDefense(p,names,1000).state,'clear');
 p.statuses.GDroidPT.groupedCombat.currentAttackersAt=0;
 assert.equal(classifyTravelDefense(p,names,4000).state,'waiting-for-observations');
});
test('missing and stale observations explicitly stop a moving route and resume without inventing a fight',()=>{
  const {p,names,issue}=fixture();delete p.statuses.QwenTina.groupedCombat.currentAttackers;
  assert.equal(classifyTravelDefense(p,names,1000).state,'waiting-for-observations');
  defense.step(p,1000,issue);assert.equal(p.activeConvoy.phase,'observing');assert.equal(p.commands.GDroidPT.phase,'hold');
  assert.equal(p.activeConvoy.loot,undefined);
  p.statuses.QwenTina.groupedCombat.currentAttackers=[];
  defense.step(p,1001,issue);assert.equal(p.activeConvoy.phase,'assemble');
  p.statuses.QwenTina.groupedCombat.currentAttackersAt=-3000;
  assert.equal(classifyTravelDefense(p,names,1001).state,'waiting-for-observations');
});
test('new attack invalidates loot completion; invalid acknowledgements cannot release the route',()=>{
  const {p,issue}=fixture();p.statuses.GermanicHP.groupedCombat.currentAttackers=[target];defense.step(p,1000,issue);
  p.statuses.GermanicHP.groupedCombat.currentAttackers=[];defense.step(p,1100,issue);
  const old=p.activeConvoy.loot;
  for(const bad of [{id:'old'},{realm:':EUI'},{in:'other'},{observedAt:1100},{complete:false,error:'loot_no_space'}]){
    p.statuses.GDroidPT.convoyLoot={...old,observedAt:1101,complete:true,...bad};defense.step(p,1101,issue);
    assert.equal(p.activeConvoy.phase,'defending');
  }
  p.statuses.GermanicHP.groupedCombat.currentAttackers=[target];defense.step(p,1200,issue);assert.equal(p.activeConvoy.loot,undefined);
  p.statuses.GermanicHP.groupedCombat.currentAttackers=[];defense.step(p,1201,issue);
  assert.notEqual(p.activeConvoy.loot.id,old.id);
  p.statuses.GDroidPT.convoyLoot={...old,observedAt:1202,complete:true};defense.step(p,1202,issue);assert.equal(p.activeConvoy.phase,'defending');
});
test('retired passive fight cannot return from delayed evidence or cached snapshots; a new attacker can',()=>{
  const {p,names}=fixture();
  const members=names.map((name,i)=>({name,ctype:i===1?'priest':'warrior',revision:0,status:p.statuses[name]}));
  const retired=retireTravelTargets(p.groupedCombat,members,1000);
  assert.equal(retired.fights.length,0);assert.equal(retired.lostTargets[0].reason,'released for travel; no current attacker');
  assert.deepEqual(retired.deaths,[]);assert.equal(retireTravelTargets(retired,members,1001),retired);
  members[0].status.groupedCombat.evidence=[{...target,at:999,action:'old-hit',state:'engaged'}];
  const next=evaluateGroup({...retired,protocol:4,leader:names[0],key:'old',observers:[],blockers:[],members:names},members,names[0],1100,0,true);
  assert.equal(next.fights.length,0);
  members[0].status.groupedCombat.threats=[target];
  const attacked=evaluateGroup(next,members,names[0],1200,0,true);
  assert.equal(attacked.fights[0].id,target.id);
});
test('already stuck bee return starts with separated members and no active attackers',()=>{
  const {p,names}=fixture();p.activeConvoy=null;p.statuses.QwenTina.x=48;p.statuses.QwenTina.y=35;
  p.statuses.GermanicHP.y=837;p.statuses.QwenTina.monsterHunt={id:'bee',count:0};
  const h={cycleId:'hunt',stage:'returning',participants:names,missions:[],currentIndex:-1,target:null,convoyId:null};
  let calls=0;
  const service=createHuntConvoy(p,{now:()=>1000,intent:()=>({}),authorize(){},processDaisy(){assert.fail('not arrived');},start(location){
    calls++;p.activeConvoy={id:'return',location};return true;
  }});
  assert.equal(service.start(h,{map:'main',x:-100,y:-50},'Monster Hunt turn-in','returning'),true);
  assert.equal(calls,1);assert.equal(h.convoyId,'return');assert.equal(p.activeConvoy.combatHandoffAllowed,false);
});
test('unfinished Hunt loot survives return stage and rejects stale or displaced completion',()=>{
  const {p,names}=fixture(),loot={id:'final-kill',after:900,map:'main',in:'main',realm:':USII',x:580,y:750,complete:false};
  const h={stage:'returning',participants:names,missions:[],currentIndex:-1,loot};
  const ports={now:()=>1000,intent:()=>({}),cancelHuntConvoy(){p.activeConvoy=null;}};
  assert.equal(huntLootPending(h,p,ports),true);
  p.statuses.GDroidPT.huntLoot={...loot,observedAt:900,complete:true};assert.equal(huntLootPending(h,p,ports),true);
  p.statuses.GDroidPT.huntLoot.observedAt=1001;assert.equal(huntLootPending(h,p,ports),false);
});
test('travel ownership suppresses pulls only until cancellation, supersession, arrival or emergency override',()=>{
  const {p,names}=fixture();p.navigationIntents.GDroidPT={revision:5};
  assert.equal(travelCombatFor(p,names[0]).revision,5);
  p.navigationIntents.GDroidPT.cancelled=true;assert.equal(travelCombatFor(p,names[0]),null);
  p.navigationIntents.GDroidPT.cancelled=false;p.activeConvoy.force=true;assert.equal(travelCombatFor(p,names[0]),null);
  p.activeConvoy=null;assert.equal(travelCombatFor(p,names[0]),null);
});
test('delivered individual travel remains active from fresh client ownership and ends on completion or newer navigation',()=>{
 const {p,names}=fixture();p.activeConvoy=null;p.navigationIntents.GDroidPT={revision:5};
 const s=p.statuses.GDroidPT;s.seenAt=Date.now();s.groupedCombat.currentAttackersAt=Date.now();
 s.groupedCombat.travelCommand={id:42,revision:5};
 assert.equal(travelCombatFor(p,names[0]).id,'command:42');
 p.navigationIntents.GDroidPT.revision=6;assert.equal(travelCombatFor(p,names[0]),null);
 p.navigationIntents.GDroidPT.revision=5;s.groupedCombat.travelCommand=null;assert.equal(travelCombatFor(p,names[0]),null);
});

test('joining Franky releases the old Daisy waiting restriction without bypassing an actual movement command',()=>{
 const p={farmingPolicy:'hunt',monsterHunt:{cycleId:'hunt',stage:'at-daisy',participants:['W']},statuses:{W:{}},commands:{},navigationIntents:{W:{revision:1}}};
 assert.ok(travelCombatFor(p,'W'));
 p.statuses.W.activeEvent='franky';p.statuses.W.joinedEvent='franky';
 assert.equal(travelCombatFor(p,'W'),null);
 p.commands.W={id:42,type:'character-travel'};assert.equal(travelCombatFor(p,'W').id,'command:42');
});

for(const stage of ['mission-travel','returning','daisy-sync-travel'])test('authorized rare handoff releases Hunt combat suppression during '+stage,()=>{
 const p={farmingPolicy:'hunt',monsterHunt:{cycleId:'hunt',stage,participants:['W']},statuses:{W:{}},commands:{},navigationIntents:{W:{revision:1}}};
 assert.ok(travelCombatFor(p,'W'));
 p.rareHuntState={encounter:{revisions:{W:1}}};assert.equal(travelCombatFor(p,'W'),null);
 p.commands.W={id:42,type:'character-travel'};assert.equal(travelCombatFor(p,'W').id,'command:42');
 delete p.commands.W;p.navigationIntents.W.revision=2;assert.ok(travelCombatFor(p,'W'),'stale rare cannot suppress new travel');
 p.navigationIntents.W.revision=1;p.rareHuntState.encounter=null;assert.ok(travelCombatFor(p,'W'),'Hunt resumes after rare completion');
});
