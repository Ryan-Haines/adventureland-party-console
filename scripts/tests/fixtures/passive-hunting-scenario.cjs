// The passive hunting settings and their reports (a shared setup lives in the harness).
const {productionFunction} = require('../helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settings=require('../../../runtime/hunting/saved-fields.ts');
const {reconcileQueue}=require('../../../runtime/coordinator/targeting/queue.ts');
const {classifyTravelDefense}=require('../../../runtime/movement/coordinator/defense.ts');
const {collectPassing}=require('../../../runtime/characters/targeting/api.ts');
// helpers/client-dependencies.cjs passingContext is the passing combat context; the Hunt travel reads
// are the hunt client's, which it answers absent, so only the targeting names load here.
const {passingContext}=require('../helpers/client-dependencies.cjs');
function fixture(){
 const bee={id:'bee1',mtype:'bee',type:'monster',visible:true,hp:100,x:20,y:0,map:'main',in:'main'};
 // The party's passive rules on the hunting owner's rare client and the tasks owner's recovery hold, which a row changes.
 const passive={rules:{bee:{enabled:true,keepMoving:true,priority:100}},useFieldGenerators:false};
 const assignment={combatRecoveryHolds:()=>false};
 // The Hunt's facts on the hunting owner's doors, which a row changes: the loot hold, the rare run and the outbound Hunt walk.
 const focus={focus:[],huntTarget:null,partyType:null,mode:'default',lootPending:false,rare:{control:null,active:false,candidate:()=>false},contains:()=>false,inRadius:()=>false};
 // Movement's transition fact, which a row sets to 'town' or 'transport'.
 const movement={fresh:require('../../../runtime/protocol/reports.ts').fresh,transition:()=>null};
 const hunt={control:()=>null,defense:()=>false,status:()=>null,outbound:()=>false,extraAggro:()=>false,pause:()=>null,log:()=>{},rejection:()=>null};
 const c=passingContext({Date,Math,Object,String,Number,Promise,passiveGeneratorAttempt:null,
  character:{name:'W',ctype:'warrior',map:'main',in:'main',x:0,y:0,items:[],slots:{}},G:{classes:{warrior:{}},items:{},skills:{}},parent:{entities:{bee}},
  passiveRareHunts:{},fightDeaths:[],partyThreats:[],currentPartyList:()=>['W'],
  get_entity:id=>Object.values(c.parent.entities).find(e=>e.id===id),is_in_range:e=>Math.hypot(e.x,e.y)<=100,
  isExternallyClaimedMonster:e=>!!e.claimed,equip:()=>{throw Error('unexpected deployment');}},
 {movement,tasks:{partyList:()=>['W'],assignment},walks:{currentTravelAttackers:()=>[]},hunting:{facts:{focus},hunt,rares:{passive:()=>passive,fields:()=>[]}}});
 const names=['passiveLevelAllowed','passiveStopRequired','passiveTravelInterruptible','travelStopCandidates','returnDepartureDefense','committedHuntEncounter','passingKey','passingEncounterReport','isPassingEncounter','passingTravelAllowed','walkingPassiveTarget','passingTarget','beginPassingAttack','groupedEntityReport','monsterPriority','isPartyThreat','isAttackingPartyMember','nativeAttackProjectile','tinyProjectileProtected','rareAttackAllowed'];
 vm.runInContext(names.map(n=>productionFunction(n)).join('\n'),c);
 return {c,bee,passive,assignment,focus,hunt,movement};
}
module.exports = { fixture };
