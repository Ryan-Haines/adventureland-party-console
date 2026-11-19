// A class bundle's start over a stub game client: the owners, shared.js's install and the role
// runner, built from runtime/characters/entries as tools/game/build.mts builds them. shared.js builds
// each owner after the doors it reads, so a port that reads a later owner at its call throws here
// before any game call. The stub answers every game name with a callable value, the game data is
// the installed client's G, and the timers and draw frames never fire, so only the load order runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const installed = require('./helpers/installed-game.cjs');

const root = path.join(__dirname, '../..');
let source;
function warriorBundle() {
  source ??= buildSync({ absWorkingDir: root, entryPoints: ['runtime/characters/entries/warrior.ts'], bundle: true,
    format: 'iife', platform: 'browser', target: 'es2022', write: false }).outputFiles[0].text;
  return source;
}

// A value for every game name the start reads and no test sets: callable, any property, empty when
// iterated, 0 as a primitive and never a thenable.
function any() {
  return new Proxy(function () { return any(); }, {
    get: (target, key) => key === Symbol.iterator ? function* () {} : key === Symbol.toPrimitive ? () => 0
      : key === 'then' ? undefined : any(),
    apply: () => any(), construct: () => any(),
  });
}

function startWarrior() {
  const data = {};
  vm.runInNewContext(fs.readFileSync(path.join(installed.directory, 'data.js'), 'utf8'), data);
  const frame = { console, Date, Math, JSON, Promise, Map, Set, WeakMap, Array, Object, Error, TypeError,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    character: { name: 'E2EWarrior', ctype: 'warrior', x: 0, y: 0, map: 'main', items: [], slots: {} },
    parent: { entities: {}, socket: { on() {}, off() {} }, S: {}, draw_trigger() {} }, G: data.G };
  // The console's own frame names (the owners' doors and installs, the shared routine) are undefined
  // until the bundle publishes them, so a door no entry imports fails as it does in the game.
  const consoleName = key => typeof key === 'string' && /^(party|__party|install|shared)/.test(key);
  const context = vm.createContext(new Proxy(frame, { has: () => true,
    get: (target, key) => key in target ? target[key] : key in globalThis ? globalThis[key] : consoleName(key) ? undefined : any() }));
  frame.globalThis = context;
  let error = null;
  try { vm.runInContext(warriorBundle(), context, { filename: 'warrior.js' }); } catch (thrown) { error = thrown; }
  return { frame, error };
}

// ae41fe0ff built targeting after the merchant's Luck, whose ports read `targeting.positions` as
// they were built, so every class load threw a TypeError in luckPorts and no character started
// (side-by-side dry run, 2026-11-16).
test('shared.js installs its shared routine at load', () => {
  const { frame, error } = startWarrior();
  assert.ok(frame.sharedRoutine, String(error && error.stack));
});

// 8b3c70adc moved the role runner's movement tick from the shared routine to movement's door,
// root.partyMovement, which held the movers only as `follow`, so the runner's start threw
// "startMovementTick is not a function".
test('the role runner starts with movement\'s tick', () => {
  const { frame, error } = startWarrior();
  assert.equal(error, null, String(error && error.stack));
  assert.ok(frame.partyRoleRunner);
});
