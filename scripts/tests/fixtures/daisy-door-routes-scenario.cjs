// The native game 17175 and the route validation ports over it (a shared setup
// lives in the harness).
const path = require('node:path');
const { createNative } = require('../../../tools/game/pathfinder-benchmark/native.cjs');
const directory = path.resolve('.caracal/game_files/17175');
function fixture() {
  const native = createNative(directory);
  const ports = { game: native.game, walk: (a,b) => native.canWalk(a,b),
    door: (p,d) => native.context.is_door_close(p.map,d,p.x,p.y) && native.context.can_use_door(p.map,d,p.x,p.y),
    hasKey: () => false };
  return { native, ports };
}

module.exports = { fixture };
