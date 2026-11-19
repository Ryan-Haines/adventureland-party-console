// The character's barrier request client (a shared setup lives in the harness).
const vm=require('node:vm');
// sharedMovementOptions names its walk through the movement requesters (runtime/movement/character/owner.ts),
// and the harness gives every context the walk client (walk-client.ts `createWalkClient`), whose
// barrier this runs on the context's clock.
const { createMovementContext } = require('./movement-owner-callers.cjs');
function fixture(handler){
 let now=0,calls=0;const command={id:3,convoyId:'C',epoch:2,routeVersion:1,continuousReturn:1,phase:'shared-travel'};
 const c={character:{name:'W'},groupWalk:{travel:{id:'C',commandId:3}},convoyRuntimeId:'R',convoySignal:{id:'C',commandId:3,epoch:2,routeVersion:1,runtimeId:'R',validUntil:999999},Date:{now:()=>now},performance:{now:()=>now},departureCombatPending:()=>false,eligibleDepartureChests:()=>[],can_use:()=>true,setTimeout:fn=>{now+=250;fn();},request:async(...args)=>{calls++;now+=2000;return handler(calls,c,args);}};
 createMovementContext(c);
 return {c,command,run:done=>c.sharedMovementOptions(command).barrier({map:'main',x:0,y:0,town:true},0,done),calls:()=>calls};
}

module.exports = { fixture };
