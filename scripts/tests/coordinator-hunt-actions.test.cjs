const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
function fixture(){
 const location={map:'main',x:1,y:2},state={combatMode:'auto',monsterHunt:null,leader:'F',monsterHunterLocation:location,
  statuses:{F:{}},monsterFocus:['bat'],monsterFocusByCharacter:{},monsterChoices:[],activeConvoy:null,commands:{},huntEventTrips:{}};
 const calls=[];let cancelled=false,fighting=false;
 const service=createHuntRoutes(state,{group:()=>null,
  now:()=>100000,participants:()=>['F'],intent:()=>({cancelled}),fighting:(current,names)=>{assert.equal(current,state);calls.push(['fighting',names]);return fighting;},
  release:()=>calls.push('release'),authorize:(...args)=>calls.push(['authorize',...args]),monsterDestination:()=>location,clear:()=>calls.push('clear'),
  selectedDestination:()=>({location}),convoy:()=>calls.push('convoy'),returnToDaisy:hunt=>calls.push(['daisy',hunt]),begin:(...args)=>calls.push(['begin',...args]),
  waypoint:()=>location,validLocation:(catalog,focus,destination)=>{assert.equal(catalog,state.monsterChoices);calls.push(['validate',focus]);return destination;},
  persist:()=>calls.push('persist'),owned:name=>name==='F',ownsTravel:()=>false,fresh:()=>true,cancelConvoy:()=>calls.push('cancel'),start:()=>calls.push('start'),
  write:require('./helpers/settings-writer.cjs').settingsWriter(state).write,
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,location,service,invoke,cancelled:value=>{cancelled=value;},fighting:value=>{fighting=value;}};
}

test('Hunt exit immediately clears completed turn-in state and retains live quest observations',()=>{
 const t=fixture();t.state.targetMode='hunt';const hunt={participants:['F'],returnLocation:t.location};t.state.monsterHunt=hunt;
 t.state.statuses.F={monsterHunt:{count:0}};
 assert.equal(t.invoke(t.service.mode,{mode:'default'}).code,200);
 assert.equal(t.state.monsterHunt,null);assert.equal(t.state.statuses.F.monsterHunt.count,0);
 assert.equal(t.calls.includes('clear'),true);assert.equal(t.calls.some(c=>c[0]==='daisy'),false);
 t.state.monsterChoices=[{id:'rat'}];
 assert.equal(t.invoke(t.service.blacklist,{action:'add',monsterId:'bat'}).code,400);
 assert.equal(t.invoke(t.service.blacklist,{action:'add',monsterId:'rat'}).code,200);
 assert.deepEqual(t.state.huntBlacklist.rat,{monsterId:'rat',at:100000,kind:'manual',deaths:0,expirations:0,reason:'Manually blacklisted'});
});
