const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createNativeStandRoute}=require('../../runtime/coordinator/http/native-stand.ts');
function fixture(){
 const state={standBids:{berry:{price:100,quantity:9,useStandSlot:true}},standListings:[],merchantCharacter:'M',merchantCurrent:null},calls=[],listeners={};
 const handler=createNativeStandRoute(state,{fulfill(item,q){const bid=state.standBids[item.name];if(bid){bid.quantity-=q;if(!bid.quantity)delete state.standBids[item.name]}},persist(){}});
 const c=vm.createContext({root:{},character:{name:'M',stand:true,slots:{},gold:100000,items:Array(42).fill(null)},parent:{socket:{on(event,fn){listeners[event]=fn},off(){}}},
  fingerprint:item=>item,setTimeout,Promise,console,
  request:async(path,{body})=>{calls.push(structuredClone(body));const response={status(code){this.code=code;return this},json(body){this.body=structuredClone(body)}};handler({body},response);if(response.code>=400)throw Error(response.body.error);return response.body;},
  wishlist:async(slot,name,price,level,q)=>{c.character.slots[slot]={name,price,level,q,b:true,rid:'rid-'+slot};},
  unequip:async slot=>{delete c.character.slots[slot]},open_stand:async()=>{c.character.stand=true},
 });
 const source=fs.readFileSync('characters/shared.js','utf8');vm.runInContext(source.slice(source.indexOf('  var nativeStandJournal ='),source.indexOf('  async function consolidateMerchantInventory(')),c);
 return {c,state,calls,listeners};
}
test('client serially places multiple native offers and preserves an occupied sale',async()=>{
 const f=fixture();f.state.standBids.cap={price:200,quantity:2,useStandSlot:true};f.c.character.slots.trade1={name:'sale',price:5,q:1};
 await f.c.nativeStandSync(null,false);assert.equal(Object.values(f.state.nativeStand.offers).length,2);assert.ok(Object.values(f.state.nativeStand.offers).every(o=>o.phase==='live'));
 assert.equal(f.c.character.slots.trade1.name,'sale');assert.equal(f.c.character.slots.trade2.b,true);assert.equal(f.c.character.slots.trade3.b,true);
 await f.c.nativeStandSync(null,false);assert.equal(f.state.standBids.berry.quantity,9);
});
test('client acknowledges full native receipt exactly once and does not recreate the order',async()=>{
 const f=fixture();await f.c.nativeStandSync(null,false);const offer=Object.values(f.state.nativeStand.offers)[0];
 f.listeners.ui({type:'+$$',buyer:'M',slot:offer.slot,item:{name:'berry',price:100,q:9}});delete f.c.character.slots[offer.slot];
 await f.c.nativeStandSync(null,false);await f.c.nativeStandSync(null,false);assert.equal(f.state.standBids.berry,undefined);assert.equal(Object.keys(f.c.character.slots).length,0);
});
test('shopping removes its native offer, accounts for removal race, then buys only the remaining quantity',async()=>{
 const f=fixture();await f.c.nativeStandSync(null,false);const offer=Object.values(f.state.nativeStand.offers)[0];
 f.state.merchantCurrent={id:'job',reason:'ALData marketplace purchases',bidItemId:'berry'};
 f.c.unequip=async slot=>{f.listeners.ui({type:'+$$',buyer:'M',slot,item:{name:'berry',price:100,q:1}});delete f.c.character.slots[slot]};
 let quantity;await f.c.guardedMarketPurchase({jobId:'job',bidItemId:'berry'},{key:'listing'},{name:'berry'},100,9,async q=>{quantity=q;assert.equal(f.c.character.slots[offer.slot],undefined)});
 assert.equal(quantity,8);assert.equal(f.state.standBids.berry,undefined);assert.equal(Object.keys(f.state.nativeStand.purchases).length,0);
});
test('failed game purchase retains a persisted reservation and blocks retry',async()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'ALData marketplace purchases',bidItemId:'berry'};
 const args=[{jobId:'job',bidItemId:'berry'},{key:'listing'},{name:'berry'},100,1,async()=>{throw Error('timeout')}];
 await assert.rejects(f.c.guardedMarketPurchase(...args),/timeout/);assert.equal(Object.keys(f.state.nativeStand.purchases).length,1);
 await assert.rejects(f.c.guardedMarketPurchase(...args),/unconfirmed/);assert.equal(f.state.standBids.berry.quantity,9);
});

test('ten scrolls share one remainder across native fills, reload, and shopping without replenishment',async()=>{
 const f=fixture();f.state.standBids={vitscroll:{price:9600,quantity:10,useStandSlot:true}};
 await f.c.nativeStandSync(null,false);const offer=Object.values(f.state.nativeStand.offers)[0];
 // Shape matches the official trade_sell ui event; a partial fill retains rid.
 f.c.character.slots[offer.slot].q=6;
 f.listeners.ui({type:'+$$',seller:'Seller',buyer:'M',slot:offer.slot,num:0,snum:2,item:{name:'vitscroll',q:4,price:9600}});
 await f.c.nativeStandSync(null,false);await f.c.nativeStandSync(null,false);
 assert.equal(f.state.standBids.vitscroll.quantity,6);
 // Reload drops local counters; the persisted acknowledgement and live slot
 // must seed the same remainder without counting the first four twice.
 f.c.nativeStandJournal.receipts={};await f.c.nativeStandSync(null,false);
 assert.equal(f.state.standBids.vitscroll.quantity,6);
 f.state.merchantCurrent={id:'job',reason:'stand bid purchases',bidItemId:'vitscroll'};
 let bought=0;
 await f.c.guardedMarketPurchase({jobId:'job',bidItemId:'vitscroll'},{key:'scrolls'},{name:'vitscroll'},9600,10,async q=>{bought+=q});
 assert.equal(bought,6);assert.equal(f.state.standBids.vitscroll,undefined);
 await f.c.guardedMarketPurchase({jobId:'job',bidItemId:'vitscroll'},{key:'scrolls'},{name:'vitscroll'},9600,10,async()=>assert.fail('duplicate purchase'));
 f.state.merchantCurrent=null;await f.c.nativeStandSync(null,false);
 assert.equal(Object.keys(f.state.nativeStand.offers).length,0);assert.equal(Object.keys(f.c.character.slots).length,0);
});
