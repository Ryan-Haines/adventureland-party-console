const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync('characters/shared.js', 'utf8');

test('event release clears exactly its held movement and wakes acquisition', async () => {
  const start = source.indexOf('  async function handleCommand(command)');
  const end = source.indexOf("    if(command.type==='party-monster-travel' && command.phase==='defending')", start);
  for (const kind of ['matching', 'different', 'cancelled', 'revision']) {
    let wakes = 0, released = 0, stops = 0;
    const c = vm.createContext({ lastCommand: 1, navigationIntent: { revision: kind === 'revision' ? 3 : 2, cancelled: kind === 'cancelled' },
      convoyTraveling: { id: kind === 'different' ? 'new' : 'failed', epoch: 4, release() { released++; } },
      releaseConvoyCruise() {}, stop: async () => stops++, partyRoleRunner: { wake() { wakes++; } }, Date });
    c.root = c;
    vm.runInContext(source.slice(start, end) + '\n}', c);
    await c.handleCommand({ id: 2, type: 'party-monster-travel', phase: 'event-walk-release', convoyId: 'failed', epoch: 4, navigationRevision: 2, reason: 'runtime-lost' });
    if (kind === 'matching') {
      assert.equal(c.convoyTraveling, null); assert.equal(released, 1); assert.equal(stops, 1); assert.equal(wakes, 1);
      assert.equal(c.__partyEventWalkFailure.reason, 'runtime-lost');
    } else { assert.ok(c.convoyTraveling); assert.equal(released, 0); assert.equal(stops, 0); assert.equal(wakes, 0); }
  }
});

function reentry(overrides = {}) {
  const c = vm.createContext({ escapeOwns: () => false, navigationIntent: { revision: 2, cancelled: false },
    eventsEnabled: true, character: { ctype: 'priest' }, activeCombatEvent: () => ({ name: 'franky', types: ['franky'], state: {} }),
    eventSelectionRevision: 1, runtimeCurrent: () => true, eventSelected: () => true, eventTravelAllowed: async () => true,
    eventTraveling: false, eventTargetTypes: [], eventMissingSince: 0, travellingEventName: null, joinedEvent: 'franky',
    __partyEventRejoinRequired: 'franky', stop: async () => {}, eventDestination: () => ({ map: 'level2w', x: 0, y: 0 }),
    eventRequiresJoin: () => true, join: async () => {}, nearestEventTarget: () => ({ id: 'boss' }),
    sharedPartyWalk: async () => {}, game_log() {}, ...overrides });
  c.root = c;
  const start = source.indexOf('  async function rejoinActiveEventAfterRespawn()');
  vm.runInContext(source.slice(start, source.indexOf('  async function regenerateHpOrMp()', start)), c);
  return c;
}
test('event recovery distinguishes join and walk failure and never repeats a successful join', async () => {
  const joinFailure = reentry({ join: async () => { throw { reason: 'openning' }; } });
  const failed = await joinFailure.rejoinActiveEventAfterRespawn();
  assert.equal(failed.status, 'retryable'); assert.equal(failed.phase, 'event-reentry'); assert.equal(failed.reason, 'openning');
  assert.equal(joinFailure.eventTraveling, false);
  let joins = 0;
  const walking = reentry({ join: async () => joins++, nearestEventTarget: () => null, sharedPartyWalk: async () => { throw Error('route blocked'); } });
  assert.equal((await walking.rejoinActiveEventAfterRespawn()).phase, 'event-travel');
  walking.nearestEventTarget = () => ({ id: 'boss' });
  assert.equal((await walking.rejoinActiveEventAfterRespawn()).status, 'recovered'); assert.equal(joins, 1);
});
test('cancellation during join releases event ownership without continuing its walk', async () => {
  const c = reentry({ sharedPartyWalk: async () => assert.fail('cancelled walk') });
  c.join = async () => { c.navigationIntent.revision++; };
  assert.equal((await c.rejoinActiveEventAfterRespawn()).status, 'cancelled');
  assert.equal(c.eventTraveling, false); assert.equal(c.travellingEventName, null);
});


test('restart preserves the original failed event-walk diagnosis',()=>{
 const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
 const state=initialCommandState({activeConvoy:{id:'failed',purpose:'shared-walk',label:'event walking leg',phase:'failed',
 failure:'Convoy runtime-lost',failureCode:'runtime-lost',failedAt:123,expected:{A:{revision:2}}}},()=>999);
 assert.equal(state.activeConvoy.failure,'Convoy runtime-lost');assert.equal(state.activeConvoy.failedAt,123);
 assert.equal(state.activeConvoy.restartRevisions.A,2);
});
