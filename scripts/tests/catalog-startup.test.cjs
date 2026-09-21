const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const prepare = namedFunction(source, 'prepareCatalog');

function fixture() {
  const timers = [], warmed = [], errors = [];
  const context = vm.createContext({
    G: { items: { coat: {}, staff: {}, potion: {} } },
    catalogPreparing: false, catalogPrepared: false, catalogKnown: false, catalogGeneration: 0,
    runtimeCurrent: () => true, itemWorldInfo: id => warmed.push(id),
    setTimeout: callback => timers.push(callback), game_log: message => errors.push(message),
  });
  vm.runInContext(prepare, context);
  const step = async () => { timers.shift()(); await Promise.resolve(); await Promise.resolve(); };
  return { context, warmed, errors, timers, step };
}

test('catalog work yields before every item, does not duplicate, and becomes ready only when complete', async () => {
  const f = fixture(), pending = f.context.prepareCatalog();
  await f.context.prepareCatalog();
  assert.equal(f.timers.length, 1);
  assert.deepEqual(f.warmed, []);
  for (const id of ['coat', 'staff', 'potion']) {
    assert.equal(f.context.catalogPrepared, false);
    await f.step();
    assert.equal(f.warmed.at(-1), id);
  }
  await pending;
  assert.equal(f.context.catalogPrepared, true);
  assert.equal(f.context.catalogPreparing, false);
  await f.context.prepareCatalog();
  assert.equal(f.timers.length, 0);
});

test('Tracktrix invalidation and retired code cannot publish stale preparation', async () => {
  for (const invalidate of [c => c.catalogGeneration++, c => c.runtimeCurrent = () => false]) {
    const f = fixture(), pending = f.context.prepareCatalog();
    await f.step(); invalidate(f.context); await f.step(); await pending;
    assert.equal(f.context.catalogPrepared, false);
    assert.equal(f.context.catalogPreparing, false);
    assert.deepEqual(f.warmed, ['coat']);
  }
});

test('known server catalogs still warm local item metadata asynchronously; failures can retry', async () => {
  const f = fixture(); f.context.catalogKnown = true;
  f.context.itemWorldInfo = () => { throw Error('bad catalog'); };
  const pending = f.context.prepareCatalog(); assert.equal(f.timers.length, 1);
  assert.equal(f.warmed.length, 0); await f.step(); await pending;
  assert.equal(f.context.catalogPreparing, false); assert.equal(f.context.catalogPrepared, false);
  assert.match(f.errors[0], /bad catalog/);
  f.context.itemWorldInfo = id => f.warmed.push(id);
  const retry = f.context.prepareCatalog();
  for (let i = 0; i < 3; i++) await f.step();
  await retry; assert.equal(f.context.catalogPrepared, true);
});

test('first status omits expensive catalogs; prepared status includes them', () => {
  const ts = require('typescript');
  const ast = ts.createSourceFile('shared.js', namedFunction(source, 'snapshot'), ts.ScriptTarget.Latest, true);
  let block;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast).includes('catalogPrepared')) block = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(block);
  const context = vm.createContext({ catalogKnown: false, catalogPrepared: false, status: {}, merchantCatalogVersion: 'test' });
  for (const name of ['travelPlaces', 'monsterChoices', 'monsterHunterLocation', 'bestiaryCatalog', 'skillCatalog', 'classAppearanceChoices', 'merchantCatalog']) {
    context[name] = () => { throw Error('catalog executed before ready'); };
  }
  vm.runInContext(block, context); assert.deepEqual(Object.keys(context.status), []);
  for (const name of ['travelPlaces', 'monsterChoices', 'monsterHunterLocation', 'bestiaryCatalog', 'skillCatalog', 'classAppearanceChoices', 'merchantCatalog']) context[name] = () => [name];
  context.catalogPrepared = true; vm.runInContext(block, context);
  assert.equal(context.status.merchantCatalog[0], 'merchantCatalog');
});
