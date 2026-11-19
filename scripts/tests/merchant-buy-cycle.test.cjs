// The buy-and-level rows run the items owner's merchantCommerce
// (runtime/items/character/production.ts) on the items harness with a one-line order. The fixture
// character is no merchant, so upgradeConfirmed calls the game's upgrade directly, with no production
// journal or lucky swap; `upgrade` is that call.
const { productionHarness } = require('./helpers/items-character.cjs');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const {createMerchantProgressRoutes} = require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createCompletionRetries} = require('../../runtime/merchant-jobs/coordinator/endings.ts');
const {currentMerchantReport} = require('../../runtime/merchant-jobs/coordinator/endings.ts');
const {COMMERCE_PROGRESS_VERSION} = require('../../runtime/merchant-jobs/rules.ts');
const {craftProtection} = require('../../runtime/items/coordinator/production.ts');
const {availableCraftStock, PROTECTED_FREE_SLOTS_DEFAULT} = require('../../runtime/items/rules.ts');
const {publishTasks} = require('../../runtime/tasks/api.ts');
const {publishEventAnswers} = require('../../runtime/events/api.ts');
const {itemsDoor} = require('./helpers/coordinator-merchant.cjs');

function worker(poofs = 0) {
  let failures = poofs, buys = 0, upgrades = 0, checkpointHook = () => {};
  const items = Array(42).fill(null), calls = [], activity = [];
  const purchase = {id: 'coat', level: 3, quantity: 1, attempts: 1000, budget: 100000};
  const command = {id: 1, jobId: 'fixture-commerce', commerceProgressVersion: COMMERCE_PROGRESS_VERSION, order: {buys: [purchase]}};
  const G = {items: {coat: {g: 10, upgrade: true}, scroll0: {g: 1, s: 9999}}, skills: {},
    npcs: {armors: {items: ['coat']}, scrolls: {items: ['scroll0', 'scroll1']}}};
  const w = {items, calls, activity, command, purchase, G, grade: () => 0, move: async name => calls.push(['move', name]),
    // The game's upgrade: a poof empties the cell and the game confirms the destruction.
    upgrade: async (slot, scroll) => {
      items[scroll].q--; if (!items[scroll].q) items[scroll] = null;
      if (failures-- > 0) {items[slot] = null; throw {reason: 'upgrade_destroyed', confirmedDestroyed: true};}
      items[slot].level++;
    }};
  const h = productionHarness({character: {name: 'M', items, gold: 1e9, bank: {gold: 0}}, G, bank: {findBankItem: () => null},
    reads: {merchantCatalog: () => ({buyable: [], craftable: []})},
    ports: {job: () => ({commandId: command.id}), grade: item => w.grade(item), move: name => w.move(name),
      protectedSlots: () => PROTECTED_FREE_SLOTS_DEFAULT, upgrade: (slot, scroll) => { upgrades++; return w.upgrade(slot, scroll); },
      buyConfirmed: async (name, quantity) => { buys++; calls.push(['buy', name, quantity]);
        if (name === 'coat') items[items.indexOf(null)] = {name, level: 0};
        else {const existing = items.find(item => item?.name === name); if (existing) existing.q += quantity;
          else items[items.indexOf(null)] = {name, q: quantity};}
      },
      // Each checkpoint lands in the local journal before its request, so a hook that throws is a
      // lost reply after the save.
      request: async (path, {body}) => {
        if (path === '/merchant/checkpoint') {checkpointHook(body.state, body.cycleBoundary); return {yield: false};}
        if (path === '/merchant/activity') activity.push(body);
        calls.push([path, JSON.parse(JSON.stringify(body))]);
        return {};
      }}});
  return Object.assign(w, {h, stored: h.stored, run: () => h.production.merchantCommerce(command),
    checkpoint: fn => checkpointHook = fn, counts: () => ({buys, upgrades}),
    poofs: () => activity.filter(entry => /poof/.test(entry.message)).length});
}

