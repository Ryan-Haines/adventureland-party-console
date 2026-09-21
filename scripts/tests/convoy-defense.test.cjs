const test=require('node:test'),assert=require('node:assert/strict');
const defense=require('../convoy-defense.cjs'),navigation=require('../convoy-navigation.cjs');
function fixture(){const t={id:'A',map:'main',in:'main',server:'USII',x:5,y:0,state:'engaged',target:'P',mtype:'bee'};
 const p={commands:{},nextCommandId:10,navigationIntents:{W:{revision:1},P:{revision:1}},combatLogs:{},groupedCombat:{fights:[t],deaths:[]},
 statuses:Object.fromEntries(['W','P'].map(name=>[name,{name,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,speed:50,seenAt:1000,groupedCombat:{reportedAt:1000,threats:[],sightings:[t]}}])),
 activeConvoy:{id:'C',epoch:1,phase:'assemble',purpose:'monster-hunt',participants:['W','P'],leader:'W',rally:{map:'main',x:0,y:0},location:{map:'cave',x:20,y:20},slowestSpeed:50,completed:[]}};
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 return {p,t};}
for(const phase of ['assemble','plan-return','scheduled','travel','failed'])test('defense interrupts '+phase+' and rebuilds a fresh convoy after confirmed death',()=>{
 const {p,t}=fixture();p.activeConvoy.phase=phase;p.statuses.P.groupedCombat.currentAttackers=[t];navigation.step(p,1000);assert.equal(p.activeConvoy.phase,'defending');
 const id=p.commands.W.id;navigation.step(p,5000);assert.equal(p.activeConvoy.phase,'observing','stale observations cannot resume');
 p.groupedCombat.deaths=[t];p.groupedCombat.fights=[];p.statuses.P.groupedCombat.currentAttackers=[];
 for(const s of Object.values(p.statuses)){s.seenAt=6000;s.groupedCombat.reportedAt=6000;}
 navigation.step(p,6000);assert.equal(p.activeConvoy.phase,'defending');assert.match(p.activeConvoy.defenseReason,/Pending travel loot/);
 p.statuses.W.convoyLoot={...p.activeConvoy.loot,observedAt:6001,complete:true};
 navigation.step(p,6001);assert.equal(p.activeConvoy.phase,'assemble');assert.ok(p.commands.W.id>id);assert.equal(p.activeConvoy.epoch,2);
 p.groupedCombat.fights=[{...t,id:'B'}];p.statuses.W.groupedCombat.sightings=[{...t,id:'B'}];p.statuses.P.groupedCombat.currentAttackers=[{...t,id:'B'}];navigation.step(p,6001);assert.equal(p.activeConvoy.phase,'defending');
});
test('follower aggressor pauses the convoy; a planned neutral does not',()=>{
 const {p,t}=fixture();p.groupedCombat.fights=[];p.groupedCombat.target={...t,state:'planned'};assert.equal(defense.fighting(p,['W','P'],1000),false);
 p.statuses.P.groupedCombat.currentAttackers=[t];assert.equal(defense.fighting(p,['W','P'],1000),true);navigation.step(p,1000);assert.equal(p.activeConvoy.phase,'defending');
});
for(const phase of ['assemble','plan-return','scheduled','travel'])test('anniversary return defends during '+phase+' and resumes after loot',()=>{
 const {p,t}=fixture(),c=p.activeConvoy;c.purpose='anniversary-return';c.navigationExempt=true;c.phase=phase;
 const destination=c.location;p.statuses.P.groupedCombat.currentAttackers=[t];navigation.step(p,1000);assert.equal(c.phase,'defending');
 p.groupedCombat.fights=[];p.groupedCombat.deaths=[t];p.statuses.P.groupedCombat.currentAttackers=[];for(const s of Object.values(p.statuses)){s.seenAt=2000;s.groupedCombat.reportedAt=2000;}
 navigation.step(p,2000);assert.ok(c.loot);assert.equal(c.location,destination);
 p.statuses.W.convoyLoot={...c.loot,complete:true,observedAt:2001};navigation.step(p,2001);
 assert.equal(c.phase,'assemble');assert.equal(c.id,'C');assert.equal(c.epoch,2);assert.equal(c.location,destination);assert.equal(c.purpose,'anniversary-return');
});
test('escape and event convoys retain their travel policy',()=>{
 for(const purpose of ['escape-recovery','franky-exit','event-return']){const {p}=fixture();p.activeConvoy.purpose=purpose;assert.equal(defense.eligible(p,p.activeConvoy),false);}
});
test('lost death-return assembly command is reissued without losing destination or accepting old acknowledgements',()=>{
 const {p}=fixture();p.groupedCombat.fights=[];p.activeConvoy.purpose='death-recovery';p.activeConvoy.expected={W:{revision:1,commandId:7},P:{revision:1,commandId:8}};
 const destination=p.activeConvoy.location;navigation.step(p,1000);
 assert.equal(p.commands.W.type,'party-monster-travel');assert.equal(p.commands.W.location,destination);
 assert.equal(navigation.validReport(p,{character:'W',convoyId:'C',epoch:1,commandId:7,runtimeId:'old'}),false);
});
test('Hunt mode does not authorize a new destination while fighting, and convoy startup waits',()=>{
 const {createHuntMode}=require('../../runtime/coordinator/hunt/mode.ts');const {createHuntConvoy}=require('../../runtime/coordinator/hunt/convoy.ts');
 const state={farmingPolicy:'auto',monsterHunt:null,leader:'W',statuses:{},monsterFocus:[],monsterFocusByCharacter:{}};let authorized=0,begun=0;
 const mode=createHuntMode(state,{participants:()=>['W'],cancelled:()=>false,fighting:()=>true,release(){},authorize(){authorized++;},begin(){begun++;}});
 mode.select('hunt',null,undefined,false);assert.equal(authorized,0);assert.equal(begun,1);assert.equal(state.farmingPolicy,'hunt');
 const h={participants:['W']},convoy=createHuntConvoy(state,{now:()=>1000,intent:()=>({})});
 assert.equal(convoy.start(h,{map:'main',x:0,y:0},'Daisy','daisy-sync-travel'),false);assert.equal(h.stage,'daisy-sync-travel');
});

