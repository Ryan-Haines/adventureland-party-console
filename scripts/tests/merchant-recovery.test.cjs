const test = require('node:test');
const assert = require('node:assert/strict');
const {createMerchantRealmOwner}=require('../../runtime/merchant-realm/coordinator/owner.ts');
const {merchantSlotCommand}=require('../../runtime/merchant-jobs/coordinator/api.ts');

function runtime() {
  const party = { merchantCharacter: 'M', activeRealm: 'SR_USII', statuses: { M: { server: 'USIII' } }, commands: {} };
  const block = { realm: 'SR_USIII' }, logs = [], restarts = [];
  let now = Date.now();
  const r = createMerchantRealmOwner(party, { now: () => now, block: () => block, realmLabel: value => value,
    log: message => logs.push(message), persist() {}, restart: worker => restarts.push(worker) });
  return { r, party, block, logs, restarts, setNow:value=>{now=value;} };
}

test('local work waits for actual home arrival and restarts only once', () => {
  const { r, party, block, restarts, setNow } = runtime();
  assert.equal(r.ensureHome('compounding'), false);
  assert.equal(block.realm, 'SR_USII');
  assert.equal(r.ensureHome('compounding'), false);
  assert.equal(restarts.length, 1);
  party.statuses.M.server = 'USII';
  party.statuses.M.seenAt = party.merchantRealmRequests.M.requestedAt + 1;
  setNow(party.statuses.M.seenAt);
  assert.equal(r.ensureHome('compounding'), true);
});

// The merchant job owner's recovery asks this once the lifecycle owner's roster holds the merchant
// offline; the sale never replays.
test("an offline merchant's WTB sale ends without a requeue", () => {
  const { r, party, block, logs } = runtime();
  party.merchantCurrent = { id: 'sale', reason: 'ALData marketplace sales', startedAt: Date.now(),
    heartbeatAt: Date.now(), buyOrder: { buyer: 'Buyer', item: { name: 'leather' } } };
  party.commands.M = {};
  assert.equal(r.recoverStalledSale(), true);
  assert.equal(party.merchantCurrent, null);
  assert.equal(party.commands.M, undefined);
  assert.equal(block.realm, 'SR_USII');
  assert.match(logs[0], /Buyer/);
});

// The stalled sale ends through the merchant job owner's one job end, so an equip, unequip or
// use-item held for the sale's next stop reaches the slot.
test('the WTB sale end releases a manual command held for it', () => {
  const { r, party } = runtime();
  party.merchantCurrent = { id: 'sale', reason: 'ALData marketplace sales', startedAt: Date.now() };
  const command = { id: 7, type: 'equip' };
  assert.equal(merchantSlotCommand(party, 'manual:equip', command), 'held');
  assert.equal(r.recoverStalledSale(), true);
  assert.equal(party.commands.M, command);
});

test('the WTB sale end leaves every other job', () => {
  const { r, party } = runtime();
  party.merchantCurrent = { reason: 'upgrades and compounds', startedAt: Date.now() - 999999 };
  assert.equal(r.recoverStalledSale(), false);
});

test('home restart preserves sixty second arrival window and requires fresh matching worker realm',()=>{
  let now=20000;const restarts=[],block={realm:'SR_USIII'};
  const state={merchantCharacter:'M',activeRealm:'SR_USII',statuses:{M:{server:'SR_USII'}},commands:{M:{}}};
  const service=createMerchantRealmOwner(state,{now:()=>now,block:()=>block,realmLabel:x=>x,
    log(){},persist(){},restart:()=>restarts.push(now)});
  assert.equal(service.ensureHome('bank'),false);assert.deepEqual(restarts,[20000]);assert.equal(state.commands.M,undefined);
  state.statuses.M.server='USIII';now=35000;service.ensureHome('bank');assert.deepEqual(restarts,[20000]);
  now=79999;service.ensureHome('bank');assert.deepEqual(restarts,[20000]);
  now++;service.ensureHome('bank');assert.deepEqual(restarts,[20000,80000]);
  state.statuses.M.server='SR_USII';state.statuses.M.seenAt=++now;
  assert.equal(service.ensureHome('bank'),true);
});

// The merchant card's activity log (dashboard/components/merchant-activity.tsx) rendered on the real loader.
// The log is scrolled down to an entry; a newer entry arriving above it keeps that entry where it was,
// and a log at the top stays at the top.
test('activity log keeps the visible entry anchored when newer entries arrive', async t => {
  const React = require('../../dashboard/node_modules/react');
  const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
  const { restoreGlobals } = require('./helpers/test-registry.cjs');
  const { MerchantActivityLog } = require('./helpers/dashboard-query-module.cjs')('../../components/merchant-activity.tsx');
  restoreGlobals(t, ['IS_REACT_ACT_ENVIRONMENT']); global.IS_REACT_ACT_ENVIRONMENT = true;
  // The log box is 100 from the top of the page; each entry it renders is 30 px tall, newest first.
  let view;
  const box = { scrollTop: 30, getBoundingClientRect: () => ({ top: 100 }),
    get children() { return view.root.findAllByType('p').map(p => p.props['data-log-key']).map((key, i) => ({ getAttribute: () => key,
      getBoundingClientRect: () => ({ top: 100 + 30 * i - box.scrollTop, bottom: 130 + 30 * i - box.scrollTop }) })); } };
  const entry = (at, message) => ({ at, level: 'info', message });
  try {
    const first = [entry(1, 'a'), entry(2, 'b'), entry(3, 'c')];
    await act(async () => { view = create(React.createElement(MerchantActivityLog, { entries: first }), { createNodeMock: () => box }); });
    const next = [...first, entry(4, 'd')];
    const before = box.children.find(child => child.getBoundingClientRect().bottom > 100).getAttribute();
    await act(async () => { view.update(React.createElement(MerchantActivityLog, { entries: next })); });
    assert.equal(box.scrollTop, 60, 'the entry in view stays in view');
    assert.equal(box.children.find(child => child.getBoundingClientRect().bottom > 100).getAttribute(), before);
    box.scrollTop = 0;
    const last = [...next, entry(5, 'e')];
    await act(async () => { view.update(React.createElement(MerchantActivityLog, { entries: last })); });
    assert.equal(box.scrollTop, 0, 'a log at its top stays at its top');
  } finally { await act(async () => view?.unmount()); }
});

