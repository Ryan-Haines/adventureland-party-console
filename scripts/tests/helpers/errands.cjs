// The errand walk (runtime/movement/character/errands.ts) in a sliced test's vm context, with
// shared.js's ports (characters/shared.js `installErrands`) read live from the context's globals,
// so a test that changes `lastCommand`, `get_player`, `smart` or the anniversary reservation
// (`eventMerchant`, the events owner's merchant row) after creation reaches the module. Movement's own ports
// come from install.ts `errandPorts` over the context's walk state, stop and requesters
// (helpers/requesters.cjs). `meet` goes on the context for the sliced callers.
const { installErrands } = require('../../../runtime/movement/character/errands.ts');
const { errandPorts } = require('../../../runtime/movement/character/install.ts');
const { plantWalkState } = require('./walk-state.cjs');
const { contextScope } = require('./run-scope.cjs');

function installErrandWalk(context) {
  const call = (name, ...args) => context[name](...args);
  plantWalkState(context);
  const parts = { movement: () => context.movement, stop: (...args) => call('stop', ...args), requesters: () => context };
  const errands = installErrands(context, {
    ...errandPorts(context.walkState, parts, () => call('reunionRealm')),
    scope: contextScope(context, '02', 'act'), now: () => (context.Date || Date).now(), character: () => context.character, G: () => context.G,
    current: () => call('runtimeCurrent'), command: () => context.lastCommand,
    reserved: () => context.eventMerchant.anniversaryReserved(),
    smartMove: (destination, callback, options) => call('smart_move', destination, callback, options),
    withTimeout: (promise, ms, label) => call('anniversaryWithTimeout', promise, ms, label),
  });
  Object.assign(context, errands);
  return errands;
}
module.exports = { installErrandWalk };
