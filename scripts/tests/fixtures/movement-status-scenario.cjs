const { installMovementCharacter } = require('../../../runtime/movement/character/install.ts');

// Table A's movement rows on the character (runtime/movement/character/install.ts `convoyReply`,
// `partyWalksReply`, `endLeaderFollow`, `navigationReply`), applied to one status reply as
// characters/shared.js applies them: the `convoy` row first, then the awaited rows, then
// `party-walks`. The install gets the movement owner's walk state and stop, and each port the
// install reads as it builds its parts answers nothing. `walking` starts a group walk whose signal the coordinator renewed
// at `signalAt` (the fast heartbeat's `__partyTravelSignalAt`).
function statusApply() {
  const stops = [], logs = [], failed = [];
  const state = { intent: { revision: 1 }, runtimeId: 'run-1', clockOffset: 0, following: false, forceTraveling: false,
    convoyActive: false, townTraveling: false, townActive: false, departing: false, partyLocation: null, farmTravelPaused: false,
    townGeneration: 0, convoyDefense: null, navigationDetail: null };
  // `stopRejects(error)` makes the next stop fail with `error`.
  let stopFailure = null;
  const movement = { walkState: state, stop: async (kind, _ignored, request) => { stops.push([kind, request && request.owner]);
      if (stopFailure) { const error = stopFailure; stopFailure = null; throw error; } },
    cancel: async () => {}, stepAllows: () => true, audit() {}, holdStep() {}, step: () => ({ sent: Promise.resolve() }) };
  const root = { character: { name: 'W', ctype: 'warrior', map: 'winterland', x: 0, y: 0 }, parent: {} };
  const hooks = { publish: () => ({ ok: true }), notify: () => [] };
  const ports = { character: () => root.character, gameLog: (message, colour) => logs.push([message, colour]), now: () => 1000,
    root: () => root, current: () => true, escaping: () => false, G: () => ({ maps: { main: { spawns: [[0, 0]] }, winterland: { spawns: [[0, 0]] } } }) };
  const character = installMovementCharacter(root, movement, hooks, ports);
  function walking(signalAt) {
    const travel = { id: 'c1', epoch: 2, commandId: 7, routeVersion: 0, navigationRevision: 1, fail: reason => failed.push(reason) };
    character.walkClient.groupWalk.travel = travel;
    character.walkClient.groupWalk.signal = { id: 'c1', epoch: 2, commandId: 7, runtimeId: 'run-1', routeVersion: 0, navigationRevision: 1,
      localDeadline: Number.MAX_SAFE_INTEGER };
    root.__partyTravelSignalAt = signalAt;
    return travel;
  }
  return { character, state, root, stops, logs, failed, walking, stopRejects: error => { stopFailure = error; } };
}

module.exports = { statusApply };
