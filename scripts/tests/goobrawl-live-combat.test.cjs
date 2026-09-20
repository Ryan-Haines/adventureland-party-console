const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shared=fs.readFileSync(process.env.AL_SHARED_SOURCE || 'characters/shared.js','utf8');
const coordinator=require('./helpers/coordinator-source.cjs').coordinatorSource();
test('visible Brawl Goos corroborate live combat without a server event flag; empty arena does not',()=>{
 let now=1000;const c=require('./helpers/client-dependencies.cjs').passingContext({character:{map:'goobrawl'},parent:{entities:{a:{type:'monster',mtype:'bgoo',hp:100}}},Date:{now:()=>now}});
 vm.runInContext(shared.slice(shared.indexOf('  var goobrawlEvidenceCache'),shared.indexOf('  function activeCombatEvent()')),c);
 assert.equal(c.hasGoobrawlCombat(),true);c.parent.entities.a.dead=true;now+=251;assert.equal(c.hasGoobrawlCombat(),false);
 c.parent.entities.a.dead=false;c.character.map='main';assert.equal(c.hasGoobrawlCombat(),false);
});
test('live Goobrawl cancels only its stale return commands and convoy, retaining the farming checkpoint',()=>{
 const location={map:'winterland',x:20,y:-1109};const party={location,statuses:{W:{map:'goobrawl',seenAt:1000,goobrawlCombat:true}},
 eventReturn:{event:'goobrawl',cycleId:'old',convoyId:'convoy'},activeConvoy:{id:'convoy'},commands:{W:{type:'event-return-town',cycleId:'old'},M:{type:'merchant-service'}},deferredEventReturns:{P:{cycleId:'old'}}};
 const c={party,Date:{now:()=>1000},persistSettings(){},cancelActiveConvoy(){party.activeConvoy=null;}};
 Object.assign(c,require('./helpers/coordinator-events.cjs').eventService(c));
 assert.equal(c.beginEventReturn('goobrawl',{}),null);assert.equal(c.cancelPrematureGoobrawlReturn(),true);
 assert.equal(party.activeConvoy,null);assert.equal(party.eventReturn,null);assert.equal(party.commands.W,undefined);assert.ok(party.commands.M);assert.equal(party.location,location);
});
test('stale reports and merely standing in an empty arena do not suppress return',()=>{
 const party={statuses:{W:{map:'goobrawl',seenAt:1000,goobrawlCombat:false}}};const c={party,Date:{now:()=>20000}};
 Object.assign(c,require('./helpers/coordinator-events.cjs').eventService(c));
 assert.equal(c.goobrawlStillFighting(),false);party.statuses.W.goobrawlCombat=true;assert.equal(c.goobrawlStillFighting(),false);
});
test('arena monsters remain allowed with boar focus and an empty event target cache',()=>{
 const c=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,character:{map:'goobrawl'},eventTargetTypes:[],monsterFocus:['boar'],combatTargetId:null,convoyTraveling:null,scatterBreakTarget:null,farmingMode:'default',followLeader:false,
 isExternallyClaimedMonster:()=>false,isAttackingPartyMember:()=>false,isPartyThreat:()=>false,leaderLockAllows:()=>true});
 vm.runInContext(shared.slice(shared.indexOf('  function isAllowedTarget('),shared.indexOf('  function sameEventTeamMember(')),c);
 assert.equal(c.isAllowedTarget({id:'goo',type:'monster',mtype:'bgoo'}),true);
});
