// The role runner over the class roles, built in memory for the vm tests (combat-claims.test.cjs,
// fixtures/combat-runner-scenario.cjs, fixtures/formation-scenario.cjs). The class bundles also run
// shared.js and every owner, so each test builds this entry instead and stands in the shared routine
// it reads. It puts the roles on `partyRoles` for the rows that call one role's turn and
// `installRoleRunner` on `RunnerTest` for the rows that install their own role. With `install` it
// also installs the runner for `character.ctype`.
//
// installRoleRunner reads six realm owners that shared.js publishes at load, and the selection asks
// The lifecycle owner's `lifecycle.drain` on the realm's registry. The entry plants each one the context left out, for
// a character with no party, no grouped farm, no hand hold, no queue to mark, an idle loot pass and
// no console drain. A test's own plant wins, and a planted partyMovement keeps its members over the
// stand-in's.
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.join(__dirname, '../../..');
const sources = {};
const realmOwners = [
  "import { createHandoffTiming } from './runtime/status/character/rings.ts';",
  "import { partyHooks } from './runtime/hooks/index.ts';",
  'const realm = globalThis, no = () => false, none = () => null;',
  // The lifecycle owner's core registration (lifecycle/character/drain.ts) with the not-draining answer.
  'const hooks = partyHooks();',
  "if (!hooks.registrations().some(r => r.hooks && r.hooks['lifecycle.drain'])) hooks.publish({ name: 'core:lifecycle', folder: 'core',",
  "  author: 'adventureland-party-console', summary: 'Answers no console drain on a test realm.', hooks: { 'lifecycle.drain': none } });",
  // The status owner's character door (shared.js `partyStatus.character`).
  'realm.partyStatus ??= {};',
  'realm.partyStatus.character ??= { applyChannel: (data, combat) => combat(data), queueMarkers: none,',
  '  handoffTiming: createHandoffTiming([], () => true) };',
  // Movement's character door: its coordinator clock, no convoy and no recovery clients.
  'realm.partyMovement = { startMovementTick: () => () => {}, resetCombatMovement() {}, coordinatorNow: () => Date.now(),',
  '  convoyActive: no, independentApproachClient: none, terrainRecoveryClient: none, queueSightRecovery: none, ...realm.partyMovement };',
  // The hunting owner's character door: no grouped farm, and loot ports with no quest, chest or socket.
  'realm.partyHunting ??= { farm: { grouped: no, mode: () => "default" }, lootPorts: () => ({ name: () => character.name, quest: none,',
  '  positions: () => [], clockOffset: () => 0, character: () => character, frame: () => realm, navigationCancelled: no, escaping: no,',
  '  eventJoined: none, defending: no, passing: no, engaged: no, chests: () => ({}), socket: none }) };',
  // The tasks owner's door: no party list and no hand hold.
  'realm.partyTasks ??= { partyList: () => [], holds: { handControl: none } };',
  // The turns owner's door with no stand-in facts; rows that run the turns owner plant their own.
  'realm.partyTurns ??= { facts: () => ({}) };',
  // The items owner's loot pass runs on its own registration, which these rows leave idle.
  'realm.partyItems ??= {};',
  'realm.partyItems.loot ??= { start() {}, stop() {} };',
];
function roleRunnerBundle({ install = true } = {}) {
  sources[install] ??= buildSync({
    stdin: {
      contents: [
        ...realmOwners,
        "import { mage, priest, warrior, ranger, rogue, paladin, merchant } from './runtime/characters/turns/api.ts';",
        "import { installRoleRunner } from './runtime/lifecycle/character/roles.ts';",
        'const roles = { mage, priest, warrior, ranger, rogue, paladin, merchant };',
        'globalThis.partyRoles = roles;',
        'globalThis.RunnerTest = { installRoleRunner };',
        install ? 'installRoleRunner(roles[character.ctype]);' : '',
      ].join('\n'),
      resolveDir: root, loader: 'ts', sourcefile: 'role-runner-entry.ts',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  }).outputFiles[0].text;
  return sources[install];
}
module.exports = { roleRunnerBundle };
