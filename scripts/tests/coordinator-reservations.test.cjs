const test=require('node:test'),assert=require('node:assert/strict');
const {createInventoryReservations}=require('../../runtime/coordinator/inventory/reservations.ts');
test('outgoing slots release reservations but preserve equipped upgrades and partial compounds',()=>{
  const item={name:'ring',q:2}, other={name:'ring',q:3};
  const partial={id:'partial',items:[{slot:1,item},{slot:2,item}]};
  const state={marked:{M:[item,other,{slot:1,item:other},{slot:2,item}]},merchantMarked:{M:[{slot:1},{slot:2}]},
    upgrades:{M:[{slot:1},{slot:1,equipped:true},{slot:2}]},compounds:{M:[partial,{items:[{slot:1,item}]}]}};
  createInventoryReservations(state).remove('M',1,item);
  assert.deepEqual(state.marked.M,[other,{slot:2,item}]);
  assert.deepEqual(state.merchantMarked.M,[{slot:2}]);
  assert.deepEqual(state.upgrades.M,[{slot:1,equipped:true},{slot:2}]);
  assert.deepEqual(state.compounds.M,[{id:'partial',items:[{slot:2,item}]}]);
  assert.equal(state.compounds.M[0],partial);
});
test('incoming reservations use exact item payload and remove empty groups only',()=>{
  const item={name:'ring',q:2},other={name:'ring',q:3};
  const state={marked:{},merchantMarked:{},upgrades:{},compounds:{M:[{items:[{slot:1,item}]},{items:[{slot:2,item:other},{slot:3,item}]}]}};
  const service=createInventoryReservations(state);service.clearIncoming('M',item);
  assert.deepEqual(state.compounds.M,[{items:[{slot:2,item:other}]}]);
  service.remove('Missing',0,item);service.clearIncoming('Other',item);
  assert.deepEqual(state.compounds.Missing,[]);assert.deepEqual(state.compounds.Other,[]);
});
