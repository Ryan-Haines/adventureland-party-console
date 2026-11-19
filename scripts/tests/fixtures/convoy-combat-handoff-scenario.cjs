// The character's travel acquisition in targeting's module (passing.ts `farmingTravelTarget`) over
// The hunting owner's farm client on the hunting door, and the coordinator's engagement over the legacy barrier
// (a shared setup lives in the harness).
const { passingContext } = require('../helpers/client-dependencies.cjs');
const { huntingDoor } = require('../helpers/targeting-module.cjs');
// A grouped character in winterland that farms goo with search radius 100.
function client() {
  const entities = {}, character = { name: 'Us', map: 'winterland', x: 500, y: 0 };
  const hunting = huntingDoor({ character: () => character, frame: () => ({ entities }) }, { monsterFocus: ['goo'], monsterSearchRadius: 100 });
  return passingContext({ root: { partyFarmingZones: require('../../../.build/shared/farming-zones.cjs') }, parent: { entities }, character,
    partyTargets: [], combatTargetId: null, monsterPriority: () => 50, isAllowedTarget: t => !t.claimed }, { hunting });
}

function coordinator() {
  const party = { nextCommandId: 10, activeConvoy: { id: 'c', epoch: 2, phase: 'travel', departAt: 1000,
    participants: ['A', 'B'], completed: [], location: { map: 'winterland', x: 0, y: 0 }, runtimes: { A: 'r' } },
    commands: { A: { id: 3, convoyId: 'c', epoch: 2, navigationRevision: 7 }, B: { id: 4, convoyId: 'c', epoch: 2, navigationRevision: 8 } } };
  const body = { character: 'A', convoyId: 'c', epoch: 2, commandId: 3, runtimeId: 'r', navigationRevision: 7,
    target: { id: 'm', map: 'winterland', mtype: 'goo', x: 100, y: 0 } };
  const options = { revisions: { A: 7, B: 8 }, focus: ['goo'], radius: 100, now: 2000 };
  return { party, body, options };
}

// A farming walk the leader A leads into a goo area at (0, 0) with radius 100: A reports a goo 40
// away, from a current report. `outside` places B that far beyond the area's edge.
// Each member reports its class's attack range, which standsAt reads: G.classes.warrior
// range 18 for A and G.classes.priest range 120 for B (data.js at game version 17175).
function farmingWalk(outside = 0) {
  const now = 2000, { party, body, options } = coordinator();
  Object.assign(party.activeConvoy, { leader: 'A', purpose: '', combatHandoffAllowed: true });
  party.navigationIntents = { A: { revision: 7 }, B: { revision: 8 } };
  party.statuses = { A: { seenAt: now, map: 'winterland', x: 0, y: 0, range: 18 },
    B: { seenAt: now, map: 'winterland', x: 100 + outside, y: 0, range: 120 } };
  body.target = { id: 'm', map: 'winterland', mtype: 'goo', x: 40, y: 0 };
  return { party, body, options: { ...options, now }, now };
}

module.exports = { client, coordinator, farmingWalk };
