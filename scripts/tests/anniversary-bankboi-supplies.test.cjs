const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const routing=require('../bank-stack-routing.cjs');
const {inventoryCounts}=require('../../.build/shared/account-inventory.cjs');
function fixture(){
 const item={name:'slice_citrus',q:281};
 const party={merchantCharacter:'M',statuses:{M:{items:[]}},withdrawals:{},bankbois:{bankboi0:{name:'bankboi0',state:'ready',items:[{slot:21,item}]}},bankSnapshot:{packs:{items1:Array(42).fill(null)}},bankboiQueue:[]};
 let handler;const logs=[];
 const c=vm.createContext({party,ANNIVERSARY_SLICES:['slice_citrus','slice_strawberry'],anniversaryCounts:()=>inventoryCounts(Object.values(party.statuses),party.bankSnapshot,Object.values(party.bankbois)),persistBankState(){},merchantLog:(...args)=>logs.push(args),express_inst:{post:(_,fn)=>handler=fn}});
 handler=require('../../runtime/coordinator/http/anniversary-supplies.ts').createAnniversarySuppliesRoute(party,
  {counts:c.anniversaryCounts,persist:c.persistBankState,log:c.merchantLog});
 function request(missing,character='M'){const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body:{character,missing}},res);return res;}
 return {party,request,logs};
}
test('offline bankboi citrus is queued through shared storage routing exactly once',()=>{
 const t=fixture();assert.deepEqual(Array.from(t.request(['slice_citrus']).body.pending),['slice_citrus']);
 t.request(['slice_citrus']);assert.equal(t.party.withdrawals.M.length,1);assert.equal(t.logs.length,1);
 const plan=routing.servicePlan(t.party);assert.equal(plan.candidate.name,'bankboi0');assert.equal(plan.retrievals[0].slot,21);assert.equal(plan.retrievals[0].item.q,281);
});
test('staged ingredient remains pending rather than creating another bankboi request',()=>{
 const t=fixture();t.party.withdrawals.M=[{pack:'items1',slot:35,item:{name:'slice_citrus',q:281}}];
 assert.equal(t.request(['slice_citrus']).body.pending.length,1);assert.equal(t.party.withdrawals.M.length,1);assert.equal(t.logs.length,0);
});
test('unavailable slices are distinguished from queued supplies and invalid requests are rejected',()=>{
 const t=fixture(),res=t.request(['slice_citrus','slice_strawberry']);
 assert.deepEqual(Array.from(res.body.missing),['slice_strawberry']);assert.equal(res.body.pending.length,1);
 assert.equal(t.request(['sword']).code,400);assert.equal(t.request(['slice_citrus'],'Other').code,400);assert.equal(t.party.withdrawals.M.length,1);
});
