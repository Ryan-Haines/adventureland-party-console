// Preload only for managed caracAL processes. Keep config/storage-relative
// imports installed, but resolve external packages through the artifact cache.
const Module = require('node:module');
const path = require('node:path');
const artifact = process.env.AL_CONSOLE_ARTIFACT;
const installed = process.env.AL_CONSOLE_NATIVE_DIR;
if (artifact && installed) {
  const source = path.resolve(installed);
  const target = path.join(path.resolve(artifact), '.caracal');
  const modules = path.join(source, 'node_modules');
  const builtins = new Set(Module.builtinModules.map(name => name.replace(/^node:/, '')));
  const original = Module._resolveFilename;
  const load = Module._load;
  const config = path.join(source, 'config.js');
  // The console activation picks a managed generation, so a legacy config.js loads with its
  // development watchers (watch_CODE, enable_TYPECODE) off.
  Module._load = function (request, parent, ...options) {
    const value = load.call(this, request, parent, ...options);
    if (parent?.filename && inside(source, parent.filename) &&
        Module._resolveFilename(request, parent) === config)
      return {...value, watch_CODE: false, enable_TYPECODE: false};
    return value;
  };
  const inside = (base, filename) => {
    const relative = path.relative(base, filename);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  Module._resolveFilename = function (request, parent, ...options) {
    if (!parent?.filename || !inside(source, parent.filename) || builtins.has(request.replace(/^node:/, '')))
      return original.call(this, request, parent, ...options);
    const absolute = path.isAbsolute(request) ? request : request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request) : undefined;
    if (absolute && inside(modules, absolute))
      return original.call(this, path.join(target, path.relative(source, absolute)), parent, ...options);
    if (absolute) return original.call(this, request, parent, ...options);
    // A bare package resolves from the artifact path of the file that requires it, so nested
    // node_modules keep their lookup order.
    const filename = path.join(target, path.relative(source, parent.filename));
    const pinnedParent = Object.create(parent);
    pinnedParent.filename = filename;
    pinnedParent.paths = Module._nodeModulePaths(path.dirname(filename));
    return original.call(this, request, pinnedParent, ...options);
  };
}
