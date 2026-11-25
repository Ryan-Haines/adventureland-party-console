// The self-test of the coverage ledger (e2e/coverage/ledger.mts). The ways the ledger can fail,
// written before the script (AGENTS.md "Testing"):
//  L1 a catalog id whose test or row the "before" scan never found passes with no line;
//  L2 a "before" line with no ledger row passes, so a port drops a check unseen;
//  L3 a window mapping names an observer id the window never declares, or a message the window's
//     files no longer hold;
//  L4 an "old" mapping stays after its window is ported, so the old table hides a lost check;
//  L5 a unit mapping names a test file or title that does not exist;
//  L6 a line that moves to a later window stays unmapped once that window is ported.
// Usage: node --test e2e/coverage/ledger.test.mts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, type Before, type Mapping, type Sources } from './ledger.mts';

const before: Before[] = [
  { id: 'T13', kind: 'expect', text: 'TC33 accepted attacks per second', at: 'e2e/movement-steps-rows.ts:156' },
  { id: 'C44', kind: 'expect', text: 'movement.live answers the owner', at: 'e2e/live-movement-hooks.spec.ts:40' },
];
const catalog = [{ id: 'T13', window: 'W01' }, { id: 'C44', window: '' }];
const sources: Sources = {
  windows: { W01: { observers: ['T13'], text: 'expect(rate, "TC33 accepted attacks per second")' } },
  read: path => path === 'scripts/tests/hook-registry.test.cjs' ? "test('X3: the character requests', ...)" : null,
};
const ledger: Mapping[] = [
  { id: 'T13', kind: 'expect', text: before[0].text, target: 'window:W01:T13' },
  { id: 'C44', kind: 'expect', text: before[1].text, target: 'unit:scripts/tests/hook-registry.test.cjs::X3: the character requests' },
];

test('the ledger passes when every line maps', () => {
  assert.deepEqual(check(catalog, before, ledger, sources), []);
});
test('L1: a catalog id with no before line fails', () => {
  assert.match(check([...catalog, { id: 'H99', window: 'W12' }], before, ledger, sources).join('\n'), /H99 has no before line/);
});
test('L2: a deliberately unmapped line fails', () => {
  assert.match(check(catalog, before, ledger.slice(1), sources).join('\n'), /T13 .*TC33 accepted.* has no mapping/);
});
test('L3: a window mapping needs its observer and its message', () => {
  assert.match(check(catalog, before, [{ ...ledger[0], target: 'window:W01:T11' }, ledger[1]], sources).join('\n'), /W01 declares no observer T11/);
  const gone: Sources = { ...sources, windows: { W01: { observers: ['T13'], text: '' } } };
  assert.match(check(catalog, before, ledger, gone).join('\n'), /W01 holds no "TC33 accepted/);
});
test('L4: an old mapping fails once its window is ported', () => {
  assert.match(check(catalog, before, [{ ...ledger[0], target: 'old:e2e/live-movement-owner.spec.ts' }, ledger[1]], sources).join('\n'), /T13 .* still maps to the old table though W01 is ported/);
});
test('L5: a unit mapping needs its file and title', () => {
  assert.match(check(catalog, before, [ledger[0], { ...ledger[1], target: 'unit:scripts/tests/hook-registry.test.cjs::X9' }], sources).join('\n'), /no test "X9"/);
});
test('L6: a moved line fails once its window is ported', () => {
  const moved = [{ ...ledger[0], target: 'moves:W04' }, ledger[1]];
  assert.deepEqual(check(catalog, before, moved, sources), []);
  const ported: Sources = { ...sources, windows: { ...sources.windows, W04: { observers: [], text: '' } } };
  assert.match(check(catalog, before, moved, ported).join('\n'), /moves to W04, which is ported/);
  assert.match(check(catalog, before, moved, sources, true).join('\n'), /still waits for W04 at the final step/);
});
test('L7: a window split by the code counts as ported once any part is', () => {
  const split: Sources = { ...sources, windows: { W01a: sources.windows.W01! } };
  assert.match(check(catalog, before, [{ ...ledger[0], target: 'old:e2e/live-movement-owner.spec.ts' }, ledger[1]], split).join('\n'), /still maps to the old table though W01 is ported/);
});
