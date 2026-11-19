const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
const {huntMessage}=require('../../runtime/hunting/coordinator/record.ts');
function fixture(){
 const state={monsterHunt:{stage:'returning',participants:['P'],convoyId:'old',returnRetries:2},activeConvoy:{id:'old',purpose:'monster-hunt',phase:'failed'},
  statuses:{P:{convoyProtocol:4}},commands:{},monsterHunterLocation:{map:'main',x:1,y:2}};
 const calls=[],ports={owned:name=>name==='P',ownsTravel:()=>true,fresh:()=>true,intent:()=>({cancelled:false}),cancelConvoy:()=>calls.push('cancel'),
  start:hunt=>{calls.push('start');hunt.convoyId='new';},persist:()=>calls.push('persist')};
 const routes=createHuntRoutes(state,ports).controls;
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,ports,calls,send};
}
test('manual hunt-return retry waits for runtime compatibility and existing command ownership',()=>{
 const t=fixture();t.state.statuses.P.convoyProtocol=1;assert.equal(t.send('retryReturn').code,409);
 t.state.statuses.P.convoyProtocol=4;t.state.commands.P={convoyId:'other'};assert.equal(t.send('retryReturn').code,409);assert.equal(t.calls.length,0);
 t.state.commands.P.convoyId='old';assert.equal(t.send('retryReturn').body.convoyId,'new');assert.deepEqual(t.calls,['cancel','start','persist']);
});
test('interaction acknowledgements cannot clear a newer command and success waits for quest telemetry',()=>{
 const t=fixture(),command={id:7,type:'monster-hunt-interact',cycleId:'cycle',action:'claim'};t.state.commands.P=command;
 assert.equal(t.send('interactionComplete',{character:'P',commandId:6,cycleId:'cycle',success:false}).code,409);assert.equal(t.state.commands.P,command);
 t.send('interactionComplete',{character:'P',commandId:7,cycleId:'cycle',success:true});assert.equal(t.state.commands.P,command);
 t.send('interactionComplete',{character:'P',commandId:7,cycleId:'cycle',success:false,error:'busy'});assert.equal(t.state.commands.P,undefined);assert.equal(huntMessage(t.state.monsterHunt),'Retrying claim for P: busy');
});
// (-07d): after a hand-in, `events-pending` holds the next quest until every participant the
// lifecycle owner holds online has sent one report stamped after the release. A silent member holds
// it by the lifecycle owner's answer, not by its report's age.
test('events-pending waits for one report per online participant after the hand-in, then releases',()=>{
 const {eventsPending:pendingFor}=require('../../runtime/hunting/coordinator/hunt.ts');
 const offline=new Set();
 const eventsPending=(hunt,statuses)=>pendingFor(hunt,statuses,name=>!!statuses[name]?.huntEventPending,name=>!offline.has(name));
 const hunt={stage:'at-daisy',participants:['W','P'],eventReleaseAt:10000};
 const statuses={W:{seenAt:9900},P:{seenAt:9950}};
 assert.equal(eventsPending(hunt,statuses),true);
 statuses.W.seenAt=10200;assert.equal(eventsPending(hunt,statuses),true);
 statuses.P.seenAt=10300;assert.equal(eventsPending(hunt,statuses),false);
 statuses.P.huntEventPending=true;assert.equal(eventsPending(hunt,statuses),true);
 delete statuses.P.huntEventPending;statuses.P.seenAt=9950;
 assert.equal(eventsPending(hunt,statuses),true,'a silent member 13 holds online keeps the quest held');
 offline.add('P');assert.equal(eventsPending(hunt,statuses),false,'13 answering the silent member offline releases it');
});
// The `hunt` source answers for combat groups only, so a Hunt never holds the merchant group's
// event travel.
test('the Hunt source asks nothing for the merchant group during a Hunt',()=>{
 const {createHuntingSources}=require('../../runtime/hunting/coordinator/install.ts');
 const scope={targetMode:'hunt',leader:'W',monsterHunt:{cycleId:'c',stage:'returning',participants:['W','P'],turnIn:{owner:'W',phase:'returning'}}};
 const {hunt}=createHuntingSources({visit:()=>null,rare:()=>null,scope:()=>scope,due:()=>false});
 const ask=kind=>hunt.hooks['task.request']({group:kind+':W',groupKind:kind,members:['W'],live:null,tick:1});
 assert.deepEqual(ask('merchant'),[]);
 assert.equal(ask('party')[0].ask.kind,'hunt-turn-in');
});
// `event.pending` (the events owner's for the hunting owner's Hunt): the events owner answers from
// the member's latest report, and a released Hunt holds its next quest while any participant reports
// its Hunt waits on an event.
test('event.pending: a released Hunt waits while a member reports an event pending',()=>{
 const {eventsPending}=require('../../runtime/hunting/coordinator/hunt.ts');
 const statuses={W:{seenAt:20000},P:{seenAt:20000,huntEventPending:true}};
 const answer=name=>!!statuses[name]?.huntEventPending,online=()=>true;
 const hunt={stage:'at-daisy',participants:['W','P'],eventReleaseAt:10000};
 assert.equal(eventsPending(hunt,statuses,answer,online),true);
 statuses.P.huntEventPending=false;assert.equal(eventsPending(hunt,statuses,answer,online),false);
 assert.equal(eventsPending({...hunt,eventReleaseAt:null},{P:{seenAt:20000,huntEventPending:true}},()=>true,online),false,'an unreleased Hunt asks nothing');
});
// The cycle changes stage only through record.ts `huntStep`, along its edges. One
// Hunt runs from its quest check through a pickup, the mission and the turn-in, and its stages
// follow v1.5.0's order with no step outside the edge table.
test('a full Hunt cycle steps along H2 edges in the earlier console\'s order',()=>{
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const {HUNT_EDGES}=require('../../runtime/hunting/coordinator/record.ts');
 const {priority}=require('../../runtime/tasks/api.ts');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 if(!partyHooks().map().registrations.some(r=>r.name==='test:event-pending'))
  partyHooks().publish({name:'test:event-pending',folder:'core',author:'test',summary:'Answers no event pending.',hooks:{'event.pending':()=>false}});
 let now=1,walks=0;
 const daisy={map:'main',x:0,y:0},spawn={map:'main',x:600,y:0};
 const at=(where,extra={})=>({seenAt:now,server:'US',ctype:'warrior',hp:100,speed:50,convoyProtocol:4,map:where.map,x:where.x,y:where.y,
  groupedCombat:{currentAttackersAt:now,currentAttackers:[]},...extra});
 const state={targetMode:'hunt',leader:'W',followers:{},commands:{},nextCommandId:1,activeConvoy:null,monsterHunterLocation:daisy,
  monsterChoices:[{id:'bee',locations:[{map:'main',x:600,y:0}]}],statuses:{W:at(daisy,{monsterHunt:null})},combatLogs:{}};
 const steps=[];let stage='checking-quests';
 state.monsterHunt={version:2,policyVersion:3,cycleId:'c',participants:['W'],missions:[],currentIndex:-1,target:null,startedAt:1,
  selectionLeader:'W',owner:'W',returnPolicy:'farming',returnLocation:null};
 Object.defineProperty(state.monsterHunt,'stage',{enumerable:true,get:()=>stage,set:to=>{if(to!==stage)steps.push(stage+' -> '+to);stage=to;}});
 const errors=[],error=console.error;console.error=message=>errors.push(String(message));
 const hunt=createHunt(state,{now:()=>now,participants:()=>['W'],cancelConvoy(){state.activeConvoy=null;},persist(){},selectedDestination:()=>null,
  start(location,label,names,purpose){state.activeConvoy={id:'walk'+(++walks),purpose,label,participants:names,location,phase:'walking'};return true;},
  navigation:{authorize(){},intent:()=>({revision:0})},ownsTravel:priority,online:()=>true});
 const report=(where,quest)=>{now+=1;state.statuses.W=at(where,{monsterHunt:quest});};
 const arrive=where=>{state.activeConvoy=null;report(where,state.statuses.W.monsterHunt);};
 try{
  hunt.tick();                                   // no quest: walk to Daisy for a pickup
  arrive(daisy);hunt.tick();                     // at Daisy: the assignment is issued
  report(daisy,{id:'bee',count:2,remainingMs:90});hunt.tick();   // the quest shows: the mission walk
  hunt.walkArrived(state.monsterHunt.convoyId); // the walk's arrival hands the cycle to farming
  arrive(spawn);report(spawn,{id:'bee',count:0,remainingMs:80});hunt.tick();  // kills done: the turn-in walk
  arrive(daisy);hunt.tick();                     // at Daisy: the claim is issued
  report(daisy,null);hunt.tick();                // claimed: events go first
  report(daisy,null);hunt.tick();                // the next quest
 }finally{console.error=error;}
 assert.deepEqual(steps,['checking-quests -> daisy-sync-travel','daisy-sync-travel -> at-daisy','at-daisy -> assigning',
  'assigning -> mission-travel','mission-travel -> farming','farming -> returning','returning -> at-daisy','at-daisy -> assigning']);
 for(const step of steps){const [from,to]=step.split(' -> ');assert.ok(HUNT_EDGES[to].from.includes(from),step+' is an H2 edge');}
 assert.deepEqual(errors,[]);
});
// Tasks row 5: a report's one-shot types reach the scope's scatter record through its writer, so
// the record's saved list is replaced, never pushed into.
test('one-shot types reach the scatter record through its writer',()=>{
 const {createScatterReports}=require('../../runtime/hunting/coordinator/modes.ts');
 const saved=Object.freeze(['goo']),scope={scatterMonsterTypes:saved,scatterEpoch:2,statuses:{},leader:'W',merchantCharacter:null};
 const reports=createScatterReports({farmingState:()=>scope,activeNames:()=>[],now:()=>1,rareOwns:()=>false});
 assert.deepEqual(reports.oneShots({name:'W',oneShotMonsterTypes:['rat'],oneShotEpoch:2}),['rat']);
 assert.deepEqual([saved,scope.scatterMonsterTypes],[['goo'],['goo','rat']]);
});
// Leaving Hunt starts the walk to the leader's farm with movement's `hunt-fallback` purpose, and
// selecting Hunt again ends that walk by its purpose, whatever its label; a walk with no purpose
// stays, since a label names no walk.
test('a fallback walk is started and ended by its purpose, never its label',()=>{
 const {createHuntEntry}=require('../../runtime/hunting/coordinator/modes.ts');
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const walks=[],farm={map:'main',x:5,y:5};
 const entry=createHuntEntry({leader:'W',monsterFocusByCharacter:{},statuses:{}},{participants:()=>['W'],cancelled:()=>false,release(){},
  authorize(){},monsterDestination:()=>null,clear(){},selectedDestination:()=>({location:farm}),begin(){},
  convoy:(location,label,names,purpose)=>walks.push(purpose)});
 entry.select('hunt','farming',null,undefined,false);
 assert.deepEqual(walks,['hunt-fallback']);
 const cancelled=[];
 const tick=convoy=>{
  const state={targetMode:'hunt',leader:'W',followers:{},statuses:{},commands:{},activeConvoy:convoy,
   monsterHunt:{cycleId:'c',stage:'farming',participants:['W'],missions:[],currentIndex:-1,target:'bee',startedAt:1,convoyId:null,
    owner:'W',selectionLeader:'W'}};
  createHunt(state,{now:()=>1,persist(){},cancelConvoy:()=>cancelled.push(convoy.label),participants:()=>['W'],ownsTravel:()=>false,
   navigation:{intent:()=>({revision:0})},online:()=>true}).tick();
 };
 tick({id:'a',purpose:'hunt-fallback',label:'any label',participants:['W']});
 tick({id:'b',label:"the leader's configured farming focus",participants:['W']});
 assert.deepEqual(cancelled,['any label']);
});
