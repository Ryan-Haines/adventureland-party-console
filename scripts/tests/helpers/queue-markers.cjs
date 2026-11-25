// The combat queue's rings (runtime/status/character/telemetry.ts `createQueueMarkers`) on a
// sliced test context: each port reads the context's name that shared.js's install hands it, at the
// moment it is asked, so a test that changes a name sees the change. Each port calls its name as
// shared.js's install does, with no default, so a test that leaves a name out fails on it.
// `c.queueMarkers` is the view's read, the name the sliced code and the tests call. The farm and
// the drain are the doors of the context's targeting module (helpers/targeting-module.cjs), read
// through its view as the module reads them (view.ts PORT_FACTS): The hunting owner's farm client and the lifecycle owner's
// `lifecycle.drain`, which answers null unless the console drains. The module's absent Hunt client
// holds no control.
const vm = require('node:vm');
const { createQueueMarkers } = require('../../../runtime/status/character/telemetry.ts');
function installQueueMarkers(c) {
  const view = createQueueMarkers({
    character: () => c.character, entity: id => c.get_entity(id), realm: () => c.reunionRealm(),
    now: () => vm.runInContext('Date.now()', c) + (c.walkState.clockOffset || 0),
    returnCombat: () => c.returnCombatActive(), returnDefense: () => c.returnDefenseTarget(),
    eventTypes: () => c.eventTargetTypes, selected: () => c.targeting.selection().targetId, allowed: entity => c.isAllowedTarget(entity),
    grouped: () => c.targeting.view().groupedFarming, mode: () => c.targeting.view().getFarmingMode, cancelled: () => c.walkState.intent.cancelled,
    activeTarget: () => c.activeCombatTarget(), partyPositions: () => c.targeting.positions(), huntControl: () => c.huntClient.control ? c.huntClient.control() : null,
    queue: () => c.targeting.queue(), travel: () => c.groupWalk && c.groupWalk.travel,
    holdDefense: () => c.convoyHoldDefenseTarget(),
    entityReport: entity => c.groupedEntityReport(entity), draining: () => c.targeting.view().drain !== null,
    drainAllows: entity => c.consoleDrainAllows(entity),
  });
  c.queueMarkers = view.markers;
  return view;
}
module.exports = { installQueueMarkers };
