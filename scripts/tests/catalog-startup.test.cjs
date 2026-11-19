const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statusReport } = require('./helpers/status-report.cjs');

// The warm-up yields one item per slice through the status owner's run scope (report.ts `prepareCatalog`); each
// `step` runs the next yield. Real timer throughput and publication are verified by live-catalog.spec.ts.
function fixture() {
  const timers = [], warmed = [], errors = [];
  const c = { character: {}, G: { items: { coat: {}, staff: {}, potion: {} } }, root: {}, current: () => true,
    sleep: () => new Promise(resolve => timers.push(resolve)), log: message => errors.push(message),
    itemReads: { itemWorldInfo: id => c.warm(id) }, warm: id => warmed.push(id) };
  const report = statusReport(c);
  const state = () => c.root.__partyCatalogDiagnostic('goo', 'coat');
  const step = async () => { timers.shift()(); await Promise.resolve(); await Promise.resolve(); };
  return { c, report, state, warmed, errors, timers, step };
}

test('expensive catalog work yields between slices, does not duplicate, and becomes ready only when complete', async () => {
  const f = fixture(), pending = f.report.prepareCatalog();
  await f.report.prepareCatalog();
  assert.equal(f.timers.length, 1);
  assert.deepEqual(f.warmed, []);
  for (const id of ['coat', 'staff', 'potion']) {
    assert.equal(f.state().prepared, false);
    await f.step();
    assert.equal(f.warmed.at(-1), id);
  }
  await pending;
  assert.equal(f.state().prepared, true);
  assert.equal(f.state().preparing, false);
  await f.report.prepareCatalog();
  assert.equal(f.timers.length, 0);
});

test('Tracktrix invalidation and retired code cannot publish stale preparation', async () => {
  for (const invalidate of [f => f.report.stopCatalog(), f => { f.c.current = () => false; }]) {
    const f = fixture(), pending = f.report.prepareCatalog();
    await f.step(); invalidate(f); await f.step(); await pending;
    assert.equal(f.state().prepared, false);
    assert.equal(f.state().preparing, false);
    assert.deepEqual(f.warmed, ['coat']);
  }
});

test('known server catalogs still warm local item metadata asynchronously; failures can retry', async () => {
  const f = fixture(); f.report.catalogReply({ needsCatalog: false });
  f.c.warm = () => { throw Error('bad catalog'); };
  const pending = f.report.prepareCatalog(); assert.equal(f.timers.length, 1);
  assert.equal(f.warmed.length, 0); await f.step(); await pending;
  assert.equal(f.state().preparing, false); assert.equal(f.state().prepared, false);
  assert.match(f.errors[0], /bad catalog/);
  f.c.warm = id => f.warmed.push(id);
  const retry = f.report.prepareCatalog();
  for (let i = 0; i < 3; i++) await f.step();
  await retry; assert.equal(f.state().prepared, true);
});
