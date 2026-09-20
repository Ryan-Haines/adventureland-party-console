const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantIdleRoute}=require('../../runtime/coordinator/http/merchant-idle.ts');
const {createMerchantBidRoute}=require('../../runtime/coordinator/http/merchant-bid.ts');
const {createStackMergeRoute}=require('../../runtime/coordinator/http/stack-merge.ts');
function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};handler({body},res);return res;}
function idleFixture(){
 const state={merchantCharacter:'M',commands:{M:{id:5,type:'merchant-idle'}},standListings:[],withdrawals:{}};
 const calls=[],handler=createMerchantIdleRoute(state,{sameItem:(a,b)=>a.name===b?.name,log:(...args)=>calls.push(args),persist:()=>calls.push('persist'),queue:(...args)=>calls.push(args)});
 return {state,calls,send:body=>invoke(handler,{character:'M',commandId:5,...body})};
}

test('arrival, inventory recovery, and stand update failures are distinct from travel failure',()=>{
 const f=idleFixture();f.state.standListings=[{id:'kept',item:{name:'pants'},state:'live',tradeSlot:'trade1'}];
 f.send({phase:'arrived'});assert.equal(f.calls[0][0],'At stand');
 f.send({phase:'inventory-recovery',error:'displaced item changed'});
 assert.equal(f.calls[2][0],'Inventory recovery required');assert.equal(f.state.standListings[0].state,'live');
 assert.equal(f.state.commands.M,undefined);
 f.send({phase:'failed',stage:'stand',error:'cant_equip'});assert.equal(f.calls.at(-2)[0],'Could not update stand');
 f.send({phase:'failed',stage:'return',error:'path failed'});assert.equal(f.calls.at(-2)[0],'Could not return to stand');
});
test('stand reconciliation retains live items and allocates each returned bag entry only once',()=>{
 const f=idleFixture();f.state.standListings=['live','returned','missing','bank'].map(id=>({id,item:{name:'ring'},state:'live',tradeSlot:'old',...(id==='bank'?{bankPack:'items0',bankSlot:2}:{})}));
 f.send({phase:'complete',liveListings:[{id:'live',tradeSlot:'trade1'}],inventory:[{slot:7,item:{name:'ring'}}]});
 assert.deepEqual(f.state.standListings.map(s=>s.id),['live','returned','bank']);
 assert.equal(f.state.standListings[0].tradeSlot,'trade1');assert.equal(f.state.standListings[1].slot,7);
 assert.equal(f.state.standListings[1].tradeSlot,undefined);assert.equal(f.state.commands.M,undefined);
 assert.equal(f.state.withdrawals.M[0].standListingId,'bank');assert.deepEqual(f.calls.at(-2),[['M'],'manual bank exchange']);
});
test('bank-backed listing withdrawals are deduplicated across idle completions',()=>{
 const f=idleFixture();f.state.standListings=[{id:'bank',item:{name:'ring'},state:'waiting',bankPack:'bankboi:B',bankSlot:1}];
 f.send({phase:'complete'});f.send({phase:'complete'});
 assert.equal(f.state.withdrawals.M.length,1);assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[1]==='manual bank exchange').length,1);
});
test('idle reports reject stale generations and preserve unrelated commands',()=>{
 const f=idleFixture();assert.equal(f.send({phase:'complete',commandId:4}).code,409);assert.deepEqual(f.calls,[]);
 f.state.commands.M={id:5,type:'merchant-service'};f.send({phase:'failed',error:'interrupted'});
 assert.equal(f.state.commands.M.type,'merchant-service');assert.equal(f.calls[0][0],'Stand return interrupted; retrying');
 assert.equal(f.send({phase:'invalid'}).code,400);assert.equal(f.send({character:'X',phase:'complete'}).code,409);
});
test('WTB retains the chosen level only for improvable items and validates before mutation',()=>{
 const state={merchantCharacter:'M',standBids:{},statuses:{},merchantCatalog:{allItems:[{id:'cap',upgradeable:true},{id:'leather'}]}};
 const calls=[],handler=createMerchantBidRoute(state,{removeQueued:id=>calls.push(id),log(){},observe(){},persist(){},publish(){},ponty:()=>false,aldata:()=>calls.push('aldata'),dispatch(){}});
 assert.equal(invoke(handler,{itemId:'cap',price:500,quantity:1,minimumQuality:8}).code,200);assert.equal(state.standBids.cap.minimumQuality,8);
 invoke(handler,{itemId:'leather',price:5,quantity:1,minimumQuality:8});assert.equal(state.standBids.leather.minimumQuality,0);
 const before=JSON.stringify(state);assert.equal(invoke(handler,{itemId:'cap',price:0,quantity:1}).code,400);assert.equal(JSON.stringify(state),before);
 invoke(handler,{itemId:'cap',clear:true});assert.equal(state.standBids.cap,undefined);
});
test('editing a legacy bid without a saved level retains its priority and supplies the requested level',()=>{
 const previous={price:100,quantity:2,priorityOverride:75};
 const state={merchantCharacter:'M',standBids:{cap:previous},statuses:{},merchantCatalog:{allItems:[{id:'cap',upgradeable:true}]}};
 const handler=createMerchantBidRoute(state,{removeQueued(){},log(){},observe(){},persist(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
 assert.equal(invoke(handler,{itemId:'cap',price:500,quantity:1,minimumQuality:8}).code,200);
 assert.deepEqual(state.standBids.cap,{price:500,quantity:1,priorityOverride:75,minimumQuality:8,useStandSlot:false,acceptHigherLevels:true,revision:0,standSuppressed:undefined});
 assert.deepEqual(previous,{price:100,quantity:2,priorityOverride:75});
});
test('stack merge authorization fences reservations, stale observations and changed quantities',()=>{
 const merge={from:2,to:3,source:{name:'leather',q:2},target:{name:'leather',q:3}};
 const state={merchantCharacter:'M',statuses:{M:{seenAt:100000}}};let anniversary={},busy=false;
 const handler=createStackMergeRoute(state,{now:()=>100000,anniversary:()=>anniversary,bankboiBusy:()=>busy,plan:()=>merge,identity:item=>item?.name});
 const send=proposed=>invoke(handler,{character:'M',merge:proposed||merge}).body.allowed;
 assert.equal(send(),true);assert.equal(send({...merge,source:{name:'leather',q:1}}),false);
 busy=true;assert.equal(send(),false);busy=false;
 anniversary={reserved:true};assert.equal(send(),false);anniversary={busy:true};assert.equal(send(),false);anniversary={};
 state.statuses.M.seenAt=89999;assert.equal(send(),false);
});
