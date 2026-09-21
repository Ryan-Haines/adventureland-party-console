const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const zones=require('../../dashboard/lib/farming-zones.ts');
const area={map:'halloween',x:-589,y:-335,boundary:[-654,-384,-525,-287]};
const inside={id:'inside',map:'halloween',x:-580,y:-330},fringe={id:'fringe',map:'halloween',x:-509,y:-626};
test('bounded zone wins exclusively; fringe is allowed only when it is empty',()=>{
 assert.deepEqual(zones.candidates(area,[inside,fringe],400),[inside]);
 assert.deepEqual(zones.candidates(area,[fringe],400),[fringe]);
 assert.deepEqual(zones.candidates(area,[{...fringe,map:'main'},{...fringe,y:-900}],400),[]);
 assert.deepEqual(zones.candidates({...area,boundary:undefined},[inside,fringe],400),[inside,fringe]);
 assert.deepEqual(zones.candidates({...area,boundary:[-654,-900,-398,-287]},[{...fringe,y:-850}],100),[{...fringe,y:-850}]);
});
test('queue filters claims and path exclusions before choosing zone, while passive rares remain available',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),entities={};
 for(const t of [inside,fringe])entities[t.id]={...t,mtype:'osnake',type:'monster',visible:true,hp:100};
 entities.rare={...fringe,id:'rare',mtype:'phoenix',type:'monster',visible:true,hp:100};
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{partyFarmingZones:zones},parent:{entities},character:{name:'W'},leader:'W',navigationIntent:{},partyConvoyActive:false,
  groupedFarming:()=>true,combatRecoveryActive:()=>false,monsterFocus:['osnake'],passiveRareHunts:{phoenix:true},
  partyLocation:area,monsterSearchRadius:400,farmApproach:{failed:{}},isExternallyClaimedMonster:t=>!!t.claimed,
  groupedEntityReport:t=>t,monsterPriority:t=>t.mtype==='phoenix'?100:50});
 vm.runInContext(source.slice(source.indexOf('  function inFarmArea('),source.indexOf('  var farmAreaEvidence'))+
  source.slice(source.indexOf('  function queueCandidates('),source.indexOf('  function queueReport(')),c);
 const ids=()=>Array.from(c.queueCandidates(),t=>t.id);
 assert.deepEqual(ids(),['inside','rare']);entities.inside.claimed=true;assert.deepEqual(ids(),['fringe','rare']);
 entities.inside.claimed=false;c.farmApproach.failed.inside=Date.now()+10000;assert.deepEqual(ids(),['fringe','rare']);
 c.farmApproach.failed={};assert.deepEqual(ids(),['inside','rare']);
 delete entities.rare;entities.second={...entities.inside,id:'second'};entities.third={...entities.inside,id:'third'};
 c.partyConvoyActive=true;assert.deepEqual(ids(),[]);assert.equal(c.root.__partyNomination.blocked,'convoy travel');
 c.partyConvoyActive=false;assert.deepEqual(ids(),['inside','second','third']);
 assert.deepEqual(Array.from(c.root.__partyNomination.eligible),['inside','second','third']);
 assert.equal(c.root.__partyNomination.rejected.fringe,'zone or target eligibility');
});

test('a follower nominates nearby ghosts outside the original spawn area for all three target rings',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const entities=Object.fromEntries([1,2,3].map(i=>['g'+i,{id:'g'+i,mtype:'ghost',type:'monster',visible:true,hp:100,map:'halloween',in:'halloween',x:i*20,y:0}]));
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{partyFarmingZones:zones},parent:{entities},
  character:{name:'M',map:'halloween',in:'halloween',x:0,y:0},leader:'W',navigationIntent:{},partyConvoyActive:false,
  groupedFarming:()=>true,combatRecoveryActive:()=>false,monsterFocus:['ghost'],huntCombatTarget:'ghost',passiveRareHunts:{},
  partyLocation:area,monsterSearchRadius:200,farmApproach:{failed:{}},isExternallyClaimedMonster:t=>!!t.claimed,
  groupedEntityReport:t=>t,monsterPriority:()=>50});
 vm.runInContext(source.slice(source.indexOf('  function inFarmArea('),source.indexOf('  var farmAreaEvidence'))+
  source.slice(source.indexOf('  function queueCandidates('),source.indexOf('  function queueReport(')),c);
 assert.deepEqual(Array.from(c.queueCandidates(),t=>t.id),['g1','g2','g3']);
 entities.g1.claimed=true;entities.g2.x=250;entities.g3.in='other';assert.deepEqual(Array.from(c.queueCandidates()),[]);
});

