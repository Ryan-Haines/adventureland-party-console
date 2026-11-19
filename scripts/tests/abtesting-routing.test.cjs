const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
const { installEventFacts } = require('../../runtime/events/character/combat.ts');
const { observeEventAttendance } = require('../../runtime/events/coordinator/attendance.ts');

// EV21: the A/B facts of combat.ts on one live arena. The feed searches toward
// the other team's spawn, read from the map's game data (G.maps.abtesting.spawns); an opponent is a
// live other-team character in our instance, or one of ours a split strategy names to feed; the
// nearest opponent ranks our feeders, then attackers of an ally, then the weakest; partyheal goes only
// under a uniform strategy.
function arena() {
  const t = { pvp: true, entities: {}, members: [{ name: 'W', team: 'A' }, { name: 'P', team: 'A' }, { name: 'R', team: 'B' }],
    character: { name: 'W', map: 'abtesting', team: 'A', x: 0, y: 0, in: 'abtesting' } };
  t.facts = installEventFacts({
    game: () => ({ maps: { abtesting: { spawns: [[0, 0], [0, -232], [-832, 0, 2, 160], [832, 0, 1, 160]] } } }),
    character: () => t.character, entities: () => t.entities, members: () => t.members, inPvp: () => t.pvp,
    attend: () => ({ active: () => ({ name: 'abtesting' }) }),
  });
  return t;
}
const foe = (name, extra) => ({ name, type: 'character', team: 'B', x: 50, y: 0, hp: 1000, in: 'abtesting', ...extra });
scenarioTable('EV21: the A/B facts', arena, [
 ['team A searches toward team B on the left, team B toward team A on the right', ({ facts }) => {
  assert.deepEqual({ ...facts.enemySpawn('A') }, { x: -832, y: 0 });
  assert.deepEqual({ ...facts.enemySpawn('B') }, { x: 832, y: 0 });
 }],
 ['a team reads the entity, then its abtesting status', ({ facts }) => {
  assert.equal(facts.team({ team: 'B' }), 'B');
  assert.equal(facts.team({ s: { abtesting: { team: 'A' } } }), 'A');
  assert.equal(facts.team({}), null);
 }],
 ['an opponent is a live other-team character in our instance', t => {
  const { facts } = t;
  assert.equal(facts.validOpponent(foe('X')), true);
  assert.equal(facts.validOpponent(foe('X', { team: 'A' })), false, 'our team');
  assert.equal(facts.validOpponent(foe('X', { rip: true })), false, 'dead');
  assert.equal(facts.validOpponent(foe('X', { in: 'other' })), false, 'another instance');
  assert.equal(facts.validOpponent(foe('R')), false, 'one of ours with no split strategy');
  facts.receiveStrategy({ mode: 'split', majorityTeam: 'A', sabotageNames: ['R'] });
  assert.equal(facts.validOpponent(foe('R')), true, 'a feeder the split names');
  t.pvp = false;
  assert.equal(facts.validOpponent(foe('X')), false, 'no live arena');
 }],
 ['the nearest opponent ranks our feeders, then attackers of an ally, then the weakest', t => {
  const { facts } = t;
  t.entities = { X: foe('X', { hp: 100 }), Y: foe('Y', { hp: 900, target: 'P' }), R: foe('R', { hp: 900 }) };
  assert.equal(facts.nearestOpponent(), null, 'no strategy yet');
  facts.receiveStrategy({ mode: 'uniform' });
  assert.equal(facts.nearestOpponent().name, 'Y', 'the attacker of an ally first');
  delete t.entities.Y;
  assert.equal(facts.nearestOpponent().name, 'X', 'then the weakest');
  facts.receiveStrategy({ mode: 'split', majorityTeam: 'A', sabotageNames: ['R'] });
  assert.equal(facts.nearestOpponent().name, 'R', 'our feeder first');
  facts.receiveStrategy({ mode: 'split', majorityTeam: 'A', sabotageNames: ['W'] });
  assert.equal(facts.nearestOpponent(), null, 'a feeder of ours picks none');
 }],
 ['the mode, the team test and partyheal follow the arena and the strategy', t => {
  const { facts } = t;
  assert.equal(facts.abtestingMode(), 'pending');
  assert.equal(facts.partyhealAllowed(), false);
  facts.receiveStrategy({ mode: 'uniform' });
  assert.equal(facts.abtestingMode(), 'uniform');
  assert.equal(facts.partyhealAllowed(), true);
  facts.receiveStrategy({ mode: 'split', sabotageNames: ['W'] });
  assert.equal(facts.abtestingMode(), 'feed');
  assert.equal(facts.sameTeam({ team: 'A' }), true);
  assert.equal(facts.sameTeam({ team: 'B' }), false);
  t.pvp = false;
  assert.equal(facts.abtestingMode(), 'none');
  assert.equal(facts.sameTeam({ team: 'B' }), true, 'outside the arena every member counts');
  assert.equal(facts.partyhealAllowed(), true);
 }],
]);

// EV30: the A/B join goes only with a free cell, since the server skips
// the prize of a full bag on a branch that can stop before the arena closes. The member stays
// admitted and joins on the first poll with a cell.
scenarioTable('EV30: an A/B join waits for a free cell', () => attendScenario({ event: 'abtesting', map: 'abtesting', freeSlots: 0 }), [
 ['a full bag waits, with the log naming the cell', async ({ attend, calls, t }) => {
  await attend.poll();
  assert.deepEqual(calls.filter(c => c[0] === 'join'), [], 'no join with a full bag');
  assert.ok(t.logs.some(line => /empty inventory slot before A\/B Testing/.test(line)), 'the wait is logged');
  assert.equal(attend.joined(), null);
 }],
 ['a freed cell joins on the next poll', async ({ attend, calls, t }) => {
  await attend.poll();
  t.freeSlots = 1;
  await attend.poll();
  assert.deepEqual(calls.filter(c => c[0] === 'join'), [['join', 'abtesting']]);
  assert.equal(attend.joined(), 'abtesting');
 }],
]);

// EV6: the server refuses a late join only to a character not in the
// round (server.js:12682-12687), so the refusal one member got spares a member that attended.
test('EV6: a join_too_late refusal spares the member already in the round', () => {
  const party = { leader: 'W', followers: {}, eventSelectionsByCharacter: { W: ['abtesting'], P: ['abtesting'], R: ['abtesting'] },
    eventLimitsByCharacter: {}, eventAttendance: {} };
  const live = { server: 'US I', serverLiveEvents: [{ name: 'abtesting', id: 'round' }], eventFeedConnected: true };
  observeEventAttendance(party, { name: 'W', ...live, joinedEvent: 'abtesting' }, 1000);
  observeEventAttendance(party, { name: 'R', ...live }, 1000);
  observeEventAttendance(party, { name: 'P', ...live, eventRefusal: { name: 'abtesting', id: 'round', reply: 'join_too_late' } }, 2000);
  assert.equal(party.eventAttendance.P.abtesting.ignored, 'event-over', 'the refused member skips the round');
  assert.equal(party.eventAttendance.R.abtesting.ignored, 'event-over', 'a member that never attended is refused with it');
  assert.equal(party.eventAttendance.W.abtesting.ignored, undefined, 'the member in the round keeps it');
});
