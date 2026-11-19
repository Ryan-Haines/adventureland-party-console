const test=require('node:test');
const assert=require('node:assert/strict');
// The observer with the events owner's member rows, as the coordinator composes it (returns.ts).
const {createEventReturnObservations:createEventObservations}=require('../../runtime/events/coordinator/returns.ts');
function fixture(){
 const state={sessions:{},current:null,deferred:{},anniversary:{eventCycle:null,returnReady:{},returnDestination:null,partyHold:null}};
 const statuses={},commands={},effects=[],order=require('../../runtime/events/rules.ts').supportedEvents;let now=1000,revision=1,cancelled=false,fighting=false;
 const offline=new Set();
 // The lifecycle owner's online answer: each member online until a row marks it
 // offline.
 const ports={now:()=>now,activeNames:()=>['P','W'],online:name=>!offline.has(name),merchant:()=> 'M',enabled:()=>true,admits:()=>true,selected:()=>order,checkpoint:()=>(effects.push('checkpoint'),{map:'cave',x:1,y:2}),
  capture:()=>({}),persist:()=>effects.push('persist'),log:message=>effects.push(message),statuses:()=>statuses,
  goobrawlStillFighting:()=>fighting,begin:(event,session)=>effects.push(['return',event,session.participants]),finishIfReady:()=>effects.push('finish'),
  location:recovery=>recovery.checkpoint,intent:()=>({revision,cancelled}),hasCommand:name=>!!commands[name],
  command:(name,command)=>{commands[name]=command;},nextCommand:()=>1};
 const observer=createEventObservations(state,ports);
 // The ingest: a report that names the event as the member's live one; the
 // anniversary's names its round and the kiss it runs.
 const admitTo=(name,event,kiss=null)=>observer.admit(event==='anniversary'?{name,anniversaryServer:{live:true},anniversaryState:{kiss}}:{name,activeEvent:event});
 // An event ends on a fresh connected feed that no longer lists it (attendance.ts `feedDropped`).
 const feedDrops=name=>{statuses[name]={seenAt:now,eventFeedConnected:true,serverLiveEvents:[]};};
 return {state,statuses,commands,effects,ports,offline,...observer,admitTo,feedDrops,
  time:value=>{now=value;},intent:(value,cleared=false)=>{revision=value;cancelled=cleared;},fighting:value=>{fighting=value;}};
}
test('the report names the kiss it runs: a newer kiss replaces the old, a report without one ends it, and cancelled movement cannot join combat',()=>{
 const f=fixture();f.state.anniversary.eventCycle={endsAt:100000,kissOperations:{}};
 f.admitTo('P','anniversary','old');f.admitTo('P','anniversary','new');
 assert.equal(f.state.anniversary.eventCycle.kissOperations.P.id,'new');
 f.admitTo('P','anniversary');assert.equal(f.state.anniversary.eventCycle.kissOperations.P,undefined);
 f.intent(2,true);assert.equal(f.admitTo('P','crabxx').allowed,false);assert.equal(f.state.sessions.P,undefined);
});

test('raw event reports retain captured participants and derived hints cannot keep an event alive',()=>{
 const f=fixture();f.admitTo('P','franky');f.admitTo('W','franky');f.observe({name:'P',serverLiveEvents:[{name:'franky',id:'round'}]});
 const original=f.state.sessions.P;f.time(2000);f.observe({name:'P',serverLiveEvents:[{name:'franky'}]});
 assert.equal(f.state.sessions.P.id,'round');assert.equal(f.state.sessions.P.waypoints,original.waypoints);
 f.time(12000);f.feedDrops('P');f.observe({name:'P',activeEvent:'franky'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','franky',['P','W']]);assert.deepEqual(f.state.sessions,{});
});
test('Goo Brawl combat postpones recovery even after the server announcement expires',()=>{
 const f=fixture();f.admitTo('P','goobrawl');f.admitTo('W','goobrawl');f.observe({name:'P',serverLiveEvents:[{name:'goobrawl'}]});f.time(20000);f.fighting(true);
 f.feedDrops('P');f.observe({name:'P'});assert.ok(f.state.sessions.P);assert.equal(f.effects.some(Array.isArray),false);
 f.fighting(false);f.observe({name:'P'});assert.deepEqual(f.effects.find(Array.isArray),['return','goobrawl',['P','W']]);
});
test('a cleared navigation intent prevents reconnect recovery from restoring an old checkpoint',()=>{
 const f=fixture();f.state.deferred.P={event:'franky',cycleId:'r',checkpoint:{map:'cave',x:1,y:2},navigationRevision:1,phase:'awaiting-reconnect'};
 f.intent(2,true);f.observe({name:'P',map:'main',x:0,y:0});
 assert.equal(f.state.deferred.P,undefined);assert.equal(f.commands.P,undefined);
});
test('stale return participant is deferred without holding up healthy party members',()=>{
 const f=fixture();f.time(40000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],participants:['P','W'],checkpoint:null};
 f.statuses.W={seenAt:40000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['W']);assert.equal(f.state.deferred.P.phase,'awaiting-reconnect');assert.ok(f.effects.includes('finish'));
});

test('a return younger than the grace defers no member for a report the restarted coordinator has not received yet',()=>{
 const f=fixture();f.time(5000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],participants:['P','W'],checkpoint:null};
 f.statuses.W={seenAt:5000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['P','W']);assert.equal(f.state.deferred.P,undefined);
});

// A pending member whose report is old stays pending while the lifecycle owner holds it online;
// its stale report holds the return, and the lifecycle owner's offline answer defers it.
test('a stale return member the lifecycle owner holds online stays pending until the lifecycle owner answers it offline',()=>{
 const f=fixture();f.time(40000);f.state.current={event:'franky',cycleId:'r',startedAt:1000,pending:['P','W'],participants:['P','W'],checkpoint:null};
 f.statuses.P={seenAt:1000};f.statuses.W={seenAt:40000};f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['P','W']);assert.equal(f.state.deferred.P,undefined);
 f.offline.add('P');f.observe({name:'W'});
 assert.deepEqual(f.state.current.pending,['W']);assert.equal(f.state.deferred.P.phase,'awaiting-reconnect');
});

