// The one loader for dashboard/features/party modules in unit tests. esbuild bundles the
// named files with packages external, so React and React Query are the dashboard's own copies. JSX
// compiles as the dashboard's (dashboard/tsconfig.json "react-jsx"), so a file outside dashboard/,
// such as runtime/hooks/dashboard/slots.tsx, reaches React through its own `@jsxImportSource`.
// `stubs` maps an import id to the exports the test hands in; a key ending in `/*` covers every id
// under that prefix (`@/components/ui/*`). Every other import is the real module, query-cache.tsx
// included. A load with no stubs is cached by name.
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const folder = path.resolve('dashboard/features/party');
// The packages as a component's bare import resolves them, through their exports maps.
const dashboardRequire = Module.createRequire(path.join(folder, 'index.js'));
const React = dashboardRequire('react');
const { QueryClientProvider } = dashboardRequire('@tanstack/react-query');
const cache = new Map();

function stubFor(stubs, id) {
  if (Object.hasOwn(stubs, id)) return { found: true, value: stubs[id] };
  const prefix = Object.keys(stubs).find(key => key.endsWith('/*') && id.startsWith(key.slice(0, -1)));
  return prefix ? { found: true, value: stubs[prefix] } : { found: false };
}

// `names` is one file name in the folder, or a list whose exports the load joins into one bundle, so
// a context provider and its consumers share one module instance.
function load(names, stubs) {
  const list = [].concat(names), cacheKey = stubs ? null : list.join('|');
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  const entry = list.length === 1
    ? { entryPoints: [path.join(folder, list[0])] }
    : { stdin: { contents: list.map(name => `export * from './${name}';`).join('\n'), resolveDir: folder, loader: 'tsx' } };
  const result = buildSync({ ...entry, bundle: true, packages: 'external', external: Object.keys(stubs || {}),
    platform: 'node', format: 'cjs', write: false, jsx: 'automatic' });
  const filename = path.join(folder, list.length === 1 ? list[0] : 'test-bundle.cjs');
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(folder);
  if (stubs) compiled.require = function require(id) {
    const stub = stubFor(stubs, id);
    return stub.found ? stub.value : Module.prototype.require.call(this, id);
  };
  compiled._compile(result.outputFiles[0].text, filename);
  if (cacheKey) cache.set(cacheKey, compiled.exports);
  return compiled.exports;
}

// A fresh dashboard query client from the real query-cache.tsx, and `wrap`, which puts an element
// under its QueryClientProvider.
function queryRoot() {
  const client = load('query-cache.tsx').createDashboardClient();
  return { client, wrap: element => React.createElement(QueryClientProvider, { client }, element) };
}

module.exports = load;
module.exports.load = load;
module.exports.queryRoot = queryRoot;
module.exports.dashboardRequire = dashboardRequire;
