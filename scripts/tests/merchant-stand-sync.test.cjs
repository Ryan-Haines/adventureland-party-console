const {withRunner}=require('./helpers/merchant-runner.cjs');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const { productionHarness, marketHarness, planted } = require('./helpers/items-character.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
// The stand return and the stand sync are the job owner's runner over the items owner's stand
// (market.ts `stand`, which the runner reads as partyItems.stand) and the items owner's lucky recovery
// (production.ts recoverLucky), all over one character and one request log.
function fixture(){
 const calls=[],ports={request:async(path,args)=>{calls.push({path,...args.body});return {};}};
 const character={name:'M',ctype:'merchant',map:'main',x:0,y:0,stand:true,slots:{},items:[{name:'pants'},null,null,null]};
 const c=withRunner(createMovementContext({root:{__merchantHolder:{kind:'job',jobId:'job'}},runtimeCurrent:()=>true,lastCommand:5,
 character,merchantMarketLocation:{map:'main',x:0,y:0},merchantHomeRealm:'SR_USII',parent:{server_region:'US',server_identifier:'II'},
 tidyLuckySlot:async()=>{},
 gatheringMode:null,gatheringGeneration:0,gatheringTimer:null,gatheringSession:null,stop:async()=>{},
 fingerprint:i=>i,game_log(){},
 request:(...args)=>ports.request(...args)}));
 const job=()=>c.root.__merchantHolder&&{jobId:c.root.__merchantHolder.jobId,commandId:5};
 const production=productionHarness({character,ports:{job,request:(...args)=>ports.request(...args)}});
 const market=marketHarness({character,game:{
   trade:async(slot,tradeSlot,price)=>{character.slots[tradeSlot]={...character.items[slot],price};character.items[slot]=null;},
   openStand:async()=>{character.stand=true;},closeStand:async()=>{character.stand=false;}},
  ports:{production:planted({luckySlot:()=>null,verifyMarks:production.production.verifyMerchantItemMarks}),
   request:(...args)=>ports.request(...args)}});
 c.partyItems={stand:market.market.stand};
 c.recoverLuckyUpgrade=production.production.recoverLucky;
 require('./helpers/merchant-hop.cjs').installHop(c);
 // The stand point is the reply's; the character stands on it.
 c.merchantRunner.standReply({merchantStandLocation:{map:'main',x:0,y:0}});
 c.merchantStandSync=command=>c.merchantRunner.standSync(command);c.merchantIdle=command=>c.merchantRunner.holdStand(command);
 return {c,calls,ports,production,market};
}
test('stand sync passes active ownership, performs listing, and reconciles before completion',async()=>{
 const {c,calls}=fixture();await c.merchantStandSync({id:5,jobId:'job',listings:[{id:'pants',slot:0,item:{name:'pants'},price:10}]});
 assert.equal(c.character.slots.trade1.name,'pants');const checkpoint=calls.find(call=>call.path==='/merchant/checkpoint');assert.equal(checkpoint.protectionOnly,true);assert.equal(checkpoint.jobId,'job');const status=calls.find(call=>call.path==='/merchant/idle-status');assert.equal(status.commandId,5);assert.equal(status.liveListings[0].id,'pants');assert.equal(calls.at(-1).success,true);
});
test('skipped and deferred stand sync cannot claim success',async()=>{
 for(const deferred of [false,true]){const {c,calls,production}=fixture();if(deferred){c.bag=production.bag;c.bag.take('previewing');}else c.root.__merchantHolder.jobId='other';
 await assert.rejects(c.merchantStandSync({id:5,jobId:'job',listings:[]}),/did not execute/);assert.equal(calls.at(-1).success,false);assert.equal(calls.some(x=>x.success===true),false);}
});
test('blocked stand work waits for relevant changes while unrelated crafting inventory changes do not retrigger it',()=>{
 const {createMerchantQueue}=require('../../runtime/merchant-jobs/coordinator/owner.ts');const {standSyncSignature}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const listings=[{id:'pants',state:'waiting',item:{name:'pants'}}],items=[{item:{name:'pants'}},{item:{name:'fur',q:10}}];const state={queue:[],current:null,blocks:{}};
 const ports={merchant:()=> 'M',hasPendingStandInventory:()=>true,standInventorySignature:()=>standSyncSignature('M',listings,items),stamp:j=>j,nextId:()=> 'j',now:()=>1,persist(){},dispatch(){}};
 const queue=createMerchantQueue(state,ports);assert.equal(queue.localStandSync(),true);state.queue=[];assert.equal(queue.localStandSync(),false);items[1].item.q--;assert.equal(queue.localStandSync(),false);
 listings.push({id:'sold',state:'live',tradeSlot:'trade1',item:{name:'hat'}});assert.equal(queue.localStandSync(),true);
});

// A placeholder in the bag keeps the half-done lucky swap's recovery waiting until it gives up.
test('lucky recovery failure allows arrival and opening, but no stand or inventory mutations',async()=>{
 const {c,calls,production}=fixture();delete c.root.__merchantHolder;c.character.map='bank';c.character.stand=false;
 c.merchantTownReturn=async()=>{c.character.map='main';};
 c.smart_move=async()=>{};
 c.character.items[3]={name:'placeholder'};
 production.stored['party-lucky-upgrade']={from:0,to:1,item:{name:'sword',level:3},displaced:null,phase:'running'};
 const result=await c.merchantIdle({id:5,listings:[{id:'pants',slot:0,item:{name:'pants'},price:10}]});
 assert.equal(result.state,'deferred');assert.equal(c.character.map,'main');assert.equal(c.character.stand,true);
 assert.deepEqual(calls.filter(c=>c.phase).map(c=>c.phase),['returning','arrived','inventory-recovery']);
 assert.equal(c.character.items[0].name,'pants');assert.deepEqual(c.character.slots,{});
});

// production.ts prepareCommand: a stand return skips the recovery before dispatch; another command
// defers on the half-done lucky swap's recovery failure.
test('stand-return commands bypass pre-dispatch recovery; other commands still require it',async()=>{
 for(const type of ['merchant-idle','equip']) {
   const reports=[];
   const h=productionHarness({character:{name:'M',ctype:'merchant',items:[null,null,{name:'placeholder'}]},ports:{runnerHolds:()=>false,
    request:async()=>({pending:[]}),reportCommand:(_command,state,reason)=>reports.push({state,reason})}});
   h.stored['party-lucky-upgrade']={from:0,to:1,item:{name:'sword',level:3},displaced:null,phase:'running'};
   h.production.lucky();
   const ready=await h.production.prepareCommand({type});
   assert.equal(ready,type==='merchant-idle');
   assert.deepEqual(reports.map(r=>r.state),type==='merchant-idle'?[]:['deferred']);
 }
});

test('optional tidy failure reports recovery without claiming the stand return failed',async()=>{
 const {c,calls}=fixture();delete c.root.__merchantHolder;c.luckyUpgradeSlot=7;
 c.tidyLuckySlot=async()=>{throw Error('displaced item changed');};
 const result=await c.merchantIdle({id:5,listings:[]});
 assert.equal(result.state,'complete');
 assert.deepEqual(calls.filter(c=>c.phase).map(c=>c.phase),['arrived','inventory-recovery','complete']);
});

// market.ts standSyncReply: the open stand syncs only while no lucky swap holds the bag.
test('background native stand synchronization waits for lucky-slot recovery',async()=>{
 let lucky=true;
 const h=marketHarness({character:{name:'M',ctype:'merchant',stand:true,slots:{},items:[]},ports:{
  merchant:planted({standReturning:()=>false,holder:()=>null}),production:planted({luckySlot:()=>null}),request:async()=>({})}});
 h.bag.connect({freeCells:()=>0,lucky:()=>lucky,map:()=>'main',merchant:()=>true,name:()=>'M'});
 assert.equal(h.market.standSyncReply(),undefined);
 lucky=false;const sync=h.market.standSyncReply();
 assert.ok(sync);await sync;
});
