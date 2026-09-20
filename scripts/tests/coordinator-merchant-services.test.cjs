const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantServices}=require('../../runtime/coordinator/merchant/service-composition.ts');
function fixture(){
 const state={merchantQueue:[],merchantCurrent:null,nextCommandId:7,merchantCharacter:'M',bankbois:{},bankboiTransaction:null,
  commands:{},gatheringModes:[],gatheringCooldowns:{},statuses:{M:{seenAt:100,map:'bank',server:'USII'}},activeRealm:'SR_USII',
  aldata:{key:'fixture'},threshold:100,merchantCargo:{},npcSaleMarks:[],standListings:[],marked:{},upgrades:{},purchases:{},
  compounds:{},autoCompounds:{},withdrawals:{},statScrolls:{},merchantDeliveries:{},goldTargets:{}};
 const calls=[];let storage=null;
 const services=createCoordinatorMerchantServices(state,{
  now:()=>100,ensureHome:()=>true,routineNeedsHome:()=>false,storageBusy:()=>false,
  storagePlan:current=>{assert.equal(current,state);return storage;},startStorage:async()=>calls.push('storage'),
  anniversary:()=>({}),routinePriority:()=>0,priority:()=>1,capacityBlocked:()=>false,collectionReady:()=>true,
  pick:()=>state.merchantQueue.shift(),stamp:job=>job,planPonty:()=>null,restock:()=>({}),persist:()=>calls.push('persist'),log:()=>{},
  inventoryMerge:(current,status)=>{calls.push(['merge',current,status]);return null;},
 });
 return {state,calls,services,setStorage:value=>storage=value};
}
test('dispatch falls through to the composed idle service using current merchant data and the shared sequence',()=>{
 const {state,calls,services}=fixture();
 state.merchantCharacter='N';state.statuses={N:{seenAt:100,map:'bank',server:'EUI'}};state.activeRealm='SR_EUI';
 state.standListings=[{item:{name:'leather'}}];services.dispatcher.dispatch();
 assert.equal(state.commands.N.type,'merchant-idle');assert.equal(state.commands.N.id,7);
 assert.equal(state.commands.N.homeRealm,'SR_EUI');assert.equal(state.commands.N.listings,state.standListings);
 assert.equal(calls[0][1],state);assert.equal(calls[0][2],state.statuses.N);
 delete state.commands.N;state.merchantQueue=[{id:'job',target:'N',reason:'restock'}];services.dispatcher.dispatch();
 assert.equal(state.commands.N.id,8);assert.equal(state.nextCommandId,9);assert.equal(state.merchantCurrent.id,'job');
});
test('storage blocks both idle and dispatch, and dispatch starts storage without consuming queued work',()=>{
 const {state,calls,services,setStorage}=fixture();state.merchantQueue=[{id:'job',target:'M',reason:'restock'}];
 setStorage({requests:['pending']});services.idle.idle();services.dispatcher.dispatch();
 assert.deepEqual(calls,['storage']);assert.deepEqual(state.commands,{});assert.equal(state.nextCommandId,7);
 assert.equal(state.merchantQueue.length,1);assert.equal(state.merchantCurrent,null);
 setStorage(null);services.dispatcher.dispatch();assert.equal(state.merchantCurrent.id,'job');assert.equal(state.commands.M.id,7);
});
