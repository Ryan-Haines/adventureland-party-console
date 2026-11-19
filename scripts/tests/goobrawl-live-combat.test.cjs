const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const coordinator=require('./helpers/coordinator-source.cjs').coordinatorSource();
// The arena's fight evidence is the events owner's (runtime/events/character/attend.ts `arenaFight`): the
// character on the event's map with a living catalog `targets.first` monster in view. One read stands until
// the running code yields, since the client changes its entities only in its own handlers.
test('visible Brawl Goos corroborate live combat without a server event flag; empty arena does not',async()=>{
 const {installEventAttendance}=require('../../runtime/events/character/attend.ts');
 let now=1000;const character={map:'goobrawl'},entities={a:{type:'monster',mtype:'bgoo',hp:100}};
 const attend=installEventAttendance({now:()=>now,game:()=>({maps:{goobrawl:{event:'goobrawl'}}}),character:()=>character,entities:()=>entities});
 assert.equal(attend.arenaFight('goobrawl'),true);entities.a.dead=true;assert.equal(attend.arenaFight('goobrawl'),true);
 await null;assert.equal(attend.arenaFight('goobrawl'),false);
 entities.a.dead=false;character.map='main';assert.equal(attend.arenaFight('goobrawl'),false);
});
test('live Goobrawl cancels only its stale return commands and convoy, retaining the farming checkpoint',()=>{
 const location={map:'winterland',x:20,y:-1109};const party={location,statuses:{W:{map:'goobrawl',mapEvent:'goobrawl',seenAt:1000,goobrawlCombat:true}},
 eventReturn:{event:'goobrawl',cycleId:'old',convoyId:'convoy'},activeConvoy:{id:'convoy'},commands:{W:{type:'event-return-town',cycleId:'old'},M:{type:'merchant-service'}},deferredEventReturns:{P:{cycleId:'old'}}};
 const c={party,Date:{now:()=>1000},persistSettings(){},cancelActiveConvoy(){party.activeConvoy=null;}};
 Object.assign(c,require('./helpers/coordinator-events.cjs').eventService(c));
 assert.equal(c.beginEventReturn('goobrawl',{}),null);assert.equal(c.cancelPrematureGoobrawlReturn(),true);
 assert.equal(party.activeConvoy,null);assert.equal(party.eventReturn,null);assert.equal(party.commands.W,undefined);assert.ok(party.commands.M);assert.equal(party.location,location);
});
test('stale reports and merely standing in an empty arena do not suppress return',()=>{
 const party={statuses:{W:{map:'goobrawl',mapEvent:'goobrawl',seenAt:1000,goobrawlCombat:false}}};const c={party,Date:{now:()=>20000}};
 Object.assign(c,require('./helpers/coordinator-events.cjs').eventService(c));
 assert.equal(c.goobrawlStillFighting(),false);party.statuses.W.goobrawlCombat=true;assert.equal(c.goobrawlStillFighting(),false);
});
// The arena's targets are the catalog's `targets.first` that the game's G.monsters knows (events/rules.ts
// eventTargetTypes), so the row plants the game data those reads take.
test('arena monsters remain allowed with boar focus and an empty event target cache',()=>{
 const G={maps:{goobrawl:{event:'goobrawl'}},monsters:{rgoo:{},bgoo:{},goo:{},boar:{}}};
 const c=require('./helpers/client-dependencies.cjs').passingContext({G,travelCombatActive:()=>false,character:{map:'goobrawl'},eventTargetTypes:[],monsterFocus:['boar'],combatTargetId:null,groupWalk:{travel:null},scatterBreakTarget:null,farmingMode:'default',followLeader:false,
 isExternallyClaimedMonster:()=>false,isAttackingPartyMember:()=>false,isPartyThreat:()=>false,leaderLockAllows:()=>true});
 assert.equal(c.isAllowedTarget({id:'goo',type:'monster',mtype:'bgoo'}),true);
});
