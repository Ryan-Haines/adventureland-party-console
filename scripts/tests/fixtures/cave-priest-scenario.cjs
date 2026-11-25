// Setups for the Cave priest recovery tests (scripts/tests/cave-priest-recovery.test.cjs), in the shared harness.
const {installCaveRecovery,createCaveRevival} = require('../../../runtime/characters/survival/cave-revival.ts');
const {createCave} = require('../../../runtime/hunting/coordinator/cave.ts');
function fixture() {
  let now=10000, saved={}, fighting=false, healing=false, essence=true, range=true;
  const actor={name:'P',ctype:'priest',map:'cave',in:'run',hp:100,max_hp:100,mp:1000,max_mp:1000,c:{}};
  const target={...actor,name:'W',ctype:'warrior',rip:true,hp:20,c:{}};
  const cave={run:'run',paused:false};const calls=[];
  // An assignment goes stale after two report gaps of the fixture's 1500 ms reports.
  const reportGap=1500,assignmentAge=2*reportGap;
  const assignment={id:'run:W:1',run:'run',target:'W',priest:'P',authorized:false};
  const ports={now:()=>now,current:()=>true,actor:()=>actor,cave:()=>cave,target:()=>target,
    essence:()=>essence,fighting:()=>fighting,livingNeedsHealing:()=>healing,healFlying:()=>false,
    // Two report gaps and no round trip.
    assignmentAge:()=>assignmentAge,margin:()=>0,
    cost:s=>s==='heal'?50:500,reserve:()=>350,inRange:()=>range,ready:()=>true,
    heal:async()=>{calls.push('heal');target.hp=100;},revive:async()=>{calls.push('revive');},approach:()=>calls.push('move'),
    read:()=>structuredClone(saved),write:v=>{saved=structuredClone(v);}};
  const client=installCaveRecovery(ports);client.receive(assignment);
  // The character's own install (cave-revival.ts `createCaveRevival`) over the same actor, target and
  // Cave, planted as the game's globals; `told` keeps what its notify port sent.
  const revival=()=>{
    const told=[],store={};
    Object.assign(actor,{cave,items:[{name:'essenceoflife'}],range:200,speed:50,x:0,y:0});target.visible=true;
    Object.assign(globalThis,{character:actor,get_player:name=>name===target.name?target:null,parent:{entities:{}},is_in_range:()=>true,G:{skills:{revive:{range:240}}}});
    const install=createCaveRevival({current:()=>true,members:()=>[],dungeonTarget:()=>false,reportGap:()=>1500,ready:()=>({ready:true,flying:false,reserve:0}),
      push:async()=>undefined,margin:()=>60000,cost:()=>0,approachPoint:()=>({x:0,y:0}),safePoint:()=>true,step(){},
      storage:()=>({getItem:key=>store[key]??null,setItem:(key,value)=>{store[key]=value;}}),notify:(hook,payload)=>told.push([hook,payload.phase])});
    return {install,told};
  };
  return {actor,target,cave,calls,assignment,assignmentAge,ports,client,revival,set:{fighting:v=>fighting=v,healing:v=>healing=v,essence:v=>essence=v,range:v=>range=v,advance:v=>now+=v}};
}
// The coordinator half is the Cave visit's (runtime/hunting/coordinator/cave.ts): its reconcile
// assigns and authorizes the priest, and the player's revival action calls Nera.
function priestRecovery(party) {
  const cave=createCave(party,{now:()=>10000,persist(){},cancel(){},offline:()=>false});
  return {reconcile:d=>{party.dailyDungeons=d;cave.reconcile();},
    manual:d=>{party.dailyDungeons=d;cave.action({action:'revival',run:d.run,operationId:'nera-'+d.operations.length});}};
}
function coordinator() {
  const party={statuses:{}};const d={phase:'active',run:'run',participants:['W','P','P2'],commands:{},operations:[]};
  for(const n of d.participants)party.statuses[n]={seenAt:10000,map:'cave',dungeon:{alive:n!=='W',cave:{run:'run',paused:false},
    recovery:{actor:{ctype:n==='W'?'warrior':'priest',c:{}},essence:true,phase:'idle'}}};
  const service=priestRecovery(party);return {party,d,service};
}
module.exports={fixture,coordinator,priestRecovery};
