// The character's travel combat slice (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(grouped=false){
 const passive={id:'bee',type:'monster',mtype:'bee',visible:true,hp:100,x:0,y:0};
 const c=require('../helpers/client-dependencies.cjs').passingContext({root:{__partyTravelCombat:{id:'return',revision:3},__partyDefensiveHit:{at:1000,target:passive}},
  fightDeaths:[],character:{name:'W',map:'main',in:'main'},parent:{entities:{bee:passive}},navigationIntent:{revision:3},
  reunionRealm:()=> 'USII',isAttackingPartyMember:e=>e.target==='P',
  // The hunting owner's Cave and grouped answers, as shared.js binds them for movement's walk client.
  dungeonOwned:()=>false,groupedFarming:()=>grouped,currentPartyList:()=>['W','P'],
  groupedCombat:{protocol:4,target:{...passive,map:'main',in:'main',server:'USII',state:'engaged'}},
  isExternallyClaimedMonster:()=>false,combatTargetId:'bee',farmingTravelToken:null,departurePending:false,
  game_log(){},setTimeout,engagedMonster(){assert.fail('historic fight must not be consulted during travel');}},
 {tasks:{partyList:()=>['W','P']},hunting:{farm:{grouped:()=>grouped}}});
 // The kept shared.js functions; targeting's come from its module (helpers/targeting-module.cjs).
 vm.runInContext(require('../helpers/production-functions.cjs').productionFunctions(['afterCombat']),c);
 require('../helpers/walk-reports.cjs').installWalkDefense(c);
 return {c,passive};
}

module.exports = { fixture };
