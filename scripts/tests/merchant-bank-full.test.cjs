// The merchant's bank visit errands (bank.ts `merchantVisitBank`) over helpers/bank-stacks.cjs
// bankRuntime: a merchant on the bank floor with one vault, whose deposits the game answers.
const { bankRuntime } = require('./helpers/bank-stacks.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');

// `checkpoint` answers the coordinator's protection checkpoint; the bank sort checkpoint keeps
// bankRuntime's answer. `deposited` lists the bag cells the game was asked to store.
function runtime({ items, vault, checkpoint = async () => ({}) }) {
  const checks = [];
  const harness = bankRuntime({ items0: vault }, items, { hpot0: 9999, vitscroll: 9999 }, { ports: {
    request: async (path, options) => {
      if (path === '/merchant/bank-sort/checkpoint') return { mode: 'off', protection: harness.game.protection };
      if (path !== '/merchant/checkpoint') return {};
      assert.equal(options.body.protectionOnly, true); checks.push(options.body.jobId);
      return checkpoint();
    },
  } });
  const deposited = () => harness.calls.filter(call => call[0] === 'store').map(call => call[1]);
  return { ...harness, deposited, checks };
}
const swords = n => Array.from({ length: n }, (_, i) => ({ name: 'sword' + i, level: 0 }));

test('full bank defers only rejected deposits, preserves marks and allows improvement supply to continue', async () => {
  // The vault's last cell is the hpot0 pile; no cell is free for the helmet.
  const r = runtime({ items: [null, { name: 'helmet', level: 0 }, { name: 'hpot0', q: 5 }, null], vault: [...swords(41), { name: 'hpot0', q: 10 }] });
  const rejected = { slot: 1, item: { name: 'helmet', level: 0 } };
  const stacked = { slot: 2, item: { name: 'hpot0', q: 5 } };
  const command = { merchantBankMarked: [rejected, stacked] }, activity = [];
  await r.bank.merchantVisitBank(command, activity);
  assert.deepEqual(r.deposited(), [2]);
  assert.deepEqual(command._merchantBankedCompleted, [stacked]);
  assert.equal(command.merchantBankMarked[0], rejected);
  assert.ok(activity.some(entry => /Bank full; deferred deposit of helmet/.test(entry.message)));
  await r.bank.merchantVisitBank(command, activity);
  assert.deepEqual(r.deposited(), [2], 'do not retry failed errands on each scroll visit in the same job');
});

test('unrelated bank errors still propagate', async () => {
  const r = runtime({ items: [null, { name: 'helmet', level: 0 }], vault: [] });
  r.game.bank_store = async () => { throw new Error('interrupted'); };
  await assert.rejects(r.bank.merchantVisitBank({ merchantBankMarked: [{ slot: 1, item: { name: 'helmet', level: 0 } }] }, []), /interrupted/);
});

test('bank errands retain paused craft ingredients, surplus stacks and marks until the order completes',async()=>{
 const {craftProtection}=require('../../runtime/items/coordinator/production.ts');
 const materials=[{id:'strring',quantity:1},{id:'intring',quantity:1},{id:'dexring',quantity:1},{id:'vitscroll',quantity:10}];
 const paused={id:'craft',order:{crafts:[{id:'ctristone',quantity:6}],craftMaterials:[materials]},resumeState:{phase:'crafting',craftIndex:0,crafted:4}};
 const state={merchantCharacter:'M',merchantQueue:[paused]};
 const items=[...materials.slice(0,3).flatMap(m=>Array.from({length:2},()=>({name:m.id,level:0}))),{name:'vitscroll',q:305},{name:'junk',level:0},null];
 const r=runtime({items,vault:[],checkpoint:async()=>({craftProtection:craftProtection(state)})});
 r.character.name='M';
 const marks=items.slice(0,8).map((item,slot)=>({slot,item}));
 const command={jobId:'compound',merchantBankMarked:marks,craftProtection:{requirements:[]}};
 await r.bank.merchantVisitBank(command,[]);
 assert.deepEqual(r.deposited(),[7]);assert.equal(r.checks.length,8);
 assert.deepEqual(Array.from(command._merchantBankedCompleted),[marks[7]]);
 assert.equal(r.character.items[6].q,305,'partially reserved stack stays intact');
 state.merchantQueue=[];
 await r.bank.merchantVisitBank({jobId:'bank',merchantBankMarked:marks.slice(0,7)},[]);
 assert.deepEqual(r.deposited(),[7,0,1,2,3,4,5,6]);
});

test('unavailable live reservation protection prevents deposits',async()=>{
 const r=runtime({items:[{name:'vitscroll',q:5},null],vault:[]});
 await assert.rejects(r.bank.merchantVisitBank({jobId:'bank',merchantBankMarked:[{slot:0,item:{name:'vitscroll',q:5}}]},[]),/reservations unavailable/);
 assert.deepEqual(r.deposited(),[]);
});

test('capacity blocks ignore gold and movement but unblock after contents change', () => {
  const {coordinatorMerchantCapacitySignature} = require('../../runtime/merchant-jobs/rules.ts');
  const party = { merchantCharacter: 'GoldMajesty', statuses: { GoldMajesty: { items: [] } },
    bankSnapshot: { packs: { items0: [{ name: 'helmet' }] }, gold: 5 },
    merchantJobBlocks: {}, merchantQueue: [], nextCommandId: 1 };
  const r = { party, merchantLog() {}, persistSettings() {}, dispatchMerchant() {},
    merchantCapacitySignature: name => coordinatorMerchantCapacitySignature(party, name), stampMerchantJob: job => job };
  require('./helpers/coordinator-merchant.cjs').merchantQueueRuntime(r);
  party.merchantJobBlocks['GoldMajesty\nupgrades and compounds'] = {
    capacitySignature: r.merchantCapacitySignature('GoldMajesty'), error: 'inventory_full',
  };
  party.statuses.GoldMajesty.gold = 500;
  party.statuses.GoldMajesty.x = 100;
  r.queueMerchant(['GoldMajesty'], 'upgrades and compounds');
  assert.equal(party.merchantQueue.length, 0);
  party.statuses.GoldMajesty.items.push({ slot: 1, item: { name: 'scroll0' } });
  r.queueMerchant(['GoldMajesty'], 'upgrades and compounds');
  assert.equal(party.merchantQueue.length, 2);
});
