const test=require('node:test'),assert=require('node:assert/strict');
const {createNativeStandRoute}=require('../../runtime/items/coordinator/routes/market.ts');
// The merchant's stand sync and guarded purchase are market.ts's (runtime/items/character/market.ts) on
// the market harness: `request` answers through the coordinator's native-stand route, the game's
// wishlist, unequip and stand open change the planted character, and `ui` is the listener the
// market registers at start. The socket's journal lives on the game window, so each fixture starts
// it empty. The guarded purchase runs inside a stand buy (`merchantStandBuy`) of one listing, whose
// trade call is the row's purchase.
const {marketHarness,planted}=require('./helpers/items-character.cjs');
function fixture(){
 const state={standBids:{berry:{price:100,quantity:9,useStandSlot:true}},standListings:[],merchantCharacter:'M',merchantCurrent:null},calls=[];
 const handler=createNativeStandRoute(state,{fulfill(item,q){const bid=state.standBids[item.name];if(bid){bid.quantity-=q;if(!bid.quantity)delete state.standBids[item.name]}},persist(){}});
 delete globalThis.__nativeStandJournal;delete globalThis.__nativePurchaseReceipts;
 const sellers={},character={name:'M',ctype:'merchant',stand:true,slots:{},gold:100000,items:Array(42).fill(null)};
 const game={wishlist:async(slot,name,price,level,q)=>{character.slots[slot]={name,price,level,q,b:true,rid:'rid-'+slot};},
  unequip:async slot=>{delete character.slots[slot]},openStand:async()=>{character.stand=true}};
 const h=marketHarness({character,game,ports:{production:planted({luckySlot:()=>null}),
  getPlayer:name=>sellers[name],
  request:async(path,{body})=>{if(path!=='/merchant/native-stand')return {};calls.push(structuredClone(body));const response={status(code){this.code=code;return this},json(body){this.body=structuredClone(body)}};handler({body},response);if(response.code>=400)throw Error(response.body.error);return response.body;}}});
 h.market.start();
 const standBuy=async(command,listing,item,price,quantity,purchase)=>{
  sellers.Seller={name:'Seller',slots:{trade1:{...item,price,q:quantity,rid:'seller-rid'}}};
  game.tradeBuy=(seller,slot,count)=>purchase(count);
  await h.market.merchantStandBuy({...command,listings:[{...listing,seller:'Seller',slot:'trade1',rid:'seller-rid',item,price,buyQuantity:quantity,map:'main',x:0,y:0}]});
 };
 const c={character,nativeStandSync:h.market.nativeStandSync,standBuy,
  set unequip(run){game.unequip=run;},get nativeStandJournal(){return globalThis.__nativeStandJournal;}};
 return {c,state,calls,listeners:h.listeners};
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
 let quantity;await f.c.standBuy({jobId:'job',bidItemId:'berry'},{key:'listing'},{name:'berry'},100,9,async q=>{quantity=q;assert.equal(f.c.character.slots[offer.slot],undefined)});
 assert.equal(quantity,8);assert.equal(f.state.standBids.berry,undefined);assert.equal(Object.keys(f.state.nativeStand.purchases).length,0);
});
test('failed game purchase retains a persisted reservation and blocks retry',async()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'ALData marketplace purchases',bidItemId:'berry'};
 const args=[{jobId:'job',bidItemId:'berry'},{key:'listing'},{name:'berry'},100,1,async()=>{throw Error('timeout')}];
 await assert.rejects(f.c.standBuy(...args),/timeout/);assert.equal(Object.keys(f.state.nativeStand.purchases).length,1);
 await assert.rejects(f.c.standBuy(...args),/unconfirmed/);assert.equal(f.state.standBids.berry.quantity,9);
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
 await f.c.standBuy({jobId:'job',bidItemId:'vitscroll'},{key:'scrolls'},{name:'vitscroll'},9600,10,async q=>{bought+=q});
 assert.equal(bought,6);assert.equal(f.state.standBids.vitscroll,undefined);
 await f.c.standBuy({jobId:'job',bidItemId:'vitscroll'},{key:'scrolls'},{name:'vitscroll'},9600,10,async()=>assert.fail('duplicate purchase'));
 f.state.merchantCurrent=null;await f.c.nativeStandSync(null,false);
 assert.equal(Object.keys(f.state.nativeStand.offers).length,0);assert.equal(Object.keys(f.c.character.slots).length,0);
});
