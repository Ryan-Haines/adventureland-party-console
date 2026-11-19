// The lifecycle owner's run scope (runtime/lifecycle/character/run.ts) for tests, built as shared.js builds it before
// any owner installs (characters/shared.js:6-11). The scope has had its first status reply, so table
// P's row is `running` and an `act` handle runs at once, as it does in play after the first reply.
// lifecycle-run.test.cjs tests the hold itself on its own scope.
const { createRunScope } = require('../../../runtime/lifecycle/character/run.ts');

const TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
// The game windows the helper planted a draw on, which `update` draws.
const drawn = new Set();
function running(frame, game) {
  // The game's functions.js defines draw_trigger, which afterDraw and afterUpdate hand their
  // callbacks to. A window that plants none gets one that queues each callback for the next frame,
  // which only a row's `update` draws, as its timers fire only when the row ticks them.
  if (typeof game.draw_trigger !== 'function') {
    const queued = game.__partyTestDraws = [];
    game.draw_trigger = callback => { if (game.in_draw) callback(); else queued.push(callback); };
    drawn.add(game);
  }
  const run = createRunScope({ frame, game, name: () => 'Test', hold: () => null, notify() {} });
  run.replied();
  return run;
}

// The process's scope on Node's `globalThis.parent`, the game window where lifecycle/api.ts `scope()`
// finds it, for an owner a test installs in Node: the owner asks `scope()` itself, or the test passes
// `testScope(owner, kind)` as its port. Its frame is the process, so a row that stubs a global timer
// drives the scope's.
function processScope() {
  const game = globalThis.parent ??= {};
  return game.__partyRunScope ?? running(globalThis, game);
}
const testScope = (owner, kind) => processScope().scope(owner, kind);

// A sliced test's vm context is its own CODE frame, as shared.js's frame is `root`: the handles time
// on the timers the context plants when they run, which a row that drives a fake clock plants, and on
// the process's in a context that plants none, the frame headless CODE has. The scope sits on the
// context's game window, its `parent`, where code run in the context finds it (run.ts `scope()`), as
// shared.js creates it there before any owner installs.
const scopes = new WeakMap();
function contextRun(context) {
  if (!scopes.has(context)) {
    const frame = {};
    // An unbound call gives a sloppy context timer its own realm's global as `this`, the receiver a
    // browser's native timer asks for.
    for (const name of TIMERS) frame[name] = (...args) => { const timer = typeof context[name] === 'function' ? context[name] : globalThis[name]; return timer(...args); };
    if (!context.parent || typeof context.parent !== 'object') context.parent = {};
    scopes.set(context, context.parent.__partyRunScope ?? running(frame, context.parent));
  }
  return scopes.get(context);
}
const contextScope = (context, owner, kind) => contextRun(context).scope(owner, kind);

// One game update on every game window the helper planted a draw on: a draw frame that runs the
// queued callbacks and counts itself in `draws` (game.js `draw`), then the frame's end, after which
// the run scope's decisions for that update run.
async function update() {
  for (const game of drawn) {
    game.in_draw = true;
    game.draws = (Number(game.draws) || 0) + 1;
    try { for (const callback of game.__partyTestDraws.splice(0)) callback(); } finally { game.in_draw = false; }
  }
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

module.exports = { processScope, testScope, contextScope, contextRun, update };
