const test=require('node:test'),assert=require('node:assert/strict');
const {initialCollectionState}=require('../../runtime/coordinator/inventory/initial-collection.ts');
test('collection thresholds preserve integer validation and slot clamping',()=>{
 assert.equal(initialCollectionState({threshold:0,itemCollectionThreshold:99},{}).threshold,0);
 assert.equal(initialCollectionState({itemCollectionThreshold:99},{}).itemCollectionThreshold,42);
 assert.equal(initialCollectionState({itemCollectionThreshold:-2},{}).itemCollectionThreshold,1);
 const state=initialCollectionState({threshold:'5',itemCollectionThreshold:2.5},{});assert.equal(state.threshold,100000);assert.equal(state.itemCollectionThreshold,1);
});
test('explicit selection maps take precedence over legacy marks without mutation',()=>{
 const empty={},saved={M:[1]},state=initialCollectionState({marked:saved,merchantMarked:saved,autoItemMarks:saved,autoUpgradeMarks:saved},{marked:empty,autoItemMarks:empty});
 assert.equal(state.marked,empty);assert.equal(state.autoItemMarks,empty);assert.equal(state.merchantMarked,saved);assert.equal(state.autoUpgradeMarks,saved);assert.deepEqual(state.statuses,{});
 assert.notEqual(initialCollectionState({},{}).marked,initialCollectionState({},{}).marked);
});
