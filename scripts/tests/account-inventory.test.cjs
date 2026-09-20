const test = require('node:test');
const assert = require('node:assert/strict');
const {createAnniversarySnapshot}=require('../../runtime/coordinator/anniversary/snapshot.ts');
const {anniversarySlices}=require('../../runtime/coordinator/anniversary/contracts.ts');
const { inventoryCounts } = require('../../.build/shared/account-inventory.cjs');
const stack = (name, q, level = 0) => ({ slot: 0, item: { name, q, level } });

test('counts characters, bank packs and offline bankbois together', () => {
  const result = inventoryCounts([
    { name: 'Merchant', items: [stack('slice_strawberry', 2)] },
    { name: 'Priest', items: [stack('slice_strawberry', 1)] },
  ], { packs: { items0: [null, stack('slice_strawberry', 3)] } }, [
    { name: 'bankboi0', items: [stack('slice_strawberry', 4)] },
  ]);
  assert.equal(result.slice_strawberry, 10);
});

test('persisted bankboi inventory supersedes its duplicate or stale status', () => {
  const statuses = [{ name: 'bankboi0', items: [stack('slice_strawberry', 9)] }];
  assert.equal(inventoryCounts(statuses, null, [
    { name: 'bankboi0', items: [stack('slice_strawberry', 3)] },
  ]).slice_strawberry, 3);
  assert.equal(inventoryCounts(statuses, null, [{ name: 'bankboi0', items: [] }]).slice_strawberry, undefined);
});

test('dashboard counts preserve item levels and default single quantities', () => {
  assert.deepEqual(inventoryCounts([{ name: 'M', items: [
    stack('sword', 2, 1), stack('sword', undefined, 2), null,
  ] }], null, [], true), { 'sword@1': 2, 'sword@2': 1 });
  assert.deepEqual(inventoryCounts(), {});
});

test('anniversary advertisement includes offline bankbois after coordinator restart', () => {
  const party = {
    statuses: { M: { name: 'M', items: [stack('slice_nightberry', 32)] } },
    bankSnapshot: { packs: { items0: [stack('slice_strawberry', 3)] } },
    bankbois: { bankboi0: { name: 'bankboi0', items: [stack('slice_strawberry', 3)] } },
    anniversary: { nativeSlice: 'slice_nightberry', rounds: {}, activity: [], abortedRounds: {} },
    merchantCharacter: 'M',
  };
  const counts=()=>{
    const result=inventoryCounts(Object.values(party.statuses),party.bankSnapshot,Object.values(party.bankbois));
    return Object.fromEntries(anniversarySlices.map(name=>[name,result[name]||0]));
  };
  const snapshot=createAnniversarySnapshot(party.anniversary,{now:()=>100,counts,statuses:()=>party.statuses,
    leader:()=>'',merchant:()=>party.merchantCharacter,follower:()=>false,enabled:()=>false,owned:()=>false,realm:()=>undefined,
    log(){},persist(){}});
  const state = snapshot.snapshot();
  assert.equal(state.counts.slice_strawberry, 6);
  assert.equal(state.tradeLimits.slice_strawberry, 0);
  assert.equal(state.chatMessage.includes('Strawberry'), false);
  party.statuses.bankboi0 = { ...party.bankbois.bankboi0 };
  assert.equal(counts().slice_strawberry, 6);
});
test('partial inventory snapshots retain the original skip and key-coercion behavior', () => {
  const {inventoryCounts: currentCounts} = require('../../dashboard/lib/account-inventory.ts');
  const characters = [{name: 'P', items: [null, {}, {item: null}, {item: {name: 'leather', q: 3}}, {item: {q: 2}}]}];
  const bank = {packs: {items0: undefined, items1: [null, {}, {item: {name: 'leather', q: 4}}]}};
  assert.deepEqual(currentCounts(characters, bank), {leather: 7, undefined: 2});
  assert.deepEqual(currentCounts(characters, bank, [], true), {'leather@0': 7, 'undefined@0': 2});
  assert.deepEqual(currentCounts(characters, bank), inventoryCounts(characters, bank));
});
