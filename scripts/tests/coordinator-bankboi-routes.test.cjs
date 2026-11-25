const test=require('node:test'),assert=require('node:assert/strict');
const {createBankboiStorageRoutes}=require('../../runtime/items/coordinator/storage.ts');
const {createBankboiDeleteRoute}=require('../../runtime/items/coordinator/routes/characters.ts');
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function fixture(){
 const item={name:'leather',q:7},state={merchantCharacter:'M',bankbois:{bankboi0:{name:'bankboi0',items:Object.assign(Array(42).fill(null),{4:{slot:4,item}}),slots:{},gold:0}},
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
 // The snapshot writer persists after adopting and the completion persists again before the restore.
 const order=t.calls.map(call=>call[0]),adopted=order.indexOf('adopt');
 assert.ok(adopted>=0&&order.indexOf('persist',adopted)>adopted);assert.equal(order.at(-1),'restore');
});

test('an earlier command cannot complete or overwrite a new transaction for the same BankBoi',()=>{
 const t=fixture();t.state.bankboiTransaction.commandId=22;
 assert.equal(t.send('complete',{character:'bankboi0',commandId:21,items:[],completed:['pending']}).code,409);
 assert.equal(t.state.bankbois.bankboi0.items[4].item,t.item);assert.equal(t.state.bankboiQueue.length,2);assert.deepEqual(t.calls,[]);
});
test('mail deposits unblock their exact job without leaving a duplicate withdrawal',()=>{
 const t=fixture(),request={mailJobId:'mail',pack:'bankboi:bankboi0',slot:4,item:t.item};
 t.state.withdrawals.M=[request];t.state.merchantQueue=[{id:'mail',mail:{},blockedOnBankboi:true}];
 t.send('complete',{character:'bankboi0',deposited:[{request,pack:'items1',slot:35,item:t.item}]});
 assert.equal(t.state.withdrawals.M.length,0);assert.equal(t.state.merchantQueue[0].blockedOnBankboi,false);assert.equal(t.state.merchantQueue[0].mail.source.slot,35);
});
test('relocated stacks retarget every durable reference and failed completions preserve retry inventory',()=>{
 const t=fixture();t.state.standListings=[{bankPack:'bankboi:bankboi0',bankSlot:4,item:t.item}];
 t.send('complete',{character:'bankboi0',error:'interrupted',code:'interrupted',relocated:[{pack:'items3',slot:1,item:t.item}]});
 assert.equal(t.state.standListings[0].bankPack,'items3');assert.equal(t.state.bankbois.bankboi0.state,'error');assert.equal(t.state.bankbois.bankboi0.code,'interrupted');
 assert.equal(t.state.bankbois.bankboi0.items[4].item.q,7);assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,null);
});
// A manual compound selected after the worker planned its unload follows the cell it emptied, with
// its withdrawal, and the jobs are saved.
test('a relocation moves a manual compound selection and its withdrawal and saves the jobs',()=>{
 const t=fixture(),cell={pack:'bankboi:bankboi0',slot:4};t.ports.persistJobs=()=>t.calls.push(['jobs']);
 t.state.compounds={M:[{items:[{item:t.item,storage:{...cell}}]}]};t.state.withdrawals.M=[{...cell,item:t.item,improvement:'manual compounds'}];
 t.send('complete',{character:'bankboi0',relocated:[{sourceSlot:4,pack:'items3',slot:1,item:t.item}]});
 assert.deepEqual(t.state.compounds.M[0].items[0].storage,{pack:'items3',slot:1});
 assert.equal(t.state.withdrawals.M[0].pack,'items3');assert.equal(t.state.withdrawals.M[0].slot,1);
 assert.ok(t.calls.some(call=>call[0]==='jobs'));
});
// The blocked unload signature reads the bank the completion wrote (first, as v1.5.0
// did), so a run that changed the bank without relocating starts no second swap.
test('only an explicit successful empty unload report records a blocked storage signature',()=>{
 const {storageSignature}=require('../../runtime/items/coordinator/storage.ts');
 const t=fixture();t.send('complete',{character:'bankboi0'});assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,null);
 t.send('complete',{character:'bankboi0',relocated:[],bank:{packs:{items0:[{slot:0,item:{name:'ring'}}]}}});
 assert.equal(t.state.bankbois.bankboi0.unloadBlockedSignature,storageSignature(t.state,t.state.bankbois.bankboi0));
 assert.equal(t.send('checkpoint',{character:'M',bank:{}}).code,400);
 // An empty vault the leather fits changes the signature, so the worker's unload is pending again.
 assert.equal(t.send('checkpoint',{character:'M',bank:{packs:{items0:Array(42).fill(null)}}}).body.pending,true);
});
test('BankBoi deletion refuses stored assets and pending work, reads the game delete wait; requires roster confirmation',async()=>{
 const t=fixture();let requested=0,owned=true,payload={failed:true,reason:'wait_42_minutes'};
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{requested++;return {ok:true,payload,statusText:'OK'};},refresh:async()=>{},owned:()=>owned,persist(){}});
 const send=async()=>{const res=response();await route({params:{name:'bankboi0'}},res);return res;};
 assert.equal((await send()).code,409);t.state.bankbois.bankboi0.items=[];
 assert.equal((await send()).code,409);t.state.bankboiTransaction=null;assert.equal(requested,0);
 const wait=await send();assert.equal(wait.code,409);assert.equal(wait.body.deletionAvailableAt,100+42*60_000);assert.ok(t.state.bankbois.bankboi0);
 payload={};assert.equal((await send()).code,502);assert.ok(t.state.bankbois.bankboi0);
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

// A BankBoi's delete sends one `items.bankboi` notice once the roster
// confirms it gone. The creation's notice is the same producer's other phase, at the confirmed
// create (storage.ts `createCharacterCreationAnswers`), which coordinator-character-creation runs.
test('items.bankboi: a BankBoi created and deleted',async()=>{
 const {itemsSince}=require('./helpers/items-notices.cjs');
 const t=fixture();let owned=true;
 t.state.bankbois.bankboi0.items=[];t.state.bankboiTransaction=null;
 const since=itemsSince('bankboi0');
 const route=createBankboiDeleteRoute(t.state,{now:()=>100,request:async()=>{owned=false;return {ok:true,statusText:'OK',payload:{}};},
  refresh:async()=>{},owned:()=>owned,persist:()=>{}});
 await route({params:{name:'bankboi0'}},response());
 assert.deepEqual(since().filter(e=>e.decision==='bankboi').map(e=>[e.phase,e.by]),[['deleted','player']]);
});
