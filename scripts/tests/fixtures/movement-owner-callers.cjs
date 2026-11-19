// The shared harness for tests that slice functions out of characters/shared.js and run them
// in a vm context of their own (tests reuse the
// shared test-harness fixtures, and a new fixture is added here, never inside one spec).
//
// `createMovementContext(sandbox)` creates a context with four things:
// - movement's walk state over the context's variables (helpers/walk-state.cjs);
// - the movement requesters (runtime/movement/character/owner.ts: the requester
//   identities, holds, the Town cast, the task walk climb) and the member's assignment
//   (runtime/tasks/character/assignment.ts), which sliced movers call, installed with ports
//   that read the context's own globals as shared.js's ports read shared.js's
//   (helpers/requesters.cjs);
// - a movement service for a character nothing else holds (`freeMovement` below). The owner
//   grants such a character every request and sends every step, so it is the owner's answer
//   with no live journey. A test that sets `movement` itself, at creation or later, keeps every
//   method it names and gets the free character's answer for the rest; a test of the owner's
//   own decisions installs the real service (helpers/native-convoy-runtime.cjs,
//   movement-service.test.cjs).
// - `root.partySurvival`, the owner's safe goals and ladder rounds, and `root.partyTargeting`'s
//   passing column, on a
//   `root` the test passes at creation without one.
const vm = require('node:vm');
const { plantWalkState } = require('../helpers/walk-state.cjs');
const { createOwnerLadder, survivalRound, rejoinRound, taskRound, eventExitRound } = require('../../../runtime/protocol/ladder.ts');
const { isSafeAt, townGoal, farmWalkHeld } = require('../../../runtime/movement/rules.ts');
const stepRules = require('../../../runtime/movement/geometry/step-safety.ts');
// The one report freshness rule the movement service hands shared.js (owner.ts `fresh`).
const reports = require('../../../runtime/protocol/reports.ts');
const { MOVEMENT_PICKS } = require('../../../runtime/movement/rules.ts');
const { safetyInput, safetyMonsters } = require('../../../runtime/movement/character/owner.ts');
// What owner.ts hands shared.js as `root.partySurvival`, from the same modules.
const partySurvival = { survivalRound, rejoinRound, taskRound, eventExitRound, isSafeAt, townGoal, farmWalkHeld };

const { installRequesters } = require('../helpers/requesters.cjs');
const { processScope } = require('../helpers/run-scope.cjs');

