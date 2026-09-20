const {test}=require('node:test');
const assert=require('node:assert/strict');
const {standIsFull}=require('../../dashboard/features/party/stand-capacity.ts');

test('stand capacity reserves explicit buys and releases paused sales and automatic buys',()=>{
 const sales=Array.from({length:15},(_,slot)=>({slot,item:{name:'coat'},price:10,quantity:1}));
 assert.equal(standIsFull(sales),false);
 assert.equal(standIsFull(sales,{sword:{useStandSlot:true}}),true);
 assert.equal(standIsFull(sales,{sword:{useStandSlot:false}}),false);
 assert.equal(standIsFull([...sales,{...sales[0],state:'paused'}]),false);
 assert.equal(standIsFull([...sales,sales[0]]),true);
});
