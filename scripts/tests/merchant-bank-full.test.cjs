const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const errands = source.slice(source.indexOf('  async function merchantBankErrands('),
  source.indexOf('  async function merchantVisitBank('));

function runtime(store) {
  const context = vm.createContext({
    character: { gold: 0, esize: 2 },
    findMarkedItem: mark => mark.slot,
    bankStoreFully: store,
  });
  vm.runInContext(errands, context);
  return context;
}

test('full bank defers only rejected deposits, preserves marks and allows improvement supply to continue', async () => {
  const calls = [];
  const r = runtime(async slot => {
    calls.push(slot);
    if (slot === 1) throw { reason: 'bank_full' };
  });
  const rejected = { slot: 1, item: { name: 'helmet' } };
  const stacked = { slot: 2, item: { name: 'hpot0' } };
  const command = { merchantBankMarked: [rejected, stacked] }, activity = [];
  await r.merchantBankErrands(command, activity);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(command._merchantBankedCompleted.length, 1);
  assert.equal(command._merchantBankedCompleted[0], stacked);
  assert.equal(command.merchantBankMarked[0], rejected);
  assert.match(activity[0].message, /Bank full; deferred deposit/);
  await r.merchantBankErrands(command, activity);
  assert.deepEqual(calls, [1, 2], 'do not retry failed errands on each scroll visit in the same job');
});

test('unrelated bank errors still propagate', async () => {
  const r = runtime(async () => { throw new Error('interrupted'); });
  await assert.rejects(r.merchantBankErrands({ merchantBankMarked: [
    { slot: 1, item: { name: 'helmet' } },
  ] }, []), /interrupted/);
});

test('bank errands retain paused craft ingredients, surplus stacks and marks until the order completes',async()=>{
 const {craftProtection}=require('../../runtime/coordinator/merchant/craft-reservations.ts');
 const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
 const materials=[{id:'strring',quantity:1},{id:'intring',quantity:1},{id:'dexring',quantity:1},{id:'vitscroll',quantity:10}];
 const paused={id:'craft',order:{crafts:[{id:'ctristone',quantity:6}],craftMaterials:[materials]},resumeState:{phase:'crafting',craftIndex:0,crafted:4}};
 const state={merchantCharacter:'M',merchantQueue:[paused]},deposited=[];
 const r=runtime(async slot=>{deposited.push(slot);r.character.items[slot]=null;});
 r.character.name='M';r.character.items=[...materials.slice(0,3).flatMap(m=>Array.from({length:2},()=>({name:m.id,level:0}))),{name:'vitscroll',q:305},{name:'junk'}];
 r.partyAvailableCraftStock=availableCraftStock;
 let checks=0;r.request=async(_path,{body})=>{assert.equal(body.protectionOnly,true);checks++;return {craftProtection:craftProtection(state)};};
 const marks=r.character.items.map((item,slot)=>({slot,item}));
 const command={jobId:'compound',merchantBankMarked:marks,craftProtection:{requirements:[]}};
 await r.merchantBankErrands(command,[]);
 assert.deepEqual(deposited,[7]);assert.equal(checks,8);
 assert.deepEqual(Array.from(command._merchantBankedCompleted),[marks[7]]);
 assert.equal(r.character.items[6].q,305,'partially reserved stack stays intact');
 state.merchantQueue=[];
 await r.merchantBankErrands({jobId:'bank',merchantBankMarked:marks.slice(0,7)},[]);
 assert.deepEqual(deposited,[7,0,1,2,3,4,5,6]);
});

test('unavailable live reservation protection prevents deposits',async()=>{
 let stored=false;const r=runtime(async()=>{stored=true;});r.request=async()=>({});
 await assert.rejects(r.merchantBankErrands({jobId:'bank',merchantBankMarked:[{slot:0,item:{name:'vitscroll'}}]},[]),/reservations unavailable/);
 assert.equal(stored,false);
});

test('capacity blocks ignore gold and movement but unblock after contents change', () => {
  const {coordinatorMerchantCapacitySignature} = require('../../runtime/coordinator/merchant/job-policy.ts');
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
