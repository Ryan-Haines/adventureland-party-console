const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorAnniversaryActions}=require('../../runtime/coordinator/http/anniversary-actions.ts');
const {anniversarySlices:slices}=require('../../runtime/coordinator/anniversary/contracts.ts');
function fixture(){
 const anniversary={rounds:{},abortedRounds:{},attempts:{},nativeSlice:slices[0],eventCycle:null,
  advertisedRounds:{},chatAdvertisement:null,reciprocal:{},pendingReturns:{},crafted:0};
 const state={anniversary,merchantCharacter:'M',leader:'P',nextCommandId:40,statuses:{},withdrawals:{},
  monsterHunt:null,activeConvoy:null,location:{map:'main',x:1,y:2},bankbois:{}};
 const calls=[],intent={revision:4};
 const routes=createCoordinatorAnniversaryActions(state,{
  now:()=>100000,owned:name=>['P','M','N'].includes(name),enabled:(...args)=>{calls.push(['enabled',...args]);return true;},intent:()=>intent,
  snapshot:()=>({live:{round:'r',target:'Friend'},message:'offer',chatMessage:'slices',tradableNative:2,counts:{}}),
  abort:()=>({}),log:()=>{},persist:()=>calls.push('settings'),scheduleReturn:()=>calls.push('return'),
  huntOwns:hunt=>{calls.push(['hunt',hunt]);return !!hunt?.turnIn;},supersede:cycle=>calls.push(['supersede',cycle]),
  cancelConvoy:()=>calls.push('cancel'),fallback:location=>location,participants:()=>['P'],capture:()=>({}),
  identity:(_owner,sender)=>sender,alreadyTraded:()=>false,publish:()=>calls.push('publish'),
  counts:()=>({[slices[1]]:2}),persistBank:()=>calls.push('bank'),merchantLog:()=>{},
 });
 function send(handler,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,anniversary,calls,intent,routes,send};
}
test('anniversary actions share current revisions and preserve Hunt and convoy travel ownership',()=>{
 const {state,anniversary,calls,intent,routes,send}=fixture();intent.revision=8;
 assert.equal(send(routes.visits.attempt,{character:'P',round:'r',target:'Friend',navigationRevision:4}).code,409);
 assert.equal(send(routes.visits.attempt,{character:'P',round:'r',target:'Friend',navigationRevision:8}).body.attempt,1);
 assert.deepEqual(calls[0],['enabled','P','anniversary']);
 state.monsterHunt={turnIn:true};
 assert.equal(send(routes.navigation.preempt,{character:'P',navigationRevision:8}).body.huntTurnIn,true);
 assert.equal(calls.find(call=>Array.isArray(call)&&call[0]==='hunt')[1],state.monsterHunt);
 state.monsterHunt=null;state.activeConvoy={id:'new',purpose:'event-return'};
 assert.equal(send(routes.navigation.preempt,{character:'P',navigationRevision:8}).body.alreadyReturning,true);
 state.activeConvoy={id:'farm',purpose:'farm-relocation'};
 assert.equal(send(routes.navigation.preempt,{character:'P',navigationRevision:8}).body.cancelled,true);
 anniversary.eventCycle={id:'r'};calls.length=0;
 assert.equal(send(routes.navigation.ready,{character:'P',round:'r',navigationRevision:8}).code,200);
 assert.deepEqual(calls,['settings','return']);
});
test('anniversary commerce uses the shared counter and supplies follow the current merchant with bank persistence',()=>{
 const {state,anniversary,calls,routes,send}=fixture();state.merchantCharacter='N';state.nextCommandId=90;
 send(routes.commerce.chat);assert.equal(anniversary.chatAdvertisement.id,'anniversary-chat-100000-90');
 assert.equal(state.nextCommandId,91);send(routes.commerce.chat);assert.equal(state.nextCommandId,91);
 state.bankbois={B:{name:'B',items:[{slot:5,item:{name:slices[1],q:2}}]}};calls.length=0;
 assert.equal(send(routes.supplies,{character:'M',missing:[slices[1]]}).code,400);
 assert.deepEqual(send(routes.supplies,{character:'N',missing:[slices[1]]}).body.pending,[slices[1]]);
 assert.deepEqual(state.withdrawals.N,[{pack:'bankboi:B',slot:5,item:{name:slices[1],q:2}}]);
 assert.deepEqual(calls,['bank']);
});