// The realm owner's one path (3.10 rule 5): a Steam merchant's move is its native-realm-switch
// command, a headless one the worker restart; both count as a move here.
function homeReportGap(runtime='headless') {
 let now=10000;const restarts=[];
 const block={realm:'SR_USI',connected:true,instance:{exitCode:null,killed:false}};
 const commands=new Proxy({M:{id:1,type:'merchant-gather'}},{set(target,key,value){if(value?.type==='native-realm-switch')restarts.push(now);target[key]=value;return true;}});
 const state={merchantCharacter:'M',activeRealm:'SR_USI',steamMembers:runtime==='native'?['M']:[],nextCommandId:2,
  statuses:{M:{server:'USI',seenAt:6000,hp:100,rip:false,runtime,travelSample:{connected:true}}},commands};
 const recovery=createMerchantRealmOwner(state,{now:()=>now,block:()=>block,realmLabel:x=>x,log(){},persist(){},restart:()=>restarts.push(now)});
 return {state,block,restarts,recovery,setNow:value=>{now=value;}};
}
for(const runtime of ['headless','native'])test('same-home live '+runtime+' heartbeat gap holds work without reconnect and resumes on a fresh report',()=>{
 const f=homeReportGap(runtime),command=f.state.commands.M;
 assert.equal(f.recovery.ensureHome('gathering'),false);
 assert.deepEqual(f.restarts,[]);assert.equal(f.state.merchantRealmRequests,undefined);assert.equal(f.state.commands.M,command);
 f.state.statuses.M.seenAt=10001;f.setNow(10001);
 assert.equal(f.recovery.ensureHome('gathering'),true);assert.deepEqual(f.restarts,[]);
});
for(const runtime of ['headless','native'])test('same-home '+runtime+' missing reports recover at fifteen seconds then retain the existing sixty second arrival budget',()=>{
 const f=homeReportGap(runtime);f.setNow(20999);
 assert.equal(f.recovery.ensureHome('idle'),false);assert.deepEqual(f.restarts,[]);
 f.setNow(21000);assert.equal(f.recovery.ensureHome('idle'),false);assert.deepEqual(f.restarts,[21000]);
 assert.equal(f.state.merchantRealmRequests.M.attempts,1);
 f.setNow(80999);assert.equal(f.recovery.ensureHome('idle'),false);assert.deepEqual(f.restarts,[21000]);
 f.setNow(81000);assert.equal(f.recovery.ensureHome('idle'),false);assert.deepEqual(f.restarts,[21000,81000]);
});
for(const fault of ['wrong realm','offline worker','exited worker','offline native','dead','missing health','missing report','future report'])test('home recovery does not infer a healthy same-home connection from '+fault,()=>{
 const f=homeReportGap(fault==='offline native'?'native':'headless');
 if(fault==='wrong realm')f.state.statuses.M.server='USII';
 if(fault==='offline worker')f.block.connected=false;
 if(fault==='exited worker')f.block.instance.exitCode=1;
 if(fault==='offline native')f.state.statuses.M.travelSample.connected=false;
 if(fault==='dead')f.state.statuses.M.rip=true;
 if(fault==='missing health')delete f.state.statuses.M.hp;
 if(fault==='missing report')delete f.state.statuses.M.seenAt;
 if(fault==='future report')f.state.statuses.M.seenAt=20000;
 assert.equal(f.recovery.ensureHome('idle'),false);assert.deepEqual(f.restarts,[10000]);
});

// The runner tells a hot reload's redelivery from the coordinator's reissue by the command id
// alone, at any heartbeat age, and leaves the expiry's report to the coordinator.
test('a redelivered job command runs nothing and a reissued one replaces the holder with no bound',async()=>{
  const {installRunner}=require('./helpers/merchant-runner.cjs');
  const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
  require('./helpers/run-scope.cjs').processScope();
  const context={root:{},character:{name:'M'},request:async()=>({}),freeInventorySlots:()=>0,recoverLuckyUpgrade:async()=>{},tidyLuckySlot:async()=>{}};
  const runner=installRunner(context),old=Date.now()-3_600_000;
  boundsSent(boundsPending().length);
  context.root.__merchantHolder={kind:'job',jobId:'j',commandId:7,owner:'reloaded',label:'sale',startedAt:old};
  const ran=[];
  await runner.runJob({jobId:'j',id:7},'sale',async()=>{ran.push(7);});
  assert.deepEqual(ran,[],'an hour old holder of the same command keeps its job');
  assert.equal(context.root.__merchantHolder.owner,'reloaded');
  context.root.__merchantHolder.startedAt=Date.now();
  await runner.runJob({jobId:'j',id:8},'sale',async()=>{ran.push(runner.job().commandId);});
  assert.deepEqual(ran,[8],'a new command id for the job takes over from a fresh holder');
  assert.deepEqual(boundsPending().map(firing=>firing.bound),[]);
});
