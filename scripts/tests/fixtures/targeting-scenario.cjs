// The targeting owner's setup builders (the cases that share a setup are rows of one
// table, and the builder lives in the shared harness). Layer 7 step 5 moved each one here from its test file.
const {productionFunction, productionFunctions} = require('../helpers/production-functions.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sharedSource = () => fs.readFileSync(path.join(__dirname, '../../../characters/shared.js'), 'utf8');

// The character's targeting parts on ports a row drives by hand: the ring on the row's clock, the
// overkill skip over the damage in flight per target, the refusal recorder, the retire over the
// failed-approach marks, the selection, the fight fact, the leader and the grouped lock, and the
// scope's death recovery check over the tier, the verdict and the finishing list.
function targetingWorld() {
  const { createTargetingRing } = require('../../../runtime/characters/targeting/records.ts');
  const { createOverkillSkip, createRetire } = require('../../../runtime/characters/targeting/retire.ts');
  const { refusalRecorder } = require('../../../runtime/characters/targeting/gates.ts');
  const w = { now: 0, flights: {}, gone: new Set(), marks: {}, selected: null, dropped: [], fighting: false, leader: false, lock: null,
    tier: null, verdict: 'fight', listed: [] };
  w.ring = createTargetingRing(() => w.now);
  w.skip = createOverkillSkip({ incoming: id => w.flights[id] ?? 0, live: id => !w.gone.has(id), record: e => w.ring.record(e), now: () => w.now });
  w.refused = refusalRecorder(e => w.ring.record(e));
  w.retire = createRetire({
    marks: { fail: id => { w.marks[id] = Date.now() + 10000; }, clear: () => { for (const k of Object.keys(w.marks)) delete w.marks[k]; },
      any: () => Object.keys(w.marks).length > 0, marked: id => w.marks[id] > Date.now() },
    selected: () => w.selected, drop: id => { w.dropped.push(id); w.selected = null; }, fighting: () => (w.fightAsks = (w.fightAsks || 0) + 1, w.fighting),
    record: e => w.ring.record(e), leader: () => w.leader, lock: () => w.lock,
  });
  // The death recovery check (rules.ts `recoveryRefuses`) in the module, over the tier, the verdict
  // and the finishing list a row sets (helpers/targeting-module.cjs builds it).
  const c = vm.createContext({ character: { map: 'main', in: 'main' } });
  c.root = { __partyHooks: { survival: { verdict: () => w.verdict,
    recovery: () => ({ targets: w.listed.map(id => ({ id, map: 'main', in: 'main', server: 'USII' })) }) } } };
  const module = require('../helpers/targeting-module.cjs').targetingModule(c, {},
    { tasks: { assignment: { assignedTier: () => w.tier } }, walks: { reunionRealm: () => 'USII' } });
  w.scope = { recoveryRefuses: target => module.recoveryRefuses(target) };
  // The retire reads the character's own name from the game global, as in play.
  w.as = (name, run) => {
    const saved = globalThis.character;
    globalThis.character = { name };
    try { return run(); } finally { globalThis.character = saved; }
  };
  return w;
}

// Targeting's own death listeners (runtime/characters/targeting/death.ts) on ports that record each
// report and each target reset.
function deathFixture() {
  const deaths = [], invalidations = [];
  const { createTargetingDeath } = require('../../../runtime/characters/targeting/death.ts');
  const ports = { self: () => 'W', instance: () => 'cave', report: id => deaths.push(id), invalidate: id => invalidations.push(id),
    entitiesSeen() {} };
  return { c: createTargetingDeath(ports), ports, deaths, invalidations, source: sharedSource() };
}

// shared.js's claim and party defense checks sliced into one context, with one goo the character
// has selected (combat-claims.test.cjs). the events owner's facts read no event there, so every member is on the
// character's A/B team (helpers/character-events.cjs). The farm is the hunting owner's door: the goo focus, a
// 500-wide search radius and an area that holds every target; `doors.rare` and `doors.rares` are its
// rare facts and rare client, which a row plants on.
function claimsSetup() {
  const source = sharedSource();
  const entities = {};
  const doors = { rare: { control: null, active: false, candidate: () => false }, rares: {} };
  const context = require('../helpers/shared-context.cjs').createSharedContext({
    isPassingEncounter: () => false, root: {}, farmingTravelToken: null,
    eventAttend: { active: () => false, joined: () => null, traveling: () => null }, lastAttackTarget: null, lastAttackAt: 0, partyLocation: null,
    character: { name: 'Us', x: 0, y: 0 }, parent: { entities },
    G: { monsters: { goo: {}, phoenix: { cooperative: true } } },
    get_entity: id => entities[id],
    eventTargetTypes: [], combatTargetId: '1', groupWalk: {travel:null},
    partyThreats: [], scatterBreakTarget: null, farmingMode: 'default',
    followLeader: false, leader: null, isPartyThreat: () => false,
    partyTargets: [], monsterPriority: () => 50,
    passiveRareHunts: {}, get_nearest_monster: () => null,
    // The movement helpers' reads of the hunting owner's Cave and grouped answers (shared.js turnsPorts).
    dungeonOwned: () => false, groupedFarming: () => false,
  }, { tasks: { partyList: () => ['Us', 'Ally'] },
    hunting: { facts: { focus: { focus: ['goo'], contains: () => true, inRadius: () => false, rare: doors.rare } }, farm: { radius: () => 500 },
      rares: doors.rares } });
  require('../helpers/targeting-module.cjs').drivePositions(context, [{ name: 'Ally' }, { name: 'Stranger' }]);
  vm.runInContext(productionFunction('passiveLevelAllowed'), context);
  // isAllowedTarget's farm boundary is the area new pulls come from (01 step 6 correction).
  require('../helpers/requesters.cjs').installHolds(context);
  require('../helpers/queue-markers.cjs').installQueueMarkers(context);
  require('../helpers/walk-reports.cjs').installWalkDefense(context);
  require('../helpers/group-movement.cjs').installGroupMoves(context);
  vm.runInContext(productionFunctions(['engagedMonster']), context);
  vm.runInContext(productionFunctions(['isAttackingPartyMember']), context);
  // The routine's finder, as shared.js binds it to targeting's module.
  vm.runInContext('var select = { getNearestFocusedMonster: targeting.getNearestFocusedMonster };', context);
  entities['1'] = { id: '1', type: 'monster', mtype: 'goo', visible: true, x: 10, y: 0, hp: 100 };
  return { context, entities, doors };
}

// shared.js's eligibility check with an unfinished grouped fight on one locked wolfie outside the
// farm bounds and focus (unfinished-target-boundary.test.cjs).
function unfinishedTarget() {
  const target = { id: 'locked', type: 'monster', mtype: 'wolfie', visible: true };
  const r = require('../helpers/client-dependencies.cjs').passingContext({ root: {}, character: { map: 'winterland', in: 'winterland' },
    groupedCombat: { target: { id: 'locked', map: 'winterland', in: 'winterland', server: 'USII' } },
    unfinishedFight: () => true, groupedFresh: () => true,
    leaderLockAllows: e => e.id === 'locked', rareTarget: () => null,
    isExternallyClaimedMonster: () => false, isAttackingPartyMember: () => false, eventAttend: { active: () => false, joined: () => null, traveling: () => null }, isPartyThreat: () => false,
    partyLocation: {}, combatTargetId: null, lastAttackTarget: null, lastAttackAt: 0 },
  // A grouped farm whose area and radius hold no target.
  { hunting: { farm: { grouped: () => true } } });
  vm.runInContext(productionFunctions(['isAllowedTarget']), r);
  return { r, target };
}

// The porcupine bow swap (runtime/characters/targeting/porcupine.ts) on a warrior with a
// sword and a shield in hand and two bows in its bag. `advance` moves its clock one past the failed
// equip's retry wait (targeting/rules.ts GAME_BOUNDS.swapRetryMs).
const porcupine = { id: 'p1', mtype: 'porcupine' };
function porcupineFixture(options = {}) {
  const { createPorcupineEquipment } = require('../../../runtime/characters/targeting/porcupine.ts');
  const { GAME_BOUNDS } = require('../../../runtime/characters/targeting/rules.ts');
  const hands = { mainhand: { name: 'sword', level: 8 }, offhand: { name: 'shield', level: 3 } };
  const items = [{ name: 'bow', level: 2 }, { name: 'bow', level: 7 }, null];
  const calls = [], errors = [], memory = {};
  let now = 1000;
  const ports = {
    now: () => now, hands: () => hands, items: () => items,
    usableBow: item => item.name === 'bow', twoHanded: () => true,
    fingerprint: item => item && structuredClone(item),
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    async equip(index, slot) { calls.push(['equip', index, slot]); const previous = hands[slot]; hands[slot] = items[index]; items[index] = previous; },
    async unequip(slot) { calls.push(['unequip', slot]); items[items.indexOf(null)] = hands[slot]; hands[slot] = null; },
    report: error => errors.push(error),
    ...options,
  };
  const api = createPorcupineEquipment(ports, memory);
  const tick = (selected = porcupine, type = 'physical', range = 30, allowed = true) => api.tick(selected, type, range, allowed);
  return { api, ports, memory, hands, items, calls, errors, tick, advance() { now += GAME_BOUNDS.swapRetryMs + 1; } };
}

module.exports = { targetingWorld, deathFixture, claimsSetup, unfinishedTarget, porcupineFixture, porcupine };