test('an actual native Halloween target records the assisting follower without a joined flag',()=>{
 const f=fixture();f.statuses.P={seenAt:1000,map:'halloween',in:'halloween',server:'USI'};
 f.observe({name:'P',map:'halloween',in:'halloween',server:'USI',serverLiveEvents:[{name:'mrpumpkin'}],target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100000}});
 assert.deepEqual(f.state.sessions.P.participants,['P']);
 const globalOnly=fixture();globalOnly.statuses.P={seenAt:1000};globalOnly.observe({name:'P',serverLiveEvents:[{name:'mrpumpkin'}]});
 assert.deepEqual(globalOnly.state.sessions.P.participants,[]);
 for(const invalid of [{status:{seenAt:-20000}},{status:{seenAt:1000,eventFeedConnected:false}},{cancelled:true},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:0}},{target:{id:'other',type:'monster',mtype:'goo',hp:100}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,map:'main'}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,in:'other'}},
  {target:{id:'492',type:'monster',mtype:'mrpumpkin',hp:100,server:'USII'}},{missingMap:true},{clockStale:true}]){
  const rejected=fixture();rejected.statuses.P={map:'halloween',in:'halloween',server:'USI',...(invalid.status||{seenAt:1000})};if(invalid.cancelled)rejected.intent(2,true);
  rejected.observe({name:'P',map:invalid.missingMap?undefined:'halloween',in:'halloween',server:'USI',eventClockStale:!!invalid.clockStale,serverLiveEvents:[{name:'mrpumpkin'}],target:invalid.target||{id:'492',type:'monster',mtype:'mrpumpkin',hp:100000}});
  assert.deepEqual(rejected.state.sessions.P.participants,[]);
 }
});

test('observed Gigacrab without departure never starts event recovery',()=>{
 const f=fixture(); f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});
 f.time(12000);f.feedDrops('P');f.observe({name:'P'});
 assert.equal(f.effects.some(Array.isArray),false);assert.deepEqual(f.state.sessions,{});
});
test('authorized departure recovers even when the character never joined',()=>{
 const f=fixture();f.observe({name:'P',serverLiveEvents:[{name:'crabxx'}]});f.admitTo('W','crabxx');
 f.time(12000);f.feedDrops('P');f.observe({name:'P'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','crabxx',['W']]);
});
test('combat handoff waits for registered kiss, rejects new attempts, and retains origin',()=>{
 const f=fixture(),waypoints={P:{revision:1,location:{map:'arena',x:384,y:-420}}};
 const c=f.state.anniversary.eventCycle={id:'round',endsAt:999999,waypoints};
 assert.equal(f.admitTo('P','anniversary','one').allowed,true);
 assert.equal(f.admitTo('W','crabxx').allowed,false);
 // A kiss that starts while the departure is pending is refused and holds nothing.
 assert.equal(f.admitTo('W','anniversary','two').allowed,false);assert.equal(c.kissOperations.W,undefined);
 f.admitTo('P','anniversary','one');
 assert.equal(f.admitTo('W','crabxx').allowed,false);
 f.admitTo('P','anniversary');
 assert.equal(f.admitTo('W','crabxx').allowed,true);
 const at=c.combatHandoffAt; f.time(2000);f.admitTo('W','crabxx');
 assert.equal(c.combatHandoffAt,at);assert.equal(f.state.sessions.W.waypoints,waypoints);
 assert.equal(f.admitTo('P','anniversary').allowed,false);
});
// A held kiss ends on the lifecycle owner's answer that its member is offline, not on report
// silence: a member gone from the active names that the lifecycle owner holds online keeps the kiss
// and the departure's hold.
test('a held kiss stays while the lifecycle owner holds its member online and ends once the lifecycle owner answers it offline',()=>{
 const f=fixture(),c=f.state.anniversary.eventCycle={id:'round',endsAt:999999};
 f.admitTo('P','anniversary','one');f.ports.activeNames=()=>['W'];
 assert.equal(f.admitTo('W','crabxx').allowed,false,'the kiss of a silent member 13 holds online holds the departure');
 f.offline.add('P');
 assert.equal(f.admitTo('W','crabxx').allowed,true);assert.equal(c.kissOperations.P,undefined);
});
// (a): a kiss the member's reports stop naming holds the departure to its round's end, past the
// earlier console's 180 s expiry, and the round's end lets the departure go.
test('a lost kiss operation holds departure until its round ends',()=>{
 const f=fixture(); f.state.anniversary.eventCycle={id:'round',endsAt:999999};
 f.admitTo('P','anniversary','one');f.time(182000);
 assert.deepEqual(f.admitTo('W','crabxx'),{event:'crabxx',allowed:false,reason:'Finishing anniversary kiss: P'});
 f.time(999999);assert.equal(f.admitTo('W','crabxx').allowed,true);
});


test('merchant departures and joined reports participate in the normal event return',()=>{
 // Correction 40: the merchant's report that names its live event admits it into the session.
 const f=fixture();assert.deepEqual(f.admitTo('M','snowman'),{event:'snowman',allowed:true});
 assert.deepEqual(f.state.sessions.M.participants,['M']);
 f.observe({name:'M',joinedEvent:'snowman'});
 assert.deepEqual(f.state.sessions.M.participants,['M']);
 f.time(12000);f.feedDrops('M');f.observe({name:'M'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','snowman',['M']]);
 const g=fixture();g.observe({name:'M',joinedEvent:'goobrawl',serverLiveEvents:[{name:'goobrawl'}]});
 assert.deepEqual(g.state.sessions.M.participants,['M']);
});

function retiredSameEvent(){
 const f=fixture();f.time(10000);
 const recovery={event:'mrpumpkin',cycleId:'retired-old',checkpoint:{map:'uhills',x:-550,y:-160},navigationRevision:1,phase:'returning-to-checkpoint'};
 f.state.deferred.W={...recovery};f.state.deferred.P={...recovery};
 f.statuses.W={seenAt:10000,serverLiveEvents:[{name:'mrpumpkin',id:'new-native-round'}],eventFeedConnected:true,eventClockStale:false};
 f.statuses.P={seenAt:1000};
 f.ports.retireDeferredCommand=(name,cycleId)=>{const c=f.commands[name];if(c?.cycleId===cycleId&&['event-return-town','event-resume-travel'].includes(c.type))delete f.commands[name];};
 return f;
}
test('retired same-type live admission waits for actual authorization without recreating the old return',()=>{
 const f=retiredSameEvent();f.observe({name:'W',map:'uhills',x:-550,y:-160,serverLiveEvents:[{name:'mrpumpkin',id:'new-native-round'}]});
 assert.equal(f.commands.W,undefined);assert.ok(f.state.deferred.W);assert.deepEqual(f.state.sessions.W.participants,[]);
 assert.equal(f.admitTo('W','mrpumpkin').allowed,true);assert.equal(f.state.deferred.W,undefined);
 assert.deepEqual(f.state.sessions.W.waypoints.W.location,{map:'uhills',x:-550,y:-160});assert.ok(f.state.deferred.P);
});
test('a late fresh same-event report retires only its already-issued obsolete return command',()=>{
 const f=retiredSameEvent();f.commands.W={id:1,type:'event-return-town',cycleId:'retired-old'};
 f.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});assert.equal(f.commands.W,undefined);assert.ok(f.state.deferred.W);
 const manual=retiredSameEvent();manual.commands.W={id:2,type:'character-travel',cycleId:'manual'};
 manual.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});assert.equal(manual.commands.W.id,2);assert.ok(manual.state.deferred.W);
});
test('original same-type live event exhausted by attendance limits cannot bypass its old return',()=>{
 const {eventInstanceAllowed}=require('../../runtime/events/coordinator/attendance.ts');
 for(const ignored of ['duration','deaths']){
  const f=retiredSameEvent(),policy={eventAttendance:{W:{mrpumpkin:{ended:false,ignored,elapsedMs:90000}}},leader:'W',followers:{P:true}};
  f.ports.enabled=(name,event)=>event?eventInstanceAllowed(policy,name,event):true;
  f.observe({name:'W',map:'uhills',serverLiveEvents:[{name:'mrpumpkin',id:'original-live-round'}]});
  assert.equal(f.commands.W.type,'event-return-town');assert.equal(f.admitTo('W','mrpumpkin').allowed,false);assert.ok(f.state.deferred.W);
 }
});
test('retired same-event entry does not bypass stale clocks, manual intents or active return ownership',()=>{
 for(const variant of ['stale','disconnected','clock','cancelled','revision','disabled','active']){
  const f=retiredSameEvent();
  if(variant==='stale')f.statuses.W.seenAt=6000;
  if(variant==='disconnected')f.statuses.W.eventFeedConnected=false;
  if(variant==='clock')f.statuses.W.eventClockStale=true;
  if(variant==='cancelled')f.intent(1,true);
  if(variant==='revision')f.intent(2);
  if(variant==='disabled')f.ports.enabled=()=>false;
  if(variant==='active')f.state.current={cycleId:'retired-old',event:'mrpumpkin',startedAt:10000,participants:['W'],pending:['W']};
  f.observe({name:'W',map:'uhills',serverLiveEvents:[{name:'mrpumpkin'}]});
  assert.equal(f.commands.W?.type,'event-return-town',variant);assert.ok(f.state.deferred.W,variant);
 }
});

