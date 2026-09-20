const test=require('node:test'),assert=require('node:assert/strict');
const {createDeconstruction}=require('../../runtime/coordinator/merchant/deconstruction.ts');
const {receiveBankDeconstruction}=require('../../runtime/coordinator/merchant/bank-deconstruction.ts');
const {createStorageReferenceUpdates}=require('../../runtime/coordinator/inventory/bankboi-completion.ts');
function fixture(){
 let id=0;const calls=[],item={name:'ring',level:2,stat_type:'int'};
 const state={merchantCharacter:'M',deconstructionMarks:[],deconstructionCatalog:{ring:{compound:true}},autoDeconstruction:{},merchantMarked:{},
 statuses:{M:{seenAt:20000,items:[]}},merchantCurrent:null,withdrawals:{},bankSnapshot:{packs:{items0:[{slot:0,item}],items1:[{slot:0,item:{...item,q:2}}]}},
 bankbois:{B:{items:[{slot:0,item},{slot:1,item:{...item,stat_type:'str'}},{slot:2,item:{...item,l:true}}]}}};
 const ports={now:()=>20000,next:()=>++id,persist:()=>calls.push('persist'),persistBank:()=>calls.push('bank'),owned:()=>true,
 queue:(names,reason)=>calls.push(reason),bankService:()=>calls.push('bankboi'),reserved:()=>false,log(){}};
 const service=createDeconstruction(state,ports);
 const send=body=>{let code=200,result;service.mark({body},{status(n){code=n;return this},json(v){result=v;return v}});return{code,...result}};
 return{state,service,send,item,calls};
}
test('bank mark creates a single durable withdrawal and never enables an auto rule',()=>{
 const f=fixture(),body={pack:'items0',slot:0,item:f.item};
 assert.equal(f.send(body).added,1);assert.equal(f.send(body).added,0);
 assert.equal(f.state.deconstructionMarks[0].state,'withdrawing');
 assert.deepEqual(f.state.autoDeconstruction,{});assert.ok(f.calls.includes('bank'));
 f.state.statuses.M.items=[{slot:4,item:f.item}];f.service.reconcile('M');
 assert.equal(f.state.deconstructionMarks[0].state,'withdrawing');
 receiveBankDeconstruction(f.state,'Other',f.state.withdrawals.M,20000);
 assert.equal(f.state.deconstructionMarks[0].state,'withdrawing');
 receiveBankDeconstruction(f.state,'M',f.state.withdrawals.M,20000);f.service.reconcile('M');
 assert.equal(f.state.deconstructionMarks[0].state,'ready');assert.equal(f.state.deconstructionMarks[0].slot,4);
 assert.ok(f.calls.includes('deconstruction'));
});
test('mark all snapshots matching unlocked copies across bank panes and bankbois',()=>{
 const f=fixture();assert.equal(f.send({pack:'items0',slot:0,item:f.item,all:true}).added,3);
 assert.equal(f.state.deconstructionMarks.reduce((sum,mark)=>sum+mark.quantity,0),4);
 assert.ok(f.calls.includes('bankboi'));assert.ok(f.calls.includes('manual bank exchange'));
 assert.deepEqual(f.state.autoDeconstruction,{});
});
test('bankboi staging preserves deconstruction receipt identity',()=>{
 const f=fixture();f.send({pack:'bankboi:B',slot:0,item:f.item});
 const request=f.state.withdrawals.M[0];
 const updates=createStorageReferenceUpdates({...f.state,standListings:[],npcSaleMarks:[],merchantQueue:[]},item=>JSON.stringify(item));
 updates.deposited([{request,pack:'items2',slot:3,item:f.item}]);
 assert.equal(f.state.withdrawals.M[0].deconstructionId,request.deconstructionId);
 assert.equal(f.state.withdrawals.M[0].pack,'items2');
 receiveBankDeconstruction(f.state,'M',f.state.withdrawals.M,20000);
 assert.equal(f.state.deconstructionMarks[0].state,'ready');
});
test('stale/locked bank selections reject and cancellation releases the withdrawal',()=>{
 const f=fixture();assert.equal(f.send({pack:'items0',slot:0,item:{name:'ring',level:3}}).code,409);
 assert.notEqual(f.send({pack:'bankboi:B',slot:2,item:{...f.item,l:true}}).code,200);
 f.send({pack:'items0',slot:0,item:f.item});
 const id=f.state.deconstructionMarks[0].id;
 f.send({character:'M',id,remove:true});assert.deepEqual(f.state.withdrawals.M,[]);
 assert.equal(f.state.deconstructionMarks.length,0);
});
test('stale withdrawal cleanup never authorizes destroying a matching merchant item',()=>{
 const f=fixture();f.send({pack:'items0',slot:0,item:f.item});
 const request=f.state.withdrawals.M[0];
 receiveBankDeconstruction(f.state,'M',[{...request,deconstructionMissing:true}],20000);
 f.state.statuses.M.items=[{slot:4,item:f.item}];f.service.reconcile('M');
 assert.equal(f.state.deconstructionMarks[0].state,'blocked');assert.deepEqual(f.state.withdrawals.M,[]);
 assert.equal(f.send({character:'M',id:request.deconstructionId,retry:true}).code,409);
});
