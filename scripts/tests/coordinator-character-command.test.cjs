const test=require('node:test'),assert=require('node:assert/strict');
const {createCharacterCommandRoute}=require('../../runtime/items/coordinator/routes/characters.ts');
const {createFarmingCommand}=require('../../runtime/hunting/coordinator/routes.ts');
const {createStatScrollCommands}=require('../../runtime/items/coordinator/production.ts');
function routeFixture(){
 const state={monsterChoices:[],farmAreaState:null,leader:null,monsterFocusByCharacter:{},marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},statScrolls:{},compounds:{},withdrawals:{}};
 const calls=[],ports={managed:n=>n==='F',handlers:[],farming:createFarmingCommand(state,{farmingState:()=>state,persist(){},members:()=>[],invalidate(){},
  location:(_choices,ids,location)=>{calls.push(['location',ids]);return location;}})};
 const route=createCharacterCommandRoute(state,ports);
 function send(body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};route({body},res);return res;}
 return {state,ports,calls,send};
}
test('command boundary validates farming area before character and never runs rejected requests',()=>{
 const f=routeFixture();f.ports.handlers.push(()=>{throw Error('must not run');});
 assert.equal(f.send({character:'X',farmingMonsterIds:['phoenix']}).body.error,'The selected farming area is no longer available');
 assert.equal(f.send({character:'X'}).body.error,'unknown character');
 for(const farmingMonsterIds of [null,[],['tinyp']])assert.equal(f.send({character:'F',farmingMonsterIds}).code,400);
});
test('command boundary preserves accepted farming location, response keys and first-handler ownership',()=>{
 const f=routeFixture(),location={map:'main',x:1,y:2};
 f.ports.handlers.push(()=>undefined,body=>{f.state.marked.F=[body.location];return null;},()=>{throw Error('double dispatch');});
 const response=f.send({character:'F',farmingMonsterIds:['goo'],location});
 assert.deepEqual(f.state.farmAreaState,{preferredLocation:location});assert.equal(f.calls.length,2);
 assert.deepEqual(response.body,{ok:true,marked:[location],merchantMarked:[],autoItemMarks:{},upgrades:[],statScrolls:[],compounds:[],withdrawals:[]});
});
test('command boundary keeps explicit error and deferred responses and rejects unhandled commands',()=>{
 const f=routeFixture();assert.equal(f.send({character:'F'}).code,400);
 f.ports.handlers.push(()=>({status:409,body:{error:'blocked'}}));assert.deepEqual(f.send({character:'F'}).body,{error:'blocked'});
 f.ports.handlers[0]=()=>({status:200,body:{ok:true,deferredUntilEventEnd:true}});assert.equal(f.send({character:'F'}).body.deferredUntilEventEnd,true);
});
function statFixture(level=0){
 const item={name:'coat',level},equipped={slot:1,item,meta:{definition:{stat:1,upgrade:'armor',grades:[1,2,3,4]}}};
 const state={merchantCharacter:'M',statuses:{M:{items:[equipped]},F:{primaryStat:'dex',slots:{chest:equipped}}},bankSnapshot:{packs:{}},statScrolls:{}},calls=[];
 const service=createStatScrollCommands(state,{persist:()=>calls.push('persist'),queue:(...args)=>calls.push(args)});
 return {state,item,calls,send:body=>service.handle({character:'M',type:'stat-scroll-mark',item,slot:1,...body})};
}
test('equipped stat commands use the character primary stat and reject ordinary-character bag slots',()=>{
 const f=statFixture();assert.equal(f.send({character:'F',slot:'chest',statType:'str'}),null);
 assert.equal(f.state.statScrolls.F[0].statType,'dex');assert.equal(f.state.statScrolls.F[0].equipped,true);assert.deepEqual(f.calls,['persist']);
 assert.equal(f.send({character:'F',slot:1}),undefined);
});
for(const [level,required] of [[0,1],[1,10],[2,100],[3,1000],[4,9999]])test('non-primary stat grade '+level+' requires '+required+' scrolls across merchant and bank',()=>{
 const f=statFixture(level);f.state.bankSnapshot.packs.items0=[{slot:4,item:{name:'mpcostscroll',q:required-1}}];
 if(required===1)f.state.bankSnapshot.packs.items0=[];
 assert.equal(f.send({statType:'mp_cost'}).status,409);
 f.state.statuses.M.items.push({slot:5,item:{name:'mpcostscroll',q:1}});
 assert.equal(f.send({statType:'mp_cost'}),null);assert.equal(f.state.statScrolls.M[0].scroll,'mpcostscroll');assert.deepEqual(f.calls.at(-1),[['M'],'stat scrolls']);
});
test('stat marking rejects stale items and already applied stats but permits removing a mark without scroll stock',()=>{
 const f=statFixture();assert.equal(f.send({item:{name:'other'},statType:'dex'}).status,409);
 f.item.stat_type='dex';assert.equal(f.send({statType:'dex'}).status,409);
 f.state.statScrolls.M=[{slot:1,item:f.item,statType:'luck'}];assert.equal(f.send({statType:'luck',remove:true}),null);assert.deepEqual(f.state.statScrolls.M,[]);
});
// The command's farming rule is the hunting owner's (createFarmingCommand), over the scope the
// character farms in: the farm area check, the preferred spot and the character's focus.
test('07\'s farming half of the command checks the area, keeps the spot and sets the character\'s focus',()=>{
 const scope={leader:'L',monsterFocus:[],monsterFocusByCharacter:{},farmAreaState:null},state={monsterChoices:[],farmAreaState:null},location={map:'main',x:1,y:2};
 const farming=createFarmingCommand(state,{farmingState:()=>scope,location:(_c,_ids,at)=>at,members:()=>['L','F'],invalidate(){},persist(){}});
 assert.equal(farming.valid({farmingMonsterIds:['phoenix'],location}),false);
 const body={character:'F',farmingMonsterIds:['goo','goo'],location};
 assert.equal(farming.valid(body),true);farming.place(body);farming.focus(body);
 assert.deepEqual(state.farmAreaState,{preferredLocation:location});assert.deepEqual(scope.monsterFocusByCharacter.F,['goo']);
});
