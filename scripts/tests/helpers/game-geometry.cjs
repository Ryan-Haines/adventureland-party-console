const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const manifest=require('../fixtures/game/manifest.json');
const { sliceBetween } = require('./slice.cjs');
function installGameGeometry(context, requestedVersion) {
  const base = path.resolve('.caracal/game_files');
  if (!fs.existsSync(base)) return false;
  const candidates=requestedVersion===undefined?manifest.versions.map(entry=>entry.version).sort((a,b)=>Number(b)-Number(a)):[String(requestedVersion)];
  const version = candidates.find(n => fs.existsSync(path.join(base,n,'old_common_functions.js')) && fs.existsSync(path.join(base,n,'data.js')));
  if (!version) return false;
  const data = fs.readFileSync(path.join(base, version, 'data.js'), 'utf8');
  const game = JSON.parse(data.slice(data.indexOf('{'), data.lastIndexOf('}') + 1));
  const common = fs.readFileSync(path.join(base, version, 'old_common_functions.js'), 'utf8');
  context.G.geometry = game.geometry;
  Object.assign(context, { min: Math.min, max: Math.max, EPS: 1e-8, REPS: Number.EPSILON,
    Place: 'client', m_line_x: false, m_line_y: false });
  const file = path.join(base, version, 'old_common_functions.js');
  vm.runInContext(sliceBetween(common, 'function bsearch_start(', 'function closest_line(', file), context);
  vm.runInContext(sliceBetween(common, 'function get_x(', 'function simple_distance(', file), context);
  vm.runInContext(sliceBetween(common, 'function distance(', 'function random_away(', file), context);
  context.can_move_to = (x, y) => context.can_move({ map: context.character.map,
    x: context.character.x, y: context.character.y, going_x: x, going_y: y, base: context.character.base });
  return true;
}
module.exports = { installGameGeometry };
