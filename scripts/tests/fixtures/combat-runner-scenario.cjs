// Setups for the role runner and combat geometry tests (scripts/tests/combat-movement.test.cjs), in
// the shared harness: one character's role runner over
// the role runner bundle (helpers/role-runner-bundle.cjs), and the combat steps (runtime/movement/character/steps.ts) around one
// target. Both read the events owner's character facts with no event (helpers/character-events.cjs): the
// targeting module installs them in the runner's context, and the combat steps in the geometry's.
// A row reaches the three event movers through `c.characterEvents.movers`.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createMovementContext } = require('./movement-owner-callers.cjs');
const roles = require('../helpers/role-runner-bundle.cjs').roleRunnerBundle();
const { survivalHalf, turnsPorts } = require('./formation-scenario.cjs');
const { routineModule } = require('../helpers/targeting-module.cjs');
const { installCombatSteps } = require('../helpers/combat-steps.cjs');
const { createMoverView } = require('../../../runtime/movement/character/movers.ts');
const { movementTick } = require('../helpers/movement-tick.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function runner(ctype = 'ranger', native = false, configure = () => {}) {
  let now = 1000, attacks = 0, moves = 0, ready = true, occupied = false;
  const intervals = [], timeouts = [];
  const target = { id: 'm', type: 'monster', mtype: 'goo', visible: true, x: 20, y: 0, map: 'main' };
  const character = { name: 'Us', ctype, map: 'main', moving: true, frequency: 2, slots: {mainhand:null,offhand:null}, items: [] };
  const routine = {
    isOccupied: () => occupied, getFarmingMode: () => 'default',
    hasScatterBreakTarget: () => false, getScatterBreakTarget: () => null,
    nearestEventTarget: () => null, shouldFollowLeader: () => false, getPreferredTarget: () => target,
    isAllowedTarget: t => !t.claimed, setCombatTarget() {}, noteAttack() {}, followLeaderIfFar: async () => false,
    // The attack gates the routine left out answered open before the targeting module (gates.ts `createAnswers`).
    groupedAttackAllowed: () => true, rareAttackAllowed: () => true,
    kiteIfNeeded: async () => false, approachCombatTarget: () => { moves++; return new Promise(() => {}); },
    resetCombatMovement() {},
    // The survival owner's character half (runtime/characters/survival/install.ts).
    survival: survivalHalf(), isAttackingPartyMember: () => false, getNearestPartyAttacker: () => null,
    // The movement owner's mover view (runtime/movement/character/movers.ts) over this character
    // alone, with no event, rare or farm spot; Franky's fight and the boss approach are the events owner's facts.
    moverView: createMoverView({ character: () => character, partyList: () => [character.name], leader: () => null, focus: () => [],
      joinedEvent: () => null, franky: () => c.characterEvents.frankyActive(), fightsAdds: name => c.characterEvents.fightsAdds(name), rareControl: () => null,
      farmSpot: () => null, inFarmArea: () => true, root: () => c, now: () => now, service: () => c.__partyMovement }),
  };
  configure(routine);
  // The game's attack cooldown, as the turns executor reads it:
  // `ready(false)` puts the attack family's `next_skill` entry far ahead.
  const host = native ? { next_skill: {} } : { caracAL: {}, next_skill: {} };
  const c = createMovementContext({ character, parent: host, sharedRoutine: routine, get_entity: () => target,
    G: {items:{},classes:{},skills:{}},
    can_attack: () => ready, is_in_range: () => true, game_log() {},
    attack: () => { attacks++; return new Promise(() => {}); },
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn, ms) => { const entry = { fn, ms }; intervals.push(entry); return entry; },
    clearInterval: entry => { if (entry) entry.off = true; },
    setTimeout: (fn, ms) => { const entry = {fn, ms, at: now + ms}; timeouts.push(entry); return entry; },
    clearTimeout: entry => { if (entry) entry.off = true; },
  });
  // The lifecycle owner's run scope on the game window, where shared.js creates it before the runner installs.
  const run = host.__partyRunScope = require('../helpers/run-scope.cjs').contextRun(c), scope = run.scope.bind(run);
  // The scope hands the planted setTimeout its own wrapper, so each one-shot keeps the callback the
  // owner gave it beside the planted entry, where attackTick finds the executor's edge.
  run.scope = (owner, kind) => {
    const handle = scope(owner, kind);
    return { ...handle, setTimeout: (callback, ...rest) => { const id = handle.setTimeout(callback, ...rest); timeouts.at(-1).callback = callback; return id; } };
  };
  // Survival's `act` handle on this context's scope, so its respawn interval runs on the row's
  // planted timers with every other owner's; on the process's scope it ran on Node's clock and held
  // the run open after a row that ended before `stop()`.
  routine.survival.shared.act = host.__partyRunScope.scope('05', 'act');
  // Movement's door with its tick over this routine, as movement's install publishes it.
  // The queue client also reads its coordinator clock and recovery clients there; this character has
  // no convoy and no recovery client.
  c.partyMovement = { startMovementTick: movementTick(c), resetCombatMovement: () => routine.resetCombatMovement(),
    coordinatorNow: () => now, convoyActive: () => false, independentApproachClient: () => null, terrainRecoveryClient: () => null,
    queueSightRecovery: () => null };
  // The status owner's character door (shared.js `partyStatus.character`) with its handoff timing and no queue to mark.
  c.partyStatus = { character: { applyChannel: (data, combat) => combat(data), queueMarkers: () => null,
    handoffTiming: require('../../../runtime/status/character/rings.ts').createHandoffTiming([], () => true) } };
  // The hunting owner's character door (shared.js `partyHunting`): the loot client's ports for a character with no
  // quest, no chest and no socket, and its farm answers for a character with no leader, which
  // fights outside the grouped queue (hunting/character/farm.ts `grouped`).
  c.partyHunting = { farm: { grouped: () => false, mode: () => 'default' }, lootPorts: () => ({ name: () => character.name, quest: () => null, positions: () => [], clockOffset: () => 0,
    character: () => character, frame: () => c, navigationCancelled: () => false, escaping: () => false, eventJoined: () => null,
    defending: () => false, passing: () => false, engaged: () => false, chests: () => ({}), socket: () => null }) };
  // The items owner's loot pass runs on its own registration, which these rows leave idle.
  c.partyItems = { loot: { start() {}, stop() {} } };
  // The turns owner's door with the stand-in facts over this routine, as shared.js publishes it.
  c.partyTurns = { facts: () => turnsPorts.call(routine) };
  // The targeting module over this routine, as shared.js builds it at load.
  // Its switch resets the combat walk through movement's walks door, which is this routine's.
  routine.targeting = routineModule(c, routine, { walks: { resetCombatMovement: () => routine.resetCombatMovement() } });
  // The runner's questions go to a planted call budget on the bundle's registry.
  require('../helpers/planted-calls.cjs').plantCallsWhenCreated(c);
  vm.runInContext(roles, c); c.partyRoleRunner.start();
  // The turns executor's attack edge (runtime/characters/turns/executor.ts `arm`).
  const attackTick = () => {
    const entry = timeouts.find(t => !t.off && /pass\(["']edge["']\)/.test(String(t.callback)));
    if (entry) { entry.off = true; entry.fn(); }
  };
  return { c, target, character, routine, intervals, timeouts, attackTick,
    advance: async value => {
      while (true) {
        const next = timeouts.filter(t=>!t.off && t.at<=value).sort((a,b)=>a.at-b.at)[0];
        if (!next) break;
        now=next.at; next.off=true; next.fn(); await flush();
      }
      now=value; await flush();
    }, attacks: () => attacks, moves: () => moves,
    now: value => now = value, ready: value => { ready = value; host.next_skill.attack = value ? undefined : now + 1e6; }, occupied: value => occupied = value,
    run: async ms => {
      if (ms === 50) attackTick();
      else {
        intervals.filter(t => t.ms === ms && !t.off).forEach(t => t.fn());
        // The selection's timer, then the report timer's notice, the role loop's backstop event
        // (replacing b9b5c91e's 250 ms role loop).
        if (ms === 250) { c.partyRoleRunner.wake(); c.__partyHooks.notify('report.sent', { character: character.name, by: 'core:lifecycle' }); }
      }
      await flush();
    } };
}
function geometry(range = 120) {
  const moves = [], target = { id: 'm', type: 'monster', visible: true, x: 0, y: 0, target: 'Us' };
  let now = 1000;
  const c = createMovementContext({ character: { name: 'Us', map: 'main', x: range - 5, y: 0,
    range, speed: 60, hp: 100, max_hp: 100 }, parent: { entities: { m: target } },
    movement:{report:()=>null},kiteState: { targetId: null }, formationFrame: null, formationPerformance: { collisionChecks: 0 },
    runtimeCurrent: () => true,
    // The game's `distance` and `can_move` on the CODE frame: hitbox-free, and a segment is open
    // when the row's `can_move_to` opens its end.
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), can_move: query => c.can_move_to(query.going_x, query.going_y),
    can_move_to: () => true, is_in_range: () => true,
    move: (x, y) => { moves.push({ x, y }); return new Promise(() => {}); },
    Date: class extends Date { static now() { return now; } },
  }); c.root = c;
  require('../helpers/approach.cjs').installApproach(c);
  installCombatSteps(c);
  return { c, target, moves, now: value => now = value };
}
module.exports={runner,geometry};
