const {settingsWriter,merchantViewNames}=require('./helpers/settings-writer.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createDeconstruction,receiveDeconstruction,buildDeconstructionCatalog}=require('../../runtime/items/coordinator/market.ts');
const {deconstructable}=require('../../runtime/items/rules.ts');
function fixture(){
 let now=20000,id=0;
 const item={name:'salvage',q:2}, calls=[];
 const state={deconstructionMarks:[],autoDeconstruction:{},deconstructionCatalog:{salvage:{compound:false,cost:100},ring:{compound:true}},
 merchantCharacter:'M',merchantMarked:{},statuses:{P:{seenAt:now,items:[{slot:1,item}]},M:{seenAt:now,items:[]}},merchantCurrent:null};
 const ports={now:()=>now,next:()=>++id,persist:()=>{},write:settingsWriter(state).write,owned:n=>['P','M'].includes(n),queue:(names,reason)=>calls.push({names,reason}),reserved:()=>false,log:()=>{}};
 const service=createDeconstruction(state,ports);
 const send=(route,body)=>{const answer=service[route](body);return {code:answer.status||200,...answer.body};};
 return {state,ports,service,send,item,calls,advance(ms){now+=ms;Object.values(state.statuses).forEach(s=>s.seenAt=now)}};
}

scenarioTable('a deconstruction mark moves from the pickup character through claim and receipt',fixture,[
 ['automatic missing-item blocks recover one available copy without replaying uncertain work',f=>{
 
 const {commerceRuleKey}=require('../../runtime/items/identity.ts');
 f.state.autoDeconstruction.P={[commerceRuleKey(f.item)]:{item:f.item}};
 f.state.deconstructionMarks=[1,2].map(id=>({id:String(id),owner:'P',origin:'P',slot:1,item:f.item,quantity:2,auto:true,updatedAt:0,state:'blocked',error:'Marked item is missing; refresh inventory before retrying'}));
 f.service.reconcile('P');
 assert.equal(f.state.deconstructionMarks.filter(m=>m.state==='collecting').length,1);
 assert.equal(f.state.merchantMarked.P.length,1);
 assert.equal(f.calls[0].reason,'marked items');
 const blocked=f.state.deconstructionMarks[1];blocked.attempt='uncertain';
 f.state.statuses.P.items.push({slot:2,item:f.item});f.advance(11000);f.service.reconcile('P');
 assert.equal(blocked.state,'blocked');
}],
 ['character mark reserves pickup; confirmed receipt promotes it to merchant deconstruction',f=>{
 assert.equal(f.send('mark',{character:'P',slot:1,item:f.item}).code,200);
 const mark=f.state.deconstructionMarks[0];assert.equal(mark.state,'collecting');
 assert.equal(f.state.merchantMarked.P[0].deconstructionId,mark.id);
 assert.equal(f.calls.at(-1).reason,'marked items');
 receiveDeconstruction(f.state,'P',f.state.merchantMarked.P,20000);
 assert.equal(mark.owner,'M');assert.equal(mark.state,'ready');
 // The merchant's report keeps every cell, so DISMANTLE_FREE_SLOTS free cells read as nulls.
 f.state.statuses.M.items=[...Array(7).fill(null),{slot:7,item:f.item},null,null];f.service.reconcile('M');
 assert.equal(mark.slot,7);assert.equal(f.calls.at(-1).reason,'deconstruction');
}],
 ['no transfer is inferred from an unrelated receipt or a matching merchant item',f=>{
 f.send('mark',{character:'P',slot:1,item:f.item});
 f.state.statuses.M.items=[{slot:1,item:f.item}];f.service.reconcile('M');
 receiveDeconstruction(f.state,'P',[{item:f.item}],20000);
 assert.equal(f.state.deconstructionMarks[0].owner,'P');
}],
 ['manual marking rejects unsupported items, stale slots and competing work',f=>{
 
 assert.equal(f.send('mark',{character:'P',slot:2,item:f.item}).code,409);
 f.state.statuses.P.items[0].item={name:'sword'};
 assert.equal(f.send('mark',{character:'P',slot:1,item:{name:'sword'}}).code,400);
 f.state.statuses.P.items[0].item=f.item;f.ports.reserved=()=>true;
 assert.equal(f.send('mark',{character:'P',slot:1,item:f.item}).code,409);
}],
 ['auto rules match character, level, stat and variant without recursively dismantling outputs',f=>{
 f.item.name='ring';f.item.level=2;f.item.stat_type='int';
 assert.equal(f.send('automatic',{character:'P',item:f.item}).code,200);
 assert.equal(f.state.deconstructionMarks.length,1);
 f.state.statuses.P.items.push({slot:2,item:{name:'ring',level:1,stat_type:'int'}},{slot:3,item:{name:'ring',level:2,stat_type:'str'}});
 f.advance(11000);f.service.reconcile('P');assert.equal(f.state.deconstructionMarks.length,1);
 f.state.statuses.M.items=[{slot:1,item:f.item}];f.service.reconcile('M');assert.equal(f.state.deconstructionMarks.length,1);
}],
 ['slot movement updates the pickup reservation and identical copies remain distinct',f=>{
 f.send('mark',{character:'P',slot:1,item:f.item});
 f.state.statuses.P.items[0].slot=4;f.service.reconcile('P');
 assert.equal(f.state.merchantMarked.P[0].slot,4);
 f.state.statuses.P.items.push({slot:5,item:{...f.item}});
 f.send('mark',{character:'P',slot:5,item:f.item});
 assert.equal(f.state.deconstructionMarks.length,2);
}],
 ['cancelling an auto rule removes queued pickup marks',f=>{
 f.send('automatic',{character:'P',item:f.item});
 f.send('automatic',{character:'P',item:f.item,remove:true});
 assert.equal(f.state.deconstructionMarks.length,0);assert.deepEqual(f.state.merchantMarked.P,[]);
}],
 ['partial stack pickup limits destructive quantity and releases the source reservation',f=>{
 f.send('mark',{character:'P',slot:1,item:f.item});
 const mark=f.state.deconstructionMarks[0];
 receiveDeconstruction(f.state,'P',[{...f.state.merchantMarked.P[0],quantity:1}],20000);
 assert.equal(mark.quantity,1);assert.equal(mark.owner,'M');assert.deepEqual(f.state.merchantMarked.P,[]);
}],
]);
test('UI and server hide/reject unsupported, locked, blocked, base compounds and boosters',()=>{
 const catalog=buildDeconstructionCatalog({dismantle:{salvage:{cost:100}},items:{ring:{compound:{}},xpbooster:{compound:{},type:'booster'}}});
 for(const item of [{name:'sword'},{name:'ring',level:0},{name:'xpbooster',level:1},{name:'salvage',l:true},{name:'salvage',b:true}]){
  assert.equal(deconstructable(item,catalog),false);
 }
 for(const item of [{name:'salvage'},{name:'ring',level:1}]){
  assert.equal(deconstructable(item,catalog),true);
 }
});

test('a deconstruction mark waits for ordinary collection eligibility',()=>{
 const {coordinatorCollectionReady}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const f=fixture();f.send('mark',{character:'P',slot:1,item:f.item});
 const job={target:'P',reason:f.calls.at(-1).reason};
 f.state.itemCollectionThreshold=10;
 Object.assign(f.state.statuses.P,{map:'main',server:'USI',x:1000,y:0});
 Object.assign(f.state.statuses.M,{map:'main',server:'USI',x:0,y:0});
 assert.equal(coordinatorCollectionReady(f.state,job,()=>20000),false);
 f.state.statuses.M.x=900;
 assert.equal(coordinatorCollectionReady(f.state,job,()=>20000),true);
});

function merchantFixture(){
 const f=fixture();f.state.statuses.M.items=[{slot:1,item:f.item}];f.send('mark',{character:'M',slot:1,item:f.item});
 f.state.merchantCurrent={id:'job',reason:'deconstruction'};return f;
}
scenarioTable('a merchant claim and send follows the mark job',merchantFixture,[
 ['claims and receipts protect against duplicate execution and stale jobs',f=>{
 const mark=f.state.deconstructionMarks[0],body={jobId:'job',id:mark.id,action:'claim'};
 assert.equal(f.send('step',{...body,jobId:'old'}).code,409);
 const result=f.send('step',body);const attempt=result.mark.attempt;
 assert.equal(f.send('step',body).code,409);
 assert.equal(f.send('mark',{character:'M',id:mark.id,remove:true}).code,409);
 assert.equal(f.send('step',{jobId:'job',id:mark.id,attempt,success:true}).code,200);
 assert.equal(mark.quantity,1);
 assert.equal(f.send('step',{jobId:'job',id:mark.id,attempt,success:true}).code,409);
 const next=f.send('step',body).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt:next,success:true});assert.equal(mark.state,'complete');
}],
 ['rejected actions remain blocked and restart never replays an uncertain cast',f=>{
 const mark=f.state.deconstructionMarks[0];
 const attempt=f.send('step',{jobId:'job',id:mark.id,action:'claim'}).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt,success:false,error:'gold_not_enough'});
 assert.equal(mark.state,'blocked');assert.match(mark.error,/gold/);
 f.send('mark',{character:'M',id:mark.id,retry:true});assert.equal(mark.state,'ready');
 f.send('step',{jobId:'job',id:mark.id,action:'claim'});
 createDeconstruction(f.state,f.ports);assert.equal(mark.state,'blocked');assert.match(mark.error,/Interrupted/);
}],
// A space refusal at
// the send holds the mark until a report shows the game's two free cells, then queues it again; any
// other refusal stays blocked for the player.
 ['a full bag at the send holds the mark under S2 until the bag has room',f=>{
 const mark=f.state.deconstructionMarks[0];
 const attempt=f.send('step',{jobId:'job',id:mark.id,action:'claim'}).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt,success:false,code:'deconstruct_space',error:'Insufficient inventory space for deconstruction results'});
 assert.equal(mark.state,'ready');
 f.state.merchantCurrent=null;f.calls.length=0;
 const full=[{slot:1,item:f.item},{slot:2,item:{name:'x'}}];f.state.statuses.M.items=full;f.advance(1000);f.service.reconcile('M');
 assert.equal(f.calls.length,0,'a bag with one free cell holds the mark');
 f.state.statuses.M.items=[{slot:1,item:f.item},null,null];f.advance(1000);f.service.reconcile('M');
 assert.deepEqual(f.calls.map(c=>c.reason),['deconstruction']);
}],
]);

