const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
const module_ = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('dashboard/features/party/exact-level-price.tsx', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, module_);
const context = module_.exports;
test('hover prices require an explicitly matching item level', () => {
  assert.equal(context.exactLevelPrice(8000, 0, 2), undefined);
  assert.equal(context.exactLevelPrice(24000, 2, 2), 24000);
  assert.equal(context.exactLevelPrice(8000, 0, 0), 8000);
  assert.equal(context.exactLevelPrice(8000, undefined, 2), undefined);
  assert.equal(context.exactLevelPrice(undefined, 2, 2), undefined);
});
