const test=require('node:test'),assert=require('node:assert/strict');
const {createInventoryReceiptRoutes}=require('../../runtime/coordinator/http/inventory-receipts.ts');
function fixture(){
 const item={name:'ring',level:2};
 const state={commands:{F:{type:'bank'}},statScrolls:{F:[item,item]},withdrawals:{F:[item,item]},
   upgrades:{F:[item]},purchases:{F:[item]},compounds:{F:[{id:'a'},{id:'b'}]},bankCurrent:{name:'F'},bankStartedAt:10,
   merchantCatalog:{allItems:[{id:'ring',name:'Ring of Vitality'}]}};
 const calls=[],routes=createInventoryReceiptRoutes(state,{owned:name=>name==='F',log:(...args)=>calls.push(args),
   persist:()=>calls.push('persist'),persistBank:()=>calls.push('bank'),dispatchBank:()=>calls.push('dispatch')});
 function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};routes[route]({body},res);return res;}
 return {state,calls,send,item};
}
test('bank receipts consume one duplicate and dispatch only after persistence',()=>{
 const f=fixture();f.send('bank',{character:'F',withdrawn:[f.item],upgraded:[f.item],purchased:[f.item],compounded:['a']});
 assert.equal(f.state.withdrawals.F.length,1);assert.deepEqual(f.state.upgrades.F,[]);assert.deepEqual(f.state.compounds.F,[{id:'b'}]);
 assert.equal(f.state.bankCurrent,null);assert.equal(f.state.bankStartedAt,0);assert.equal(f.state.commands.F,undefined);
 assert.deepEqual(f.calls,['bank','persist','dispatch']);
 assert.equal(f.send('bank',{character:'F'}).code,409);
});
test('bank receipt refuses another owner and preserves unrelated commands',()=>{
 const f=fixture();assert.equal(f.send('bank',{character:'X',withdrawn:[f.item]}).code,409);assert.deepEqual(f.calls,[]);
 f.state.commands.F={type:'convoy'};f.send('bank',{character:'F'});assert.equal(f.state.commands.F.type,'convoy');
});
test('stat receipts consume individual matches and keep newer command types',()=>{
 const f=fixture();f.state.commands.F={type:'convoy'};
 assert.equal(f.send('statScrolls',{character:'F',resolved:[f.item]}).body.remaining,1);
 assert.equal(f.state.commands.F.type,'convoy');
 f.state.commands.F={type:'apply-stat-scrolls'};f.send('statScrolls',{character:'F'});assert.equal(f.state.commands.F,undefined);
 assert.equal(f.send('statScrolls',{character:'X'}).code,400);
});
test('equipment acknowledges only its command generation and logs catalog names',()=>{
 const f=fixture();f.state.commands.F={type:'equip-deliveries',id:8};
 assert.equal(f.send('equipment',{character:'F',commandId:7}).code,409);assert.deepEqual(f.calls,[]);
 f.send('equipment',{character:'F',commandId:8,results:[{item:f.item,success:true}]});
 assert.equal(f.calls[0][0],'Equipped delivered Ring of Vitality on F');assert.equal(f.state.commands.F,undefined);
});