test('300 poofs yield between item cycles and resume with cumulative spending and attempts', async () => {
  const w = worker(300); let yields = 0;
  w.checkpoint((p,boundary) => {
    if (!boundary || p.buyIndex || p.cycleActive || !p.attempts || p.attempts <= yields) return;
    yields = p.attempts; throw Error('merchant_yield');
  });
  for (;;) {try {await w.run(); break;} catch (e) {assert.equal(e.message,'merchant_yield');}}
  assert.equal(yields,301); assert.equal(w.items.filter(item=>item?.name==='coat' && item.level===3).length,1);
  assert.equal(w.calls.filter(call=>call[0]==='buy' && call[1]==='coat').length,301);
  assert.equal(w.command._commerceState.buyIndex,1);
});

test('confirmed survivor resumes after reload without a new item or another cycle allowance', async () => {
  const w = worker(); let interrupted = false;
  w.checkpoint((p,boundary) => {if (!interrupted && p.activeItem?.level===1 && !p.pendingUpgrade) {
    assert.equal(boundary,false); interrupted=true; throw Error('reload');}});
  await assert.rejects(w.run(),/reload/);
  assert.equal(w.command._commerceState.attempts,1);
  w.checkpoint(()=>{}); await w.run();
  assert.equal(w.calls.filter(c=>c[0]==='buy' && c[1]==='coat').length,1);
  assert.equal(w.counts().upgrades,3);
});

test('lost final-upgrade response is reconciled once and cannot duplicate a result', async () => {
  // The game applies the final upgrade after its reply was lost, so the bag shows +3 only once the
  // line has thrown.
  const w=worker(), upgrade=w.upgrade;
  w.upgrade=async(slot,scroll)=>{if(w.items[slot].level<2)return upgrade(slot,scroll);
    setImmediate(()=>upgrade(slot,scroll));throw Error('connection lost');};
  await assert.rejects(w.run(),/connection lost/);
  assert.equal(w.command._commerceState.pendingUpgrade.level,3);
  await new Promise(resolve=>setImmediate(resolve));
  await w.run(); assert.equal(w.counts().upgrades,3);
  assert.equal(w.command._commerceState.results.length,1);
});

test('purchase checkpoint response loss does not buy or charge a second base item', async () => {
  const w=worker(); let lost=false, spent;
  w.checkpoint(p=>{if(!lost && p.activeItem?.level===0 && !p.pendingPurchase) {lost=true;spent=p.spent;throw Error('response lost');}});
  await assert.rejects(w.run(),/response lost/); w.checkpoint(()=>{}); await w.run();
  assert.equal(spent,13);assert.equal(w.calls.filter(c=>c[0]==='buy' && c[1]==='coat').length,1);
});

test('attempt and gold allowances cannot reset across repeated yields', async () => {
  for(const kind of ['attempt','budget']) {
    const w=worker(50);if(kind==='attempt')w.purchase.attempts=2;else w.purchase.budget=24;
    let last=0;w.checkpoint((p,b)=>{if(b&&!p.cycleActive&&p.attempts>last){last=p.attempts;throw Error('merchant_yield');}});
    let failure;for(let n=0;n<10;n++){try{await w.run();}catch(e){if(e.message!=='merchant_yield'){failure=e;break;}}}
    assert.match(failure.message,kind==='attempt'?/attempt allowance exhausted/:/budget exhausted/);
    assert.ok(w.command._commerceState.spent<=w.purchase.budget);
    assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,2);
  }
});

