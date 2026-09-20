const test=require('node:test');
const assert=require('node:assert/strict');
const {run,runBundled}=require('./helpers/coordinator-host.cjs');

for (const [implementation, start] of [['source',run],['bundle',runBundled]]) {
test(`${implementation} coordinator handles first and repeated heartbeats without a current combat target`,async()=>{
 const host=await start(1900000000000);
 assert.equal(host.handlers.has('/party-api/anniversary/blacklist'),false);
 const contracts=require('./fixtures/heartbeat-contracts.json').map(value=>({...value,leader:'P',desiredPartyMembers:['P'],leaderLocation:{map:'main',x:0,y:0},monsterFocus:[],scatterEpoch:0}));
 const status=host.handlers.get('/party-api/status');let response;
 const res={status(code){assert.equal(code,200);return this;},json(value){response=value;}};
 const report=()=>({name:'P',ctype:'priest',map:'main',x:0,y:0,server:'USII',gold:0,items:Array(42).fill(null),hp:100,max_hp:100});
 status({body:report()},res);assert.ok(response);assert.equal(response.partyPositions[0].name,'P');
 assert.equal(Object.hasOwn(response.anniversary,'blacklist'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(response)),{...contracts[0],luckyUpgradeSlots:{GoldMajesty:7},huntCombatTarget:null,travelCombat:null,combatRecovery:null,combatResetByCharacter:{},eventTrip:null,partyTownCycleId:null,returnProgress:null});
 status({body:{...report(),oneShotMonsterTypes:['goo'],oneShotEpoch:response.scatterEpoch}},res);
 assert.equal(response.partyFarmingMonsterType,'goo');assert.ok(response.scatterMonsterTypes.includes('goo'));
 assert.deepEqual(JSON.parse(JSON.stringify(response)),{...contracts[1],luckyUpgradeSlots:{GoldMajesty:7},huntCombatTarget:null,travelCombat:null,combatRecovery:null,combatResetByCharacter:{},eventTrip:null,partyTownCycleId:null,returnProgress:null});
});

test(`${implementation} application propagates explicit no-merchant configuration into heartbeat responses`,async()=>{
 const host=await start(1900000000000,{
  '../config':{characters:{},merchant:null,web_app:{party_dashboard:true,port:0}},
 });
 let response;
 host.handlers.get('/party-api/status')({body:{name:'P',ctype:'priest',map:'main',x:0,y:0,
  server:'USII',gold:0,items:Array(42).fill(null),hp:100,max_hp:100}},
  {status(code){assert.equal(code,200);return this;},json(value){response=value;}});
 assert.equal(response.merchantCharacter,null);
 assert.equal(response.anniversary.merchant,null);
});

test(`${implementation} preserves an explicit null server from the heartbeat sender`,async()=>{
 const host=await start(1900000000000);
 let response;
 host.handlers.get('/party-api/status')({body:{name:'P',ctype:'priest',map:'main',x:0,y:0,
  server:null,gold:0,items:Array(42).fill(null),hp:100,max_hp:100}},
  {status(code){assert.equal(code,200);return this;},json(value){response=value;}});
 assert.equal(response.partyPositions[0].name,'P');
 assert.equal(response.partyPositions[0].server,null);
});
}