test('late merchant recovery cannot delete a replacement convoy and command transitions identify their caller',()=>{
 const {createMerchantRecovery}=require('../../runtime/coordinator/merchant/recovery.ts');
 const party={commands:{W:{id:2,type:'party-monster-travel',convoyId:'return'}},combatLogs:{}};
 const ownership=require('../command-ownership.cjs')(party),state={current:{id:'old',reason:'restock'},queue:[]};
 const recovery=createMerchantRecovery(state,{recoverSale(){},restockSatisfied:()=>true,
  clearCommand:(name,id)=>ownership.clear(name,c=>c.jobId===id),log(){},persist(){},dispatch(){}});
 recovery.observe('W',[]);assert.equal(party.commands.W.id,2);
 delete party.commands.W;assert.equal(party.combatLogs.W[0].details.before.convoyId,'return');assert.ok(party.combatLogs.W[0].details.source.length);
});
test('client interruption releases its route and ignores stale convoy signals',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');let stops=0;
 const c=vm.createContext({root:{partyRoleRunner:{wake(){}}},convoyTraveling:{id:'C',epoch:3,purpose:'monster-hunt'},releaseConvoyCruise(){},stop(){stops++;}});
 vm.runInContext(source.slice(source.indexOf('  function interruptConvoyForDefense('),source.indexOf('  function groupedFarming(')),c);
 c.interruptConvoyForDefense('C',2);assert.ok(c.convoyTraveling);c.interruptConvoyForDefense('C',3);
 assert.equal(c.convoyTraveling,null);assert.equal(c.root.__partyConvoyDefense,'C');assert.equal(stops,1);
 c.convoyTraveling={id:'E',epoch:1,purpose:'escape-recovery'};c.interruptConvoyForDefense();assert.ok(c.convoyTraveling);
});
test('protocol 4 local defense retains an identifiable handle until the coordinator acknowledges it',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');let stops=0,freezes=0;
 const convoy={id:'C',epoch:3,commandId:42,navigationRevision:9,routeProtocol:4,purpose:'monster-hunt',freezeRoute(){freezes++;}};
 const c=vm.createContext({root:{partyRoleRunner:{wake(){}}},convoyTraveling:convoy,releaseConvoyCruise(){},stop(){stops++;}});
 vm.runInContext(source.slice(source.indexOf('  function interruptConvoyForDefense('),source.indexOf('  function groupedFarming(')),c);
 c.interruptConvoyForDefense();c.interruptConvoyForDefense();
 assert.equal(c.convoyTraveling,convoy);assert.equal(convoy.phase,'defending');assert.equal(convoy.defensePaused,true);
 assert.equal(convoy.commandId,42);assert.equal(convoy.navigationRevision,9);assert.equal(stops,1);assert.equal(freezes,1);
});

test('an old invisible engagement cannot hold departure, but a visible party attacker can',()=>{
 const {p,t}=fixture();for(const s of Object.values(p.statuses))s.groupedCombat.sightings=[];
 assert.equal(defense.fighting(p,['W','P'],1000),false);
 p.statuses.P.groupedCombat.currentAttackers=[t];assert.equal(defense.fighting(p,['W','P'],1000),true);
});
test('travel loot failure retries, rejects stale acknowledgements, and a new attacker invalidates the pass',()=>{
 const {p,t}=fixture();p.statuses.P.groupedCombat.currentAttackers=[t];navigation.step(p,1000);p.groupedCombat.fights=[];p.groupedCombat.deaths=[t];p.statuses.P.groupedCombat.currentAttackers=[];
 for(const s of Object.values(p.statuses)){s.seenAt=2000;s.groupedCombat.reportedAt=2000;}
 navigation.step(p,2000);const loot=p.activeConvoy.loot;
 for(const bad of [{id:'old'},{realm:':EUI'},{in:'other'},{observedAt:1999},{complete:false,error:'loot_no_space'}]) {
  p.statuses.W.convoyLoot={...loot,observedAt:2001,complete:true,...bad};navigation.step(p,2001);assert.equal(p.activeConvoy.phase,'defending');
 }
 assert.match(p.activeConvoy.defenseReason,/loot_no_space/);
 p.statuses.P.groupedCombat.currentAttackers=[{...t,id:'B'}];navigation.step(p,2002);assert.equal(p.activeConvoy.loot,undefined);
 p.statuses.P.groupedCombat.currentAttackers=[];navigation.step(p,2003);assert.notEqual(p.activeConvoy.loot.id,loot.id);
 p.statuses.W.convoyLoot={...p.activeConvoy.loot,observedAt:2004,complete:true};navigation.step(p,2004);assert.equal(p.activeConvoy.phase,'assemble');
});
