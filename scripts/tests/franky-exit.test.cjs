const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { fixture } = require('./fixtures/franky-exit-scenario.cjs');

scenarioTable('the Franky exit convoy and return rebuild under their owned cycle', fixture, [
  ['exit assembles only remote members, even with cleared farming focus, preserving farm location', ({context,party,recovery})=>{
    const location=party.location;
    assert.equal(context.startFrankyExitConvoy(recovery),true);
    assert.deepEqual(Array.from(party.activeConvoy.participants),['B','C']);
    assert.equal(party.activeConvoy.leader,'B');
    assert.equal(party.activeConvoy.rally.map,'level2w');
    assert.equal(party.location,location);
    assert.equal(party.commands.B.navigationExempt,true);
    assert.equal(party.activeConvoy.combatHandoffAllowed,false);
    assert.equal(context.startFrankyExitConvoy(recovery),false);
  }],
  ['completed exits cannot restart from stale position heartbeats', ({context,recovery})=>{
    recovery.exited=['B','C'];
    assert.equal(context.startFrankyExitConvoy(recovery),false);
  }],
  ['failed exit rebuilds using remaining remote participants', ({context,party,recovery})=>{
    context.startFrankyExitConvoy(recovery);
    const first=party.activeConvoy.id; party.activeConvoy.phase='failed'; recovery.exited=['B'];
    assert.equal(context.startFrankyExitConvoy(recovery),true);
    assert.notEqual(party.activeConvoy.id,first);
    assert.deepEqual(Array.from(party.activeConvoy.participants),['C']);
  }],
  ...['town-unavailable','town-interrupted','communication-timeout','owner-lost'].map(code=>
    ['Franky retry distinguishes '+code+' within its owned cycle', ({context,party,recovery})=>{
      context.startFrankyExitConvoy(recovery);
      Object.assign(party.activeConvoy,{phase:'failed',failureCode:code});
      context.startFrankyExitConvoy(recovery);
      const walking=['town-unavailable','town-interrupted'].includes(code);
      assert.equal(!!party.activeConvoy.disableTown,walking);assert.equal(party.activeConvoy.townFirst,!walking);
      recovery.exitTownFallback={cycleId:'old-cycle',participants:['B','C']};party.activeConvoy.phase='failed';party.activeConvoy.failureCode='communication-timeout';
      context.startFrankyExitConvoy(recovery);assert.equal(!!party.activeConvoy.disableTown,false);
    }]),
  ['a newer anniversary hold suspends exit convoy rebuilding', ({context,recovery})=>{
    recovery.exitSuspended=true;
    assert.equal(context.startFrankyExitConvoy(recovery),false);
  }],
  // EV11: a member the return still holds whose exit command was
  // replaced (the left-out member's farm walk) gets the exit again on its next fresh report, so the
  // return does not stay evacuating with that member pending.
  ['a pending member whose exit command is gone gets the exit again on its next report', ({context,party,recovery})=>{
    Object.assign(recovery,{event:'crabxx',participants:['A','B','C'],pending:['B'],startedAt:Date.now(),phase:'evacuating',checkpoint:null});
    Object.assign(party,{deferredEventReturns:{},eventSessions:{}});
    party.commands.B={id:9,type:'party-monster-travel'};
    context.reconcileCombatEventReturn();
    assert.equal(party.commands.B.type,'party-monster-travel','a command the return did not issue stays');
    delete party.commands.B;
    context.reconcileCombatEventReturn();
    assert.equal(party.commands.B.type,'event-return-town');assert.equal(party.commands.B.cycleId,'return');
  }],
]);
// EV16's walk repair: the failed return walk is cancelled and
// re-issued once no participant's live task ranks at the merchant job's tier in the tasks owner's rank table;
// a merchant job keeps the walk until it ends. It builds no coordinator context, so it stays its own test.
test('the failed return walk waits while a participant runs a merchant job',()=>{
  const {repairReturnWalk}=require('../../runtime/events/coordinator/returns.ts'),{publishTasks}=require('../../runtime/tasks/api.ts');
  const tiers={M:'errand'};
  publishTasks({assignment:name=>tiers[name]?{kind:'merchant-job',owner:'merchant-job:1',tier:tiers[name],reunion:'no'}:null});
  const recovery={cycleId:'r',event:'crabxx',participants:['A','M'],pending:['A','M'],waypoints:{A:{revision:1},M:{revision:1}}};
  const convoy={id:'c',phase:'failed',purpose:'shared-walk-return',walkingActivity:'event-return',participants:['A','M'],
    walkingParents:{A:{revision:1,command:{cycleId:'r'}},M:{revision:1,command:{cycleId:'r'}}}};
  const commands={A:{id:1,cycleId:'r'}},calls=[];
  const ports={convoy:()=>convoy,capture:()=>({A:{revision:1},M:{revision:1}}),commands:()=>commands,now:()=>1000,
    statuses:()=>statuses,cancelConvoy:()=>calls.push('cancel'),
    clearCommand:name=>delete commands[name],town:name=>calls.push(['town',name]),persist(){}};
  let statuses={A:{seenAt:1000,map:'level2w'},M:{seenAt:1000,map:'level2w'}};
  repairReturnWalk(recovery,ports);assert.deepEqual(calls,[]);
  delete tiers.M;repairReturnWalk(recovery,ports);
  assert.deepEqual(calls,['cancel',['town','A'],['town','M']]);
  // A member who died in the walk respawns on Main outside Town (Graveyard Rising), so
  // only Main Town counts as returned: A gets the Town command and stays pending, M in Town does not.
  calls.length=0;commands.A={id:1,cycleId:'r'};recovery.pending=['A','M'];
  statuses={A:{seenAt:ports.now(),map:'main',x:1300,y:-420},M:{seenAt:ports.now(),map:'main',x:10,y:20}};
  repairReturnWalk(recovery,ports);
  assert.deepEqual(calls,['cancel',['town','A']]);assert.deepEqual(recovery.pending,['A']);
});
