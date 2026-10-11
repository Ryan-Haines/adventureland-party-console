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
    // Preserve nested dependency lookup order by translating the actual parent's
    // path, rather than resolving every package from one flat artifact root.
    const filename = path.join(target, path.relative(source, parent.filename));
    const pinnedParent = Object.create(parent);
    pinnedParent.filename = filename;
    pinnedParent.paths = Module._nodeModulePaths(path.dirname(filename));
    return original.call(this, request, pinnedParent, ...options);
  };
}