// The merchant's event reservation asks the tasks owner's live task and the events owner's deferred returns
// (merchant-jobs/coordinator/event-hold.ts); neither holds one here. A queued job's readiness asks
// the items owner's items.needs over the same state.
function progressFixture() {
  publishTasks({groupOf: name => 'party:' + name, live: () => null});
  publishEventAnswers({deferredReturn: () => false});
  let event=false; const state={merchantCharacter:'M',merchantCurrent:{id:'j',commandId:7,commerceProgressVersion:2,
    reason:'merchant commerce',target:'M',priority:50},merchantQueue:[],statuses:{},gatheringModes:[],gatheringCooldowns:{},commands:{M:{id:7}}};
  itemsDoor(state);
  const routes=createMerchantProgressRoutes(state,{offline:()=>false,now:()=>1000,priority:j=>j.priority||0,routinePriority:()=>0,
    stamp:j=>j,persist(){},log(){},dispatch(){},anniversaryReserved:()=>event,capacityBlocked:j=>j.full===true,collectionReady:()=>true});
  function invoke(body,handler=routes.checkpoint){let code=200,value;const res={status:c=>{code=c;return res;},json:v=>value=v};handler({body},res);return{code,value};}
  return{state,invoke,routes,event:()=>event=true};
}
test('anniversary and runnable priorities yield only at cycle boundaries; stale dispatches are rejected',()=>{
  const f=progressFixture();f.event();
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{spent:12},cycleBoundary:false}).value.yield,false);
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{spent:13},cycleBoundary:true}).value.yield,true);
  assert.equal(f.state.merchantQueue[0].resumeState.spent,13);
  f.state.merchantCurrent={...f.state.merchantQueue.pop(),commandId:8};
  for(const handler of [f.routes.checkpoint,f.routes.heartbeat])assert.equal(f.invoke({jobId:'j',commandId:7},handler).code,409);
  assert.equal(currentMerchantReport(f.state.merchantCurrent,{jobId:'j',commandId:7}),false);
});
test('blocked and equal priority work cannot cause a yield loop',()=>{
  const f=progressFixture();f.state.merchantQueue=[{reason:'x',priority:99,retryAt:2000},{reason:'x',priority:99,full:true},{reason:'x',priority:50}];
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{},cycleBoundary:true}).value.yield,false);
  f.state.merchantQueue.push({reason:'x',priority:51});
  assert.equal(f.invoke({jobId:'j',commandId:7,state:{},cycleBoundary:true}).value.yield,true);
});
test('movement retries retain allowances, grow backoff, and leave invalid orders terminal',()=>{
  const state={merchantQueue:[],merchantJobBlocks:{},statuses:{M:{}},merchantCharacter:'M',npcSaleMarks:[],commands:{}};
  const retries=createCompletionRetries(state,{now:()=>1000,nextCommand:()=>1,stamp:j=>j,log(){}});
  let job={id:'j',target:'M',reason:'merchant commerce',order:{buys:[{level:8}]},resumeState:{spent:42,attempts:9}};
  for(const delay of [10000,30000,60000,300000,300000]){
    retries.enqueue(job,retries.decide(job,{success:false,error:'ALClient found no route',failureKind:'commerce_movement'}));
    job=state.merchantQueue.shift();assert.equal(job.retryAt,1000+delay);assert.deepEqual(job.resumeState,{spent:42,attempts:9});
  }
  assert.equal(retries.decide(job,{success:false,error:'90% estimated budget exhausted'}).retry,true);
  assert.equal(retries.decide({...job,order:{buys:[{level:0}]}},{success:false,error:'Invalid order'}).retry,false);
});
test('queued order reservations protect survivors and completed results but release on cancellation',()=>{
  const state={merchantCharacter:'M',merchantQueue:[{id:'j',resumeState:{activeSlot:0,activeItem:{name:'coat',level:2},results:[{slot:1,item:{name:'coat',level:8}}]}}]};
  const items=[{slot:0,item:{name:'coat',level:2},craftLocation:'inventory:M'},{slot:1,item:{name:'coat',level:8},craftLocation:'inventory:M'},
    {slot:2,item:{name:'coat',level:8},craftLocation:'inventory:M'}];
  assert.deepEqual(availableCraftStock(items,craftProtection(state)),[null,null,items[2]]);
  state.merchantQueue=[];assert.deepEqual(availableCraftStock(items,craftProtection(state)),items);
});

