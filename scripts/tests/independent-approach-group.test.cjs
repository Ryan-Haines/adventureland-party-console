const assert=require('node:assert/strict');
require('./fixtures/coordinator-core.cjs');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/independent-approach-group-scenario.cjs');
scenarioTable("the coordinator grants independent approach only on fresh capability and a confirmed round", ()=>fixture, [
 ['the coordinator grants independent approach to fresh capable actors and refuses it on a stale capability report', fixture=>{
 {const f=fixture(),g=f.ready();assert.equal(g.independentApproach,true);assert.equal(g.target.id,'A');assert.equal(g.committed,true);assert.deepEqual(g.recovering,[]);assert.deepEqual(g.participating,['W','P','M']);}
 {const f=fixture();f.ready();f.members[2].status.seenAt=0;const g=evaluateGroup(f.g,f.members,'W',10000);assert.equal(g.independentApproach,false);assert.equal(g.committed,false);}}],
 ['a member report with no `in` and an anchor whose `in` is its map are one place (runtime/protocol/place.ts)', fixture=>{
 const f=fixture();for(const m of f.members.slice(1))delete m.status.in;const g=f.ready();assert.equal(g.independentApproach,true);assert.deepEqual(g.recovering,[]);assert.deepEqual(g.participating,['W','P','M']);}],
]);
