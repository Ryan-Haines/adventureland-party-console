// The dashboard's browser bundle loads no coordinator code and imports no Node builtin.
// runtime/tasks/api.ts once re-exported tasks/coordinator/ values, which pulled 61 coordinator
// files and eight node: modules into dashboard/app/page.tsx's bundle. The bundle uses the alias and
// loaders vinext uses, with packages external, as tools/dashboard-reach.mjs does.
//
// The same bundle lands no hook table and no character targeting runtime. An import of the
// targeting owner's character door (runtime/characters/targeting/api.ts) evaluates every module the
// door re-exports, its installs among them, and through them runtime/hooks/index.ts, the registry and
// every owner's row file: 430 KB in the page chunk, which the dashboard server held for its whole run.
// The dashboard takes targeting's published values through runtime/hooks/addon-api.ts, whose
// api/04-targeting.ts re-exports them from the files that hold them (docs/efficiency.md "The
// dashboard reads targeting's values through the add-on API").
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');
const COORDINATOR = /^runtime\/(coordinator\/|[\w-]+\/coordinator\/)/;
const HOOKS_AND_TARGETING = /^runtime\/hooks\/(rows\/|registry\.ts$)|^runtime\/characters\/targeting\/(install|selection|queue-client|passing)\.ts$/;

test('the dashboard page bundle lands no coordinator file and no Node builtin', async () => {
  const result = await esbuild.build({ absWorkingDir: ROOT, entryPoints: ['dashboard/app/page.tsx'], bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent', alias: { '@': path.join(ROOT, 'dashboard') }, packages: 'external',
    loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty' } });
  const output = Object.values(result.metafile.outputs)[0];
  const inputs = Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file.split(path.sep).join('/'));
  const landed = inputs.filter(file => COORDINATOR.test(file));
  const builtins = [...new Set(output.imports.filter(i => i.external && i.path.startsWith('node:')).map(i => i.path))];
  assert.deepEqual({ landed, builtins }, { landed: [], builtins: [] });
  assert.deepEqual(inputs.filter(file => HOOKS_AND_TARGETING.test(file)), [], 'no hook table and no character targeting runtime');
});
