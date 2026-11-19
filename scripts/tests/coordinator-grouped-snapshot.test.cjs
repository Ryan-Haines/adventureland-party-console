const test = require('node:test'), assert = require('node:assert/strict');
const { coordinatorGroupedSnapshot } = require('../../runtime/coordinator/targeting/snapshot.ts');
require('./fixtures/coordinator-core.cjs');
const { partyHooks } = require('../../runtime/hooks/index.ts');
// Survival's `survival.recoveryStep` as the rows plant it: each ask is one step, and the answer
// is the row's recovery view.
const recovery = { view: undefined, calls: null };
if (!partyHooks().map().registrations.some(r => r.name === 'core:survival-step-fixture'))
  partyHooks().register({ name: 'core:survival-step-fixture', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'survival.recoveryStep': () => { recovery.calls.push('tick'); return recovery.view; } } });
const running = { id: 'death-1', phase: 'finishing', reason: '', names: [], targets: [], fight: { running: true, keepsObservations: true, keepsCommitted: true }, record: {} };

function fixture() {
  const group = { phase: 'ready', selection: 'selection', blockers: [], recovering: [], target: null };
  const state = { leader: 'W', statuses: {}, groupedCombat: group, partyFarmingMode: 'default',
    headlessSlots: ['W', 'P'], steamMembers: ['M'], followers: { P: true, M: true, Absent: true },
    merchantCharacter: 'M', combatLogs: {} };
  // The tasks owner's `presence` reads the fact each status carries, as install.ts
  // answers it.
  require('./helpers/requesters.cjs').publishPresence(() => state.statuses);
  const calls = [];
  recovery.view = undefined; recovery.calls = calls;
  const ports = { now: () => 100, passing: walk => partyHooks().targeting.passing(walk), recoveryGroup: () => 'party:W',
    intent: () => ({ revision: 1 }), owned: () => ({ type: 'warrior' }),
    prepare: members => { calls.push(['prepare', members.map(member => member.name)]); return members; },
    evaluate: (...args) => { calls.push(['evaluate', args]); return group; }, pullsHeld:()=>false, rareRejections: () => [] };
  return { state, ports, group, calls, run: () => coordinatorGroupedSnapshot(state, ports) };
}

test('event suppression retains the group but cancellation clears it and updates reset time', () => {
  const f = fixture(); f.state.statuses.W = { presence: { event: 'goobrawl', phase: 'attending' } };
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, f.group);
  assert.deepEqual(f.calls, ['tick']);
  f.ports.intent = () => ({ revision: 1, cancelled: true });
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, null);
  assert.equal(f.state.groupedCombatResetAt, 100);
});
test('unselected leader clears an absent initial group after disengagement without evaluating members', () => {
  const f = fixture(); f.state.leader = null; delete f.state.groupedCombat;
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, null);
  assert.deepEqual(f.calls, ['tick']);
});
test('completed event retirement waits for fresh members and removes only unseen pre-event targets', () => {
 const f=fixture(),target={id:'old',map:'main',server:'USII',startedAt:1};
 Object.assign(f.group,{queue:[target],fights:[target],threats:[target],evidence:[target]});
 f.state.eventBoundary={startedAt:50,endedAt:60};
 f.state.statuses={W:{seenAt:100,server:'USII'},P:{seenAt:59,server:'USII'}};
 f.run();assert.ok(f.state.eventBoundary);
 f.state.statuses.P.seenAt=100;f.calls.length=0;f.run();
 const previous=f.calls.find(call=>Array.isArray(call)&&call[0]==='evaluate')[1][0];
 assert.deepEqual(previous.queue,[]);assert.equal(previous.resetAt,100);assert.equal(f.state.eventBoundary,null);
 assert.equal(f.state.combatLogs.W[0].message,'Event return retired unseen pre-event targets');
});

test('scatter only evaluates during disengagement or convoy defense, excluding merchant and unassigned followers', () => {
  const f = fixture(); f.state.partyFarmingMode = 'scatter';
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, null);
  f.state.activeConvoy = { phase: 'defending' };
  assert.equal(f.run(), f.group);
  assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'prepare'), ['prepare', ['P', 'W']]);
  f.state.activeConvoy = null; recovery.view = running;
  assert.equal(f.run(), f.group);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'evaluate').at(-1)[1][5], true);
});

// The latest the settings owner's historyKept (500 by default), the bound the history document
// saves.
test('formation logs change only on meaningful transitions and retain the latest historyKept entries', () => {
  const f = fixture();
  f.run(); assert.deepEqual(f.state.combatLogs, {});
  f.state.combatLogs.W = Array.from({ length: 500 }, (_, at) => ({ at }));
  f.ports.evaluate = () => ({ ...f.group, recovering: ['P'] });
  const result = f.run();
  assert.equal(f.state.combatLogs.W.length, 500);
  assert.equal(f.state.combatLogs.W[0].at, 1);
  assert.deepEqual(f.state.combatLogs.W.at(-1).details.recovering, ['P']);
  assert.equal(f.state.groupedCombat, result);
  f.run(); assert.equal(f.state.combatLogs.W[0].at, 1);
});
