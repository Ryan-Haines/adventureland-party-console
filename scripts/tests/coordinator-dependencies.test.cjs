const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCoordinatorDependencies} = require('../../runtime/coordinator/infrastructure/dependencies.ts');

const order = [
  '../../.build/runtime/hunt.cjs', '../../.build/runtime/lifecycle.cjs',
  '../../.build/runtime/grouped-combat.cjs', '../../.build/runtime/roster.cjs',
  '../../.build/runtime/lifecycle.cjs', '../../dashboard/lib/event-policy.cjs',
  'node:child_process', '../account_info', '../game_files', 'bot-web-interface',
  '../monitoring_util', 'express', 'node:fs', 'node:crypto', 'node:vm',
  '../../scripts/ponty-market.cjs', '../../scripts/hunt-safety.cjs',
  '../../characters/farming-zones.cjs', '../../scripts/farm-area-control.cjs',
  '../../scripts/farming-navigation.cjs',
  '../../scripts/convoy-navigation.cjs', '../../scripts/merchant-inventory-stacks.cjs',
  '../../scripts/bank-stack-routing.cjs', '../../scripts/mail-inbox.cjs',
  '../../dashboard/lib/farming-areas.cjs', '../../scripts/party-escape.cjs',
  '../../scripts/convoy-defense.cjs', '../../scripts/combat-disengagement.cjs',
  '../src/CONSTANTS', '../src/LogUtils', '../src/FileStoredKeyValues',
];

test('dependencies use launcher resolution in legacy order and preserve getters and references', () => {
  const calls = [], gets = [], modules = new Map();
  const load = name => {
    calls.push(name);
    if (!modules.has(name)) modules.set(name, new Proxy({}, {get(target, key) {
      gets.push([name, key, calls.length]);
      return target[key] ||= {module: name, property: key};
    }}));
    return modules.get(name);
  };
  const dependencies = loadCoordinatorDependencies(load);
  assert.deepEqual(calls, order);
  assert.equal(dependencies.huntPolicy, modules.get(order[0]));
  assert.equal(dependencies.rareHunting.createRareHunting, require('../../runtime/coordinator/navigation/rare-hunting.ts').createRareHunting);
  assert.equal(dependencies.FileStoredKeyValues, modules.get(order.at(-1)));
  assert.deepEqual(gets.filter(([name]) => name === order[3]).map(([, key, at]) => [key, at]),
    [['installRosterRoutes', 4], ['reservedForSteam', 4], ['publicHandoff', 4]]);
  assert.equal(dependencies.log, modules.get('../src/LogUtils').log);
  assert.equal(dependencies.console, modules.get('../src/LogUtils').console);
  assert.equal(calls.includes('../config'), false, 'configuration stays deferred until environment initialization');
  assert.equal(calls.includes('../../scripts/command-ownership.cjs'), false);
  assert.equal(calls.includes('../../scripts/mail-postage.cjs'), false);
});

test('dependency failure propagates synchronously and prevents later module loading', () => {
  const calls = [], failure = Error('account module failed');
  assert.throws(() => loadCoordinatorDependencies(name => {
    calls.push(name);
    if (name === '../account_info') throw failure;
    return {};
  }), error => error === failure);
  assert.deepEqual(calls, order.slice(0, order.indexOf('../account_info') + 1));
});
