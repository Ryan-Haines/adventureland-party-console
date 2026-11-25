// The setup for the Franky combat tests (scripts/tests/franky-combat.test.cjs), in the shared harness.
// The Franky mover on character/combat.ts: the facts with every port a plain
// value. The character attends Franky on its map; `selected` is the target the targeting owner's selection holds, and
// `unsafe` makes every step point fail the add-aware check, `blocked` every point fail terrain,
// `owns: false` stands for a task or request above the attendance, `entities` is the game's
// entity list and `returnFight` the exit's fight under attack.
function factsFixture(over = {}) {
  const { installEventFacts } = require('../../../runtime/events/character/combat.ts');
  const t = { unsafe: false, inRange: false, blocked: false, owns: true, limits: {}, ...over }, steps = [], positions = [];
  const character = { name: 'Hero', map: 'level2w', x: 0, y: 0, speed: 40 };
  const facts = installEventFacts({
    game: () => ({ maps: { level2w: { event: 'franky' } }, monsters: { franky: { spawns: [[15000, 'nerfedmummy']] }, nerfedmummy: {} } }),
    limits: () => t.limits, character: () => character, entities: () => t.entities || {},
    attend: () => ({ selected: () => true, joined: () => 'franky', traveling: () => null, active: () => ({ name: 'franky' }), owns: () => t.owns,
      sighting: () => null, rejoin: async () => ({}), rejoinPending: () => null }),
    activity: () => null, clockOffset: () => 0, members: () => [], inPvp: () => false, targetTypes: () => ['franky'],
    exitPending: () => false, exiting: () => false, leaveEventMap: async () => false, travelling: () => false, recovering: () => false, merchantJob: () => null,
    inRange: () => t.inRange, approachPoint: target => ({ x: target.x, y: target.y }), canMoveTo: () => !t.blocked, safePoint: () => !t.unsafe,
    step: (target, point, mode, closes) => { steps.push({ target: target.id, mode, closes: closes ?? null }); return true; },
    resetSteps() {}, position: record => positions.push(record), now: () => 1000,
    frankyAllows: target => !!target && (target.mtype === 'franky' || target.mtype === 'nerfedmummy' && target.target === 'Hero'),
    returnFight: () => !!t.returnFight, cancelReturnTown() { t.cancelled = (t.cancelled || 0) + 1; },
  });
  return { facts, steps, positions, t };
}
module.exports={factsFixture};
