const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync('.build/runtime/' + name, 'utf8');
// party-member.js is caracAL's whole entry (runtime/characters/legacy-entry.ts): it installs every
// owner of owners.ts, loads farming-zones.js before shared.js, and only then installs its class's role
// runner. The stand-in shared.js finds the owners on the frame and builds no targeting module, so the
// runner's install refuses before it starts any timer.
test('party-member.js installs the owners before shared.js and the role runner after it', async () => {
  const calls = [], timers = [];
  let afterShared = false;
  const context = vm.createContext({
    setInterval: (fn, ms) => { if (afterShared) timers.push(ms); return 0; },
    setTimeout: (fn, ms) => { if (afterShared) timers.push(ms); return 0; },
    clearTimeout() {}, clearInterval() {}, queueMicrotask,
    character: { name: 'W', ctype: 'warrior' },
    parent: { caracAL: {
      async load_scripts(files) {
        for (const file of files) {
          calls.push(file); await Promise.resolve();
          if (file.endsWith('farming-zones.js')) vm.runInContext(fs.readFileSync('characters/farming-zones.js', 'utf8'), context);
          if (file.endsWith('/shared.js')) {
            assert.equal(typeof context.installHuntingClient, 'function', "07's install is on the frame when shared.js runs");
            context.sharedRoutine = { isOccupied: () => false };
            afterShared = true;
          }
        }
      },
    } },
  });
  context.root = context;
  vm.runInContext(read('party-member.js'), context);
  await assert.rejects(context.__partyReady, /Shared party code is not ready/);
  assert.deepEqual(calls, ['adventure_land/farming-zones.js', 'adventure_land/shared.js', 'adventure_land/profiles.js']);
  assert.deepEqual(timers, []);
});
