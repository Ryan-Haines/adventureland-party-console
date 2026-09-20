const test=require('node:test'),assert=require('node:assert/strict');
const {createCompoundCommands}=require('../../runtime/coordinator/inventory/compound-commands.ts');
function fixture(){const item={name:'ring',level:1},state={merchantCharacter:'M',compounds:{},autoCompounds:{},autoUpgradeMarks:{F:{rule:1}},upgrades:{F:[{auto:true},{}]},statuses:{F:{items:Array.from({length:6},(_,slot)=>({slot,item}))}},merchantQueue:[],merchantCurrent:null},calls=[];
 const service=createCompoundCommands(state,{persist:()=>calls.push('persist'),schedule:(...args)=>calls.push(['schedule',...args]),log:(...args)=>calls.push(args)});
 return {state,item,calls,send:body=>service.handle({character:'F',...body})};}
test('compound groups reserve disjoint triplets with the selected slot first',()=>{
 const f=fixture();f.send({type:'compound-mark',slot:4,item:f.item});f.send({type:'compound-mark',slot:5,item:f.item});
 assert.deepEqual(f.state.compounds.F.map(g=>g.items.map(i=>i.slot)),[[4,0,1],[5,2,3]]);
 assert.deepEqual(f.state.compounds.F.map(g=>g.id),['group-1','group-2']);assert.equal(f.send({type:'compound-mark',slot:4,item:f.item}).status,409);
});
test('removing a compound member retains the partial group until its final member is removed',()=>{
 const f=fixture();f.send({type:'compound-mark',slot:0,item:f.item});
 for(const slot of [0,1,2]){const result=f.send({type:'compound-mark',slot,item:f.item,remove:true});assert.equal(result.body.ok,true);}
 assert.deepEqual(f.state.compounds.F,[]);
});
test('automatic compound edits preserve a saved limit or default to unlimited',()=>{
 const f=fixture(),body={type:'auto-compound-mark',item:f.item,targetTier:2};f.send(body);assert.equal(f.state.autoCompounds.F[0].quantity,-1);
 f.send({...body,quantity:3});f.send({...body,targetTier:3});assert.equal(f.state.autoCompounds.F[0].quantity,3);
 assert.equal(f.send({...body,quantity:0}).status,400);assert.equal(f.state.autoCompounds.F[0].targetTier,3);
 f.send({...body,remove:true});assert.deepEqual(f.state.autoCompounds.F,[]);assert.equal(f.calls.at(-1)[0],'schedule');
});
test('clearing automations is merchant-only and lets an active compound job finish',()=>{
 const f=fixture();assert.equal(f.send({type:'clear-auto-compounds'}).status,409);
 f.state.merchantQueue=[{reason:'auto compound'},{reason:'manual visit'}];f.state.merchantCurrent={reason:'auto compound'};
 f.send({character:'M',type:'clear-auto-compounds'});assert.equal(f.state.merchantQueue.length,1);assert.equal(f.state.merchantCurrent.reason,'auto compound');
 f.send({character:'M',type:'clear-auto-upgrades'});assert.deepEqual(f.state.upgrades.F,[{}]);assert.deepEqual(f.state.autoUpgradeMarks.F,{});
});
