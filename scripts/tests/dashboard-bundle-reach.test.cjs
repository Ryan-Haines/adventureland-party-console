// The dashboard's browser bundle loads no coordinator code and imports no Node builtin.
// runtime/tasks/api.ts once re-exported tasks/coordinator/ values, which pulled 61 coordinator
// files and eight node: modules into dashboard/app/page.tsx's bundle. The bundle uses the alias and
// loaders vinext uses, with packages external, as tools/dashboard-reach.mjs does.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');
const COORDINATOR = /^runtime\/(coordinator\/|[\w-]+\/coordinator\/)/;

test('the dashboard page bundle lands no coordinator file and no Node builtin', async () => {
  const result = await esbuild.build({ absWorkingDir: ROOT, entryPoints: ['dashboard/app/page.tsx'], bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent', alias: { '@': path.join(ROOT, 'dashboard') }, packages: 'external',
    loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty' } });
  const output = Object.values(result.metafile.outputs)[0];
  const landed = Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0)
    .map(([file]) => file.split(path.sep).join('/')).filter(file => COORDINATOR.test(file));
  const builtins = [...new Set(output.imports.filter(i => i.external && i.path.startsWith('node:')).map(i => i.path))];
  assert.deepEqual({ landed, builtins }, { landed: [], builtins: [] });
});