test('eligible same-event admission retires exit phase while preserving checkpoint and stale peer ownership',()=>{
 const f=retiredSameEvent();f.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});
 assert.equal(f.state.deferred.W.phase,'awaiting-event-admission');assert.equal(f.state.deferred.P.phase,'returning-to-checkpoint');
 assert.deepEqual(f.state.deferred.W.checkpoint,{map:'uhills',x:-550,y:-160});
 f.statuses.W.serverLiveEvents=[];f.observe({name:'W',map:'main',x:0,y:0,serverLiveEvents:[]});
 assert.equal(f.state.deferred.W.phase,'returning-to-checkpoint');assert.equal(f.commands.W.type,'event-resume-travel');
});


// The live manual-override row: the first Mr Pumpkin's return held both members for 2 min, and the
// next Pumpkin, the same event, could not take them from it.
test('a new occurrence of the event the party returns from takes its members from the return; the occurrence it left does not',()=>{
 for(const [since,released] of [[20000,true],[5000,false]]){
  const f=fixture();f.time(30000);
  f.state.current={event:'mrpumpkin',cycleId:'r',startedAt:10000,participants:['P','W'],pending:['P','W'],checkpoint:{map:'main',x:0,y:0}};
  f.state.eventAttendance={W:{mrpumpkin:{id:null,realm:'USII',lastLiveAt:30000,ended:false,since,elapsedMs:0,lastObservedAt:30000,attending:false,deaths:0,lastDeathAt:0,dead:false}}};
  f.statuses.W={seenAt:30000,serverLiveEvents:[{name:'mrpumpkin'}],eventFeedConnected:true,eventClockStale:false};
  f.statuses.P={seenAt:30000};
  f.observe({name:'W',serverLiveEvents:[{name:'mrpumpkin'}]});
  assert.equal(f.state.current.participants.includes('W'),!released,'since '+since);
  assert.equal(f.state.deferred.W?.phase,released?'awaiting-event-handoff':undefined,'since '+since);
  if(released)assert.equal(f.admitTo('W','mrpumpkin').allowed,true,'the new occurrence admits the member');
 }
});
test('authorized future Halloween staging survives delayed joined-event reporting',()=>{
 // The group's walk estimate lead (rules.ts `leadFor`) puts the spawn 38 s away inside the staging.
 const f=fixture();f.statuses.P={seenAt:1000,server:'USI',eventFeedConnected:true,eventLeads:{mrpumpkin:60_000}};
 f.admitTo('P','mrpumpkin');
 f.observe({name:'P',server:'USI',serverStagingEvents:[{name:'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 f.time(12000);f.statuses.P.seenAt=12000;
 f.observe({name:'P',server:'USI',serverStagingEvents:[{name:'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 assert.equal(f.effects.some(Array.isArray),false,'pre-join transport delay must not retire an authorized future staging round');
 assert.equal(f.state.sessions.P.stagingSpawnId,50000);
 assert.deepEqual(f.state.sessions.P.participants,['P']);
});

// The staging window opens at the member's group's `due` lead (rules.ts `leadFor`): `outside-lead`
// gives P's group a 30 s lead, so the spawn 38 s away is not yet staged.
for(const invalid of ['unowned','stale','future-status','dead','wrong-event','wrong-realm','missing-realm','disconnected','clock-stale','cancelled','already-live','wrong-participant','unrecorded','incoming-dead','stored-disconnected','stored-clock-stale','outside-lead'])test('pre-join staging cannot extend invalid attendance: '+invalid,()=>{
 const f=fixture();f.statuses.P={seenAt:1000,server:'USI',eventFeedConnected:true};
 if(invalid!=='unowned')f.admitTo('P','mrpumpkin');
 if(invalid==='already-live')f.observe({name:'P',serverLiveEvents:[{name:'mrpumpkin'}]});
 f.time(12000);f.statuses.P.seenAt=invalid==='stale'?1000:invalid==='future-status'?13000:12000;
 if(invalid==='dead')f.statuses.P.rip=true;
 if(invalid==='wrong-participant')f.state.sessions.P.participants=['W'];
 if(invalid==='unrecorded')f.state.sessions.P.participationRecorded=false;
 if(invalid==='stored-disconnected')f.statuses.P.eventFeedConnected=false;
 if(invalid==='stored-clock-stale')f.statuses.P.eventClockStale=true;
 if(invalid==='outside-lead')f.statuses.P.eventLeads={mrpumpkin:30_000};
 if(invalid==='cancelled')f.intent(1,true);
 f.observe({name:'P',rip:invalid==='incoming-dead',server:invalid==='missing-realm'?undefined:invalid==='wrong-realm'?'USII':'USI',
  eventFeedConnected:invalid==='disconnected'?false:true,eventClockStale:invalid==='clock-stale',
  serverStagingEvents:[{name:invalid==='wrong-event'?'mrgreen':'mrpumpkin',spawnAt:50000,spawnId:50000}]});
 assert.equal(f.state.sessions.P?.stagingSpawnId,undefined);
 if(invalid==='unowned')assert.equal(f.state.sessions.P,undefined);
});

// Two live events keep one record per member, captured once.
test('two live events keep both records: the top selected event holds the record and its checkpoint is captured once',()=>{
 const f=fixture();
 for(const at of [1000,2000,3000]){f.time(at);f.observe({name:'P',serverLiveEvents:[{name:'franky',id:'f'},{name:'crabxx',id:'c'}]});}
 assert.equal(f.state.sessions.P.event,'crabxx');
 assert.equal(f.effects.filter(effect=>effect==='checkpoint').length,1);
 // A member admitted to the lower event keeps that record while the higher one is live.
 const g=fixture();g.admitTo('W','franky');const checkpoints=g.effects.filter(effect=>effect==='checkpoint').length;
 g.observe({name:'W',serverLiveEvents:[{name:'crabxx',id:'c'},{name:'franky',id:'f'}]});
 assert.equal(g.state.sessions.W.event,'franky');assert.deepEqual(g.state.sessions.W.participants,['W']);
 assert.equal(g.effects.filter(effect=>effect==='checkpoint').length,checkpoints);
});
// `ended`: an event ends on the first fresh report whose feed is current and no longer
// lists it, never while a member still reports it live.
test('an event ends on the first current feed that drops it, never while a member lists it live',()=>{
 const f=fixture();f.admitTo('P','crabxx');f.admitTo('W','crabxx');
 f.observe({name:'P',serverLiveEvents:[{name:'crabxx',id:'c'}]});
 f.time(3000);f.statuses.W={seenAt:3000,eventFeedConnected:true,serverLiveEvents:[{name:'crabxx'}]};
 f.statuses.P={seenAt:3000,eventFeedConnected:true,serverLiveEvents:[]};f.observe({name:'P'});
 assert.equal(f.effects.some(Array.isArray),false,'W still lists it live');
 f.statuses.W={seenAt:3000,eventFeedConnected:true,serverLiveEvents:[]};f.observe({name:'P'});
 assert.deepEqual(f.effects.find(Array.isArray),['return','crabxx',['P','W']]);
 const {observeEventAttendance}=require('../../runtime/events/coordinator/attendance.ts');
 const party={eventAttendance:{},eventSelectionsByCharacter:{P:['crabxx']}};
 observeEventAttendance(party,{name:'P',server:'I',serverLiveEvents:[{name:'crabxx',id:'c'}],eventFeedConnected:true},1000);
 observeEventAttendance(party,{name:'P',server:'I',serverLiveEvents:[],eventFeedConnected:true},2000);
 assert.equal(party.eventAttendance.P.crabxx.ended,true,'the attendance record ends with the current feed');
});
// (a): the merchant's return ends in Main Town on its first fresh report, with a job command in its
// slot.
// This file loads no game data, so Main Town is the radius the failed load leaves, and each answer
// it gives shows on the safety bound record.
test('the merchant return ends on its first fresh report in Main Town',()=>{
 const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const before=boundFirings().counts.MAIN_TOWN_RADIUS||0;
 const f=fixture();f.state.deferred.M={event:'witchcipher',cycleId:'m',checkpoint:null,navigationRevision:1,deferredAt:1000,phase:'merchant-return'};
 f.commands.M={id:3,type:'merchant-bank'};f.statuses.M={seenAt:1000,map:'main',x:20,y:-30};
 f.observe({name:'M',map:'main',x:20,y:-30});
 assert.equal(f.state.deferred.M,undefined);
 assert.ok((boundFirings().counts.MAIN_TOWN_RADIUS||0)>before,'the radius answer reports');
});
// The ingest: a report
// that names no live event opens no trip, an admitted event opens one, the anniversary's opens once its
// activity runs, and a nameless trip or a finished anniversary's closes.
test('the ingest opens one trip per admitted event and closes obsolete ones',()=>{
 const f=fixture();
 f.admit({name:'P'});assert.equal(f.state.huntEventTrips,undefined);
 f.admitTo('P','icegolem');f.admitTo('P','icegolem');
 assert.equal(f.state.huntEventTrips.P.length,1);assert.equal(f.state.huntEventTrips.P[0].event,'icegolem');
 f.admitTo('P','anniversary');assert.equal(f.state.huntEventTrips.P.at(-1).event,'icegolem','the anniversary trip waits for its activity');
 f.admit({name:'P',anniversaryServer:{live:true},anniversaryState:{busy:true}});assert.equal(f.state.huntEventTrips.P.at(-1).event,'anniversary');
 f.state.anniversary.eventCycle={returnCompletedAt:1000};
 f.admit({name:'P'});assert.ok(f.state.huntEventTrips.P.at(-1).endedAt);
 f.state.huntEventTrips.P.push({event:'null',startedAt:1000});
 f.admit({name:'P'});assert.ok(f.state.huntEventTrips.P.at(-1).endedAt,'an obsolete nameless trip cannot leave protection active');
});
// A member of the event return is not admitted until its return releases it.
test('the event return refuses admission until it releases the member',()=>{
 const f=fixture();f.state.current={event:'franky',cycleId:'r',participants:['P'],pending:[]};
 for(let i=0;i<3;i++)assert.equal(f.admitTo('P','icegolem').allowed,false);
 assert.equal(f.state.sessions.P,undefined);assert.equal(f.state.huntEventTrips,undefined);
 f.state.current.participants=['W'];assert.equal(f.admitTo('P','icegolem').allowed,true);
 f.state.current=null;assert.equal(f.admitTo('P','icegolem').allowed,true);
 // The tasks owner's answer for the group.
 const held=fixture();held.ports.admits=()=>false;assert.equal(held.admitTo('P','icegolem').allowed,false);assert.equal(held.state.sessions.P,undefined);
});
// A trip opens only for a member whose Hunt the attendance suspends; the merchant's own group
// asks no admission at all.: every admitted fighter records its trip, as and (hunt-trip.ts:12-28).
test('an admitted departure records a hunt trip for every fighter',()=>{
 const f=fixture();
 assert.equal(f.admitTo('P','crabxx').allowed,true);assert.equal(f.state.huntEventTrips.P.at(-1).event,'crabxx');
});
// Correction 40: the merchant's own group is admitted in the ingest with its session alone: no trip
// (row 36 (c)), no anniversary handoff and no anniversary occurrence.
test('the ingest admits the merchant with its session alone',()=>{
 const f=fixture();
 f.state.anniversary.eventCycle={startsAt:0,endsAt:900000,participants:['P','W']};
 assert.deepEqual(f.admitTo('M','witchcipher'),{event:'witchcipher',allowed:true});
 assert.deepEqual(f.state.sessions.M.participants,['M']);
 assert.equal(f.state.huntEventTrips,undefined);
 assert.equal(f.state.anniversary.eventCycle.combatHandoffAt,undefined,'the merchant hands no round to combat');
 assert.equal(f.admitTo('M','anniversary'),null,'the merchant visit is no occurrence');
 f.ports.enabled=()=>false;assert.equal(f.admitTo('M','witchcipher').allowed,false);
 f.ports.enabled=()=>true;f.ports.admits=()=>false;assert.equal(f.admitTo('M','witchcipher').allowed,false);
});
// The answer rides the member's status for the reply.
test('the admission rides the member status for the reply',()=>{
 const f=fixture();f.statuses.P={seenAt:1000};
 f.admitTo('P','crabxx');assert.deepEqual(f.statuses.P.eventAdmission,{event:'crabxx',allowed:true});
 f.admit({name:'P'});assert.equal(f.statuses.P.eventAdmission,null);
 // Attendance marks the record of a member that dies attending an occurrence, and the mark rides beside the
 // admission until the member attends again or the occurrence ends.
 const {observeEventAttendance}=require('../../runtime/events/coordinator/attendance.ts');
 f.state.eventAttendance={};const party={eventAttendance:f.state.eventAttendance,eventSelectionsByCharacter:{P:['crabxx']}};
 const live={name:'P',server:'I',serverLiveEvents:[{name:'crabxx',id:'c'}],eventFeedConnected:true};
 observeEventAttendance(party,{...live,joinedEvent:'crabxx'},1000);
 observeEventAttendance(party,{...live,rip:true},2000);f.admitTo('P','crabxx');
 assert.equal(f.statuses.P.eventRejoin,'crabxx','a death while attending marks the rejoin');
 observeEventAttendance(party,{...live,rip:false},3000);f.admitTo('P','crabxx');
 assert.equal(f.statuses.P.eventRejoin,'crabxx','a respawn away from the event keeps it');
 observeEventAttendance(party,{...live,joinedEvent:'crabxx'},4000);f.admitTo('P','crabxx');
 assert.equal(f.statuses.P.eventRejoin,null,'attending again clears it');
 observeEventAttendance(party,{...live,joinedEvent:'crabxx'},5000);observeEventAttendance(party,{...live,rip:true},6000);
 observeEventAttendance(party,{...live,serverLiveEvents:[]},7000);f.admitTo('P','crabxx');
 assert.equal(f.statuses.P.eventRejoin,null,'the end of the occurrence clears it');
});

// Each full report replaces the member's status (status/coordinator/intake.ts `store`), as the live
// run's Goobrawl reports did once a second.
test('repeated reports with the same admission give one event.admitted notice',()=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 const heard=[],hooks=partyHooks(),notify=hooks.notify;
 hooks.notify=(kind,payload)=>{if(kind==='event.admitted')heard.push([payload.member,payload.event]);return notify.call(hooks,kind,payload);};
 try{
  const f=fixture(),report=event=>{f.statuses.W={seenAt:1000};return event?f.admitTo('W',event):f.admit({name:'W'});};
  for(let i=0;i<3;i++)report('goobrawl');
  assert.deepEqual(heard,[['W','goobrawl']]);
  report(null);report('goobrawl');
  assert.deepEqual(heard,[['W','goobrawl'],['W','goobrawl']],'a new admission after one ends is told again');
 }finally{hooks.notify=notify;}
});
// The live Goobrawl run: after `event.ended`, the reports that still named Goobrawl admitted the
// priest and the warrior to the ended occurrence.
test('an ended occurrence admits nobody, and the next occurrence admits again',()=>{
 const {observeEventAttendance}=require('../../runtime/events/coordinator/attendance.ts');
 const f=fixture();f.state.eventAttendance={};
 const party={eventAttendance:f.state.eventAttendance,eventSelectionsByCharacter:{P:['goobrawl'],W:['goobrawl']}};
 const feed=(name,live,at)=>observeEventAttendance(party,{name,server:'I',serverLiveEvents:live,eventFeedConnected:true},at);
 for(const name of ['P','W'])feed(name,[{name:'goobrawl',id:'g1'}],1000);
 assert.equal(f.admitTo('W','goobrawl').allowed,true);
 for(const name of ['P','W'])feed(name,[],2000);
 for(const name of ['P','W'])assert.deepEqual(f.admitTo(name,'goobrawl'),{event:'goobrawl',allowed:false,reason:'occurrence ended'},name+' is not admitted to the ended occurrence');
 feed('P',[{name:'goobrawl',id:'g2'}],3000);
 assert.equal(f.admitTo('P','goobrawl').allowed,true,'a new occurrence admits again');
});

// The unit rows: the death limit has no live seed, and the slot and the add-on kind list are reads
// with no game state.
const { observeEventAttendance, rejoinOccurrence, playerMoved, eventInstanceAllowed } = require('../../runtime/events/coordinator/attendance.ts');
const { adoptAddonKinds, eventKinds, eventKey, eventListRows } = require('../../runtime/events/rules.ts');
const { createRegistry } = require('../../runtime/hooks/registry.ts');
const { partyHooks } = require('../../runtime/hooks/index.ts');
test('U: a death limit ends attendance', () => {
  const heard = [];
  partyHooks().publish({ name: 'test:event-limit', folder: 'core', author: 'test', summary: 'Hears the event limits.',
    hooks: { 'event.limit': payload => heard.push(payload) } });
  const party = { leader: 'W', followers: {}, eventSelectionsByCharacter: { W: ['franky'] }, eventAttendance: {},
    eventLimitsByCharacter: { W: { franky: { deathLimit: 0, timeLimitMinutes: null } } } };
  const live = { name: 'W', server: 'US I', serverLiveEvents: [{ name: 'franky', id: 'n1' }], eventFeedConnected: true, joinedEvent: 'franky' };
  observeEventAttendance(party, live, 1000);
  observeEventAttendance(party, { ...live, rip: true, lastDeath: { at: 1500, eventTrip: { event: 'franky' } } }, 2000);
  assert.equal(party.eventAttendance.W.franky.ignored, 'death limit');
  assert.deepEqual(heard.map(h => [h.member, h.event, h.limit, h.by]), [['W', 'franky', 'death limit', 'core:events']]);
});
// Rejoin half: the slot lists a member a manual move took off the map as rejoinable, the rejoin
// route clears only that leave, and a limit stays.
test('U: the slot data lists the left member as rejoinable', () => {
  const state = { statuses: { W: { seenAt: 1000, server: 'US I', map: 'goobrawl', mapEvent: 'goobrawl', eventFeedConnected: true } },
    eventAttendance: { W: { goobrawl: { id: null, realm: 'US I', lastLiveAt: 1000, ended: false, elapsedMs: 0, lastObservedAt: 1000, attending: true, deaths: 0, lastDeathAt: 0, dead: false } },
      P: { goobrawl: { id: null, realm: 'US I', lastLiveAt: 1000, ended: false, elapsedMs: 0, lastObservedAt: 1000, attending: false, deaths: 2, lastDeathAt: 0, dead: false, ignored: 'death limit' } } } };
  playerMoved(state, ['W'], { map: 'main' }, 1000);
  const rows = eventListRows(state.eventAttendance);
  assert.deepEqual(rows.map(r => [r.member, r.event, r.label, r.state, r.rejoin]),
    [['W', 'goobrawl', 'Goobrawl', 'left', true], ['P', 'goobrawl', 'Goobrawl', 'limit', false]]);
  assert.equal(rejoinOccurrence(state, 'P', 'goobrawl'), false, 'a limit is not rejoinable');
  assert.equal(rejoinOccurrence(state, 'W', 'goobrawl'), true);
  assert.equal(eventListRows(state.eventAttendance)[0].state, 'attending');
});
// `event.kind` : an enabled add-on's row joins the kind list after the core rows; a core name is
// refused with the notices' errors; turning the add-on off takes the row out.
test('U: the kinds list includes the add-on kind', () => {
  const registry = createRegistry();
  const kind = (name, label) => ({ name, folder: 'addons', author: 'test', summary: 'An event kind.', hooks: { 'event.kind': () => ({ name: label, label, kind: 'walk', point: { map: 'main', x: 0, y: 0 } }) } });
  assert.deepEqual(registry.register(kind('dream-kind', 'dreams')), { ok: true });
  assert.deepEqual(registry.register(kind('core-name', 'franky')), { ok: true });
  registry.configure({ 'dream-kind': { enabled: true }, 'core-name': { enabled: true } });
  try {
    adoptAddonKinds(registry.events.kinds());
    assert.equal(eventKinds().at(-1).name, 'dreams');
    assert.equal(eventKey('dreams').added, 'addon');
    assert.equal(eventKey('franky').added, 'legacy', 'the core row stays');
    assert.ok(registry.noticeErrors().some(e => e.name === 'core-name' && e.hook === 'event.kind' && /core event/.test(e.error)));
    registry.configure({ 'core-name': { enabled: true } });
    adoptAddonKinds(registry.events.kinds());
    assert.equal(eventKey('dreams'), null, 'off, the row leaves K1');
  } finally { adoptAddonKinds([]); }
});
// and: createOccurrences on one group's reports. A walk the report names schedules a record and asks
// the group's walk estimate; the lead is the walk plus one report interval, and `due` holds from the
// spawn minus the lead; the live list starts and ends it; a member whose current feed drops the walk
// misses it; a live record keeps its spawn; a failed estimate is asked again on the next report.
const { createOccurrences } = require('../../runtime/events/coordinator/occurrences.ts');
test('K2 schedules, dues, starts and ends one group occurrence', async () => {
  const notices = [], asks = [];
  let now = 1234, answer = () => Promise.resolve(4321);
  const notice = name => payload => notices.push([name, payload.event, payload.reason ?? null]);
  partyHooks().publish({ name: 'test:k2', folder: 'core', author: 'test', summary: 'Answers the walk estimate and hears K2.',
    hooks: { 'walks.estimate': (group, destination, member) => { asks.push([group, member]); return answer(); },
      'event.scheduled': notice('scheduled'), 'event.due': notice('due'), 'event.started': notice('started'), 'event.ended': notice('ended') } });
  const k2 = createOccurrences(() => now);
  const spawnAt = 99999, walk = { event: 'mrgreen', spawnAt, destination: { map: 'spookytown', x: 1, y: 1 } };
  const report = over => ({ name: 'W', server: 'US I', seenAt: now, eventFeedConnected: true, reportIntervalMs: 100, eventWalks: [walk], ...over });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  k2.observe('g', report());
  await settle();
  assert.deepEqual(notices, [['scheduled', 'mrgreen', null]]);
  assert.deepEqual(k2.observe('g', report()), { mrgreen: 4421 }, 'the walk plus one report interval');
  assert.equal(k2.schedule('g|mrgreen').phase, 'scheduled');
  now = spawnAt - 4421;
  k2.observe('g', report());
  assert.equal(k2.schedule('g|mrgreen').phase, 'due');
  k2.observe('g', report({ serverLiveEvents: [{ name: 'mrgreen' }] }));
  k2.observe('g', report({ serverLiveEvents: [{ name: 'mrgreen' }], eventWalks: [{ ...walk, spawnAt: spawnAt + 1 }] }));
  assert.equal(k2.schedule('g|mrgreen').spawnAt, spawnAt, 'a live record keeps its spawn');
  k2.observe('g', report({ eventWalks: [] }));
  assert.deepEqual(notices.slice(1), [['due', 'mrgreen', null], ['started', 'mrgreen', null], ['ended', 'mrgreen', 'ended']]);
  assert.equal(k2.schedule('g|mrgreen'), null);
  // A failed first estimate leaves no lead, and the next report asks again.
  notices.length = 0; asks.length = 0; answer = () => Promise.reject(Error('no walk'));
  k2.observe('g', report());
  await settle();
  assert.deepEqual(k2.observe('g', report()), {}, 'no answer, no lead');
  assert.equal(asks.length, 2);
  // The naming member's current feed drops the walk: the record is missed.
  k2.observe('g', report({ eventWalks: [] }));
  assert.deepEqual(notices, [['scheduled', 'mrgreen', null], ['ended', 'mrgreen', 'missed']]);
  // A group with no members is gone, and its records end; another group's stay.
  notices.length = 0;
  k2.observe('g', report()); k2.observe('h', report({ name: 'P' }));
  k2.groupGone('g');
  assert.deepEqual(notices.filter(([name]) => name === 'ended'), [['ended', 'mrgreen', 'ended']]);
  assert.equal(k2.schedule('g|mrgreen'), null);
  assert.equal(k2.schedule('h|mrgreen').group, 'h');
});
// Events hook table (live run on a4884e05f), "Goobrawl goes live": Goo Brawl is a join kind with no
// walk, so no report named its spawn and no record opened; its live listing fired no
// `event.started`. The first current report that lists an event no walk scheduled opens its record
// live, and `event.schedule` leaves it out, since it has no spawn or walk to read.
test('the occurrence record starts and ends an event no walk scheduled from the live list', () => {
  delete globalThis.__partyHooks;
  const notices = [];
  const notice = name => payload => notices.push([name, payload.event, payload.reason ?? null]);
  partyHooks().publish({ name: 'test:k2-join', folder: 'core', author: 'test', summary: 'Hears K2.',
    hooks: { 'walks.estimate': () => Promise.resolve(1), 'event.scheduled': notice('scheduled'), 'event.due': notice('due'),
      'event.started': notice('started'), 'event.ended': notice('ended') } });
  const k2 = createOccurrences(() => 1234);
  const report = live => ({ name: 'W', server: 'US I', eventFeedConnected: true, reportIntervalMs: 100, eventWalks: [], serverLiveEvents: live });
  k2.observe('g', report([{ name: 'goobrawl' }, { name: 'not-an-event' }]));
  k2.observe('g', { ...report([{ name: 'goobrawl' }]), name: 'P' });
  assert.deepEqual(notices, [['started', 'goobrawl', null]], 'one start, and only for an event K1 knows');
  assert.equal(k2.schedule('g|goobrawl'), null, 'no spawn or walk to read');
  assert.deepEqual(k2.observe('g', report([])), {});
  assert.deepEqual(notices.slice(1), [['ended', 'goobrawl', 'ended']]);
  // A feed that is not current opens nothing.
  k2.observe('g', { ...report([{ name: 'goobrawl' }]), eventClockStale: true });
  assert.equal(notices.length, 2);
});
// Separate: the live events hook table, where the warrior and the priest reported Mr. Green's spawn
// 125 ms apart on their report clocks. Each report ended the other's record as missed and opened a
// new one, so the walk estimate's answer always went to a replaced record and `due` came with no walk.
test('K2 keeps one record for a spawn two members name at different report-clock times', async () => {
  // A registry of its own: the row above leaves its estimate answering a rejection.
  delete globalThis.__partyHooks;
  const notices = [];
  partyHooks().publish({ name: 'test:k2-members', folder: 'core', author: 'test', summary: 'Answers the walk estimate and hears K2.',
    hooks: { 'walks.estimate': () => Promise.resolve(4321),
      'event.scheduled': payload => notices.push(['scheduled', payload.spawnAt]), 'event.ended': payload => notices.push(['ended', payload.reason]) } });
  const k2 = createOccurrences(() => 1234);
  const walk = { event: 'mrgreen', spawnAt: 99999, spawnId: 777, destination: { map: 'spookytown', x: 1, y: 1 } };
  const report = (name, spawnAt) => ({ name, server: 'US I', eventFeedConnected: true, reportIntervalMs: 100, eventWalks: [{ ...walk, spawnAt }] });
  k2.observe('g', report('W', 99999));
  k2.observe('g', report('P', 99874));
  await new Promise(resolve => setImmediate(resolve));
  k2.observe('g', report('W', 99999));
  assert.deepEqual(notices, [['scheduled', 99999]], 'one record, never missed');
  assert.equal(k2.schedule('g|mrgreen').walkMs, 4321, 'the estimate settles on the kept record');
  // A later spawn has a new server id and replaces the record.
  k2.observe('g', { ...report('W', 199999), eventWalks: [{ ...walk, spawnAt: 199999, spawnId: 778 }] });
  assert.deepEqual(notices.slice(1), [['ended', 'missed'], ['scheduled', 199999]]);
});

// The game's Green feed entry names no instance (server_functions.js:2768), so the instance a death
// limit exhausted ends only in the feed's gap, and the next listing starts a fresh record.
test('a death limited instance with no feed id ends in the feed gap and the next one starts clear',()=>{
 const {observeEventAttendance}=require('../../runtime/events/coordinator/attendance.ts');
 const party={eventAttendance:{},eventSelectionsByCharacter:{W:['mrgreen']},eventLimitsByCharacter:{W:{mrgreen:{deathLimit:0,timeLimitMinutes:null}}}};
 const report=(live,extra={})=>({name:'W',server:'I',eventFeedConnected:true,serverLiveEvents:live?[{name:'mrgreen'}]:[],...extra});
 observeEventAttendance(party,report(true,{joinedEvent:'mrgreen'}),1000);
 observeEventAttendance(party,report(true,{rip:true,lastDeath:{at:1500,eventTrip:{event:'mrgreen'}}}),2000);
 assert.equal(party.eventAttendance.W.mrgreen.ignored,'death limit');
 observeEventAttendance(party,report(true),3000);
 assert.equal(party.eventAttendance.W.mrgreen.ignored,'death limit','with no id and no gap it is the same instance');
 observeEventAttendance(party,report(false),4000);
 assert.equal(party.eventAttendance.W.mrgreen.ended,true);
 observeEventAttendance(party,report(true),5000);
 assert.equal(party.eventAttendance.W.mrgreen.ignored,undefined,'the next listing is a new instance');
 assert.equal(party.eventAttendance.W.mrgreen.deaths,0);
});

// `left` in `members` (attendance.ts `leftOccurrence`): the warrior's move off Goo Brawl is
// observed live, and its feed then ends the occurrence first, which marks its left record ended.
test('a member a player moved off the event stays out of its return, and the return of the one who stayed frees the group',()=>{
 const {createCoordinatorEventObservations,createCoordinatorEventReturns}=require('../../runtime/events/coordinator/returns.ts');
 const {presence,eventSource}=require('../../runtime/events/coordinator/source.ts');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 const returned=[],hooks=partyHooks(),notify=hooks.notify;
 hooks.notify=(kind,payload)=>{if(kind==='event.returned')returned.push(payload.members);return notify.call(hooks,kind,payload);};
 let now=1000;const revision={P:1,W:1},spot={map:'cave',x:1,y:2};let id=1;
 const state={leader:'W',followers:{P:true},merchantCharacter:'M',eventSelectionsByCharacter:{W:['goobrawl']},eventSessions:{},eventReturn:null,eventReturnLast:null,
  deferredEventReturns:{},anniversary:{eventCycle:null},statuses:{},commands:{},eventAttendance:{},huntEventTrips:{},activeConvoy:null,townCycle:null};
 const enabled=(name,event)=>!event||eventInstanceAllowed(state,name,event);
 const capture=names=>Object.fromEntries((names||['P','W']).map(name=>[name,{revision:revision[name],location:spot}]));
 const returns=createCoordinatorEventReturns(state,{now:()=>now,nextCommand:()=>id++,activeNames:()=>['P','W'],enabled,checkpoint:()=>spot,cancelConvoy(){},startConvoy:()=>false,
  anniversaryParticipants:()=>[],persist(){},huntCycle:()=>false,navigation:{capture,dispatch:owner=>{owner.returnDispatchedAt=owner.returnCompletedAt=now;return true;},reconcile:()=>true,finish(){}}});
 const observer=createCoordinatorEventObservations(state,{now:()=>now,nextCommand:()=>id++,activeNames:()=>['P','W'],online:()=>true,enabled,admits:()=>true,selected:()=>['goobrawl'],
  checkpoint:()=>spot,persist(){},log(){},goobrawlStillFighting:()=>false,begin:returns.begin,finishIfReady:returns.finishIfReady,cancelConvoy(){},
  navigation:{capture,location:()=>spot,intent:name=>({revision:revision[name]})}});
 const onMap={map:'goobrawl',mapEvent:'goobrawl',joinedEvent:'goobrawl'},offMap={map:'main',x:0,y:0};
 const report=(name,over)=>{const body=state.statuses[name]={name,seenAt:now,server:'US I',eventFeedConnected:true,serverLiveEvents:[{name:'goobrawl',id:'g1'}],...over};
  observeEventAttendance(state,body,now);observer.observe(body);returns.reconcile();};
 try{
  for(const name of ['W','P']){observer.admit({name,activeEvent:'goobrawl'});report(name,onMap);}
  now=2000;revision.W=2;playerMoved(state,['W'],{map:'main'},now);report('W',offMap);
  now=3000;report('W',{...offMap,serverLiveEvents:[]});report('P',{...onMap,serverLiveEvents:[]});
  assert.deepEqual(state.eventReturn.participants,['P'],'the warrior left by the player is not returned');
  assert.equal(state.commands.W,undefined,"no Town command undoes the player's move");
  // The priest's Town lands it in Main (routes.ts `acknowledgeReturn`).
  now=4000;report('P',{...offMap,serverLiveEvents:[]});state.eventReturn.pending=[];returns.reconcile();
  assert.deepEqual(returned,[['P']],'the return names the member it brought back');
  assert.equal(state.eventReturn,null);
  assert.deepEqual(['P','W'].map(name=>presence(state,name)),[null,null],'no member is left on the event');
  const source=eventSource({presence:name=>presence(state,name),eventReturn:()=>state.eventReturn,merchantReturn:()=>undefined,commandHold:()=>null});
  const [attend,back]=source.hooks['task.request']({groupKind:'party',members:['W','P']});
  assert.deepEqual([attend.ask,back.ask],[null,null],'the group holds no event task');
 }finally{hooks.notify=notify;}
});
