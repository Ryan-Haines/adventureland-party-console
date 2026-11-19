const {test}=require('node:test');
const assert=require('node:assert/strict');
const {standIsFull,standFullMessage}=require('../../dashboard/features/party/stand-capacity.ts');

test('the stand is full when 10\'s count has no free cell',()=>{
 assert.equal(standIsFull({}),false,'before the first core answer the coordinator refuses for itself');
 assert.equal(standIsFull({standSlots:{slots:16,used:15,free:1}}),false);
 assert.equal(standIsFull({standSlots:{slots:16,used:16,free:0}}),true);
 assert.equal(standIsFull({standSlots:{slots:30,used:16,free:14}}),false,'a 30-cell merchant stand takes a 17th listing');
 assert.equal(standFullMessage({standSlots:{slots:30,used:30,free:0}}),'Merchant stand is full (30/30)');
});
// The dashboard's full check and the coordinator's refusal read one count, the unpaused
// listings and the slot-reserving bids, as did; a queued listing holds no cell yet and still fills
// the stand, and a paused listing frees one.
test('D-D11: a queued listing and a slot-reserving bid fill the stand for both sides; a paused listing frees one',()=>{
 const {standSlotUse,standSlotsUsed,merchantStandSlots}=require('../../runtime/items/rules.ts');
 // 16 and 30 are the cell counts get_trade_slots gives a base and a level 80 merchant.
 for(const cells of [16,30]) {
  const listings=Array.from({length:cells-1},(_,i)=>({tradeSlot:'trade'+(i+1),state:'live'}));
  const state={merchantCharacter:'M',statuses:{M:{standSlots:cells,standOpen:false}},standListings:[...listings,{state:'queued'}],standBids:{b:{useStandSlot:true}}};
  const coordinatorRefuses=standSlotsUsed(state)>=merchantStandSlots(state);
  assert.equal(coordinatorRefuses,true,cells+' cells');
  assert.equal(standIsFull({standSlots:standSlotUse(state)}),coordinatorRefuses,cells+' cells');
  state.standListings[0].state='paused';state.standBids={};
  assert.equal(standSlotsUsed(state)>=merchantStandSlots(state),false,cells+' cells');
  assert.equal(standIsFull({standSlots:standSlotUse(state)}),false,cells+' cells');
 }
});
// The stand's cell count is one table, the game's get_trade_slots (G
// node/server_functions.js:4365-4376), which the merchant's bag reads.
test('standSlots gives 30 at merchant level 80, 24 at level 70 or on a cstand, else 16',()=>{
 const {standSlots}=require('../../runtime/items/rules.ts');
 const merchant=(level,stand)=>standSlots({ctype:'merchant',level,stand});
 assert.deepEqual([merchant(80,'stand0'),merchant(70,'stand0'),merchant(40,'cstand'),merchant(69,'stand0')],[30,24,24,16]);
 assert.equal(standSlots({ctype:'ranger',level:90,stand:'cstand'}),16,'only a merchant opens more than the base cells');
});
