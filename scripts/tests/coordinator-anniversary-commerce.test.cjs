const test=require('node:test'),assert=require('node:assert/strict');
const {createAnniversaryCommerceRoutes}=require('../../runtime/coordinator/http/anniversary-commerce.ts');
const {anniversarySlices:slices}=require('../../runtime/coordinator/anniversary/contracts.ts');
function fixture(){
 const native=slices[0],incoming=slices[1],counts=Object.fromEntries(slices.map(name=>[name,name===native?9:1]));
 const state={nativeSlice:native,rounds:{r:{claims:{M:{}}}},advertisedRounds:{},chatAdvertisement:null,reciprocal:{},pendingReturns:{},crafted:0};
 let saves=0,published=0;const logs=[];
 const ports={autoChat:()=>true,now:()=>100,nextCommand:()=>7,merchant:()=> 'M',owned:name=>name==='M',
  snapshot:()=>({message:'offer',chatMessage:'trade slices',tradableNative:8,counts,live:{round:'r'}}),
  merchantItems:()=>[{item:{name:native,q:8}}],identity:(owner,sender)=>owner||sender,alreadyTraded:()=>false,
  persist:()=>saves++,publish:()=>published++,log:(...args)=>logs.push(args)};
 const routes=createAnniversaryCommerceRoutes(state,ports);
 function send(route,body={}){const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},response);return response;}
 return {state,ports,send,native,incoming,counts,logs,saves:()=>saves,published:()=>published};
}
test('automatic chat is reserved once, and manual chat completion checks its command id',()=>{
 const t=fixture();assert.equal(t.send('advertise',{round:'r'}).body.message,'trade slices');
 assert.equal(t.send('advertise',{round:'r'}).body.duplicate,true);assert.equal(t.published(),1);
 assert.equal(t.send('advertise',{round:'missing'}).code,409);
 t.send('chat');const pending=t.state.chatAdvertisement;
 assert.equal(t.send('chat').body.duplicate,true);
 assert.equal(t.send('chatComplete',{id:'stale'}).code,409);assert.equal(t.state.chatAdvertisement,pending);
 assert.equal(t.send('chatComplete',{id:pending.id}).code,200);assert.equal(t.state.chatAdvertisement,null);
});
test('slice swaps reserve one identity and track returns owed until acknowledged',()=>{
 const t=fixture(),body={sender:'Guest',owner:'account',item:t.incoming};
 const swap=t.send('trade',body).body;assert.equal(swap.action,'swap');assert.equal(swap.item,t.native);
 assert.equal(t.send('trade',body).body.reason,'identity limit reached');
 t.send('tradeComplete',{key:swap.key,state:'failed'});assert.equal(t.state.pendingReturns[swap.key].item,t.incoming);
 t.send('tradeComplete',{key:swap.key,state:'returned'});assert.equal(t.state.pendingReturns[swap.key],undefined);
 assert.equal(t.send('tradeComplete',{key:'missing'}).code,404);
});
test('fresh merchant inventory replaces stale heartbeat counts before accepting a swap',()=>{
 const t=fixture(),body={sender:'Guest',item:t.incoming,counts:{[t.native]:0}};
 assert.equal(t.send('trade',body).body.action,'return');assert.equal(Object.keys(t.state.reciprocal).length,0);
 body.counts[t.native]=8;assert.equal(t.send('trade',body).body.action,'swap');
});
test('trade guards reject invalid slices, ignore owned senders, and preserve complete sets',()=>{
 const t=fixture();assert.equal(t.send('trade',{sender:'Guest',item:'sword'}).code,400);
 assert.equal(t.send('trade',{sender:'M',item:t.incoming}).body.action,'ignore');
 for(const name of slices)t.counts[name]=2;
 assert.equal(t.send('trade',{sender:'Guest',item:t.incoming}).body.action,'return');
});

test('automatic chat is off unless explicitly enabled; manual chat remains available',()=>{const t=fixture();delete t.ports.autoChat;assert.equal(t.send('advertise',{round:'r'}).body.message,'');assert.equal(t.published(),0);assert.equal(t.send('chat').body.queued,true);});
