// A two-fighter return convoy with travel observations (a shared setup lives in the harness).
const test = require('node:test'), assert = require('node:assert/strict');
const {retireTravelTargets} = require('../../../runtime/coordinator/targeting/snapshot.ts');
const defense = require('../../../runtime/movement/coordinator/defense.ts');
const {classifyTravelDefense, travelCombatFor} = defense;
const {evaluateGroup} = require('../../../runtime/coordinator/targeting/queue.ts');
// No member of this convoy is at an event: the tasks owner's `presence` answers none.
require('../helpers/requesters.cjs').publishPresence();
const target = {id:'bee1',mtype:'bee',server:'USII',map:'main',in:'main',x:580,y:750,hp:100,target:'GermanicHP',state:'engaged',startedAt:100,fighter:'GDroidPT'};
function status(name, at=1000) { return {name,seenAt:at,map:'main',in:'main',server:'USII',x:580,y:750,hp:100,convoyProtocol:4,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,epoch:0,reportedAt:at,observationAt:at,currentAttackersAt:at,currentAttackers:[],threats:[],sightings:[target],evidence:[],deaths:[],anchorVisible:true}}; }

function fixture(){
  const names=['GDroidPT','GermanicHP','QwenTina'];
  const p={nextCommandId:1,leader:names[0],commands:{},navigationIntents:{},statuses:Object.fromEntries(names.map(n=>[n,status(n)])),
    activeConvoy:{id:'trip',epoch:1,phase:'travel',purpose:'monster-hunt',participants:names,leader:names[0],completed:[],location:{map:'main',x:-100,y:-50}},
    groupedCombat:{fights:[target],queue:[target],evidence:[{...target,at:999,action:'old-hit'}],threats:[],deaths:[],target,selection:'old',committed:true,lostTargets:[]}};
  const issue=(_p,c,phase,name)=>({id:p.nextCommandId++,convoyId:c.id,epoch:c.epoch,phase,name});
  return {p,names,issue};
}

module.exports = { status, fixture };