test('buy command releases an idle stand operation and closes the stand before starting',async()=>{
  const calls=[],root={localStorage:{getItem:()=>null}},command={id:8,jobId:'buy',type:'merchant-commerce',commerceProgressVersion:2};
  const c=createMovementContext({root,character:{ctype:'merchant',stand:true},
    luckyUpgradeSlot:null,luckyUpgradeService:null,
    request:async(path,{body})=>{calls.push([path,body]);},setInterval:()=>1,clearInterval(){},
    stop:async()=>{calls.push('stop');root.__merchantHolder=null;released();},
    partyItems:{stand:{close:async()=>{calls.push('close');c.character.stand=false;}}},recoverProductionJournal:async()=>calls.push('recover'),
    freeInventorySlots:()=>42,tidyLuckySlot:()=>assert.fail('must not relocate a pending upgrade outcome'),
    game_log(){},setTimeout:fn=>fn()});
  // The stand return walking home is the runner's holder `idle`: the buy command meets it, the
  // walk stops and the holder lets go, and the take closes the stand before the job runs.
  // The lucky recovery is the items owner's, with no lucky journal saved.
  let released;
  root.__merchantHolder={kind:'idle',commandId:7,owner:'old',startedAt:0,phase:'return',cancelled:null,pending:null,done:new Promise(resolve=>{released=resolve;})};
  c.recoverLuckyUpgrade=productionHarness({character:c.character}).production.recoverLucky;
  require('./helpers/merchant-runner.cjs').installRunner(c,{sleep:async()=>{}});
  assert.equal(await c.merchantRunner.accept(command),true);
  await c.merchantRunner.runJob(command,'buy',async()=>{assert.equal(c.character.stand,false);calls.push('action');});
  assert.ok(calls.indexOf('stop')<calls.indexOf('close'));assert.ok(calls.indexOf('close')<calls.indexOf('action'));
  assert.equal(calls.find(Array.isArray)[1].commandId,8);assert.equal(root.__merchantHolder,null);
});

test('movement checkpoint resets only the movement failure streak and preserves financial counters',()=>{
  const f=progressFixture();f.state.merchantCurrent.movementRetryCount=4;
  f.invoke({jobId:'j',commandId:7,state:{spent:90,attempts:7},cycleBoundary:false,movementSucceeded:true});
  assert.equal(f.state.merchantCurrent.movementRetryCount,0);
  assert.deepEqual(f.state.merchantCurrent.resumeState,{spent:90,attempts:7});
});

test('results remain owned across lines and unrelated target-level items do not complete an order',async()=>{
 const w=worker();w.items[8]={name:'coat',level:3};await w.run();
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
 assert.equal(w.command._commerceState.results.length,1);
 assert.notEqual(w.command._commerceState.results[0].slot,8);
 const first=w.command._commerceState.results[0];
 // A second line of the same item starts from the first line's closing checkpoint and keeps its receipt.
 w.command.order.buys.push({...w.purchase});w.command.resumeState=w.command._commerceState;
 await w.run();assert.equal(w.command._commerceState.results.length,2);
 assert.equal(w.command._commerceState.results[0].slot,first.slot);
});

test('commerce executor uses named NPC routes and reports a resumable movement failure with saved allowances',async()=>{
 const w=worker(),moves=[];
 w.move=async destination=>{moves.push(destination);if(destination==='newupgrade')throw Object.assign(Error('ALClient found no route'),{partyRequest:{path:'/movement-plan',status:503}});};
 Object.assign(w.command,{commerceOrderId:'order',resumeState:{phase:'leveling',buyIndex:0,attempts:0,spent:0}});
 await assert.rejects(w.run(),/no route/);
 assert.ok(moves.every(destination=>typeof destination==='string'));assert.ok(moves.includes('armors'));
 const completion=w.calls.findLast(([path])=>path==='/merchant/complete')[1];
 assert.equal(completion.failureKind,'commerce_movement');assert.equal(completion.commandId,1);
 const saved=w.stored['party-commerce:order'];
 assert.equal(saved.attempts,1);assert.equal(saved.spent,13);assert.equal(saved.activeItem.name,'coat');
 assert.equal(completion.activity.at(-1).message,'Merchant order paused; progress preserved');
});

