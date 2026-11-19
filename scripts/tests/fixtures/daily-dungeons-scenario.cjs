// The daily dungeon controller over a three-member party (a shared setup lives in the harness).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCave: createDungeons } = require('../../../runtime/hunting/coordinator/cave.ts');
const { installDungeonRuntime } = require('../../../runtime/hunting/character/cave.ts');
const { createDungeonJournal } = require('../../../runtime/hunting/character/cave.ts');
const { createDeathRecovery } = require('../../../runtime/characters/survival/recovery-member.ts');
const { publishTasks } = require('../../../runtime/tasks/api.ts');
const { publishEventAnswers } = require('../../../runtime/events/api.ts');

// One cave run's observation, which the fixture's members report once inside and the rows reshape.
const cave = () => ({ run: 'run-1', floor: 0, expires: 200000, server_time: 100000, remaining_ms: 100000,
  paused: false, gold: 100, amber: 2, points: [], choice: { id: 'choice-1', title: 'Shop', text: '',
    deadline: 200000, resolved: true, votes: {}, options: [], shop: { room: 'shop-1', name: 'Potion', price: 20, sold: false, nearby: true } } });
function fixture() {
  let now = 100000;
  const party = { leader: 'W', followers: { P: true, M: true }, merchantCharacter: 'Bank', statuses: {} };
  for (const name of ['W', 'P', 'M']) party.statuses[name] = { seenAt: now, server: 'II', rip: false, map: 'main', x: 816, y: 1200,
    dungeon: { protocol: 1, at: now, supported: true, alive: true, ready: true, members: ['W', 'P', 'M'], leader: 'W', cave: null,
      visit: { available: true, checkedAt: now, resets: now + 86400000, home: 'II' }, keeper: { map: 'main', x: 816, y: 1200 } } };
  // 01 puts the leader in the party group, and 06 answers `event.schedule` from `schedules`, which
  // a row fills by occurrence id (the Cave's event exit reads both).
  const schedules = new Map();
  publishTasks({ groupOf: name => name === party.leader ? 'party:' + name : null });
  publishEventAnswers({ schedule: id => schedules.get(id) ?? null });
  // 13 answers no member offline, as it does for a member its slot holds online.
  const service = createDungeons(party, { now: () => now, persist() {}, cancel() {}, offline: () => false });
  const action = (body) => service.action({ operationId: 'op-' + Math.random(), ...body });
  function active() {
    action({ action: 'enter' });
    for (const name of ['W', 'P', 'M']) party.statuses[name].dungeon.action = { id: party.dailyDungeons.commands[name].id, status: 'complete' };
    service.reconcile();
    for (const name of ['W', 'P', 'M']) party.statuses[name].dungeon.cave = cave();
    service.reconcile();
  }
  return { party, service, action, active, schedules, advance: ms => { now += ms; }, now: () => now };
}
function eligibilityRuntime(info) {
  let now = 100000;
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true,
    now: () => now, alive: () => true, current: () => true, cave: () => null, supported: () => true,
    info, request: async () => {}, keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write() {} });
  return { runtime, advance: ms => now += ms };
}

module.exports = { fixture, eligibilityRuntime, cave };
