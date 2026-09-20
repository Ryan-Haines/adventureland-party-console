const test=require('node:test'),assert=require('node:assert/strict');
const {restockInventorySatisfied}=require('../../runtime/coordinator/inventory/restock-completion.ts');
test('restock completion totals matching stacks against both maxima',()=>{
 const items=[null,{item:{name:'hp',q:2}},{item:{name:'hp',q:3}},{item:{name:'mp',q:4}},{item:{name:'other',q:999}}];
 assert.equal(restockInventorySatisfied(items,()=>({hp:{item:'hp',max:5},mp:{item:'mp',max:4}})),true);
 assert.equal(restockInventorySatisfied(items,()=>({hp:{item:'hp',max:6}})),false);
});
test('disabled targets are satisfied but missing inventory does not evaluate policy',()=>{
 assert.equal(restockInventorySatisfied([],()=>({hp:{max:0},mp:{max:-1}})),true);
 assert.equal(restockInventorySatisfied(null,()=>{throw Error('must not read policy');}),false);
});
test('legacy quantities and numeric targets retain their coercion behavior',()=>{
 const items=[{item:{name:'hp'}},{item:{name:'hp',q:0}},{item:{name:'hp',q:'3'}}];
 assert.equal(restockInventorySatisfied(items,()=>({hp:{item:'hp',max:'5'}})),true);
 assert.equal(restockInventorySatisfied(items,()=>({hp:{item:'hp',max:'invalid'}})),false);
});
