const test = require('node:test'), assert = require('node:assert/strict');
const { statusReport, gameReads } = require('./helpers/status-report.cjs');
// The account tracker scores rat 15 and goo 5 (report.ts reads `parent.tracker`).
function fixture() {
  const c = { character: { name: 'Ranger', items: [{ name: 'tracker' }] },
    parent: { character: {}, tracker: { monsters: { rat: 15, goo: 5 } } }, G: { items: { tracker: { skin: 'tracker' } }, monsters: {
      rat: { achievements: [[10, 'stat', 'dex', 2], [20, 'stat', 'dex', 3], [10, 'item', 'gold', 100]] },
      goo: { achievements: [[5, 'stat', 'speed', 1]] },
    }, sprites: {} } };
  return { c, report: gameReads(c) };
}
test('Tracktrix totals only unlocked stat rewards and prefers reported stats', () => {
  const { c, report } = fixture();
  const read = () => JSON.parse(JSON.stringify(report.tracktrix()));
  assert.deepEqual(read().bonuses, { dex: 2, speed: 1 });
  // A total the report adds up itself is marked.
  assert.equal(read().calculated, true);
  c.parent.character.monster_stats = { dex: 7 };
  assert.equal(read().bonuses.dex, 7);
  assert.equal(read().calculated, false);
});
test('banked Tracktrix does not display stale bonuses; missing data remains unknown', () => {
  const { c, report } = fixture();
  c.parent.character.monster_stats = { dex: 7 }; c.character.items = [];
  assert.equal(report.tracktrix().active, false); assert.equal(Object.keys(report.tracktrix().bonuses).length, 0);
  c.character.items = [{ name: 'supercomputer' }]; delete c.parent.character.monster_stats; c.parent.tracker = {};
  assert.equal(report.tracktrix().bonuses, null);
});
// The report object carries only the members a production caller reads; the game reads are the
// module's own exports.
test('the report object leaves the game reads to the module', () => {
  const report = statusReport(fixture().c);
  assert.deepEqual(['tracktrix', 'runSpeed', 'characterDollHtml', 'dollHtml', 'classAppearanceChoices'].filter(key => key in report), []);
});
