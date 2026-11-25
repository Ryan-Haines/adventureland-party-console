// The hunting owner's count listener (runtime/hunting/coordinator/install.ts `core:hunt-count`): a
// death counts once on the Hunt of the combat group the member is in.
'use strict';
require('./helpers/core-hooks.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { installHunting } = require('../../runtime/hunting/coordinator/install.ts');

test('a death counts once while a solo scope of the leader shares the party Hunt record', () => {
  const now = () => 5000;
  const hunt = { cycleId: 'c', stage: 'farming', participants: ['W', 'P'], missions: [], currentIndex: 0, target: 'goo', startedAt: 1000 };
  const profile = { targetMode: 'hunt', monsterHunt: hunt, huntSettings: { blacklistDeaths: true, deathThreshold: 2, blacklistExpirations: false, expirationThreshold: 1 },
    huntFailures: {}, huntBlacklist: {} };
  const party = { leader: 'W', statuses: { W: { seenAt: 5000 }, P: { seenAt: 5000 } }, commands: {} };
  for (const key of Object.keys(profile)) Object.defineProperty(party, key, { enumerable: true, get: () => profile[key], set: v => { profile[key] = v; } });
  // The solo view of the leader reads the leader's profile, as tasks/coordinator/groups.ts `view` does.
  const solo = new Proxy(party, { get: (target, key) => key === 'leader' ? 'W' : Reflect.get(target, key) });
  const groups = ['party:W'];
  const hunting = installHunting(party, { cave: { now, persist() {}, cancel() {}, online: () => true, offline: () => false },
    rare: { now, members: () => ['W', 'P'], group: () => 'party:W' }, persist() {}, groups: () => groups, solo: () => false,
    farmingState: () => ({}), activeNames: () => ['W', 'P'], now });
  const ports = id => ({ now, participants: () => ['W', 'P'], cancelConvoy() {}, persist() {}, selectedDestination: () => null, start() {},
    navigation: { members: () => ['W', 'P'], intent: () => ({}), authorize() {} }, intentHold() {}, drain: () => false, farmingLive: () => true,
    group: () => id, ladder: () => ({ fail() {}, rung: () => null }) });
  // The solo group was composed while W followed no leader; W now leads the party.
  hunting.group(solo, 'solo', {}, ports('solo:W'));
  hunting.group(party, 'party', {}, ports('party:W'));
  partyHooks().notify('survival.died', { name: 'W', at: 2000, cause: 'Killed by Rime Djinn', map: 'main', x: 0, y: 0, event: null, by: 'core:survival' });
  assert.equal(profile.huntFailures.goo.deaths, 1);
  assert.equal(!!profile.huntBlacklist.goo, false, 'one death stays below a threshold of 2');
});
