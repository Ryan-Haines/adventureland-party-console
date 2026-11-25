// The Town arrival connector's executor (runtime/movement/character/executor.ts): one Town plot step
// from a fighter at (200, -120) to the main spawn, on a fixture clock. A row passes the host's move
// and town answers and the round trip; `moves` holds each move's send time.
function townConnector({ move, town, roundTrip = 100 }) {
  const { createMovementExecutor } = require('../../../runtime/movement/character/executor.ts');
  const clock = { now: 1000 }, calls = [], moves = [];
  const character = { map: 'main', in: 'main', real_x: 200, real_y: -120, x: 200, y: -120, moving: false };
  const host = { character, move: (x, y) => { calls.push(['move', x, y]); moves.push(clock.now); return move(character, moves); },
    can_walk: () => true, is_transporting: () => false, can_use: () => true, town: () => { calls.push('town'); return town(); } };
  const executor = createMovementExecutor(host, { plot: [{ map: 'main', x: 0, y: 0, town: true }], use_town: true },
    { game: { maps: { main: { spawns: [[0, 0]] } } }, walk: () => true },
    () => clock.now, { townReady: () => true, transitionReady: () => true, judge: () => () => 'clear' },
    { band: () => 'job', stopTown: () => Promise.resolve(), standStill: () => Promise.resolve(), roundTrip: () => roundTrip });
  const at = (x, y) => Object.assign(character, { x, y, real_x: x, real_y: y });
  return { executor, character, clock, calls, moves, at };
}
module.exports = { townConnector };
