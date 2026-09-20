const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDeconstruction,receiveDeconstruction,buildDeconstructionCatalog,deconstructable}=require('../../runtime/coordinator/merchant/deconstruction.ts');
const {canDeconstruct}=require('../../dashboard/features/party/deconstruction.ts');
function fixture(){
 let now=20000,id=0;
 const item={name:'salvage',q:2}, calls=[];
 const state={deconstructionMarks:[],autoDeconstruction:{},deconstructionCatalog:{salvage:{compound:false,cost:100},ring:{compound:true}},
 merchantCharacter:'M',merchantMarked:{},statuses:{P:{seenAt:now,items:[{slot:1,item}]},M:{seenAt:now,items:[]}},merchantCurrent:null};
 const ports={now:()=>now,next:()=>++id,persist:()=>{},owned:n=>['P','M'].includes(n),queue:(names,reason)=>calls.push({names,reason}),reserved:()=>false,log:()=>{}};
 const service=createDeconstruction(state,ports);
 const send=(route,body)=>{let code=200,result;service[route]({body},{status(n){code=n;return this},json(v){result=v;return v}});return {code,...result};};
 return {state,ports,service,send,item,calls,advance(ms){now+=ms;Object.values(state.statuses).forEach(s=>s.seenAt=now)}};
}
test('UI and server hide/reject unsupported, locked, blocked, base compounds and boosters',()=>{
 const catalog=buildDeconstructionCatalog({dismantle:{salvage:{cost:100}},items:{ring:{compound:{}},xpbooster:{compound:{},type:'booster'}}});
 for(const item of [{name:'sword'},{name:'ring',level:0},{name:'xpbooster',level:1},{name:'salvage',l:true},{name:'salvage',b:true}]){
  assert.equal(deconstructable(item,catalog),false);assert.equal(canDeconstruct(item,catalog),false);
 }
 for(const item of [{name:'salvage'},{name:'ring',level:1}]){
  assert.equal(deconstructable(item,catalog),true);assert.equal(canDeconstruct(item,catalog),true);
 }
});
test('character mark reserves pickup; confirmed receipt promotes it to merchant deconstruction',()=>{
 const f=fixture();assert.equal(f.send('mark',{character:'P',slot:1,item:f.item}).code,200);
 const mark=f.state.deconstructionMarks[0];assert.equal(mark.state,'collecting');
 assert.equal(f.state.merchantMarked.P[0].deconstructionId,mark.id);
 assert.equal(f.calls.at(-1).reason,'marked items');
 receiveDeconstruction(f.state,'P',f.state.merchantMarked.P,20000);
 assert.equal(mark.owner,'M');assert.equal(mark.state,'ready');
 f.state.statuses.M.items=[{slot:7,item:f.item}];f.service.reconcile('M');
 assert.equal(mark.slot,7);assert.equal(f.calls.at(-1).reason,'deconstruction');
});
test('no transfer is inferred from an unrelated receipt or a matching merchant item',()=>{
 const f=fixture();f.send('mark',{character:'P',slot:1,item:f.item});
 f.state.statuses.M.items=[{slot:1,item:f.item}];f.service.reconcile('M');
 receiveDeconstruction(f.state,'P',[{item:f.item}],20000);
 assert.equal(f.state.deconstructionMarks[0].owner,'P');
});
test('a deconstruction mark waits for ordinary collection eligibility',()=>{
 const {coordinatorCollectionReady}=require('../../runtime/coordinator/merchant/queue-selection.ts');
 const f=fixture();f.send('mark',{character:'P',slot:1,item:f.item});
 const job={target:'P',reason:f.calls.at(-1).reason};
 f.state.itemCollectionThreshold=10;
 Object.assign(f.state.statuses.P,{map:'main',server:'USI',x:1000,y:0});
 Object.assign(f.state.statuses.M,{map:'main',server:'USI',x:0,y:0});
 assert.equal(coordinatorCollectionReady(f.state,job,()=>20000),false);
 f.state.statuses.M.x=900;
 assert.equal(coordinatorCollectionReady(f.state,job,()=>20000),true);
});
test('manual marking rejects unsupported items, stale slots and competing work',()=>{
 const f=fixture();
 assert.equal(f.send('mark',{character:'P',slot:2,item:f.item}).code,409);
 f.state.statuses.P.items[0].item={name:'sword'};
 assert.equal(f.send('mark',{character:'P',slot:1,item:{name:'sword'}}).code,400);
 f.state.statuses.P.items[0].item=f.item;f.ports.reserved=()=>true;
 assert.equal(f.send('mark',{character:'P',slot:1,item:f.item}).code,409);
});
test('auto rules match character, level, stat and variant without recursively dismantling outputs',()=>{
 const f=fixture();f.item.name='ring';f.item.level=2;f.item.stat_type='int';
 assert.equal(f.send('automatic',{character:'P',item:f.item}).code,200);
 assert.equal(f.state.deconstructionMarks.length,1);
 f.state.statuses.P.items.push({slot:2,item:{name:'ring',level:1,stat_type:'int'}},{slot:3,item:{name:'ring',level:2,stat_type:'str'}});
 f.advance(11000);f.service.reconcile('P');assert.equal(f.state.deconstructionMarks.length,1);
 f.state.statuses.M.items=[{slot:1,item:f.item}];f.service.reconcile('M');assert.equal(f.state.deconstructionMarks.length,1);
});
test('slot movement updates the pickup reservation and identical copies remain distinct',()=>{
 const f=fixture();f.send('mark',{character:'P',slot:1,item:f.item});
 f.state.statuses.P.items[0].slot=4;f.service.reconcile('P');
 assert.equal(f.state.merchantMarked.P[0].slot,4);
 f.state.statuses.P.items.push({slot:5,item:{...f.item}});
 f.send('mark',{character:'P',slot:5,item:f.item});
 assert.equal(f.state.deconstructionMarks.length,2);
});
test('cancelling an auto rule removes queued pickup marks',()=>{
 const f=fixture();f.send('automatic',{character:'P',item:f.item});
 f.send('automatic',{character:'P',item:f.item,remove:true});
 assert.equal(f.state.deconstructionMarks.length,0);assert.deepEqual(f.state.merchantMarked.P,[]);
});
function merchantFixture(){
 const f=fixture();f.state.statuses.M.items=[{slot:1,item:f.item}];f.send('mark',{character:'M',slot:1,item:f.item});
 f.state.merchantCurrent={id:'job',reason:'deconstruction'};return f;
}
test('claims and receipts protect against duplicate execution and stale jobs',()=>{
 const f=merchantFixture(),mark=f.state.deconstructionMarks[0],body={jobId:'job',id:mark.id,action:'claim'};
 assert.equal(f.send('step',{...body,jobId:'old'}).code,409);
 const result=f.send('step',body);const attempt=result.mark.attempt;
 assert.equal(f.send('step',body).code,409);
 assert.equal(f.send('mark',{character:'M',id:mark.id,remove:true}).code,409);
 assert.equal(f.send('step',{jobId:'job',id:mark.id,attempt,success:true}).code,200);
 assert.equal(mark.quantity,1);
 assert.equal(f.send('step',{jobId:'job',id:mark.id,attempt,success:true}).code,409);
 const next=f.send('step',body).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt:next,success:true});assert.equal(mark.state,'complete');
});
test('rejected actions remain blocked and restart never replays an uncertain cast',()=>{
 const f=merchantFixture(),mark=f.state.deconstructionMarks[0];
 const attempt=f.send('step',{jobId:'job',id:mark.id,action:'claim'}).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt,success:false,error:'gold_not_enough'});
 assert.equal(mark.state,'blocked');assert.match(mark.error,/gold/);
 f.send('mark',{character:'M',id:mark.id,retry:true});assert.equal(mark.state,'ready');
 f.send('step',{jobId:'job',id:mark.id,action:'claim'});
 createDeconstruction(f.state,f.ports);assert.equal(mark.state,'blocked');assert.match(mark.error,/Interrupted/);
});
const source=fs.readFileSync('characters/shared.js','utf8');
function executor(overrides={}){
 const events=[],mark={id:'d',slot:0,item:{name:'salvage'},quantity:1};
 const c=vm.createContext({character:{items:[mark.item],gold:1000},G:{items:{salvage:{}},dismantle:{salvage:{cost:100,items:[[1,'mat']]}}},
 smart_move:async n=>events.push(n),assertMerchantContinuation:()=>{},sameItem:(a,b)=>a?.name===b?.name,findItem:()=>0,
 freeInventorySlots:()=>10,withdrawMerchantCash:async()=>{},item_value:()=>200,anniversaryWithTimeout:p=>p,
 dismantle:async slot=>events.push(['dismantle',slot]),
 request:async(path,{body})=>{events.push([path,body]);return {mark:{attempt:'a'}};},...overrides});
 require('./helpers/client-dependencies.cjs').merchantGuards(c);
 vm.runInContext(source.slice(source.indexOf('  function deconstructionDefinition('),source.indexOf('  async function merchantNpcSale(')),c);
 return {c,events,command:{jobId:'job',deconstructionMarks:[mark]}};
}
test('executor visits Craftsman, claims, dismantles, acknowledges, then finishes',async()=>{
 const f=executor();await f.c.merchantDeconstruct(f.command);
 assert.equal(f.events[0],'craftsman');assert.equal(f.events[1][1].action,'claim');
 assert.deepEqual(Array.from(f.events[2]),['dismantle',0]);
 assert.equal(f.events[3][1].success,true);assert.equal(f.events[4][0],'/merchant/complete');
});
test('executor never dismantles locked items or when gold or result space is insufficient',async()=>{
 for(const mode of ['locked','gold','space']){
  const f=executor();if(mode==='locked')f.c.character.items[0].l=true;
  if(mode==='gold')f.c.character.gold=0;if(mode==='space')f.c.freeInventorySlots=()=>0;
  await f.c.merchantDeconstruct(f.command);assert.ok(!f.events.some(e=>Array.isArray(e)&&e[0]==='dismantle'));
  assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='/deconstruction/step'&&e[1].success===false));
 }
});

test('partial stack pickup limits destructive quantity and releases the source reservation',()=>{
 const f=fixture();f.send('mark',{character:'P',slot:1,item:f.item});
 const mark=f.state.deconstructionMarks[0];
 receiveDeconstruction(f.state,'P',[{...f.state.merchantMarked.P[0],quantity:1}],20000);
 assert.equal(mark.quantity,1);assert.equal(mark.owner,'M');assert.deepEqual(f.state.merchantMarked.P,[]);
});
