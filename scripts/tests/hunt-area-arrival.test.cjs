const test=require('node:test'),assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/hunt-area-arrival-scenario.cjs');

scenarioTable('Hunt travel hands off to farming only after every member acknowledged the stop (MOV-135)', fixture, [
 ['spawn edge stops once, requires matching stopped acknowledgements, releases ownership without center rally', f=>{
 assert.equal(f.step(),true);assert.equal(f.c.phase,'hunt-arrival');assert.equal(f.h.stage,'mission-travel');const epoch=f.c.epoch;
 assert.equal(f.step(),false);assert.equal(f.c.epoch,epoch);f.ack();f.s.statuses.W.convoyNavigation.commandId--;
 assert.equal(f.step(),false);f.ack();assert.equal(f.step(),true);assert.equal(f.s.activeConvoy,null);assert.deepEqual(f.s.commands,{});assert.equal(f.s.statuses.W.x,510);
 // Movement ends the walk and keeps the released commands; 07 moves the Hunt's stage when it hears walk.ended.
 assert.deepEqual(Object.keys(f.s.releasedArrivalCommands),f.names);assert.equal(f.h.stage,'mission-travel');
 }],
]);
