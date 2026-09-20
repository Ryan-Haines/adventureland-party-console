const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {competitionHold}=require('../../runtime/coordinator/navigation/farm-competition.ts');
function fixture(){const area={id:'a',map:'mansion'};const p={farmingPolicy:'hunt',statuses:{},monsterSearchRadiusByCharacter:{W:100,P:200}};
 for(const [n,radius] of Object.entries(p.monsterSearchRadiusByCharacter))p.statuses[n]={seenAt:10000,map:'mansion',in:'mansion',server:'USII',combatSelection:{runtimeId:n},farmCompetition:{at:10000,runtimeId:n,revision:1,areaId:'a',map:'mansion',in:'mansion',server:'USII',radius,monsters:{},players:['Other']}};
 return {p,check:()=>competitionHold(p,{intent:()=>({revision:1})},['W','P'],area,['rat'],'Other',10000)};}
test('all member radii must be empty, with fresh matching observations and competitor present',()=>{
 const f=fixture();assert.equal(f.check(),null);f.p.statuses.P.farmCompetition.monsters.rat=1;assert.match(f.check(),/monsters remain/);
 f.p.statuses.P.farmCompetition.monsters={goo:2};assert.equal(f.check(),null);
 f.p.statuses.P.farmCompetition.at=6000;assert.match(f.check(),/fresh/);f.p.statuses.P.farmCompetition.at=10000;
 f.p.statuses.P.farmCompetition.revision=2;assert.match(f.check(),/fresh/);f.p.statuses.P.farmCompetition.revision=1;
 for(const r of Object.values(f.p.statuses))r.farmCompetition.players=[];assert.match(f.check(),/no longer nearby/);
 f.p.huntSettings={relocateIfCompeting:false};assert.match(f.check(),/disabled/);
});
test('client observes live monsters within its radius irrespective of claims and excludes dead or other-instance entities',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'), c=vm.createContext({parent:{socket:{connected:true},server_region:'US',server_identifier:'II',entities:{}},character:{name:'W',map:'mansion',in:'mansion',x:0,y:0},partyLocation:{id:'a'},currentPartyList:()=>['W','P'],monsterSearchRadius:100,Date:{now:()=>100},coordinatorClockOffset:0,convoyRuntimeId:'W',navigationIntent:{revision:1}});
 vm.runInContext(source.slice(source.indexOf('  function farmCompetitionObservation()'),source.indexOf('  function observeFarmArea()')),c);
 const rat={type:'monster',mtype:'rat',x:99,y:0,hp:10,visible:true};
 c.parent.entities={a:rat,b:{...rat,target:'Other'},dead:{...rat,hp:0},far:{...rat,x:101},wrong:{...rat,in:'other'},player:{type:'character',name:'Other',visible:true,x:5,y:0},party:{type:'character',name:'P',visible:true,x:5,y:0}};
 const o=c.farmCompetitionObservation();assert.equal(o.monsters.rat,2);assert.deepEqual(Array.from(o.players),['Other']);
 c.parent.socket.connected=false;assert.equal(c.farmCompetitionObservation(),null);
});
