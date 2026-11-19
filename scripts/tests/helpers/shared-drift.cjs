// A shared walk that combat pushes off its route (a shared
// setup lives in the harness), over the real movement owner (installPartyMovement, through
// fixtures/movement-service-scenario.cjs `fixture`). The route runs east along y 0 in steps of
// `spacing`. A walk out of a waypoint whose number `drifts` names (1 is the first) is pushed to 50 east and 100 south of it
// instead, and the game refuses the step from there to the waypoint it was walking to, so the
// owner repairs the drift (owner.ts `repairSharedConnector`). Every other step is clear.
const { fixture, settle } = require('../fixtures/movement-service-scenario.cjs');
const { withMargin } = require('./planted-calls.cjs');

function sharedDrift({ waypoints = 12, spacing = 200, drifts = [] } = {}) {
  const plot = Array.from({ length: waypoints }, (_, at) => ({ map: 'main', x: spacing * (at + 1), y: 0 }));
  const r = fixture({ plot }), pushed = new Set(drifts.map(number => spacing * number)), c = r.c, move = r.host.move;
  r.host.move = async (x, y) => {
    const from = c.x;
    if (y === 0 && x === from + spacing && c.y === 0 && pushed.delete(from)) {
      r.calls.push(['move', x, y]);
      Object.assign(c, { x: from + 50, y: 100, real_x: from + 50, real_y: 100, moving: false });
      return;
    }
    return move(x, y);
  };
  // The step a pushed character cannot walk: from its drift point to the waypoint it was walking to.
  r.host.can_move = p => !(p.y === 100 && p.going_y === 0 && p.going_x === p.x - 50 + spacing);
  const destination = plot.at(-1);
  // Walks the shared walk to its end, one scheduler pass per 100 ms with a 200 ms round trip, and
  // answers whether it arrived and the repairs the ring and the game log hold.
  async function walk(passes = 400) {
    let now = r.ports.now(), outcome;
    await withMargin(200, async () => {
      const journey = r.service.move(destination, undefined, { shared: true, repairSharedDrift: true });
      journey.then(() => { outcome = 'arrived'; }, error => { outcome = String(error.message || error); });
      for (let pass = 0; pass < passes && outcome === undefined; pass++) { now += 100; r.setNow(now); r.host.smart_move_logic(); await settle(); }
    });
    return { outcome, at: { x: c.x, y: c.y }, rejoins: Math.max(0, ...r.logs.filter(log => log.phase === 'Rejoined forward walking segment').map(log => log.count)) };
  }
  return { ...r, plot, walk };
}

module.exports = { sharedDrift };
