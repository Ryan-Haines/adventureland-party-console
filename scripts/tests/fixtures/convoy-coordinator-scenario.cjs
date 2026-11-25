// A two-member walk assembling at the Main rally after its Town cast, stepped by the walk's own engine
// (a shared setup lives in the harness).
require('./coordinator-core.cjs');
const assert = require('node:assert/strict');
const { createSharedConvoyNavigation } = require('../../../runtime/movement/coordinator/walk.ts');
const defense = require('../../../runtime/movement/coordinator/defense.ts');
function fixture() {
  const c = { id: 'test', epoch: 7, phase: 'assemble', leader: 'A', participants: ['A', 'B'], townFirst: true, townCompleted: true,
    rally: { map: 'main', x: 0, y: 0 }, location: { map: 'cave', x: 120, y: 0 }, slowestSpeed: 57, completed: [] };
  const p = { activeConvoy: c, commands: {}, statuses: {}, nextCommandId: 10 };
  // The tasks owner's `presence` reads the fact each status carries, as install.ts answers it.
  require('../helpers/requesters.cjs').publishPresence(() => p.statuses);
  for (const [i,name] of c.participants.entries()) {
    p.commands[name] = { id: i+1, type: 'party-monster-travel', convoyId: c.id, epoch: 7 };
    p.statuses[name] = { seenAt: 1000, map: 'main', x: 0, y: 0, speed: 57, moving: false, rip: false, server: 'USII',
      convoyNavigation: { id: 'test', epoch: 7, commandId: i+1, phase: 'assembled', runtimeId: name } };
  }
  require('../helpers/travel-observations.cjs').observeTravel(p.statuses);
  const engine = createSharedConvoyNavigation((state, now, command) => defense.step(state, now, command));
  p.step = now => engine.step(p, now);
  return p;
}

// One assembled report per member that acknowledges its command begins the shared route.
function round(p) { for (const s of Object.values(p.statuses)) s.seenAt=1600; p.step(1600); }
function prepare(p) { round(p); assert.equal(p.activeConvoy.phase,'shared-prepare'); }
prepare.round = round;

// Each member reports the shared route installed on the walk's current command.
function ready(p, name, now=2000) {
  const s=p.statuses[name]; s.seenAt=now;
  s.convoyNavigation={ ...s.convoyNavigation, commandId:p.commands[name].id, routeVersion:p.activeConvoy.routeVersion, routeReady:true, phase:'route-ready' };
}

module.exports = { fixture, prepare, ready };
