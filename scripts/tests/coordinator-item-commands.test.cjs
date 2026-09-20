const test=require('node:test'),assert=require('node:assert/strict');
const {createTransferCommands}=require('../../runtime/coordinator/inventory/transfer-commands.ts');
const {createMarkCommands}=require('../../runtime/coordinator/inventory/mark-commands.ts');
const identity=require('../../runtime/coordinator/inventory/item-identity.ts');
function fixture(){const item={name:'leather',q:8},state={merchantCharacter:'M',merchantWeapon:{item:{name:'sword'}},merchantDeliveries:{},withdrawals:{},bankSnapshot:{packs:{items0:[{slot:2,item}]}},bankbois:{B:{name:'B',items:[{slot:4,item}]}},commands:{},marked:{},merchantMarked:{},autoItemMarks:{},statuses:{F:{map:"main",server:"US I",x:0,y:0,seenAt:Date.now()},P:{map:"main",server:"US I",x:10,y:0,seenAt:Date.now()}}},calls=[];
 const transfers=createTransferCommands(state,{managed:n=>['M','F','P'].includes(n),nextCommand:()=>1,removeReservations:(...args)=>calls.push(['remove',...args]),clearIncoming:(...args)=>calls.push(['incoming',...args]),sameItem:identity.sameMarkedItem,identity:item=>item?.name||'',persist:()=>calls.push('persist'),persistBank:()=>calls.push('bank'),bankboi:async()=>calls.push('bankboi'),log(){}});
 const marks=createMarkCommands(state,{key:identity.autoItemRuleKey,mode:identity.autoItemRuleMode,reconcile:(...args)=>calls.push(['reconcile',...args]),persist:()=>calls.push('persist')});
 return {state,item,calls,send:body=>transfers.handle({character:'M',item,...body}),mark:body=>marks.handle({character:'F',item,...body})};}
test('merchant delivery is a toggleable reservation, transferable between recipients without dispatch',()=>{
 const f=fixture();f.send({type:'give',slot:2,target:'F',equipOnDelivery:true});assert.equal(f.state.merchantDeliveries.F[0].equipOnDelivery,true);assert.deepEqual(f.state.commands,{});
 f.send({type:'give',slot:2,target:'P'});assert.deepEqual(f.state.merchantDeliveries.F,[]);assert.equal(f.state.merchantDeliveries.P.length,1);
 f.send({type:'give',slot:2,target:'P'});assert.deepEqual(f.state.merchantDeliveries.P,[]);
});
test('normal character delivery retains reservations until inventory confirms the send',()=>{
 const f=fixture();f.send({character:'F',type:'give',slot:2,target:'P'});assert.equal(f.calls[0][0],'incoming');assert.equal(f.calls.some(call=>call[0]==='remove'),false);assert.equal(f.state.commands.F.type,'give');
 assert.equal(f.send({character:'F',type:'give',slot:2,target:'F'}),undefined);
});
test('transfer commands coexist with unrelated commands that have no item payload',()=>{
 const f=fixture(),command={id:8,type:'merchant-idle',purpose:'stand'};
 f.state.commands.M=command;
 f.send({character:'F',type:'give',slot:2,target:'P'});
 assert.equal(f.state.commands.M,command);assert.equal(f.state.commands.F.item,f.item);
});
test('withdraw-all covers normal bank and BankBoi once, while individual requests toggle',()=>{
 const f=fixture(),body={type:'withdraw',pack:'items0',slot:2,markAll:true};f.send(body);f.send(body);
 assert.deepEqual(f.state.withdrawals.M.map(r=>r.pack),['items0','bankboi:B']);assert.ok(f.calls.includes('bankboi'));
 f.send({...body,markAll:false});assert.equal(f.state.withdrawals.M.length,1);assert.equal(f.state.withdrawals.M[0].pack,'bankboi:B');
});
test('unequipping the chosen merchant mainhand clears its saved weapon',()=>{
 const f=fixture();f.send({type:'unequip',slot:'mainhand',item:{name:'sword'}});assert.equal(f.state.merchantWeapon,null);assert.equal(f.state.commands.M.type,'unequip');assert.equal(f.calls[0],'persist');
});
test('bank and merchant marks remain mutually exclusive and support legacy item-only marks',()=>{
 const f=fixture();f.mark({type:'mark',slot:2});f.mark({type:'merchant-mark',slot:2});assert.deepEqual(f.state.marked.F,[]);assert.equal(f.state.merchantMarked.F.length,1);
 f.mark({type:'mark',slot:2});assert.deepEqual(f.state.merchantMarked.F,[]);assert.equal(f.state.marked.F.length,1);
 f.state.marked.F=[f.item];f.mark({type:'mark',slot:2});assert.deepEqual(f.state.marked.F,[]);
});
test('automatic marks replace legacy zero-level rules and only clear the requested mode',()=>{
 const f=fixture();f.state.autoItemMarks.F={leather:'bank','sword@+1':'merchant'};f.mark({type:'auto-item-mark',mode:'bank'});assert.equal(f.state.autoItemMarks.F.leather,undefined);
 f.mark({type:'auto-item-mark',mode:'bank'});assert.equal(f.state.autoItemMarks.F['leather@+0'],'bank');
 f.mark({type:'clear-auto-item-marks',mode:'bank'});assert.deepEqual(f.state.autoItemMarks.F,{'sword@+1':'merchant'});
});

