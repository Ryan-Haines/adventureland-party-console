const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function installGameGeometry(context) {
  const base = path.resolve('.caracal/game_files');
  if (!fs.existsSync(base)) return false;
  const version = fs.readdirSync(base).filter(n => /^\d+$/.test(n) &&
    fs.existsSync(path.join(base, n, 'old_common_functions.js'))).sort((a, b) => Number(b) - Number(a))[0];
  if (!version) return false;
  const data = fs.readFileSync(path.join(base, version, 'data.js'), 'utf8');
  const game = JSON.parse(data.slice(data.indexOf('{'), data.lastIndexOf('}') + 1));
  const common = fs.readFileSync(path.join(base, version, 'old_common_functions.js'), 'utf8');
  context.G.geometry = game.geometry;
  Object.assign(context, { min: Math.min, max: Math.max, EPS: 1e-8, REPS: Number.EPSILON,
    Place: 'client', m_line_x: false, m_line_y: false });
  vm.runInContext(common.slice(common.indexOf('function bsearch_start('), common.indexOf('function closest_line(')), context);
  vm.runInContext(common.slice(common.indexOf('function get_x('), common.indexOf('function simple_distance(')), context);
  vm.runInContext(common.slice(common.indexOf('function distance('), common.indexOf('function random_away(')), context);
  context.can_move_to = (x, y) => context.can_move({ map: context.character.map,
    x: context.character.x, y: context.character.y, going_x: x, going_y: y, base: context.character.base });
  return true;
}
module.exports = { installGameGeometry };
