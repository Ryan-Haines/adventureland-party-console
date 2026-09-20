const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync('.build/runtime/' + name, 'utf8');
test('generic compatibility entry loads geometry and shared code before starting its class role', async () => {
  const calls = [], errors = [];
  const shared = fs.readFileSync('characters/shared.js', 'utf8');
  const guard = shared.slice(shared.indexOf('  if (!root.partyFarmingZones)'), shared.indexOf('  var runtimeGeneration'));
  const context = vm.createContext({ game_log: message => errors.push(message), parent: { caracAL: {
    async load_scripts(files) {
      for (const file of files) {
        calls.push(file); await Promise.resolve();
        if (file.endsWith('farming-zones.js')) vm.runInContext(fs.readFileSync('characters/farming-zones.js', 'utf8'), context);
        if (file.endsWith('/shared.js')) { vm.runInContext(guard, context); context.sharedRoutine = { isOccupied: () => false }; }
        if (file.endsWith('/roles.js')) context.partyRoleRunner = { start() { assert.ok(context.sharedRoutine); calls.push('start'); } };
      }
    },
  } } });
  context.root = context;
  vm.runInContext(read('party-member.js'), context);
  await context.__partyReady;
  assert.deepEqual(errors, []);
  assert.equal(calls.at(-1), 'start');
  assert.ok(calls.indexOf('adventure_land/farming-zones.js') < calls.indexOf('adventure_land/shared.js'));
});
test('missing shared dependency fails before installing any combat timers', () => {
  const timers = [];
  const context = vm.createContext({ setInterval: fn => timers.push(fn), setTimeout, clearTimeout, clearInterval,
    character: { name: 'W', ctype: 'warrior' } });
  vm.runInContext(read('roles.js'), context);
  assert.throws(() => context.partyRoleRunner.start(), /Shared party code is not ready/);
  assert.equal(timers.length, 0);
  context.partyRoleRunner.stop();
});
