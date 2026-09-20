const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {isEquipment,isUsable}=require('../../dashboard/features/party/item-actions.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
const start=source.indexOf('  function isDashboardEquipment('),end=source.indexOf('  async function equipDeliveredItems(',start);
const deliveryEnd=source.indexOf('    return results;',end)+'    return results;'.length;
function fixture(){
 const calls=[],definitions={sword:{type:'weapon'},tracktrix:{type:'tracker'},shadowstone:{type:'stone'},fieldgen0:{type:'spawner'},elixir:{type:'elixir'}};
 const context={G:{items:definitions},character:{items:[{name:'elixir'}],slots:{}},consume:async slot=>calls.push(slot),sameItemState:(a,b)=>!!a&&a.name===b.name};
 vm.createContext(context);vm.runInContext(source.slice(start,deliveryEnd)+'\n  }',context);
 return {context,calls,definitions};
}
test('equipment eligibility excludes consumables and unknown types, and matches the execution guard',()=>{
 const {context,definitions}=fixture();
 for(const [name,definition] of Object.entries(definitions))assert.equal(context.isDashboardEquipment({name}),isEquipment(definition));
 for(const type of ['tracker','stone','spawner','elixir','unknown'])assert.equal(isEquipment({type}),false);
 for(const type of ['weapon','ring','misc_offhand','tool'])assert.equal(isEquipment({type}),true);
 assert.equal(isEquipment(),false);assert.equal(isUsable({type:'elixir'}),true);
});
test('stale delivery equipment requests reject non-equipment before any game action',async()=>{
 const {context,calls}=fixture();
 const results=await context.equipDeliveredItems([{name:'fieldgen0'},{name:'tracktrix'},{name:'shadowstone'},{name:'elixir'}]);
 assert.equal(results.length,4);assert.ok(results.every(result=>result.success===false&&result.error==='item is not equipment'));assert.deepEqual(calls,[]);
});
test('explicit Use consumes the selected item and rejects stale slots or unsupported items',async()=>{
 const {context,calls}=fixture();
 await context.useDashboardItem({slot:0,item:{name:'elixir'}});assert.deepEqual(calls,[0]);
 await assert.rejects(context.useDashboardItem({slot:0,item:{name:'fieldgen0'}}),/no longer matches/);
 context.character.items[0]={name:'sword'};
 await assert.rejects(context.useDashboardItem({slot:0,item:{name:'sword'}}),/no supported Use/);
 assert.deepEqual(calls,[0]);
});
