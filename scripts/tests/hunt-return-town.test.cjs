const test=require('node:test'),assert=require('node:assert/strict');
const {recordTownAttempt,observeReturnTown}=require('../../runtime/coordinator/navigation/return-town.ts');
const {createSharedConvoyNavigation,sharedCommand}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const defense=require('../../runtime/coordinator/navigation/convoy-defense.ts');
const {runtime,settle}=require('./helpers/native-convoy-runtime.cjs');
const {namedFunction}=require('./helpers/named-function.cjs');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('characters/shared.js','utf8'),legacy=require('../convoy-navigation.cjs');

function party(){
 const names=['L','F','P'],c={id:'return',epoch:1,routeVersion:1,routeProtocol:4,continuousReturn:1,returnRouting:true,
  phase:'shared-prepare',purpose:'monster-hunt',nonPreemptible:true,leader:'L',participants:names,completed:[],
  location:{map:'main',x:126,y:-413},rally:{map:'main',x:500,y:1100},slowestSpeed:57,runtimes:{L:'L',F:'F',P:'P'}};
 const p={activeConvoy:c,nextCommandId:1,commands:{},navigationIntents:{},combatLogs:{},monsterHunt:{stage:'returning'},
  statuses:Object.fromEntries(names.map(name=>[name,{name,seenAt:1000,map:'main',in:'main',x:500,y:1100,hp:100,speed:57,server:'USII',
   convoyProtocol:4,huntReturnProtocol:2,combatSelection:{runtimeId:name},groupedCombat:{currentAttackersAt:1000,currentAttackers:[]}}]))};
 for(const name of names){const cmd=p.commands[name]=sharedCommand(p,c,c.phase,name);p.statuses[name].convoyNavigation={
  id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:0,runtimeId:name,phase:'route-ready'};}
 return p;
}
test('three interrupted party rounds persist, deduplicate members, and reset only after everyone changes map',()=>{
 const p=party(),c=p.activeConvoy;observeReturnTown(p,c,1000);
 const attempt={round:'1:1:0',map:'main',state:'interrupted',destination:{map:'main',x:0,y:0}};
 for(let round=1;round<=3;round++){
  for(const name of c.participants)p.statuses[name].convoyNavigation.townAttempt={...attempt,round:round+':1:0'};
  observeReturnTown(p,c,1000);observeReturnTown(p,c,1000);
  assert.equal(c.returnTown.interruptions,round);assert.equal(c.returnTown.walking,round===3);
 }
 assert.deepEqual(JSON.parse(JSON.stringify(p.monsterHunt.returnTown)),c.returnTown);
 c.epoch++;observeReturnTown(p,c,1000);assert.equal(c.returnTown.interruptions,3);
 p.statuses.L.map='winterland';assert.equal(observeReturnTown(p,c,1000),false);
 for(const s of Object.values(p.statuses)){s.map='winterland';s.convoyNavigation.transitionMap='winterland';}
 assert.equal(observeReturnTown(p,c,1000),true);assert.equal(c.disableTown,false);assert.equal(c.returnTown.interruptions,0);
});
test('unavailable Town selects walking without counting a cast; superseded reports cannot add rounds',()=>{
 const p=party(),c=p.activeConvoy;observeReturnTown(p,c,1000);
 recordTownAttempt(c,{round:'1:1:0',map:'main',state:'unavailable',destination:{map:'main',x:0,y:0}},1000);
 assert.equal(c.returnTown.interruptions,0);assert.equal(c.returnTown.walking,true);
 p.statuses.F.convoyNavigation={...p.statuses.F.convoyNavigation,commandId:999,townAttempt:{round:'99',map:'main',state:'interrupted'}};
 observeReturnTown(p,c,1000);assert.equal(c.returnTown.interruptions,0);
});
test('partial Town failure waits for other casts and regroups at the successful arrival instead of returning to the attackers',()=>{
 const p=party(),c=p.activeConvoy,engine=createSharedConvoyNavigation(legacy);
 const destination={map:'main',x:0,y:0},attempt={map:'main',round:'1:1:0',destination};
 p.statuses.L.convoyNavigation.townAttempt={...attempt,state:'casting'};
 p.statuses.F.convoyNavigation.townAttempt={...attempt,state:'interrupted'};
 engine.step(p,1000);assert.equal(c.phase,'shared-prepare');assert.equal(c.returnTown.interruptions,1);
 p.statuses.L.convoyNavigation.townAttempt.state='complete';p.statuses.L.x=0;p.statuses.L.y=0;
 for(const s of Object.values(p.statuses))s.seenAt=1100;
 engine.step(p,1100);assert.equal(c.phase,'assemble');assert.deepEqual(c.rally,destination);
 assert.deepEqual(p.commands.F.rally,destination);assert.equal(p.commands.F.disableTown,false);
 engine.step(p,1200);assert.equal(c.phase,'assemble','wait for failed members without sending successful ones back');
 for(const s of Object.values(p.statuses)){s.x=0;s.y=0;s.seenAt=1300;}
 engine.step(p,1300);assert.equal(c.phase,'shared-prepare');assert.equal(c.returnTownRally,undefined);
 const restored=JSON.parse(JSON.stringify(p));observeReturnTown(restored,restored.activeConvoy,1300);
 assert.equal(restored.monsterHunt.returnTown.interruptions,1);
});
test('a local hit acknowledgement is recovered even when the attacker dies before the next heartbeat',()=>{
 const p=party(),c=p.activeConvoy;p.statuses.F.convoyNavigation.phase='defending';
 assert.equal(defense.step(p,1000,sharedCommand),true);assert.equal(c.phase,'defending');
 defense.step(p,1001,sharedCommand);assert.ok(c.loot);
 p.statuses.L.convoyLoot={...c.loot,observedAt:1002,complete:true};
 defense.step(p,1002,sharedCommand);assert.equal(c.phase,'assemble');assert.equal(c.epoch,2);
 assert.ok(c.participants.every(name=>p.commands[name].phase==='assemble'));
});
test('walking fallback retains movement ownership under live attackers, but cancellation still wins',()=>{
 const p=party(),c=p.activeConvoy;c.returnTown={map:'main',interruptions:3,walking:true};
 p.statuses.F.groupedCombat.currentAttackers=[{id:'bee',mtype:'bee',map:'main',in:'main',hp:50,target:'F'}];
 assert.equal(defense.step(p,1000,sharedCommand),false);assert.equal(c.phase,'shared-prepare');
 p.navigationIntents.F={revision:1,cancelled:true};
 const engine=createSharedConvoyNavigation(legacy,defense.step);c.routeServer='USII';engine.step(p,1000);
 assert.equal(c.phase,'failed');assert.equal(c.failureCode,'owner-lost');
});
test('real client preparation survives a bee hit as an acknowledged defense hold until a fresh command',async()=>{
 const r=runtime(),c=r.context;
 c.currentPartyList=()=>['F'];c.get_entity=()=>({id:'bee',type:'monster',mtype:'bee',target:'F'});
 c.isPassingEncounter=()=>false;c.groupedEntityReport=x=>x;c.joinedEvent=false;c.eventTargetTypes=[];
 vm.runInContext(['returnDepartureDefense','defendPartyHit','interruptConvoyForDefense'].map(n=>namedFunction(source,n)).join('\n'),c);
 const cmd={id:2,convoyId:'test',epoch:7,phase:'shared-prepare',routeVersion:1,continuousReturn:1,purpose:'monster-hunt',nonPreemptible:true,
  navigationRevision:0,leader:'F',rally:{map:'main',x:0,y:0},location:{map:'main',x:120,y:0},slowestSpeed:57};
 const started=await r.start(cmd),handle=c.convoyTraveling;
 c.defendPartyHit({id:'F',hid:'bee'});await settle();
 assert.equal(c.convoyTraveling,handle);assert.equal(handle.commandId,2);assert.equal(handle.phase,'defending');
 assert.equal(handle.cancelled,false);assert.equal(handle.routeReady,false);
 c.defendPartyHit({id:'F',hid:'bee'});await settle();assert.equal(c.convoyTraveling,handle);
 await r.cancel();await started.promise;assert.equal(c.convoyTraveling,null);
});
