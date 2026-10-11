const test=require('node:test'),assert=require('node:assert/strict');
const {createBankboiStorageRoutes}=require('../../runtime/coordinator/http/bankboi-storage.ts');
const {createBankboiDeleteRoute}=require('../../runtime/coordinator/http/bankboi-delete.ts');
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function fixture(){
 const item={name:'leather',q:7},state={merchantCharacter:'M',bankbois:{bankboi0:{name:'bankboi0',items:[{slot:4,item}],slots:{},gold:0}},
  bankSnapshot:null,bankboiTransaction:{bankboi:'bankboi0'},bankboiQueue:[{id:'done'},{id:'pending'}],commands:{bankboi0:{id:1}},
  standListings:[],npcSaleMarks:[],withdrawals:{M:[]},merchantQueue:[]};
 const calls=[],ports={now:()=>100,identity:item=>item?.name,log:(...args)=>calls.push(['log',...args]),signature:()=> 'blocked',
  adopt:()=>calls.push(['adopt']),persist:()=>calls.push(['persist']),pending:()=>true,restore:async()=>calls.push(['restore'])};
 const routes=createBankboiStorageRoutes(state,ports);
 function send(route,body){const res=response();routes[route]({body},res);return res;}
 return {state,item,ports,calls,send};
}
test('BankBoi completion moves stand and sale references and reconciles ordinary withdrawals',()=>{
 const t=fixture(),request={pack:'bankboi:bankboi0',slot:4,item:t.item};
 t.state.withdrawals.M.push(request);t.state.standListings.push({bankPack:request.pack,bankSlot:4,item:t.item});t.state.npcSaleMarks.push({...request});
 assert.equal(t.send('complete',{character:'Other'}).code,409);
 t.send('complete',{character:'bankboi0',items:[],slots:{},gold:0,bank:{packs:{}},completed:['done'],deposited:[{request,pack:'items2',slot:9,item:t.item}]});
 assert.equal(t.state.withdrawals.M[0].pack,'items2');assert.equal(t.state.standListings[0].bankSlot,9);assert.equal(t.state.npcSaleMarks[0].pack,'items2');
 assert.equal(t.state.commands.bankboi0,undefined);assert.deepEqual(t.state.bankboiQueue,[{id:'pending'}]);
 assert.deepEqual(t.calls.slice(-3),[['adopt'],['persist'],['restore']]);
});

test('an earlier command cannot complete or overwrite a new transaction for the same BankBoi',()=>{
 const t=fixture();t.state.bankboiTransaction.commandId=22;
 assert.equal(t.send('complete',{character:'bankboi0',commandId:21,items:[],completed:['pending']}).code,409);
 assert.equal(t.state.bankbois.bankboi0.items.length,1);assert.equal(t.state.bankboiQueue.length,2);assert.deepEqual(t.calls,[]);
});
test('mail deposits unblock their exact job without leaving a duplicate withdrawal',()=>{
 const t=fixture(),request={mailJobId:'mail',pack:'bankboi:bankboi0',slot:4,item:t.item};
 t.state.withdrawals.M=[request];t.state.merchantQueue=[{id:'mail',mail:{},blockedOnBankboi:true}];
 t.send('complete',{character:'bankboi0',deposited:[{request,pack:'items1',slot:35,item:t.item}]});
 assert.equal(t.state.withdrawals.M.length,0);assert.equal(t.state.merchantQueue[0].blockedOnBankboi,false);assert.equal(t.state.merchantQueue[0].mail.source.slot,35);
});
test('relocated stacks retarget every durable reference and failed completions preserve retry inventory',()=>{
 const t=fixture();t.state.standListings=[{bankPack:'bankboi:bankboi0',bankSlot:4,item:t.item}];
 t.send('complete',{character:'bankboi0',error:'interrupted',relocated:[{pack:'items3',slot:1,item:t.item}]});
 assert.equal(t.state.standListings[0].bankPack,'items3');assert.equal(t.state.bankbois.bankboi0.state,'error');assert.equal(t.state.bankbois.bankboi0.retryAt,10100);
 assert.equal(t.state.bankbois.bankboi0.items[0].item.q,7);assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,null);
});
test('only an explicit successful empty unload report records a blocked storage signature',()=>{
 const t=fixture();t.send('complete',{character:'bankboi0'});assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,null);
 t.send('complete',{character:'bankboi0',relocated:[]});assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,'blocked');
 assert.equal(t.send('checkpoint',{character:'M',bank:{}}).code,400);
 assert.equal(t.send('checkpoint',{character:'M',bank:{packs:{}}}).body.pending,true);
});
test('BankBoi deletion refuses stored assets, cooldown and pending work; requires roster confirmation',async()=>{
 const t=fixture();let requested=0,owned=true;
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{requested++;return {ok:true,payload:{},statusText:'OK'};},refresh:async()=>{},owned:()=>owned,persist(){}});
 const send=async()=>{const res=response();await route({params:{name:'bankboi0'}},res);return res;};
 assert.equal((await send()).code,409);t.state.bankbois.bankboi0.items=[];
 assert.equal((await send()).code,409);t.state.bankboiTransaction=null;
 t.state.bankbois.bankboi0.createdAt=1;assert.equal((await send()).code,409);assert.equal(requested,0);
 delete t.state.bankbois.bankboi0.createdAt;assert.equal((await send()).code,502);assert.ok(t.state.bankbois.bankboi0);
 owned=false;assert.equal((await send()).body.ok,true);assert.equal(t.state.bankbois.bankboi0,undefined);
});

