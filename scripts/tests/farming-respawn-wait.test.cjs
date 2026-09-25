const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const zones=require('../../.build/shared/farming-zones.cjs');
const {createFarmingReturnRoute}=require('../../runtime/coordinator/http/farming-return.ts');
function server(){
 const state={leader:'L',merchantCharacter:'M',activeConvoy:null,partyFarmingMode:'default',location:{map:'main',x:0,y:0},
  statuses:{L:{map:'main',x:200,y:0,seenAt:20000}},monsterSearchRadiusByCharacter:{L:400},combatLogs:{}};
 let starts=0,persists=0;
 const route=createFarmingReturnRoute(state,{now:()=>20000,owned:()=>true,intent:()=>({revision:1}),contains:zones.contains,
  active:()=>['L'],members:()=>['L'],start:()=>{starts++;return true;},persist:()=>persists++});
 return {state,starts:()=>starts,persists:()=>persists,call(body={character:'L'}){const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};route({body},res);return res;}};
}
test('old clients cannot create an inside-area return or consume the recovery cooldown',()=>{
 const f=server();
 for(const x of [0,200,400]){f.state.statuses.L.x=x;assert.equal(f.call({character:'L',location:{map:'elsewhere',x:900,y:900}}).body.skipped,true);}
 assert.equal(f.starts(),0);assert.equal(f.persists(),0);assert.equal(f.state.farmingReturnRequestedAt,undefined);
 f.state.statuses.L.x=401;assert.equal(f.call().body.ok,true);assert.equal(f.starts(),1);
 assert.equal(f.call().code,409);
});
test('shapes, instances, stale coordinates and changed authoritative destinations are respected',()=>{
 const f=server();f.state.location={map:'main',x:0,y:0,shapes:[{boundary:[100,-20,300,20]}],in:'one'};
 f.state.statuses.L.in='one';assert.equal(f.call().body.skipped,true);
 f.state.statuses.L.in='two';assert.equal(f.call().body.ok,true);assert.equal(f.starts(),1);
 for(const field of ['x','y']){const g=server();g.state.statuses.L[field]=NaN;assert.equal(g.call().code,409);assert.equal(g.starts(),0);}
 const stale=server();stale.state.statuses.L.seenAt=0;assert.equal(stale.call().code,409);
 const changed=server();changed.state.location={map:'cave',x:0,y:0};assert.equal(changed.call().body.ok,true);assert.equal(changed.starts(),1);
});
test('patrol and rare encounters own displacement recovery even between client controls',()=>{
 for(const owner of [{phoenixPatrolActive:true},{rareHuntState:{encounter:{stage:'loot'}}}]) {
  const f=server();f.state.statuses.L.x=1000;Object.assign(f.state,owner);
  assert.equal(f.call().code,409);assert.equal(f.starts(),0);
  assert.equal(f.state.farmingReturnRequestedAt,undefined);
  f.state.phoenixPatrolActive=false;f.state.rareHuntState=null;
  assert.equal(f.call().body.ok,true);assert.equal(f.starts(),1);
 }
});
function client(){
 const source=fs.readFileSync('characters/shared.js','utf8');let now=10000,requests=0;
 const c=vm.createContext({character:{name:'L',map:'main',x:200,y:0},leader:'L',partyLocation:{map:'main',x:0,y:0},
  groupedFarming:()=>false,farmingMode:'default',navigationIntent:{},activeCombatEvent:()=>false,joinedEvent:null,G:{maps:{}},
  banking:false,bankQueued:false,stocking:false,upgrading:false,forceTraveling:false,townTraveling:false,partyTownActive:false,
  convoyTraveling:false,partyConvoyActive:false,gatheringActive:false,eventTraveling:false,anniversaryBusy:false,anniversaryStaging:false,
  departurePending:false,reunion:null,engagedMonster:()=>false,partyTargets:[],visibleFocusedMonsterWithinRadius:()=>false,
  farmingSpawnMissingSince:0,farmingSpawnRecoveryPending:false,farmingSpawnRecoveryRetryAt:0,monsterSearchRadius:400,
  Date:{now:()=>now},inFarmArea:(p,a)=>zones.contains(a,p,0,400),request:async()=>{requests++;return {ok:true};}});c.root=c;
 const start=source.indexOf('    pollFarmingSpawnRecovery: function () {'),end=source.indexOf('    basicAttackReserved:',start);
 vm.runInContext('var poll=({'+source.slice(start,end)+'}).pollFarmingSpawnRecovery;',c);
 return {c,requests:()=>requests,tick(time){now=time;c.poll();}};
}
test('empty-spawn polling waits inside radius but still recovers genuine displacement',async()=>{
 const f=client();for(const t of [10000,12000,20000])f.tick(t);assert.equal(f.requests(),0);
 f.c.character.x=401;f.tick(21000);f.tick(22499);assert.equal(f.requests(),0);f.tick(22500);assert.equal(f.requests(),1);
 await new Promise(resolve=>setImmediate(resolve));
 f.c.character.x=200;f.tick(25000);assert.equal(f.c.farmingSpawnMissingSince,0);
});
