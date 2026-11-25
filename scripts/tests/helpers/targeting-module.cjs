// The targeting owner's module for a context that runs shared.js functions.
// Unit files load install.ts as the bundle does. In play, shared.js
// builds the module at load (`root.partyTargeting.create(targetingPorts())`) and binds each name its
// other owners call to the module's function. `targetingModule(context, facts, doors)` does the same
// for a sliced context, where the test asks for it: it bundles targeting's install.ts as the class
// bundle does and runs it in the context, so the module's game globals are the context's own, then
// builds the module over the typed doors shared.js's `targetingPorts` hands it. A test that
// plants a module function or a state value, before the build or after it, sets it in the module, so
// the module's other functions read the planted one, as the shared closure did.
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const reports = require('../../../runtime/protocol/reports.ts');
const { defaultSearchRadius } = require('../../../runtime/hunting/zones.ts');
const { installCharacterEvents } = require('./character-events.cjs');
const { plantWalkState } = require('./walk-state.cjs');
const { contextRun } = require('./run-scope.cjs');

const repo = path.join(__dirname, '../../..');
let bundle;
// The bundle also hands the context's hook registry to `routineModule`, which publishes the module's
// reads there as shared.js does at load.
const ENTRY = ["import './runtime/characters/targeting/install.ts';", "import { partyHooks } from './runtime/hooks/index.ts';",
  '(globalThis as any).__partyTestHooks = partyHooks;'].join('\n');
