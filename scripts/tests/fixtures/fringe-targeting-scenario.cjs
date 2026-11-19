// The queue candidate world of the fringe targeting rows (scripts/tests/fringe-targeting.test.cjs), in
// the shared harness. A grouped character in the
// Halloween spawn area with the entities a row names: the passing context with targeting's module
// (helpers/client-dependencies.cjs `passingContext`), the member holds on the tasks owner's door, and the hunting owner's farm
// client on the hunting door. A row names the character, the focus, the Hunt target, the rare hunts,
// the search radius and the priority.
const zones = require('../../../runtime/hunting/zones.ts');
const { passingContext } = require('../helpers/client-dependencies.cjs');
const { huntingDoor } = require('../helpers/targeting-module.cjs');
const { installHolds } = require('../helpers/requesters.cjs');

const area = { map: 'halloween', x: -589, y: -335, boundary: [-654, -384, -525, -287] };

function queueWorld({ entities, character, focus, huntTarget, rareHunts, radius, priority }) {
  // The holds read the context's own names, so they go on the tasks owner's door once the context exists.
  const holds = {};
  // W leads, and a member follows it, so the farm answers grouped.
  const hunting = huntingDoor({ character: () => character, frame: () => ({ entities }), scope: () => area, spot: () => area,
    leader: () => 'W', followLeader: () => true }, { monsterFocus: focus, monsterSearchRadius: radius, huntCombatTarget: huntTarget ?? null },
  { candidate: t => !!(t && rareHunts[t.mtype]) });
  const c = passingContext({ root: { partyFarmingZones: zones }, parent: { entities }, character, leader: 'W', navigationIntent: {}, partyConvoyActive: false,
    partyLocation: area, isExternallyClaimedMonster: t => !!t.claimed, groupedEntityReport: t => t, monsterPriority: priority },
  { tasks: { holds, membership: { leader: () => 'W' } }, hunting });
  Object.assign(holds, installHolds(c));
  return c;
}

module.exports = { area, queueWorld };
