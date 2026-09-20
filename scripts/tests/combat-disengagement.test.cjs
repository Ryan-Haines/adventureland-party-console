const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../combat-disengagement.cjs');
const createEscape=require('../party-escape.cjs');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
function fixture(){
 let now=1000,escapes=0,returns=0,resumes=0;const names=['W','M','P'];
 const target={id:'mole',mtype:'mole',map:'cave',in:'cave',server:'USII',x:0,y:0,hp:25,max_hp:100,state:'engaged',startedAt:800,fighter:'W'};
 const party={leader:'W',followers:{M:true,P:true},partyFarmingMode:'default',farmingPolicy:'auto',monsterFocus:['mole'],location:{map:'cave',x:10,y:10},statuses:{},commands:{},combatLogs:{},groupedCombat:{target,queue:[target],fights:[target],deaths:[]}};
 for(const [i,n] of names.entries())party.statuses[n]={name:n,ctype:['warrior','mage','priest'][i],map:'cave',in:'cave',server:'USII',x:0,y:0,hp:100,max_hp:100,range:200,seenAt:now,lastDeath:{at:0},combatSelection:{runtimeId:n},groupedCombat:{protocol:4,epoch:0,threats:[target],sightings:[target],evidence:[],candidates:[],deaths:[],anchorVisible:true}};
 const revisions={W:1,M:1,P:1};const hooks={now:()=>now,members:()=>names,intent:n=>({revision:revisions[n],cancelled:false}),persist(){},escape(){escapes++;},releaseEscape(){},abandonRare(){},cancelCombatTravel(){},returnToFarm(){returns++;party.activeConvoy={id:"return-"+returns,purpose:"death-recovery",phase:"assemble"};return true;},resumeHunt(){resumes++;}};
 const ctl=create(party,hooks);ctl.tick();
 return {party,names,target,revisions,ctl,hooks,escapes:()=>escapes,returns:()=>returns,resumes:()=>resumes,
 advance(ms=100){now+=ms;for(const s of Object.values(party.statuses))s.seenAt=now;},kill(n){party.statuses[n].rip=true;party.statuses[n].hp=0;party.statuses[n].lastDeath={at:now};},home(){for(const s of Object.values(party.statuses)){s.rip=false;s.hp=100;s.map=s.in='main';s.x=s.y=0;s.groupedCombat.threats=[];}},
 reconcile(){ctl.tick();party.groupedCombat=ctl.finalize(evaluateGroup(party.groupedCombat?.protocol?party.groupedCombat:null,ctl.prepare(names.map(n=>({name:n,ctype:party.statuses[n].ctype,revision:1,status:party.statuses[n]}))),'W',now,party.groupedCombatResetAt||0,ctl.active()));},now:()=>now};
}
test('backup farming retains three neutral nominations through coordinator preparation; departure still suppresses them',()=>{
 const f=fixture();f.party.farmingPolicy='hunt';f.party.monsterHunt={stage:'backup-farming',participants:f.names};f.party.groupedCombat=null;
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/navigation/grouped-snapshot.ts');
 Object.assign(f.party,{headlessSlots:f.names,steamMembers:[],merchantCharacter:null});
 for(const s of Object.values(f.party.statuses)){s.groupedCombat.threats=[];s.groupedCombat.sightings=[];}
 f.party.statuses.W.groupedCombat.candidates=['A','B','C'].map((id,i)=>({...f.target,id,mtype:'wolfie',x:i*10}));
 const members=()=>f.ctl.prepare(f.names.map(n=>({name:n,ctype:f.party.statuses[n].ctype,revision:1,status:f.party.statuses[n]})));
 const g=evaluateGroup(null,members(),'W',f.now());assert.deepEqual(g.queue.map(t=>t.id),['A','B','C']);
 for(const stage of ['backup-travel','batch-loot','returning','mission-travel']) {
  f.party.monsterHunt.stage=stage;
  const snapshot=coordinatorGroupedSnapshot(f.party,{now:f.now,tickDisengagement(){},disengagementActive:f.ctl.active,
   intent:f.hooks.intent,owned:()=>undefined,prepare:f.ctl.prepare,evaluate:evaluateGroup,finalize:f.ctl.finalize,blocksPulls:()=>false});
  assert.equal(snapshot.target,null,stage+' must still suppress ordinary pulls through the travel owner');
 }
 f.party.monsterHunt.stage='backup-farming';assert.equal(members()[0].status.groupedCombat.candidates.length,3);
});
test('one death finishes only at inclusive 25/50 thresholds, with no new pulls',()=>{
 const f=fixture();f.advance();f.party.statuses.M.hp=f.party.statuses.P.hp=50;f.kill('W');f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'finishing');assert.equal(f.escapes(),0);
 const members=f.ctl.prepare(f.names.map(n=>({name:n,status:f.party.statuses[n]})));assert.ok(members.every(m=>m.status.groupedCombat.candidates.length===0));
 f.target.hp=25.1;f.advance();f.ctl.tick();assert.equal(f.escapes(),1);assert.equal(f.party.groupedCombat,null);
});
for(const cause of ['healthy enemy','low survivor','missing monster HP','stale survivor','no enemies','wipe'])test(cause+' immediately escapes and clears the abandoned lock',()=>{
 const f=fixture();f.advance();f.kill('W');
 if(cause==='healthy enemy')f.target.hp=26;
 if(cause==='low survivor')f.party.statuses.M.hp=49;
 if(cause==='missing monster HP')delete f.target.max_hp;
 if(cause==='stale survivor')f.party.statuses.M.seenAt=-9000;
 if(cause==='no enemies'){f.party.groupedCombat.fights=[];for(const s of Object.values(f.party.statuses))s.groupedCombat.threats=[];}
 if(cause==='wipe'){f.kill('M');f.kill('P');}
 f.ctl.tick();assert.equal(f.escapes(),1);assert.equal(f.party.groupedCombat,null);assert.ok(f.party.combatResetByCharacter.W>0);
});
test('new attacker or second death ends the finishing window',()=>{
 for(const why of ['attacker','death']){const f=fixture();f.advance();f.kill('W');f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'finishing');
 f.advance();if(why==='death')f.kill('M');else f.party.statuses.M.groupedCombat.threats.push({...f.target,id:'new',hp:100});
 f.ctl.tick();assert.equal(f.escapes(),1);}
});
test('confirmed completion escapes then resumes only after everyone safely returns above 50 percent',()=>{
 const f=fixture();f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();assert.equal(f.escapes(),1);
 f.advance();f.ctl.tick();assert.equal(f.returns(),0);f.home();f.party.statuses.M.hp=49;f.ctl.tick();assert.equal(f.returns(),0);
 f.party.statuses.M.hp=50;f.ctl.tick();assert.equal(f.returns(),1);assert.equal(f.party.combatRecovery.phase,'returning-to-farm');f.ctl.tick();assert.equal(f.returns(),1);
 for(const s of Object.values(f.party.statuses)){s.map='cave';s.x=s.y=10;}f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'complete');
});
test('Hunt resumes through its controller and manual navigation cancels automatic return',()=>{
 const f=fixture();f.party.farmingPolicy='hunt';f.target.hp=90;f.advance();f.kill('M');f.ctl.tick();f.home();f.ctl.tick();assert.equal(f.resumes(),1);assert.equal(f.returns(),0);
 const g=fixture();g.target.hp=90;g.advance();g.kill('P');g.ctl.tick();g.revisions.W++;g.home();g.ctl.tick();assert.equal(g.party.combatRecovery.phase,'cancelled');assert.equal(g.returns(),0);
});
test('collaborative event deaths never start farming disengagement',()=>{
 const f=fixture();f.party.statuses.W.joinedEvent='franky';f.advance();f.kill('M');f.ctl.tick();assert.equal(f.escapes(),0);assert.equal(f.party.combatRecovery,undefined);
});
test('legacy death recovery does not reset the queue at Hunt travel boundaries',()=>{
 const f=fixture();f.party.groupedCombat.fights=[];for(const s of Object.values(f.party.statuses))s.groupedCombat.threats=[];f.party.monsterHunt={cycleId:'H',stage:'returning',participants:f.names,target:'mole',currentIndex:0};f.ctl.tick();const first=f.party.groupedCombatResetAt;
 f.advance();f.ctl.tick();assert.equal(f.party.groupedCombatResetAt,first);
 f.party.monsterHunt.stage='mission-travel';f.party.monsterHunt.target='tortoise';f.party.monsterHunt.currentIndex=1;f.ctl.tick();assert.equal(f.party.groupedCombatResetAt,first);
 const second=f.party.groupedCombatResetAt;f.party.monsterHunt.stage='farming';f.advance();f.ctl.tick();assert.equal(f.party.groupedCombatResetAt,second);
});
test('reset epoch rejects old evidence, threats and restored state; fresh reports reacquire actual attackers',()=>{
 const f=fixture();f.reconcile();const old=f.party.groupedCombat;f.advance();f.ctl.reset(f.names,'test');
 for(const s of Object.values(f.party.statuses)){s.groupedCombat.state=old;s.groupedCombat.evidence=[{...f.target,action:'old',at:900,startedAt:800}];}
 f.reconcile();assert.equal(f.party.groupedCombat.target,null);
 for(const s of Object.values(f.party.statuses))s.groupedCombat.epoch=f.party.groupedCombatResetAt;
 f.advance();f.reconcile();assert.equal(f.party.groupedCombat.target.id,'mole');assert.equal(f.party.groupedCombat.evidence.length,0);
});
test('dead class members go straight to escape recovery rather than waiting on their skills',()=>{
 for(const deadName of ['W','M','P']){const f=fixture();f.kill(deadName);let cancelled=0;
 const escape=createEscape(f.party,{now:f.now,persist(){},cancel(){cancelled++;},convoy(){return true;}});escape.start(f.names);
 assert.equal(f.party.escape.stage,'recovering');assert.ok(cancelled);}
});
test('failed return start remains durable across controller reload and retries without resetting again',()=>{
 const f=fixture();f.target.hp=90;f.advance();f.kill('W');f.ctl.tick();f.home();
 let accepted=false;f.hooks.returnToFarm=()=>accepted;f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'returning-to-farm');const epoch=f.party.groupedCombatResetAt;
 const reloaded=create(f.party,f.hooks);f.advance();reloaded.tick();assert.equal(f.party.groupedCombatResetAt,epoch);
 accepted=true;f.advance(5000);reloaded.tick();assert.equal(f.party.combatRecovery.phase,'returning-to-farm');
 for(const s of Object.values(f.party.statuses)){s.map='cave';s.x=s.y=10;}reloaded.tick();assert.equal(f.party.combatRecovery.phase,'complete');
});
test('escape convoy cannot hide a manual navigation revision change',()=>{
 const f=fixture();f.target.hp=90;f.advance();f.kill('W');f.ctl.tick();
 f.party.activeConvoy={purpose:'escape-recovery'};f.revisions.M++;f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'cancelled');
});


test('failed return convoy retries with delay, survives reload and completes only at the farm',()=>{
 const f=fixture();f.target.hp=90;f.advance();f.kill('W');f.ctl.tick();f.home();f.ctl.tick();
 const first=f.party.activeConvoy.id;f.party.activeConvoy.phase='failed';f.party.activeConvoy.failure='command lost';f.advance();f.ctl.tick();
 const retryAt=f.party.combatRecovery.returnRetryAt;assert.ok(retryAt>f.now());
 const reloaded=create(f.party,f.hooks);reloaded.tick();assert.equal(f.party.activeConvoy.id,first);
 f.advance(retryAt-f.now());reloaded.tick();assert.notEqual(f.party.activeConvoy.id,first);assert.equal(f.party.combatRecovery.phase,'returning-to-farm');
 for(const s of Object.values(f.party.statuses)){s.map='cave';s.x=s.y=10;}reloaded.tick();assert.equal(f.party.combatRecovery.phase,'complete');
});
