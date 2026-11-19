const test=require('node:test'),assert=require('node:assert/strict');
const {createStandMarks}=require('../../runtime/items/coordinator/market.ts');

test('removing one bank-backed queued sale preserves the automatic rule and its price',()=>{
 const item={name:'frankypants',level:2},rule={item,price:12345,createdAt:1};
 const state={autoStandMarks:{pants:rule},merchantCharacter:'M',standListings:[{id:'sale',item,bankPack:'items0',bankSlot:2,state:'waiting'}],withdrawals:{M:[{pack:'items0',slot:2,item}]},statuses:{},bankSnapshot:null};
 createStandMarks(state,{now:()=>1,nextCommand:()=>1}).remove(0,'items0',2,item);
 assert.equal(state.standListings.length,0);assert.equal(state.withdrawals.M.length,0);
 assert.equal(state.autoStandMarks.pants,rule);assert.equal(rule.price,12345);
});
