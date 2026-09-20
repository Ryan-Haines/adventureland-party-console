const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorHuntActions}=require('../../runtime/coordinator/http/hunt-actions.ts');
function fixture(){
 const location={map:'main',x:1,y:2},state={farmingPolicy:'auto',monsterHunt:null,leader:'F',monsterHunterLocation:location,
  statuses:{F:{}},monsterFocus:['bat'],monsterFocusByCharacter:{},monsterChoices:[],activeConvoy:null,commands:{},huntEventTrips:{}};
 const calls=[];let cancelled=false,fighting=false;
 const service=createCoordinatorHuntActions(state,{
  now:()=>100000,participants:()=>['F'],intent:()=>({cancelled}),fighting:(current,names)=>{assert.equal(current,state);calls.push(['fighting',names]);return fighting;},
  release:()=>calls.push('release'),authorize:(...args)=>calls.push(['authorize',...args]),monsterDestination:()=>location,clear:()=>calls.push('clear'),
  selectedDestination:()=>({location}),convoy:()=>calls.push('convoy'),returnToDaisy:hunt=>calls.push(['daisy',hunt]),begin:(...args)=>calls.push(['begin',...args]),
  waypoint:()=>location,validLocation:(catalog,focus,destination)=>{assert.equal(catalog,state.monsterChoices);calls.push(['validate',focus]);return destination;},
  persist:()=>calls.push('persist'),owned:name=>name==='F',ownsTravel:()=>false,fresh:()=>true,cancelConvoy:()=>calls.push('cancel'),start:()=>calls.push('start'),
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,location,service,invoke,cancelled:value=>{cancelled=value;},fighting:value=>{fighting=value;}};
}

test('Hunt mode consults current catalog and combat participants before authorizing a restart',()=>{
 const t=fixture();t.state.monsterChoices=[{id:'rat'}];t.fighting(true);
 assert.equal(t.invoke(t.service.mode,{mode:'hunt',backup:{monsterFocus:['rat'],location:t.location}}).code,200);
 assert.deepEqual(t.calls,[['validate',['rat']],['validate',['rat']],['fighting',['F']],['begin','auto',t.location,false],'persist']);
 assert.deepEqual(t.state.monsterFocus,['rat']);
 t.state.monsterHunt={participants:['F'],returnLocation:t.location,returnPolicy:'auto'};t.calls.length=0;
 t.fighting(false);t.cancelled(true);t.invoke(t.service.mode,{mode:'hunt'});
 assert.deepEqual(t.calls,[['fighting',['F']],'release',['authorize',['F'],t.location,true],['begin','auto',t.location,true],'persist']);
});

test('Hunt exit retains completed turn-ins and blacklist validation follows the current monster catalog',()=>{
 const t=fixture();t.state.farmingPolicy='hunt';const hunt={participants:['F'],returnLocation:t.location};t.state.monsterHunt=hunt;
 t.state.statuses.F={monsterHunt:{count:0}};
 assert.equal(t.invoke(t.service.mode,{mode:'default'}).code,200);
 assert.equal(hunt.exitMode,'default');assert.equal(t.calls[0][0],'daisy');assert.equal(t.calls[0][1],hunt);
 assert.equal(t.calls.includes('clear'),false);
 t.state.monsterChoices=[{id:'rat'}];
 assert.equal(t.invoke(t.service.blacklist,{action:'add',monsterId:'bat'}).code,400);
 assert.equal(t.invoke(t.service.blacklist,{action:'add',monsterId:'rat'}).code,200);
 assert.deepEqual(t.state.huntBlacklist.rat,{monsterId:'rat',at:100000,deaths:0,reason:'Manually blacklisted'});
});
