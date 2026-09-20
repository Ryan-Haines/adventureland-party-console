const test = require('node:test'), assert = require('node:assert/strict');
const { coordinatorGroupedSnapshot } = require('../../runtime/coordinator/navigation/grouped-snapshot.ts');

function fixture() {
  const group = { phase: 'ready', selection: 'selection', blockers: [], recovering: [], target: null };
  const state = { leader: 'W', statuses: {}, groupedCombat: group, partyFarmingMode: 'default',
    headlessSlots: ['W', 'P'], steamMembers: ['M'], followers: { P: true, M: true, Absent: true },
    merchantCharacter: 'M', combatLogs: {} };
  const calls = [];
  const ports = { now: () => 100, tickDisengagement: () => calls.push('tick'), disengagementActive: () => false,
    intent: () => ({ revision: 1 }), owned: () => ({ type: 'warrior' }),
    prepare: members => { calls.push(['prepare', members.map(member => member.name)]); return members; },
    evaluate: (...args) => { calls.push(['evaluate', args]); return group; },
    finalize: value => { calls.push('finalize'); return value; }, blocksPulls: () => false };
  return { state, ports, group, calls, run: () => coordinatorGroupedSnapshot(state, ports) };
}

test('event suppression retains the group but cancellation clears it and updates reset time', () => {
  const f = fixture(); f.state.statuses.W = { joinedEvent: true };
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
 f.state.combatEventHandoff={startedAt:50,endedAt:60};
 f.state.statuses={W:{seenAt:100,server:'USII'},P:{seenAt:59,server:'USII'}};
 f.run();assert.ok(f.state.combatEventHandoff);
 f.state.statuses.P.seenAt=100;f.calls.length=0;f.run();
 const previous=f.calls.find(call=>Array.isArray(call)&&call[0]==='evaluate')[1][0];
 assert.deepEqual(previous.queue,[]);assert.equal(previous.resetAt,100);assert.equal(f.state.combatEventHandoff,null);
 assert.equal(f.state.combatLogs.W[0].message,'Event return retired unseen pre-event targets');
});

test('scatter only evaluates during disengagement or convoy defense, excluding merchant and unassigned followers', () => {
  const f = fixture(); f.state.partyFarmingMode = 'scatter';
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, null);
  f.state.activeConvoy = { phase: 'defending' };
  assert.equal(f.run(), f.group);
  assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'prepare'), ['prepare', ['P', 'W']]);
  f.state.activeConvoy = null; f.ports.disengagementActive = () => true;
  assert.equal(f.run(), f.group);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'evaluate').at(-1)[1][5], true);
  f.state.followers.P = false;
  assert.equal(f.run(), null); assert.equal(f.state.groupedCombat, null);
});

test('formation logs change only on meaningful transitions and retain the latest 200 entries', () => {
  const f = fixture();
  f.run(); assert.deepEqual(f.state.combatLogs, {});
  f.state.combatLogs.W = Array.from({ length: 200 }, (_, at) => ({ at }));
  f.ports.finalize = group => ({ ...group, recovering: ['P'] });
  const result = f.run();
  assert.equal(f.state.combatLogs.W.length, 200);
  assert.equal(f.state.combatLogs.W[0].at, 1);
  assert.deepEqual(f.state.combatLogs.W.at(-1).details.recovering, ['P']);
  assert.equal(f.state.groupedCombat, result);
  f.run(); assert.equal(f.state.combatLogs.W[0].at, 1);
});
