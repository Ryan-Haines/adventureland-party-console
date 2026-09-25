const test=require('node:test');
const assert=require('node:assert/strict');
const {createEventObservations}=require('../../runtime/coordinator/events/observations.ts');
function fixture(){
 const state={sessions:{},current:null,deferred:{},anniversary:{eventCycle:null,returnReady:{},returnDestination:null,partyHold:null}};
 const statuses={},commands={},effects=[];let now=1000,revision=1,cancelled=false,fighting=false;
 const ports={now:()=>now,activeNames:()=>['P','W'],merchant:()=> 'M',enabled:()=>true,checkpoint:()=>({map:'cave',x:1,y:2}),
  capture:()=>({}),persist:()=>effects.push('persist'),log:message=>effects.push(message),statuses:()=>statuses,
  goobrawlStillFighting:()=>fighting,begin:(event,session)=>effects.push(['return',event,session.participants]),finishIfReady:()=>effects.push('finish'),
  location:recovery=>recovery.checkpoint,intent:()=>({revision,cancelled}),hasCommand:name=>!!commands[name],
  command:(name,command)=>{commands[name]=command;},nextCommand:()=>1};
 return {state,statuses,commands,effects,...createEventObservations(state,ports),
  time:value=>{now=value;},intent:(value,cleared=false)=>{revision=value;cancelled=cleared;},fighting:value=>{fighting=value;}};
}
test('stale kiss completion cannot erase a newer kiss, and cancelled movement cannot join combat',()=>{
 const f=fixture();f.state.anniversary.eventCycle={endsAt:100000,kissOperations:{}};
 f.authorize('P','anniversary',{id:'new',phase:'begin'});
 f.authorize('P','anniversary',{id:'old',phase:'end'});
 assert.equal(f.state.anniversary.eventCycle.kissOperations.P.id,'new');
 f.intent(2,true);assert.equal(f.authorize('P','crabxx').allowed,false);assert.equal(f.state.sessions.P,undefined);
});

test('raw event reports retain captured participants and derived hints cannot keep an event alive',()=>{
 const f=fixture();f.authorize('P','franky');f.authorize('W','franky');f.observe({name:'P',serverLiveEvents:[{name:'franky',id:'round'}]});
 const original=f.state.sessions.P;f.time(2000);f.observe({name:'P',serverLiveEvents:[{name:'franky'}]});
 assert.equal(f.state.sessions.P.id,'round');assert.equal(f.state.sessions.P.waypoints,original.waypoints);
 f.time(12000);f.observe({name:'P',activeEvent:'franky'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','franky',['P','W']]);assert.deepEqual(f.state.sessions,{});
});
test('Goo Brawl combat postpones recovery even after the server announcement expires',()=>{
 const f=fixture();f.authorize('P','goobrawl');f.authorize('W','goobrawl');f.observe({name:'P',serverLiveEvents:[{name:'goobrawl'}]});f.time(20000);f.fighting(true);
 f.observe({name:'P'});assert.ok(f.state.sessions.P);assert.equal(f.effects.some(Array.isArray),false);
 f.fighting(false);f.observe({name:'P'});assert.deepEqual(f.effects.find(Array.isArray),['return','goobrawl',['P','W']]);
});
test('a cleared navigation intent prevents reconnect recovery from restoring an old checkpoint',()=>{
 const f=fixture();f.state.deferred.P={event:'franky',cycleId:'r',checkpoint:{map:'cave',x:1,y:2},navigationRevision:1,phase:'awaiting-reconnect'};
 f.intent(2,true);f.observe({name:'P',map:'main',x:0,y:0});
 assert.equal(f.state.deferred.P,undefined);assert.equal(f.commands.P,undefined);
});
test('stale return participant is deferred without holding up healthy party members',()=>{
 const f=fixture();f.time(40000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],checkpoint:null};
 f.statuses.W={seenAt:40000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['W']);assert.equal(f.state.deferred.P.phase,'awaiting-reconnect');assert.ok(f.effects.includes('finish'));
});


test('observed Gigacrab without departure never starts event recovery',()=>{
 const f=fixture(); f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});
 f.time(12000);f.observe({name:'P'});
 assert.equal(f.effects.some(Array.isArray),false);assert.deepEqual(f.state.sessions,{});
});
test('authorized departure recovers even when the character never joined',()=>{
 const f=fixture();f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});f.authorize('W','crabxx');
 f.time(12000);f.observe({name:'P'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','crabxx',['W']]);
});
test('combat handoff waits for registered kiss, rejects new attempts, and retains origin',()=>{
 const f=fixture(),waypoints={P:{revision:1,location:{map:'arena',x:384,y:-420}}};
 const c=f.state.anniversary.eventCycle={id:'round',endsAt:999999,waypoints};
 assert.equal(f.authorize('P','anniversary',{id:'one',phase:'begin'}).allowed,true);
 assert.equal(f.authorize('W','crabxx').allowed,false);
 assert.equal(f.authorize('W','anniversary',{id:'two',phase:'begin'}).allowed,false);
 f.authorize('P','anniversary',{id:'old',phase:'end'});
 assert.equal(f.authorize('W','crabxx').allowed,false);
 f.authorize('P','anniversary',{id:'one',phase:'end'});
 assert.equal(f.authorize('W','crabxx').allowed,true);
 const at=c.combatHandoffAt; f.time(2000);f.authorize('W','crabxx');
 assert.equal(c.combatHandoffAt,at);assert.equal(f.state.sessions.W.waypoints,waypoints);
 assert.equal(f.authorize('P','anniversary').allowed,false);
});
test('a lost kiss operation expires and no longer blocks departure',()=>{
 const f=fixture(); f.state.anniversary.eventCycle={id:'round',endsAt:999999};
 f.authorize('P','anniversary',{id:'one',phase:'begin'});f.time(182000);
 assert.equal(f.authorize('W','crabxx').allowed,true);
});


test('merchant departures and joined reports participate in the normal event return',()=>{
 const f=fixture();assert.equal(f.authorize('M','snowman').allowed,true);
 assert.deepEqual(f.state.sessions.M.participants,['M']);
 f.time(12000);f.observe({name:'M'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','snowman',['M']]);
 const g=fixture();g.observe({name:'M',joinedEvent:'goobrawl',serverLiveEvents:[{name:'goobrawl'}]});
 assert.deepEqual(g.state.sessions.M.participants,['M']);
});
