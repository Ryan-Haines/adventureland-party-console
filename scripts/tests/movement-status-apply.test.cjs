const assert = require('node:assert/strict');
const { installMovementCharacter } = require('../../runtime/movement/character/install.ts');
const { scenarioTable } = require('./fixtures/scenarios.cjs');

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

scenarioTable('the status rows apply the convoy, the walk end, the Town override and the follow stop (Table A)', statusApply, [
  // The convoy defense and the navigation detail live on the walk state, and the return's saved
  // phase keeps its realm copy and its game window copy, each from one writer.
  ['the walk state keeps the convoy defense and the detail, and the return progress has one writer', async s => {
    s.walking(0);
    Object.assign(s.state, { convoyDefense: 'c1', navigationDetail: 'Defending party' });
    s.character.convoyReply({ partyConvoyActive: false, serverNow: 100, returnProgress: { kind: 'event', phase: 'local-town' } });
    assert.equal(s.state.convoyDefense, null);
    assert.deepEqual([s.root.__partyReturnProgress, s.root.parent.__partyReturnProgress], [{ kind: 'event', phase: 'local-town' }, { kind: 'event', phase: 'local-town' }]);
    await s.character.partyWalksReply({ serverNow: 100 });
    assert.equal(s.state.navigationDetail, null);
  }],
  ['a convoy the coordinator no longer runs is released and its walk stopped', s => {
    const travel = s.walking(0);
    s.character.convoyReply({ partyConvoyActive: false, serverNow: 100 });
    return s.character.partyWalksReply({ serverNow: 100 }).then(() => {
      assert.equal(s.character.walkClient.groupWalk.travel, null);
      assert.equal(travel.cancelled, true);
      assert.deepEqual(s.stops.map(([kind]) => kind), ['smart']);
    });
  }],
  // Full status can yield while a newer fast heartbeat renews the owned journey; the
  // party-walks row reads the convoy activity again after the awaited rows (the earlier
  // console shared.js:11238), so the renewed convoy keeps walking.
  ['a convoy a fast heartbeat renews during full status keeps walking', async s => {
    const travel = s.walking(0);
    const reply = { partyConvoyActive: false, serverNow: 100 };
    s.character.convoyReply(reply);
    assert.equal(s.state.convoyActive, false);
    s.root.__partyTravelSignalAt = 200;
    await s.character.partyWalksReply(reply);
    assert.equal(s.state.convoyActive, true);
    assert.equal(s.character.walkClient.groupWalk.travel, travel);
    assert.deepEqual(s.stops, []);
  }],
  // B124: a cancelled convoy's stop that fails reaches the game log. v1.5.0
  // swallowed it in an empty catch, so the walk could run on with no line.
  ['B124: the failed stop of a cancelled convoy is logged', async s => {
    s.walking(0);
    s.stopRejects(Error('server refused the stop'));
    s.character.convoyReply({ partyConvoyActive: false, serverNow: 100 });
    await s.character.partyWalksReply({ serverNow: 100 });
    assert.deepEqual(s.logs, [['Cancelled convoy stop failed: Error: server refused the stop', 'red']]);
    assert.equal(s.character.walkClient.groupWalk.travel, null);
  }],
  ['a failed convoy signal fails its walk with the coordinator\'s reason', async s => {
    s.walking(0);
    s.character.walkClient.groupWalk.signal.phase = 'failed';
    s.character.walkClient.groupWalk.signal.reason = 'Convoy blocked';
    s.character.convoyReply({ partyConvoyActive: true, serverNow: 100 });
    await s.character.partyWalksReply({ partyConvoyActive: true, serverNow: 100 });
    assert.deepEqual(s.failed, ['Convoy blocked']);
  }],
  // The override raises the departure as it starts (owner.ts enforcePartyTownOverride).
  ['the party Town starts the override on a fighter away from Main, and a merchant takes none', async s => {
    s.root.character.ctype = 'merchant';
    s.character.convoyReply({ partyTownActive: true });
    await s.character.partyWalksReply({});
    assert.deepEqual([s.state.townActive, s.state.departing], [false, false]);
    s.root.character.ctype = 'warrior';
    s.character.convoyReply({ partyTownActive: true });
    await s.character.partyWalksReply({});
    assert.deepEqual([s.state.townActive, s.state.departing], [true, true]);
  }],
  ['turning Follow off stops the follow path and hands control back', async s => {
    await s.character.endLeaderFollow(true);
    s.state.following = true;
    await s.character.endLeaderFollow(false);
    await s.character.endLeaderFollow(true);
    assert.deepEqual(s.stops, [['smart', 'follow']]);
    assert.match(s.logs.at(-1)[0], /Leader follow stopped/);
  }],
]);
