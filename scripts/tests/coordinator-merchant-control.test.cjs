const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {createMerchantControlRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createMerchantRequestRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
// The production port: an automation is a key of the default switches (application.ts DEFAULT_MERCHANT_AUTOMATIONS).
const {defaultMerchantAutomations}=require('../../runtime/merchant-jobs/rules.ts');
function fixture(){
 const state={merchantCharacter:'M',activeRealm:'SR_USI',merchantQueue:[],merchantCurrent:null,commands:{},merchantAutomations:{},autoExchanges:{a:{name:'a',level:0},b:{name:'b',level:0}},gatheringModes:['fishing'],statuses:{M:{}},merchantCatalog:{allItems:[{id:'cap'}]}};
 for(const key of ['marked','merchantMarked','statScrolls','upgrades','compounds','autoCompounds'])state[key]={F:['intent']};
 const calls=[],ports={now:()=>100,nextCommand:()=>1,stamp:j=>({...j,priority:50}),automated:r=>r in defaultMerchantAutomations(),log:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),realm:{want:(...args)=>{calls.push(['home',...args]);return 'moving';},release:()=>calls.push('release'),retry:()=>calls.push('retry')},realmLabel:r=>r,realmExists:r=>r==='SR_USII',write:settingsWriter(state).write};
 const routes={...createMerchantControlRoutes(state,ports),...createMerchantRequestRoutes(state,withDoor(state,ports))};
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};routes[route]({body},res);return res;}
 return {state,calls,send};
}
test('cancel clears only the matching work intent and never dispatches',()=>{
 for(const [reason,cleared] of [['marked items',['marked','merchantMarked']],['stat scrolls',['statScrolls','upgrades','compounds']],['auto compound',['autoCompounds']]]){
  const f=fixture();f.state.merchantQueue=[{id:'j',target:'F',reason}];assert.equal(f.send('cancel',{id:'j'}).code,200);
  for(const key of cleared)assert.deepEqual(f.state[key].F,[]);assert.equal(f.calls.includes('dispatch'),false);
 }
 const f=fixture();f.state.merchantQueue=[{id:'j',target:'M',reason:'exchange',autoExchangeKeys:['a']}];f.send('cancel',{id:'j'});
 assert.equal(f.state.autoExchanges.a,undefined);assert.ok(f.state.autoExchanges.b);assert.equal(f.state.merchantAutomations['automatic exchange'],false);assert.equal(f.state.merchantAutomations['manual exchange'],undefined);
 assert.equal(f.send('cancel',{id:'missing'}).code,404);
});

test('cancelling a delivery job disables automatic trips without deleting marks',()=>{
 const mark={id:'d',item:{name:'ring'}},f=fixture();
 Object.assign(f.state,{merchantQueue:[{id:'j',target:'P',reason:'deliveries'}],merchantAutomations:{deliveries:true},merchantDeliveries:{P:[mark]}});
 assert.equal(f.send('cancel',{id:'j'}).code,200);
 assert.equal(f.state.merchantAutomations.deliveries,false);assert.deepEqual(f.state.merchantDeliveries.P,[mark]);
});