test('externally deleted BankBoi clears stale local storage only after refreshing its roster',async()=>{
 const t=fixture(),calls=[];let owned=true;
 t.state.bankbois.bankboi0.slots={mainhand:{name:'broom'}};
 t.state.bankbois.bankboi0.gold=500;t.state.bankbois.bankboi0.createdAt=1;
 t.state.bankboiQueue.push({bankboi:'bankboi0'});
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{calls.push('delete');throw Error('must not delete again');},
  refresh:async()=>{calls.push('refresh');owned=false;},owned:()=>{calls.push('owned');return owned;},persist:()=>calls.push('persist')});
 const res=response();await route({params:{name:'bankboi0'}},res);
 assert.equal(res.code,200);assert.deepEqual(res.body,{ok:true,alreadyDeleted:true});
 assert.equal(t.state.bankbois.bankboi0,undefined);assert.deepEqual(calls,['refresh','owned','persist']);
});

test('failed initial BankBoi roster refresh preserves stale entry and never deletes or persists',async()=>{
 const t=fixture(),entry=t.state.bankbois.bankboi0,calls=[];
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{calls.push('delete');},
  refresh:async()=>{calls.push('refresh');throw Error('account unavailable');},owned:()=>false,persist:()=>calls.push('persist')});
 const res=response();await route({params:{name:'bankboi0'}},res);
 assert.equal(res.code,502);assert.equal(res.body.error,'account unavailable');
 assert.equal(t.state.bankbois.bankboi0,entry);assert.deepEqual(calls,['refresh']);
});

test('owned empty BankBoi deletion refreshes before guards and confirms native deletion afterward',async()=>{
 const t=fixture(),calls=[];let owned=true;
 t.state.bankbois.bankboi0.items=[];t.state.bankboiTransaction=null;
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{calls.push('delete');owned=false;return {ok:true,statusText:'OK',payload:{}};},
  refresh:async()=>calls.push('refresh'),owned:()=>owned,persist:()=>calls.push('persist')});
 const res=response();await route({params:{name:'bankboi0'}},res);
 assert.equal(res.code,200);assert.deepEqual(res.body,{ok:true});
 assert.deepEqual(calls,['refresh','delete','refresh','persist']);
});

test('unknown BankBoi deletion remains 404 without refreshing or mutating account',async()=>{
 const t=fixture(),calls=[];
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>calls.push('delete'),refresh:async()=>calls.push('refresh'),owned:()=>false,persist:()=>calls.push('persist')});
 const res=response();await route({params:{name:'missing'}},res);
 assert.equal(res.code,404);assert.deepEqual(calls,[]);
});

test('repeated command completion receipts restore the merchant only once',()=>{
 const t=fixture();const body={character:'bankboi0',commandId:10,items:[]};
 t.send('complete',body);t.state.bankboiTransaction=null;
 assert.equal(t.send('complete',body).body.duplicate,true);
 assert.equal(t.calls.filter(c=>c[0]==='restore').length,1);
});