const entry = () => (bundle ??= buildSync({ stdin: { contents: ENTRY, resolveDir: repo, loader: 'ts' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' }).outputFiles[0].text);

// A test hands the doors it plants as `doors`, each the owner's typed object or the members of it the
// row reads (install.ts `TargetingPorts`). `absentDoors` answers every member a test leaves out as an
// owner with nothing to report: no task hold, no group walk, no Hunt, rare, Cave or farm, no drain and
// no gathering. Movement's service and walk state and the items owner's bag are the context's own owners when it
// holds them (fixtures/movement-owner-callers.cjs), since shared.js always holds them.
const noop = () => {};
const absentDoors = context => ({
  root: context.root,
  tasks: {
    holds: { handControl: () => null, followsManual: () => false, shouldFollowLeader: () => false, targetScope: () => null },
    assignment: { combatRecoveryHolds: () => false, assignedTier: () => null },
    membership: { leader: () => null, followLeader: () => false }, partyList: () => [],
  },
  walks: { groupWalk: { travel: null, signal: null }, cancelGroupRoute: noop, resetCombatMovement: noop, interruptConvoyForDefense: noop,
    cancelFarmApproach: noop, localTravelCommand: () => null, groupedFollower: () => false, travelObservationAt: () => 0,
    travelCombatActive: () => false, groupedApproachReport: () => null, currentTravelAttackers: () => [], convoySignalExpired: () => true,
    farmApproach: { failed: {} }, reunionRealm: () => null },
  movement: context.movement ?? { fresh: reports.fresh, transition: () => null },
  walkState: context.walkState,
  survival: {},
  hunting: {
    facts: { focus: { focus: [], huntTarget: null, partyType: null, mode: 'default', lootPending: false,
      rare: { control: null, active: false, candidate: () => false }, contains: () => false, inRadius: () => false }, cave: { owned: false } },
    farm: { grouped: () => false, mode: () => 'default', select: targets => targets, radius: () => defaultSearchRadius, noteType: noop },
    cave: { owned: () => false, partyNames: () => [], partyMembers: () => [] },
    hunt: { control: () => null, defense: () => false, status: () => null, outbound: () => false, extraAggro: () => false,
      pause: () => null, log: noop, rejection: () => null },
    // rares.ts `noPassive`: no passive rule, field generators on.
    rares: { current: () => null, passive: () => ({ rules: {}, useFieldGenerators: true }), fields: () => [], acceptCombat: noop, observation: () => null },
  },
  bag: context.bag ?? { fact: () => undefined },
  lifecycle: { drain: { receive: noop, holds: () => false }, telemetry: { lastDeath: () => null }, request: () => Promise.resolve(null) },
  merchant: { gathering: { active: () => false } },
});
// A group of doors (the ports, `tasks`, `hunting`, `hunting.facts`, `lifecycle`, `merchant`) takes
// each door the test hands over the absent one. An owner door reads the test's member while the test's
// object holds one, else the absent member, so a test that changes its door after the build reaches
// the module.
const GROUPS = new Set(['', 'tasks', 'hunting', 'hunting.facts', 'lifecycle', 'merchant']);
function withDoors(absent, over, at = '') {
  if (over === undefined || absent === over) return absent;
  if (!over || typeof over !== 'object' || !absent || typeof absent !== 'object' || at === 'root') return over;
  if (!GROUPS.has(at)) return new Proxy(over, { get: (door, key) => key in door ? door[key] : absent[key], has: (door, key) => key in door || key in absent });
  const doors = { ...absent };
  for (const key of Object.keys(over)) doors[key] = withDoors(absent[key], over[key], at ? at + '.' + key : key);
  return doors;
}

// The hunting owner's hunting door with the real farm client (hunting/character/farm.ts) and the focus facts
// facts.ts reads from it, for a row whose answer turns on the farm area, the radius or the Hunt's
// type. `ports` are the farm's own (`FarmClientPorts`), each one a row leaves out answering a
// character with no area, leader, event or walk; `reply` is the farm part of the status reply.
// The rare facts are the absent door's unless `rare` plants them.
const { installFarmClient } = require('../../../runtime/hunting/character/farm.ts');
const FARM_ABSENT = { character: () => ({}), frame: () => ({}), entity: () => null, members: () => [],
  walk: () => ({ clockOffset: 0, runtimeId: null, intent: {} }), spot: () => null, scope: () => null, walkable: () => true,
  monsters: () => ({}), kept: () => ({}), own: () => false, hitReaders: noop, queueTarget: () => null, ownHit: noop,
  focusChanged: noop, selected: () => null, priority: () => 0, fighting: () => false, leader: () => null, eventTypes: () => [],
  farmTarget: () => null, takeTarget: noop };
exports.huntingDoor = (ports = {}, reply = {}, rare = {}) => {
  // Every other farm port is a yes-or-no fact (a hold, an event, a walk), which answers no.
  const farm = installFarmClient(new Proxy(ports, { get: (own, key) => key in own ? own[key] : FARM_ABSENT[key] ?? (() => false) }));
  farm.receive(reply);
  const absent = absentDoors({}).hunting.facts.focus;
  const focus = { get focus() { return farm.focus(); }, get huntTarget() { return farm.huntTarget(); }, get partyType() { return farm.partyType(); },
    get mode() { return farm.mode(); }, contains: farm.inArea, inRadius: farm.inRadius, rare: { ...absent.rare, ...rare }, lootPending: false };
  return { farm, facts: { focus } };
};

// Movement's walks door (movement/character/install.ts `MovementCharacter`) for a context that runs
// the walk client (helpers/walk-reports.cjs): the client's group walk, defense and reports, with the
// members a row names over them, such as the crossings' `reunionRealm`.
exports.walksDoor = (context, members = {}) => Object.assign(Object.create(require('./walk-reports.cjs').walkClient(context)), members);

let shape;
// The module's function names and state keys (install.ts `TargetingState`), read once from a module
// built over absent doors.
function moduleShape() {
  if (shape) return shape;
  const context = vm.createContext({ parent: {}, root: {} });
  vm.runInContext(entry(), context);
  const t = context.partyTargeting.create(absentDoors({ root: {}, walkState: {} }));
  return (shape = { functions: Object.keys(t).filter(k => typeof t[k] === 'function'), state: Object.keys(t.state) });
}
exports.MOVED = () => moduleShape().functions;

// shared.js defines each of these facts at load, and a sliced shared.js function reads them by name.
// A context that defines none of them reads the absent answer the targeting owner records for a
// sliced context: no group walk and no navigation intent, no event, the default mode, no drain and
// no Hunt client. A test's `facts` plant its own.
const ABSENT = {
  groupWalk: () => ({ travel: null }), huntClient: () => ({}), navigationIntent: () => ({}), eventTargetTypes: () => [], farmingMode: () => 'default',
  eventAttend: () => ({ selected: () => false, active: () => null, joined: () => null, traveling: () => null }), drain: () => () => null,
};

// The lifecycle owner's core registration answers `lifecycle.drain` on every realm shared.js loads in
// (lifecycle/character/drain.ts). A sliced context's realm with no such answer gets the not-draining
// one, null.
function plantDrainAnswer(hooks) {
  if (hooks.registrations().some(r => r.hooks && r.hooks['lifecycle.drain'])) return;
  const ok = hooks.publish({ name: 'core:lifecycle', folder: 'core', author: 'adventureland-party-console',
    summary: 'Answers no console drain on a test realm.', hooks: { 'lifecycle.drain': () => null } }).ok;
  if (!ok) throw Error('core:lifecycle did not register on the test realm');
}
// A row that runs during a console drain sets the lifecycle owner's answer on the module's realm: `answer()` is what
// drain.ts's `lifecycle.drain` returns, the targets the drain lets finish.
exports.answerDrain = (context, answer) => {
  const ok = context.targeting && context.root.__partyHooks.publish({ name: 'core:lifecycle', folder: 'core', author: 'adventureland-party-console',
    summary: "Answers the row's console drain.", hooks: { 'lifecycle.drain': answer } }).ok;
  if (!ok) throw Error('core:lifecycle did not take the drain answer');
};

// Each context's doors, which `routineModule` builds its own module over.
const contextDoors = new WeakMap();

// The module for one context, built once per context over `doors`. A function or state key the
// context already holds goes into the module; each name then reads and writes the module's own, so a
// write after the build lands in the module.
exports.targetingModule = (context, facts = {}, doors = {}) => {
  if (Object.prototype.hasOwnProperty.call(context, 'targeting')) {
    if (Object.keys(doors).length) throw Error('The targeting module is built already; hand its doors at the first build');
    return context.targeting;
  }
  if (!('root' in context)) context.root = {};
  if (!('parent' in context)) context.parent = {};
  Object.assign(context, facts);
  for (const [name, value] of Object.entries(ABSENT)) if (!vm.runInContext(`typeof ${name} !== 'undefined'`, context)) context[name] = value();
  // The doors read movement's `walkState`, which shared.js always holds; a sliced context's reads its
  // own variables (walk-state.cjs).
  plantWalkState(context);
  // shared.js creates the lifecycle owner's run scope before any owner installs (helpers/run-scope.cjs).
  contextRun(context);
  // installCharacterEvents gives the context the events owner's facts before the module loads, as shared.js does.
  installCharacterEvents(context);
  vm.runInContext(entry(), context);
  // shared.js's realm always holds the hook registry; a sliced context's planted realm gets one.
  if (context.root && typeof context.root === 'object' && !context.root.__partyHooks) context.root.__partyHooks = context.__partyTestHooks();
  // A stand-in registry a test planted answers its own hooks.
  if (typeof context.root?.__partyHooks?.registrations === 'function') plantDrainAnswer(context.root.__partyHooks);
  const { functions, state } = moduleShape();
  const planted = [...functions, ...state].filter(name => Object.prototype.hasOwnProperty.call(context, name)).map(name => [name, context[name]]);
  for (const [name] of planted) delete context[name];
  const ports = withDoors(absentDoors(context), doors);
  contextDoors.set(context, ports);
  const t = context.partyTargeting.create(ports);
  for (const [name, value] of planted) {
    if (state.includes(name)) t.state[name] = value;
    else t[name] = value;
  }
  Object.defineProperty(context, 'targeting', { configurable: true, enumerable: false, value: t });
  for (const name of functions) Object.defineProperty(context, name, { configurable: true, enumerable: false, get: () => t[name], set: value => { t[name] = value; } });
  for (const name of state) Object.defineProperty(context, name, { configurable: true, enumerable: false, get: () => t.state[name], set: value => { t.state[name] = value; } });
  return t;
};

// Table A's `positions` row and the targeting owner's door for the party's member reports (install.ts `positionsReply`,
// `positions`): a test drives the reports through the context's module as a reply does, and reads
// them back as shared.js's ports do.
exports.drivePositions = (context, positions) => exports.targetingModule(context).positionsReply({ partyPositions: positions });
exports.positionsOf = (context) => exports.targetingModule(context).positions();

// A role runner test plants its `sharedRoutine` with the module's own names. `routineModule` builds
// the module in the runner's own context over that routine: each planted function of the module's
// name replaces the module's, and the doors are the context's module's, with the test's `doors` over
// them.
exports.routineModule = (context, routine, doors = {}) => {
  if (!('root' in context)) context.root = context;
  // The context's own module, whose doors the routine's module reads.
  exports.targetingModule(context);
  // The realm is the runner's context, whose registry the role runner installs; a harness that planted
  // an empty `root` for its sliced functions keeps it for them.
  const realm = context.root && context.root.__partyHooks ? context.root : context;
  const t = context.partyTargeting.create(withDoors({ ...contextDoors.get(context), root: realm }, doors));
  // Each module function reads the routine's member of its name at the call, so a test that plants one
  // after the build reaches the module's other functions.
  for (const name of moduleShape().functions) {
    let own = t[name];
    Object.defineProperty(t, name, { configurable: true, enumerable: true, set: value => { own = value; },
      get: () => typeof routine[name] === 'function' ? routine[name] : own });
  }
  context.partyTargeting.publish(t.reads(), context.__partyTestHooks());
  return t;
};

// The module a test hands `createAnswers` (gates.ts) over a routine of the module's own names: each
// read goes to the routine's member at the call, else today's absent answer (no return defence, no
// Franky, every gate open, no crab sample).
const ANSWER_DEFAULTS = { returnCombatActive: () => false, returnAttacker: () => true, franky: () => false, groupedAttackAllowed: () => true,
  rareAttackAllowed: () => true, skillTargetAllowed: () => true, isAllowedTarget: () => true, consoleDrainAllows: () => true,
  describeAttackRange: () => null, combatTargetRevision: () => null, isLeader: () => true, isAttackingPartyMember: () => false };
exports.answerModule = (routine, over = {}) => new Proxy({}, { get: (_, key) => {
  const r = typeof routine === 'function' ? routine() : routine;
  if (key in over) return over[key];
  if (r && typeof r[key] === 'function') return r[key];
  return ANSWER_DEFAULTS[key];
} });

// A sliced context with targeting's module built in it over `doors`, for a test that creates its own
// context.
exports.targetingContext = (sandbox, facts, doors) => {
  const context = vm.createContext(sandbox);
  exports.targetingModule(context, facts, doors);
  return context;
};
