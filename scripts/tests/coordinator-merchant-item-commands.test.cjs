const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantItemCommands}=require('../../runtime/coordinator/inventory/merchant-item-commands.ts');
function fixture(){const item={name:'sword',level:2},state={merchantCharacter:'M',merchantWeapon:null,statuses:{M:{items:[{slot:2,item,meta:{definition:{type:'weapon',wtype:'short_sword'}}}]}},merchantCatalog:{exchangeable:[{id:'sword',level:2}]},autoExchanges:{},purchases:{}},calls=[];
 const service=createMerchantItemCommands(state,{persist:()=>calls.push('persist'),scheduleExchange:()=>calls.push('exchange')});
 return {state,item,calls,send:body=>service.handle({character:'M',item,slot:2,...body})};}
test('weapon selection validates the exact live item and merchant-compatible type',()=>{
 const f=fixture();assert.equal(f.send({type:'merchant-weapon',item:{name:'sword',level:1}}).status,409);assert.equal(f.send({character:'F',type:'merchant-weapon'}),undefined);
 f.send({type:'merchant-weapon'});assert.deepEqual(f.state.merchantWeapon,{item:f.item});f.send({type:'merchant-weapon',remove:true});assert.equal(f.state.merchantWeapon,null);
 f.state.statuses.M.items[0].meta.definition.wtype='great_sword';assert.equal(f.send({type:'merchant-weapon'}).status,400);
});
test('automatic exchange validates level and toggles before scheduling',()=>{
 const f=fixture();f.send({type:'auto-exchange'});assert.deepEqual(f.state.autoExchanges['sword@2'],{name:'sword',level:2});assert.deepEqual(f.calls,['persist','exchange']);
 f.send({type:'auto-exchange'});assert.equal(f.state.autoExchanges['sword@2'],undefined);f.state.merchantCatalog.exchangeable[0].reward=true;assert.equal(f.send({type:'auto-exchange'}).status,400);
});
test('buy-copy preserves repeated requests and only stores the item name',()=>{
 const f=fixture();f.send({character:'F',type:'buy-copy'});f.send({character:'F',type:'buy-copy'});assert.deepEqual(f.state.purchases.F,[{name:'sword'},{name:'sword'}]);
});