// A complete production journal settles on recovery and writes its receipt into the commerce journal
// it names, once: the receipt bumps the sequence, so a late replay of the same journal finds none.
test('production receipt survives a lost completion response and records poof before another routine reuses the slot',async()=>{
 const h=productionHarness({character:{name:'M',items:[]}});
 h.stored.commerce={sequence:4,pendingUpgrade:{level:3},spent:19,attempts:2};
 const journal=outcomeItem=>({id:'a',phase:'complete',item:{name:'coat',level:2},slots:[0],commerce:{key:'commerce',sequence:4},
  outcomeItem,destroyed:!outcomeItem,success:!!outcomeItem});
 h.stored['party-production']=journal(null);
 await h.production.recover();
 assert.deepEqual(h.stored.commerce,{sequence:5,pendingUpgrade:{level:3,outcome:{item:null,destroyed:true}},spent:19,attempts:2});
 h.stored['party-production']=journal({name:'coat',level:3});
 const late=productionHarness({character:{name:'M',items:[]}});
 Object.assign(late.stored,h.stored);
 await late.production.recover();
 assert.equal(late.stored.commerce.pendingUpgrade.outcome.item,null,'late replay cannot replace the receipt');
});

test('an uncertain scroll purchase protects its quantity baseline while queued',()=>{
 const state={merchantCharacter:'M',merchantQueue:[{resumeState:{pendingPurchase:{name:'scroll0',before:4,quantity:3}}}]};
 const items=[{slot:0,item:{name:'scroll0',q:7},craftLocation:'inventory:M'}];
 assert.deepEqual(availableCraftStock(items,craftProtection(state)),[null]);
});

test('empty original slot and arbitrary upgrade error cannot report poof or buy again',async()=>{
 const w=worker();
 w.upgrade=async slot=>{
  w.items[15]=w.items[slot];w.items[slot]=null;
  throw Object.assign(Error('item or scroll unavailable'),{code:'lucky_unavailable'});
 };
 await assert.rejects(w.run(),/unavailable/);
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);
 assert.equal(w.items[15].level,0);assert.equal(w.poofs(),0);
 assert.ok(w.command._commerceState.activeItem);
 assert.ok(w.command._commerceState.pendingUpgrade);
});

test('legacy inferred destruction is not a confirmed destruction receipt',async()=>{
 const w=worker();
 w.upgrade=async slot=>{w.items[slot]=null;throw {reason:'upgrade_destroyed'};};
 await assert.rejects(w.run(),e=>e.reason==='upgrade_destroyed');
 assert.equal(w.calls.filter(c=>c[0]==='buy'&&c[1]==='coat').length,1);assert.equal(w.poofs(),0);
});

test('legacy empty outcome after restart requires review and cannot purchase another base',async()=>{
 const w=worker();w.command.resumeState={phase:'leveling',buyIndex:0,attempts:1,spent:13,
  activeItem:{name:'coat',level:2},activeSlot:5,cycleActive:true,results:[],
  pendingUpgrade:{level:3,outcome:{item:null}}};
 await assert.rejects(w.run(),/uncertain/);
 assert.equal(w.counts().buys,0);
});


test('batch buys starting-tier scrolls together and finishes all items after early success', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 10;
  w.grade = item => (item.level || 0) >= 2 ? 1 : 0;
  w.G.items.scroll1 = {g: 5, s: 9999};
  await w.run();
  assert.equal(w.items.filter(i => i?.name === 'coat' && i.level === 3).length, 10);
  assert.deepEqual(w.calls.filter(c => c[0] === 'buy' && c[1] === 'scroll0'), [['buy','scroll0',20]]);
  const higher = w.calls.filter(c => c[0] === 'buy' && c[1] === 'scroll1');
  assert.equal(higher.length, 10); assert.ok(higher.every(c => c[2] === 1));
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 10);
});

test('interrupted batch purchase resumes without duplicate purchases or attempts', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 4; let stopped = false;
  w.checkpoint(p => { if (!stopped && p.batchItems?.length === 2 && !p.pendingPurchase) {
    stopped = true; throw Error('reload');
  }});
  await assert.rejects(w.run(), /reload/);
  assert.equal(w.command._commerceState.attempts, 2);
  await w.run();
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 4);
  assert.equal(w.items.filter(i => i?.name === 'coat' && i.level === 3).length, 4);
});

