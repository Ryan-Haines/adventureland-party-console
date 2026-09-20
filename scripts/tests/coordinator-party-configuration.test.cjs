const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPartyConfiguration}=require('../../runtime/coordinator/http/party-configuration.ts');
function fixture(){
 const state={leader:'F',merchantCharacter:'M',followers:{Q:true},eventsByCharacter:{},eventSelectionsByCharacter:{},
  monsterFocus:['bat'],monsterFocusByCharacter:{},monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},scatterMonsterTypes:[],scatterEpoch:1,
  partyFarmingMode:'default',partyFarmingMonsterType:'bat',scatterBreakTarget:null,statuses:{},location:null,commands:{},nextCommandId:40,townCycle:null,
  escape:null,merchantCurrent:null,merchantQueue:[],upgrades:{},purchases:{},compounds:{},autoCompounds:{}};
 const workers={F:{}},calls=[];
 const service=createCoordinatorPartyConfiguration(state,workers,{
  owned:name=>['F','Q'].includes(name),members:()=>['F','Q'],invalidate:(...args)=>calls.push(['invalidate',...args]),persist:()=>calls.push('persist'),
  supported:['anniversary','franky'],inherited:()=>false,selected:()=>['anniversary'],now:()=>100000,release:()=>calls.push('release'),
  active:()=>['F','Q'],authorize:(...args)=>calls.push(['authorize',...args]),dispatch:()=>{},escape:()=>{},queue:()=>{},
  convoy:(location,label,names)=>{for(const name of names)state.commands[name]={id:state.nextCommandId++,type:'party-monster-travel',location};return true;},
 });
 function invoke(handler,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,workers,calls,service,invoke};
}

test('party configuration consults current managed workers and focus clearing invalidates shared navigation',()=>{
 const t=fixture();assert.equal(t.invoke(t.service.formation,{leader:'toString'}).code,400);
 t.workers.Q={};assert.equal(t.invoke(t.service.formation,{leader:'Q'}).code,200);assert.equal(t.state.leader,'Q');
 t.calls.length=0;
 assert.equal(t.invoke(t.service.focus,{monsterFocus:[]}).code,200);
 assert.deepEqual(t.calls,[['invalidate',['F','Q'],'monster focus cleared',true],'persist']);
 assert.deepEqual(t.state.monsterFocus,[]);
});

test('travel and Town commands allocate from current command state after navigation authorization',()=>{
 const t=fixture();t.state.nextCommandId=80;t.state.commands={};
 assert.equal(t.invoke(t.service.actions.travel,{map:'main',x:'1',y:2}).code,200);
 assert.deepEqual(t.calls,['release',['authorize',['F','Q'],{map:'main',x:1,y:2},true],'persist']);
 assert.equal(t.state.commands.F.id,80);assert.equal(t.state.commands.Q.id,81);
 t.calls.length=0;t.invoke(t.service.actions.town);
 assert.deepEqual(t.calls,['release',['invalidate',['F','Q'],'manual Town',true],'persist']);
 assert.equal(t.state.townCycle.id,'town-100000-82');assert.equal(t.state.commands.F.id,83);assert.equal(t.state.commands.Q.id,84);
 assert.equal(t.state.nextCommandId,85);
});