test('auto-bank withdrawals require confirmation without queuing or changing rules',()=>{
 const f=fixture();f.state.autoItemMarks.M={'leather@+0':'bank'};
 for(const markAll of [false,true]) {
  const result=f.send({type:'withdraw',pack:'items0',slot:2,markAll});
  assert.equal(result.status,409);assert.equal(result.body.code,'auto_bank_confirmation_required');
  assert.deepEqual(f.state.withdrawals,{});assert.equal(f.state.autoItemMarks.M['leather@+0'],'bank');assert.deepEqual(f.calls,[]);
 }
});

test('confirmed withdrawal removes explicit and legacy bank rules before scheduling and preserves other marks',()=>{
 const f=fixture();f.state.autoItemMarks.M={leather:'bank','leather@+0':'bank','leather@+1':'bank','sword@+0':'merchant'};
 f.state.autoItemMarks.F={'leather@+0':'bank'};
 const manual={slot:3,item:f.item},upgraded={slot:5,item:{name:'leather',level:1},auto:true};
 f.state.marked.M=[{slot:2,item:f.item,auto:true},manual,upgraded];
 assert.equal(f.send({type:'withdraw',pack:'bankboi:B',slot:4,markAll:true,removeAutoBankMark:true}),null);
 assert.deepEqual(f.state.autoItemMarks.M,{'leather@+1':'bank','sword@+0':'merchant'});
 assert.deepEqual(f.state.autoItemMarks.F,{'leather@+0':'bank'});assert.deepEqual(f.state.marked.M,[manual,upgraded]);
 assert.equal(f.state.withdrawals.M.length,2);assert.deepEqual(f.calls,['persist','bank','bankboi']);
});

test('canceling an existing withdrawal never requires removing its bank rule',()=>{
 const f=fixture();const body={type:'withdraw',pack:'items0',slot:2};f.send(body);f.calls.length=0;
 f.state.autoItemMarks.M={leather:'bank'};assert.equal(f.send(body),null);
 assert.deepEqual(f.state.withdrawals.M,[]);assert.equal(f.state.autoItemMarks.M.leather,'bank');assert.deepEqual(f.calls,['bank']);
});

test('merchant collection rules and other levels do not require bank confirmation',()=>{
 const f=fixture();f.state.autoItemMarks.M={leather:'bank','leather@+0':'merchant','leather@+2':'bank'};
 assert.equal(f.send({type:'withdraw',pack:'items0',slot:2}),null);
 assert.equal(f.state.autoItemMarks.M['leather@+0'],'merchant');
});

test('out-of-range fighter delivery preserves item marks and commands',()=>{
 const f=fixture();f.state.statuses.P.x=500;f.state.marked.F=[{slot:2,item:f.item}];const before=JSON.stringify(f.state);
 assert.equal(f.send({character:'F',type:'give',slot:2,target:'P'}).status,409);assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.calls,[]);
});