// The settings write goes before any record change, so a refused write cancels nothing.
test('a refused cancel write leaves the job, its marks and its automation',()=>{
 const state={merchantCharacter:'M',merchantQueue:[{id:'j',target:'F',reason:'auto compound'}],merchantAutomations:{'auto compound':true},
  autoExchanges:{},autoCompounds:{F:['intent']},marked:{},merchantMarked:{},statScrolls:{},upgrades:{},compounds:{}};
 const routes=createMerchantControlRoutes(state,{now:()=>100,nextCommand:()=>1,stamp:j=>j,log(){},persist(){},dispatch(){},
  automated:r=>r in defaultMerchantAutomations(),write:()=>({ok:false,error:'refused'}),realm:{},realmLabel:r=>r});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;}};routes.cancel({body:{id:'j'}},res);
 assert.equal(res.code,400);assert.deepEqual(state.merchantQueue.map(job=>job.id),['j']);
 assert.deepEqual(state.autoCompounds.F,['intent']);assert.equal(state.merchantAutomations['auto compound'],true);
});
test('cancelling either upgrade routine preserves the other upgrade intent',()=>{
 for(const reason of ['auto upgrade','manual upgrades']) {
  const f=fixture();f.state.upgrades.F=[{id:'manual'},{id:'auto',auto:true}];
  f.state.merchantQueue=[{id:'j',target:'F',reason}];f.send('cancel',{id:'j'});
  assert.deepEqual(f.state.upgrades.F,reason==='auto upgrade'?[{id:'manual'}]:[{id:'auto',auto:true}]);
  if(reason==='auto upgrade') {assert.equal(f.state.merchantAutomations['auto upgrade'],false);assert.deepEqual(f.state.statScrolls.F,['intent']);}
  else assert.deepEqual(f.state.statScrolls.F,[]);
 }
});
test('force stand retains durable work, clears execution fields, and resumes without discarding queue',()=>{
 const f=fixture();f.state.merchantCurrent={id:'j',target:'F',reason:'merchant commerce',phase:'travel',startedAt:1,heartbeatAt:2,handoff:{},resumeState:{pass:8},queuedAt:25};
 f.state.commands.M={id:4,type:'merchant-service'};f.send('force',{enabled:true});
 const saved=f.state.merchantQueue[0];assert.deepEqual(saved.resumeState,{pass:8});assert.equal(saved.queuedAt,25);assert.equal(saved.phase,undefined);assert.equal(saved.handoff,undefined);
 assert.equal(f.state.merchantCurrent,null);assert.equal(f.state.commands.M,undefined);assert.ok(f.calls.some(c=>Array.isArray(c)&&c[0]==='home'));
 f.state.commands.M={type:'merchant-idle'};f.send('force',{enabled:false});assert.equal(f.state.commands.M,undefined);assert.equal(f.state.merchantQueue.length,1);assert.ok(f.calls.includes('dispatch'));
});
test('clear stops merchant gathering and removes current recipient command',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',target:'F'};f.state.commands.F={type:'merchant-handoff',jobId:'job'};f.send('clear');
 assert.equal(f.state.commands.F,undefined);assert.deepEqual(f.state.commands.M,{id:1,type:'merchant-gather',mode:null});assert.deepEqual(f.state.gatheringModes,[]);
});
test('donation, search and giveaway validate before queueing and retain their scheduling rules',()=>{
 const f=fixture();assert.equal(f.send('donate',{amount:0}).code,400);assert.equal(f.send('search',{itemId:'bad'}).code,400);assert.equal(f.send('giveaway',{seller:'Seller',realm:'PVP'}).code,400);assert.deepEqual(f.state.merchantQueue,[]);
 assert.equal('xp' in f.send('donate',{amount:10}).body,false);f.state.merchantQueue=[];
 f.state.statuses.M.donationXpPerGold=3.2;assert.equal(f.send('donate',{amount:10}).body.xp,32);assert.equal(f.state.merchantQueue[0].priority,50);
 f.send('giveaway',{seller:' Seller ',realm:'us ii'});assert.equal(f.state.merchantQueue[1].realm,'SR_USII');assert.equal(f.state.merchantQueue[1].priority,50);
 f.send('search',{itemId:'cap'});assert.deepEqual(f.state.standSearch,{status:'searching',itemId:'cap',listings:[],error:null});
});

// and: `jobs.command` is the slot's one writer.
test('a gather write during a job and an old job write leave the running job command', () => {
  const {merchantSlotCommand} = require('../../runtime/merchant-jobs/coordinator/owner.ts');
  const job = { id: 'j2', reason: 'manual upgrades' }, command = { id: 5, type: 'merchant-self-improve', jobId: 'j2' };
  const state = { merchantCharacter: 'M', merchantCurrent: job, commands: { M: command } };
  assert.equal(merchantSlotCommand(state, 'gather', { id: 6, type: 'merchant-gather', modes: ['fishing'] }), 'refused');
  assert.equal(merchantSlotCommand(state, 'job:j1', null), 'refused');
  assert.equal(state.commands.M, command);
  state.merchantCurrent = null;
  assert.equal(merchantSlotCommand(state, 'gather', { id: 7, type: 'merchant-gather', modes: [] }), 'written');
  assert.equal(state.commands.M.id, 7);
});
test('an equip during a job waits for its checkpoint, then takes the slot; with no job it goes at once', () => {
  const {merchantSlotCommand,manualCommandHeld,manualCommandPending,pauseMerchantJob} = require('../../runtime/merchant-jobs/coordinator/owner.ts');
  const job = { id: 'j', reason: 'manual upgrades', phase: 'processing', commandId: 5 }, command = { id: 5, type: 'merchant-self-improve', jobId: 'j' };
  const state = { merchantCharacter: 'M', merchantCurrent: job, merchantQueue: [], commands: { M: command } };
  const equip = { id: 9, type: 'equip', item: { name: 'blade' } };
  assert.equal(merchantSlotCommand(state, 'manual:equip', equip), 'held');
  assert.equal(state.commands.M, command);
  assert.equal(manualCommandHeld(state), true);
  const paused = pauseMerchantJob(state, job, 'checkpoint');
  assert.equal(paused.phase, undefined);
  assert.equal(state.merchantCurrent, null);
  assert.equal(state.commands.M, equip);
  assert.equal(manualCommandPending(state), true);
  const idle = { merchantCharacter: 'M', merchantCurrent: null, commands: {} };
  assert.equal(merchantSlotCommand(idle, 'manual:unequip', { id: 3, type: 'unequip', slot: 'mainhand' }), 'written');
});
