const test=require('node:test'),assert=require('node:assert/strict');
const {createPartyActionRoutes}=require('../../runtime/coordinator/http/party-actions.ts');
const {routineEnabled}=require('../../runtime/coordinator/merchant/routines.ts');
test('Send to party survives disabled automation and upgrades duplicate requests to manual',()=>{
 const state={leader:'P',followers:{F:true},merchantCharacter:'M',statuses:{P:{server:'USII'},F:{server:'USII'}},merchantCurrent:null,merchantQueue:[]};
 let id=0,dispatched=0;
 const routes=createPartyActionRoutes(state,{active:()=>['P','F','M'],now:()=>1000,nextCommand:()=>++id,persist(){},dispatch(){state.merchantQueue=state.merchantQueue.filter(j=>routineEnabled(j,{'party collection':false}));dispatched++;}});
 let reply;const res={status(n){throw Error('HTTP '+n);},json(v){reply=v;}};
 routes.bank({body:{}},res);assert.equal(reply.ok,true);assert.equal(state.merchantQueue.length,2);
 assert.ok(state.merchantQueue.every(j=>j.manual));state.merchantQueue[0].manual=false;
 routes.bank({body:{}},res);assert.equal(state.merchantQueue.length,2);assert.ok(state.merchantQueue.every(j=>j.manual));assert.equal(dispatched,2);
 assert.equal(routineEnabled({reason:'marked items'},{'party collection':false}),false);
});
