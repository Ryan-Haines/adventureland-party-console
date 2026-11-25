// The movement owner's tick (runtime/movement/character/movers.ts `createMovementTick`) for a role
// runner in a test's vm context, as movement's install hands it to the runner: its movers are the
// context's `sharedRoutine` fake, its timers, hooks and movement service the context's globals, its clock the
// context's `Date`, its timer movement's `act` handle on the context's run scope (shared.js
// `scopes.act02`), and its add-on view the routine's `moverView` when the test gives one. A
// context with no movement owner (`__partyMovement`) gets `ownerless`, whose audit finds nothing
// and whose step sends nothing.
const { createMovementTick } = require('../../../runtime/movement/character/movers.ts');
const { contextScope } = require('./run-scope.cjs');

const ownerless = { audit() {}, holdStep() {}, stepAllows: () => true, step: () => ({ sent: Promise.resolve() }) };
function movementTick(context) {
  return createMovementTick({ root: () => context, service: () => context.__partyMovement || ownerless, movers: () => context.sharedRoutine,
    now: () => (context.Date || Date).now(), scope: contextScope(context, '02', 'act') },
    tick => context.sharedRoutine.moverView(tick));
}
module.exports = { movementTick };
