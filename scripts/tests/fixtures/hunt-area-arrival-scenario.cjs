// A Hunt convoy arriving at its mission spawn (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict');
const {stepHuntArrival}=require('../../../runtime/movement/coordinator/arrivals.ts');
const {sharedCommand}=require('../../../runtime/movement/coordinator/walk.ts');
const {reconcileQueue}=require('../../../runtime/coordinator/targeting/queue.ts');
function fixture(stage='mission-travel') {
 const names=['W','P','M'], now=10000, area={map:'spookytown',x:677,y:129,boundary:[501,61,852,197]};
 const h={cycleId:'H',stage,target:'stoneworm',currentIndex:0,missionRevision:2,missions:[{target:'stoneworm',destination:area}],participants:names,convoyId:'C'};
 const c={id:'C',epoch:5,phase:'travel',purpose:'monster-hunt',huntTarget:'stoneworm',participants:names,leader:'W',location:area,rally:{map:area.map,x:0,y:0},completed:[],expected:{},runtimes:{}};
 const s={monsterHunt:h,activeConvoy:c,commands:{},statuses:{},navigationIntents:{},nextCommandId:10};
 for(const n of names){s.navigationIntents[n]={revision:1};s.statuses[n]={name:n,map:area.map,in:area.map,server:'USII',x:510,y:70,hp:100,seenAt:now,moving:true,convoyProtocol:4,combatSelection:{runtimeId:n},groupedCombat:{currentAttackersAt:now,currentAttackers:[]}};c.runtimes[n]=n;s.commands[n]=sharedCommand(s,c,'shared-travel',n);}
 const step=()=>stepHuntArrival(s,c,now,sharedCommand);
 function ack(){for(const n of names){const cmd=s.commands[n];s.statuses[n].moving=false;s.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:1,runtimeId:n,phase:'held'};}}
 return {s,c,h,names,now,step,ack};
}

module.exports = { fixture };