// The merchant's deconstruction job (runtime/items/character/market.ts `merchantDeconstruct`) on the
// market harness: `walk` and `request` log each step, the game's dismantle logs its slot.
function executor(){
 const {marketHarness}=require('./helpers/items-character.cjs');
 const events=[],mark={id:'d',slot:0,item:{name:'salvage'},quantity:1};
 const character={name:'M',ctype:'merchant',map:'main',items:[mark.item,...Array(9).fill(null)],gold:1000};
 const h=marketHarness({character,G:{items:{salvage:{}},skills:{},dismantle:{salvage:{cost:100,items:[[1,'mat']]}}},
  ports:{walk:async n=>events.push(n),request:async(path,{body})=>{events.push([path,body]);return {mark:{attempt:'a'}};}},
  game:{dismantle:async slot=>events.push(['dismantle',slot]),itemValue:()=>200}});
 return {market:h.market,character,events,command:{jobId:'job',deconstructionMarks:[mark]}};
}
test('executor visits Craftsman, claims, dismantles, acknowledges, then finishes',async()=>{
 const f=executor();await f.market.merchantDeconstruct(f.command);
 assert.equal(f.events[0],'craftsman');assert.equal(f.events[1][1].action,'claim');
 assert.deepEqual(Array.from(f.events[2]),['dismantle',0]);
 assert.equal(f.events[3][1].success,true);assert.equal(f.events[4][0],'/merchant/complete');
});
test('executor never dismantles locked items or when gold or result space is insufficient',async()=>{
 for(const mode of ['locked','gold','space']){
  const f=executor();if(mode==='locked')f.character.items[0].l=true;
  if(mode==='gold')f.character.gold=0;if(mode==='space')f.character.items.fill({name:'mat',q:1},1);
  await f.market.merchantDeconstruct(f.command);assert.ok(!f.events.some(e=>Array.isArray(e)&&e[0]==='dismantle'));
  assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='/deconstruction/step'&&e[1].success===false));
 }
});

// 1.37 (section 6 part 2): one `items.dismantled` notice per confirmed receipt; a receipt sent again
// changes nothing.
test('items.dismantled: each result once',()=>{
 const {itemsSince}=require('./helpers/items-notices.cjs');
 const f=merchantFixture(),mark=f.state.deconstructionMarks[0],body={jobId:'job',id:mark.id,action:'claim'};
 const since=itemsSince(mark.owner);
 const attempt=f.send('step',body).mark.attempt;
 f.send('step',{jobId:'job',id:mark.id,attempt,success:true});
 f.send('step',{jobId:'job',id:mark.id,attempt,success:true});
 assert.deepEqual(since().filter(e=>e.decision==='dismantled').map(e=>e.item),[mark.item.name]);
});
