const test=require('node:test');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const assert=require('node:assert/strict');
const {run,runBundled,heartbeat}=require('./helpers/coordinator-host.cjs');

function stableResponse(response) {
 const {transportTiming,...body}=JSON.parse(JSON.stringify(response));
 assert.equal(transportTiming.receivedAt,1900000000000);
 assert.equal(transportTiming.sentAt,1900000000000);
 assert.ok(Number.isFinite(transportTiming.eventLoopMaxMs) && transportTiming.eventLoopMaxMs>=0);
 assert.ok(Object.keys(transportTiming.statusStages).length>0);
 for(const stage of Object.values(transportTiming.statusStages)) {
  assert.ok(Number.isFinite(stage.lastMs) && stage.lastMs>=0);
  assert.ok(Number.isFinite(stage.maxMs) && stage.maxMs>=stage.lastMs);
 }
 return body;
}

// A solo heartbeat must retain its singleton authorization scope, but without
// runtime readiness it must not become ready, commit a fight, or select a target.
// The subsequent scatter-farming heartbeat still has no grouped combat scope.
const soloGroup = {
 protocol:4, key:'[["P",0,false,null]]', leader:'P', targetLeader:'P',
 members:['P'], anchor:{name:'P',map:'main',x:0,y:0,server:'USII'},
 range:150, ready:false, readySince:null, committed:false, phase:'regrouping',
 blockers:['P: waiting for updated combat runtime'], fighter:null, priest:null,
 target:null, selection:null, pairRevision:null, queue:[],
 queueRevision:JSON.stringify(['[["P",0,false,null]]',[]]),
 claims:[], deaths:[], evidence:[], fights:[], lostTargets:[], observers:[],
 participating:[], passingEncounters:[], pursuitExclusions:[], rareRejections:[],
 recovering:[], recoverySince:{}, resetAt:0, searches:{},
 seenAt:1900000000000, threats:[], transitionTrace:[],
};

// The start runs with the harness's console, so a start that throws fails its row naming
// start.ts failStart's line and the error, where a start loaded through Node's console printed [].
test('a start that throws fails naming failStart and its error',async()=>{
 await assert.rejects(run(undefined,{'../lifecycle/coordinator/workers.ts':workers=>({...workers,createWorkers(){throw Error('fixture workers');}})}),
  error=>/failed to start caracAL/.test(error.message)&&/fixture workers/.test(error.message));
});