// A free character's movement service: every step goes out through the context's own `move`,
// step safety is the owner's own check (runtime/movement/geometry/step-safety.ts) over the context's
// entities and its terrain check, and holds, releases and climbs answer as the owner does for
// a character with no live request. `moves` records each step, `holdSteps` and `letGos` each
// time combat holds its position or lets go.
function freeMovement(context) {
  const moves = [];
  const send = (to, mode) => { moves.push({ x: to.x, y: to.y, mode }); return Promise.resolve(typeof context.move === 'function' ? context.move(to.x, to.y) : undefined); };
  // The owner's step safety view (owner.ts `safetyInput`) over the context's character, entities
  // and `can_move`, with no add-on zones.
  const input = target => safetyInput(context, safetyMonsters(context.parent?.entities), target);
  const ladders = {};
  // The free character's ring: a loop's error, recorded as the owner records it (owner.ts `driveLoops`).
  const ring = [];
  const service = {
    moves, holdSteps: 0, letGos: 0, state: context.smart || { moving: false, found: false, plot: [] },
    step: (to, mode) => ({ status: 'sent', sent: send(to, mode) }),
    fresh: reports.fresh, setReadings: reports.setReadings, setClockError: reports.setClockError,
    holdStep() { service.holdSteps++; }, letGo() { service.letGos++; },
    stepSafe: (to, target) => stepRules.stepSafety({ ...input(target), to }),
    stepAllows(to, target) { const i = { ...input(target), to }, v = stepRules.stepSafety(i); return v.safe || v.refusal === 'idle-aggro' && !stepRules.fighting(i); },
    chooseStep: (points, target) => stepRules.chooseStep(points, input(target)),
    fighting: target => stepRules.fighting(input(target)), transition: () => null, townCasting: () => false,
    live: () => null, report: () => null, last: () => null, routinePick: () => undefined,
    // A free character has no console Pause and no drain park (owner.ts `consolePaused`), and its walk
    // state is the context's (helpers/walk-state.cjs).
    consolePaused: () => false, get walkState() { return context.walkState; },
    hold: () => 'granted', release: () => false, retarget: () => false,
    climb: (owner, round) => (ladders[owner] ||= createOwnerLadder(round, () => Date.now())), endClimb(owner) { delete ladders[owner]; },
    climbing: () => null, records: () => ring.map(entry => ({ ...entry })), incidents: () => [], snapshot() {}, audit() {},
    combatHandoff() {}, tick() {}, planTick() {}, cancel: () => Promise.resolve(),
    move: (destination, callback, options) => Promise.resolve(typeof context.smart_move === 'function' ? context.smart_move(destination, callback, options) : undefined),
    stop: () => Promise.resolve(), settingsReply() {},
    // The owner's reads for a character with no call budget and no report yet: no measured round
    // trip (`calls.margin` answers 0), the status timer's second, and the named sight search picks.
    roundTrip: () => 0, reportInterval: () => 1000,
    sightSearch: () => ({ ms: MOVEMENT_PICKS.movementSightSearchMs, steps: MOVEMENT_PICKS.movementSightSteps }),
    ownerReport: () => ({ calls: 0, totalMs: 0, maxMs: 0, errors: 0, steps: {}, invariants: {} }),
    // Step 12: the owner sends a requester's crossings, park and loops. A free character's
    // crossing goes out through the context's own game function, as the owner's native call
    // would, so a test that stubs leave, transport, town or use_skill still sees each call.
    transport: (request, map, spawn) => Promise.resolve(context.transport(map, spawn)),
    leave: () => Promise.resolve(context.leave()),
    town: () => Promise.resolve(typeof context.town === 'function' ? context.town() : typeof context.use_skill === 'function' ? context.use_skill('use_town') : context.use('town')),
    blink: (request, to) => Promise.resolve(context.use_skill('blink', [to.x, to.y])),
    magiport: (request, name) => Promise.resolve(context.use_skill('magiport', name)),
    acceptMagiport: (request, name) => Promise.resolve(context.accept_magiport(name)),
    clicking: () => null, setClickWaitMs() {}, endCode: () => null,
    park() { const c = context.character || {}; if (c.moving && typeof context.move === 'function') context.move(c.x, c.y); },
    // The owner's movement tick, every 10 ms of real time, for a loop a test leaves running.
    every(holder, run) {
      let busy = false;
      const timer = setInterval(() => { if (busy) return; busy = true; Promise.resolve().then(run).catch(error => { ring.push({ decision: 'loop-error', owner: holder, code: String(error?.message ?? error) }); }).finally(() => { busy = false; }); }, 10);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
  return service;
}

function createMovementContext(sandbox = {}) {
  const created = plantWalkState(vm.createContext(sandbox));
  // The test's own service or stub answers first, live (a real service's getters stay live);
  // the free character answers what it leaves out.
  const free = freeMovement(created), over = value => value && typeof value === 'object'
    ? new Proxy(value, { get: (target, key) => key in target ? target[key] : free[key], has: (target, key) => key in target || key in free }) : free;
  let current = over(created.movement);
  Object.defineProperty(created, 'movement', { configurable: true, enumerable: true,
    get: () => current, set: value => { current = over(value); } });
  if (created.root && typeof created.root === 'object' && !created.root.partySurvival) created.root.partySurvival = partySurvival;
  require('../helpers/survival-escaping.cjs').plantEscaping(created);
  // The events owner's character facts, which shared.js installs before movement's owners ask them.
  require('../helpers/character-events.cjs').installCharacterEvents(created);
  // A test on its own clock plants the owner's scheduler pass (`nextPass`) on that clock, and the
  // requesters keep it: the owner's pass waits on the free movement's real 10 ms tick.
  const pass = created.nextPass;
  installRequesters(created);
  if (pass) created.nextPass = pass;
  // The owners a sliced row installs in Node (the turns and merchant jobs owners) ask lifecycle/api.ts `scope()`,
  // which reads the process's run scope.
  processScope();
  return created;
}
module.exports = { createMovementContext, freeMovement, partySurvival };
