// The `event-return` row on the character (runtime/events/character/exit.ts): one exit on a given
// map, with movement's ladder and every other port a plain value the row sets (a shared setup lives in the harness).
const { installEventExit } = require('../../../runtime/events/character/exit.ts');
const { createOwnerLadder } = require('../../../runtime/protocol/ladder.ts');
const { downloadedGameSource } = require('../helpers/downloaded-game.cjs');
// The pinned game's maps and NPCs (scripts/tests/fixtures/game/manifest.json), so each event map's
// `event` and the Transporter's places are the game's own.
const data = downloadedGameSource('data.js'), G = JSON.parse(data.slice(data.indexOf('{'), data.lastIndexOf('}') + 1));

// `map` is where the character stands. `leave`, `transport`, `town` and `walk` say what each game
// move does to the character (by default it lands where the move leads); `reports` caps the
// reports a row lets pass before the exit's cycle ends.
function exitScenario(map, over = {}) {
  const t = { feedLive: false, townReady: true, reports: 40, progress: { revision: 0, phase: 'local-town' }, ...over };
  const calls = [], character = { name: 'Fighter', map, x: 800, y: 400, rip: false };
  let seen = 0, exit;
  const lands = (to, x = 0, y = 0) => Object.assign(character, { map: to, x, y });
  exit = installEventExit({
    now: () => 0,
    game: () => ({ npcs: G.npcs, maps: G.maps }),
    character: () => character, current: () => true, escaping: () => false, revision: () => 0,
    feedLive: () => t.feedLive, townCastReady: () => t.townReady, runtimeId: () => 'runtime-1',
    // Each report runs the row's hook; past the row's cap the reply names a new cycle.
    nextReport: async () => { seen++; t.onReport?.(character, seen); if (seen > t.reports) exit.observe({ eventReturnCycleId: 'next', serverNow: seen }); },
    progress: () => t.progress,
    keepProgress: record => { t.progress = record; },
    request: async (path, options) => {
      calls.push(['request', path, options.body]);
      return path === '/return-progress' ? { progress: { ...t.progress, ...options.body } } : {};
    },
    movement: {
      climb: (_owner, round) => createOwnerLadder(round, () => 0), endClimb() {}, release: owner => calls.push(['release', owner]),
      claim: request => calls.push(['claim', request.owner]), holdIdle() {}, returnRequest: cycleId => ({ kind: 'task-walk', owner: 'event-return:' + cycleId }), attendRequest: event => ({ kind: 'event', owner: event }),
      leave: async () => { calls.push(['leave', character.map]); if (t.leave) return t.leave(character); lands('main'); },
      transport: async (_request, to, spawn) => { calls.push(['transport', to, spawn]); if (t.transport) return t.transport(character); lands(to); },
      // A Town lands on the spawn of the map it is cast on.
      town: async () => { calls.push(['town', character.map]); if (t.town) return t.town(character); lands(character.map); },
      approach: async point => { calls.push(['approach', point.map]); Object.assign(character, point); },
      prepare: async () => { calls.push(['prepare', character.map]); },
      walk: async point => { calls.push(['walk', character.map]); if (t.walk) return t.walk(character); lands(point.map, 1937, -12); },
      landed: point => character.map === point.map && Math.hypot(character.x - point.x, character.y - point.y) <= 90,
    },
    walkBoss: event => event === 'franky', departing: on => calls.push(['departing', on]), clearTarget: () => calls.push(['clearTarget']), eventTargets: types => calls.push(['eventTargets', types]), fightEnds: async action => { calls.push(['afterCombat']); await action(); },
    log() {},
  });
  return { exit, calls, character, t, state: () => exit.recovery(), run: (event = 'franky', cycleId = 'cycle-1') => {
    exit.observe({ eventReturnCycleId: cycleId, serverNow: 0 });
    return exit.run({ id: 1, type: 'event-return-town', event, cycleId });
  } };
}

module.exports = { exitScenario };