test('uncertain batch upgrade cannot steal another purchased base or buy replacements', async () => {
  const w = worker(); w.command.buyUpgradeBatchSize = 3;
  w.upgrade = async slot => { w.items[slot] = null; throw Error('connection lost'); };
  await assert.rejects(w.run(), /connection lost/);
  await assert.rejects(w.run(), /missing without confirmed destruction/);
  assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 3);
  assert.equal(w.command._commerceState.batchItems.length, 2);
});

test('batch respects free space, remaining attempts, and budget', async () => {
  for (const kind of ['space','attempts','budget']) {
    const w = worker(); w.command.buyUpgradeBatchSize = 10;
    if (kind === 'space') for (let i=0;i<36;i++) w.items[i]={name:'unrelated'};
    if (kind === 'attempts') w.purchase.attempts=2;
    if (kind === 'budget') w.purchase.budget=26;
    await w.run();
    assert.equal(w.calls.filter(c => c[0] === 'buy' && c[1] === 'coat').length, 2, kind);
  }
});

test('queued batches reserve every purchased base during a yield', () => {
  const protection = craftProtection({merchantCharacter:'M',merchantQueue:[{resumeState:{
    batchItems:[{slot:4,item:{name:'coat',level:0}},{slot:5,item:{name:'coat',level:0}}]
  }}]});
  assert.equal(protection.deliveries.length,2);
  assert.deepEqual(protection.deliveries.map(i=>i.slot),[4,5]);
});

// While a commerce order holds the bag as `purchasing`, the Tracktrix pin and the bank sort
// move no copy, and a pending lucky recovery waits for the release. Red on an earlier build: each
// moved a batch's copy, and the remap chain chased it.
test('the pin, the sort and the lucky recovery wait for a purchase that holds the bag',async()=>{
 const {bankHarness,bankSortFloor}=require('./helpers/items-character.cjs');
 const items=[{name:'tracker'},{name:'staff',level:2},null,null];
 const pin=bankHarness({character:{name:'Merchant',ctype:'merchant',items,isize:4},ports:{isTracker:item=>item?.name==='tracker',othersBusy:()=>false,
  swap:async()=>{throw Error('the pin moved a batch copy');}}});
 pin.bag.take('purchasing');
 await pin.bank.keepTracktrixLast();
 assert.equal(items[0].name,'tracker');
 const sort=bankSortFloor({vault:Object.assign(Array(42).fill(null),[{name:'poison',q:5},{name:'helmet',level:0}]),
  G:{items:{helmet:{type:'helmet',g:100},poison:{type:'material',g:10,s:9999}},skills:{}}});
 sort.bag.take('purchasing');
 await sort.bank.sortCurrentBankFloor([]);
 assert.deepEqual(sort.swaps,[]);
 const {productionHarness}=require('./helpers/items-character.cjs');
 const lucky=productionHarness({character:{name:'Merchant',ctype:'merchant',items:[{name:'staff',level:2}],q:{}}});
 lucky.stored['party-lucky-upgrade']={slot:0};
 lucky.bag.take('purchasing');
 let settled=false;
 const recovery=lucky.production.recoverLucky().then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false,'the lucky recovery waits for the purchase');
 lucky.bag.release('purchasing');
 await recovery;
});
// The merchant job owner's ending table books an anniversary hold by its code, whatever text it
// carries.
test('an anniversary hold books J4 row 3 by its code, not its text',()=>{
 const state={merchantQueue:[],merchantJobBlocks:{},statuses:{M:{}},merchantCharacter:'M',npcSaleMarks:[],commands:{}};
 const retries=createCompletionRetries(state,{now:()=>0,nextCommand:()=>1,stamp:j=>j,log(){}});
 const job={id:'j',target:'M',reason:'merchant commerce'};
 assert.equal(retries.decide(job,{success:false,error:'Service paused for anniversary',code:'merchant_anniversary_reserved'}).row.ending,'merchant_anniversary_reserved');
 assert.notEqual(retries.decide(job,{success:false,error:'merchant_anniversary_reserved'}).row?.ending,'merchant_anniversary_reserved','the text alone books nothing');
});
