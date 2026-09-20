const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = require('./helpers/dashboard-source.cjs')();
const helper = source.slice(source.indexOf('function exactLevelPrice('), source.indexOf('function SuggestedPriceDetails('));
const context = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(helper), context);
test('hover prices require an explicitly matching item level', () => {
  assert.equal(context.exactLevelPrice(8000, 0, 2), undefined);
  assert.equal(context.exactLevelPrice(24000, 2, 2), 24000);
  assert.equal(context.exactLevelPrice(8000, 0, 0), 8000);
  assert.equal(context.exactLevelPrice(8000, undefined, 2), undefined);
  assert.equal(context.exactLevelPrice(undefined, 2, 2), undefined);
});
