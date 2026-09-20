const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const cache = new Map();
module.exports = function load(name) {
  if (cache.has(name)) return cache.get(name);
  const filename = path.resolve('dashboard/features/party', name);
  const result = buildSync({ entryPoints: [filename], bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false });
  const module = new Module(filename, moduleParent());
  module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename));
  module._compile(result.outputFiles[0].text, filename); cache.set(name, module.exports); return module.exports;
};
function moduleParent() { return module; }