scenarioTable('the source and the bundled coordinator answer heartbeats from one started host',(start,modules)=>start(1900000000000,modules),
 [['source',run],['bundle',runBundled]].flatMap(([implementation,start])=>[
[`${implementation} heartbeat saves cumulative slot evidence and returns it without marking it verified`,async host=>{
 const evidence={version:1,streamId:'client-a',slots:{0:{totalRolls:2,sumRolls:0.2,rollsAbove96_3:0,perfectRolls:1}}};
 heartbeat(host,{luckySlotTracking:structuredClone(evidence)});const response=heartbeat(host,{luckySlotTracking:structuredClone(evidence)});
 assert.deepEqual(JSON.parse(JSON.stringify(response.luckySlotTracking.P['client-a'])),evidence);
 assert.deepEqual(JSON.parse(JSON.stringify(response.luckyUpgradeSlots)),{});
},start],
[`${implementation} coordinator handles first and repeated heartbeats without a current combat target`,async host=>{
 assert.equal(host.handlers.has('/party-api/anniversary/blacklist'),false);
 // The harness starts with no saved settings, so the merchant job owner's first setup picks a
 // random standable Main point in -100..100 (stand.ts firstStandLocation) and the reply carries it.
 let response=heartbeat(host),stand=response.merchantStandLocation;
 assert.equal(stand.map,'main');assert.ok(Math.abs(stand.x)<=100&&Math.abs(stand.y)<=100);
 const contracts=require('./fixtures/heartbeat-contracts.json').map((value,index)=>({...value,merchantStandLocation:stand,groupedCombat:index===0?{...soloGroup,independentApproach:false}:null,leader:'P',desiredPartyMembers:['P'],leaderLocation:{map:'main',x:0,y:0},monsterFocus:[],scatterEpoch:0,passingControl:{scope:'[null,[["P",0,null,"USII","main",null]]]',ready:false,admitted:[]}}));
 assert.ok(response);assert.equal(response.partyPositions[0].name,'P');
 assert.equal(Object.hasOwn(response.anniversary,'blacklist'),false);
 assert.deepEqual(stableResponse(response),{...contracts[0],consoleMaintenance:null,bankStaging:false,pontyWanted:false,eventsEnabled:true,luckyUpgradeSlots:{},luckySlotLocks:{},luckySlotResume:{},luckySlotTracking:{},luckySlotCharacterIds:{},huntCombatTarget:null,travelCombat:null,combatRecovery:null,combatResetByCharacter:{},eventTrip:null,partyTownCycleId:null,returnProgress:null,merchantVisibility:null,dailyDungeon:{owned:false,movementReady:true}});
 response=heartbeat(host,{oneShotMonsterTypes:['goo'],oneShotEpoch:response.scatterEpoch});
 assert.equal(response.partyFarmingMonsterType,'goo');assert.ok(response.scatterMonsterTypes.includes('goo'));
 assert.deepEqual(stableResponse(response),{...contracts[1],consoleMaintenance:null,bankStaging:false,pontyWanted:false,eventsEnabled:true,luckyUpgradeSlots:{},luckySlotLocks:{},luckySlotResume:{},luckySlotTracking:{},luckySlotCharacterIds:{},huntCombatTarget:null,travelCombat:null,combatRecovery:null,combatResetByCharacter:{},eventTrip:null,partyTownCycleId:null,returnProgress:null,merchantVisibility:null,dailyDungeon:{owned:false,movementReady:true}});
},start],

[`${implementation} application propagates explicit no-merchant configuration into heartbeat responses`,async host=>{
 const response=heartbeat(host);
 assert.equal(response.merchantCharacter,null);
 assert.equal(response.anniversary.merchant,null);
},start,{
  '../config':{characters:{},merchant:null,web_app:{party_dashboard:true,port:0}},
 }],

[`${implementation} preserves an explicit null server from the heartbeat sender`,async host=>{
 const response=heartbeat(host,{server:null});
 assert.equal(response.partyPositions[0].name,'P');
 assert.equal(response.partyPositions[0].server,null);
},start],
]));

// The slot keeps a command
// its delivery does not complete. Each of the merchant owner's job commands stays for its job's completion route, one
// row per command the merchant owner's kind table names; an equip or unequip stays until a report's `lastCommandId`
// reaches its id, then leaves.
{
 const { retained } = require('../../runtime/status/rules.ts');
 const { JOB_KINDS, jobCommandRetained } = require('../../runtime/merchant-jobs/rules.ts');
 const commands = [...new Set(Object.values(JOB_KINDS).flatMap(kind => kind.command ? [kind.command] : []))];
 test('DF5: the table names job commands to keep', () => assert.ok(commands.length > 0));
 scenarioTable('DF5: each job command the kind table names stays past its first delivery', null, commands.map(type => [`DF5: a retained job command ${type} survives its first delivery`, () => {
  assert.equal(retained({ id: 7, type }, undefined, jobCommandRetained), true);
  assert.equal(retained({ id: 7, type }, 7, jobCommandRetained), true, 'a job command waits for its completion route, not the report');
 }]));
 scenarioTable('DF40: an equip or unequip command stays until a report names its id', null, ['equip', 'unequip'].map(type => [`DF40: an ${type} command stays until a report names its id`, () => {
  assert.equal(retained({ id: 12, type }, undefined, jobCommandRetained), true, 'no report yet');
  assert.equal(retained({ id: 12, type }, 11, jobCommandRetained), true, 'the report names an older command');
  assert.equal(retained({ id: 12, type }, 12, jobCommandRetained), false, 'the report names it');
 }]));
}
