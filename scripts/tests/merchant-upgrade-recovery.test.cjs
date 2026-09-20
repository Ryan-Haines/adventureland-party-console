const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

function marksRuntime() {
  const party = { autoUpgradeMarks: { M: { 'wcap@+0': { tiers: 8, quantity: -1 } } }, upgrades: { M: [] } };
  const policies = require('../../runtime/coordinator/inventory/upgrade-marks.ts');
  const r = {
    reconcileAutoUpgradeMarks(name, status) {
      const result = policies.reconcileUpgradeMarks(party.upgrades[name] || [], party.autoUpgradeMarks[name] || {}, status.items);
      party.upgrades[name] = result.marks;
      return result.changed;
    },
    clearResolvedUpgradeMarks(name, resolved) {
      party.upgrades[name] = policies.clearResolvedUpgradeMarks(party.upgrades[name] || [], resolved);
    },
  };
  return { party, r, status: level => ({ items: [
    { slot: 19, item: { name: 'wcap', level }, meta: { upgradeable: true } },
  ] }) };
}

test('automatic +0 to +8 intent survives intermediate +1 and +4 statuses and reconnects', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  for (const level of [1, 4, 8]) {
    party.upgrades = JSON.parse(JSON.stringify(party.upgrades));
    r.reconcileAutoUpgradeMarks('M', status(level));
    assert.equal(party.upgrades.M.length, 1);
    assert.equal(party.upgrades.M[0].item.level, 0);
    assert.equal(party.upgrades.M[0].tiers, 8);
  }
});

test('a rule at the intermediate level cannot replace the unfinished original target', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M['wcap@+4'] = { tiers: 5, quantity: -1 };
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M[0].item.level, 0);
  assert.equal(party.upgrades.M[0].tiers, 8);
});

test('destroyed items and removed rules retire automatic marks', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  r.reconcileAutoUpgradeMarks('M', { items: [] });
  assert.equal(party.upgrades.M.length, 0);
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M = {};
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M.length, 0);
});

test('finishing one batch preserves upgrade marks queued during that batch', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  const dispatched = JSON.parse(JSON.stringify(party.upgrades.M));
  const snapshot = status(4);
  snapshot.items.push({ slot: 25, item: { name: 'wcap', level: 0 }, meta: { upgradeable: true } });
  r.reconcileAutoUpgradeMarks('M', snapshot);
  r.clearResolvedUpgradeMarks('M', dispatched);
  assert.equal(party.upgrades.M.length, 1);
  assert.equal(party.upgrades.M[0].slot, 25);
});

test('the Town watchdog cannot interrupt merchant work even with a stale global hold', async () => {
  let guard;
  const stops = [];
  const r = vm.createContext({ escapeOwns: () => false, character: { ctype: 'merchant', map: 'main', x: -207, y: -220 },
    root: {}, partyTownActive: true, townTraveling: false, townOverrideInFlight: false,
    smart: { moving: true }, stop: kind => stops.push(kind), is_moving: () => true,
    setInterval: callback => { guard = callback; return 1; }, clearInterval() {},
  });
  vm.runInContext(shared.slice(shared.indexOf('  async function enforcePartyTownOverride('),
    shared.indexOf('  async function tick()')), r);
  await r.enforcePartyTownOverride();
  r.maintainTownOverrideGuard();
  guard();
  assert.deepEqual(stops, []);
  assert.equal(r.root.__partyTownGuardTimer, null);
});
