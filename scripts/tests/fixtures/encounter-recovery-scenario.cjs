// The encounter catch-up and its handoff (a shared setup lives in the harness).
const vm=require('node:vm');
const { createMovementContext } = require('./movement-owner-callers.cjs');
function catchup(){
 let moves=0,stops=0,time=10000;
 const target={id:'phoenix',mtype:'phoenix',map:'main',in:'main',server:'USII',x:100,y:0};
 const control={id:'C',epoch:1,defending:true,primary:target};
 const c=createMovementContext({character:{map:'mtunnel',in:'mtunnel'},root:{},smart:{},Date:{now:()=>time},
  groupWalk:{travel:{id:'C',epoch:1,commandId:2,navigationRevision:3,phase:'defending',defensePaused:true}},
  navigationIntent:{revision:3},eventTraveling:false,joinedEvent:null,escapeOwns:()=>false,groupedFresh:()=>true,
  huntTravelControl:()=>control,reunionRealm:()=> 'USII',passingKey:t=>JSON.stringify([t.server,t.map,t.in,t.id]),
  smart_move(destination){moves++;return new Promise(()=>{});},stop(){return Promise.resolve();},
  // Step 10: the catch-up ends its own walk by releasing it (design section 1.3).
  movement:{release(){stops++;return true;}}});
 require('../helpers/group-movement.cjs').installGroupMoves(c);
 return {c,control,target,moves:()=>moves,stops:()=>stops,advance:n=>time+=n};
}
function handoff(){
 const cycle={id:'anniversary',returnDispatchedAt:1000,participants:['W'],waypoints:{W:{revision:3}},returnRoutes:{W:{revision:3,convoyId:'C'}}};
 const state={targetMode:'hunt',monsterHunt:{stage:'checking-quests',target:null,message:'old'},
  activeConvoy:{id:'C',phase:'assemble'},commands:{W:{convoyId:'C'}},deferredEventReturns:{},statuses:{W:{seenAt:10000,hp:100,groupedCombat:{currentAttackersAt:10000,currentAttackers:[]}}}};
 const ports={now:()=>10000,persist(){},navigation:{intent:()=>({revision:3}),finish(c){c.returnCompletedAt=10000;state.activeConvoy=null;}}};
 return {cycle,state,ports};
}

module.exports = { catchup, handoff };
