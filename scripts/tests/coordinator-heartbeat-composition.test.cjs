const test=require('node:test'),assert=require('node:assert/strict');
const {createHeartbeatReply,assemble}=require('../../runtime/status/coordinator/reply.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
// Table R's movement sections are movement's `movement.reply`, which core:movement registers in the real
// start.
const {partyHooks}=require('../../runtime/hooks/index.ts');
partyHooks().register(require('../../runtime/movement/coordinator/runtime.ts').coordinatorMovementRegistration(()=>undefined,{time:async()=>0,statuses:()=>({})},partyHooks().walks));
// The merchant reply reads the tasks owner's live task and the events owner's deferred return for its event
// hold; no row here holds either.
require('../../runtime/tasks/api.ts').publishTasks({groupOf:()=>null,live:()=>null});
require('../../runtime/events/api.ts').publishEventAnswers({deferredReturn:()=>false});
function fixture(){
 const state={commands:{},statuses:{},followers:{},monsterFocus:['goo'],monsterFocusByCharacter:{},
  monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},monsterChoices:['catalog'],combatMode:'auto',
  monsterHunt:null,bankQueue:[],bankbois:{},bankSnapshot:{},goldTargets:{},merchantCharacter:'M',gatheringModes:[]};
 let intent={revision:1},waypoint={map:'main'};
 const settings=settingsWriter(state);
 // The tasks owner's `presence` reads the fact each status carries, as install.ts
 // answers it.
 require('./helpers/requesters.cjs').publishPresence(()=>state.statuses);
 const reply=createHeartbeatReply(state,{
  now:()=>100,activeNames:()=>[],enabled:()=>false,intent:()=>intent,rareControl:()=>null,
  convoySignal:(current,name)=>({current,name}),waypoint:()=>waypoint,resolveArea:(catalog,focus,point)=>({catalog,focus,point}),
  rareEncounter:()=>null,huntOwns:hunt=>!!hunt?.turnIn,mapSubscriberCount:()=>0,
  stackHomes:(bank,bankbois)=>({bank,bankbois}),groupedCombat:()=>null,selectedEvents:current=>current.selection||[],
  anniversary:()=>null,rareOwns:()=>false,task:()=>null,setting:query=>settings.read(query),records:{heartbeat:()=>false},
  diagnosticsRings:()=>[],items:()=>({}),
 });
 // Table R's group sections in the table's order, as coordinator/reply.ts `createReply` assembles them.
 const api={...reply,response:(name,mode)=>assemble(reply.sections,name,mode)};
 return {state,api,setIntent:value=>intent=value,setWaypoint:value=>waypoint=value};
}

test('BankBoi service commands survive repeated heartbeat delivery until completion',()=>{
 const {state,api}=fixture();const command={id:7,type:'bankboi-service'};state.commands.B=command;
 assert.equal(api.response('B').command,command);assert.equal(api.response('B').command,command);
 assert.equal(state.commands.B,command);
});

test('ALData sales remain deliverable after a realm-switch worker restart until completion',()=>{
 const {state,api}=fixture();
 const command={id:8,type:'merchant-aldata-sell',jobId:'sale-8',server:'EUI',buyer:'Buyer',item:{name:'upgrade4',level:0},quantity:1};
 state.commands.M=command;
 state.statuses.M={name:'M',runtimeId:'before-switch',server:'USII'};
 assert.deepEqual(api.response('M').command,command);
 state.statuses.M={name:'M',runtimeId:'after-switch',server:'EUI'};
 assert.deepEqual(api.response('M').command,command);
 assert.equal(state.commands.M,command);
 delete state.commands.M;
 assert.equal(api.response('M').command,null);
 state.commands.M={id:9,type:'character-travel'};
 assert.equal(api.response('M').command.id,9);
 assert.equal(api.response('M').command,null);
});

test('combat-only heartbeat does not deliver or decorate pending navigation commands',()=>{
 const {state,api}=fixture();const command={type:'travel'};state.commands.P=command;
 const response=api.response('P','combat');
 assert.equal(response.convoySignal.current,state);assert.equal(response.convoySignal.name,'P');
 assert.equal(state.commands.P,command);assert.equal(command.navigationRevision,undefined);
 assert.equal(Object.hasOwn(response,'command'),false);
});

test('retained deferred checkpoint does not publish its retired exit cycle in heartbeat',()=>{
 const f=fixture();f.state.deferredEventReturns={P:{cycleId:'old',phase:'awaiting-event-admission',checkpoint:{map:'uhills',x:1,y:2}},W:{cycleId:'peer',phase:'returning-to-checkpoint'}};
 assert.equal(f.api.response('P').eventReturnCycleId,null);assert.equal(f.api.response('W').eventReturnCycleId,'peer');
 f.state.eventReturn={cycleId:'current',participants:['P']};assert.equal(f.api.response('P').eventReturnCycleId,'current');
 f.state.eventReturn=null;f.state.deferredEventReturns.P.phase='returning-to-town';assert.equal(f.api.response('P').eventReturnCycleId,'old');
});

// The heartbeat keeps the party Town cycle in step with each member's navigation. A member
// whose revision moved on leaves the cycle with its command, a Town command outside the cycle
// is dropped, and a member still pending gets its command back.
test('the heartbeat retires a moved-on Town member, drops an orphaned Town command and restores a pending one',()=>{
 const {state,api}=fixture();
 state.townCycle={id:'town',pending:['P','W'],revisions:{P:0,W:1}};
 state.commands.P={id:1,type:'town-party',cycleId:'town'};state.commands.X={id:2,type:'town-party',cycleId:'old'};
 assert.equal(api.response('P').command,null);assert.equal(state.commands.P,undefined);assert.deepEqual(state.townCycle.pending,['W']);
 assert.equal(api.response('X').command,null);assert.equal(state.commands.X,undefined);
 const restored=api.response('W').command;assert.equal(restored?.type,'town-party');assert.equal(restored.cycleId,'town');
});

// Each section reads once, in the table's order, and a combat poll carries only the sections the
// table marks for the channel. One row per section.
{
 const { TABLE_R } = require('../../runtime/status/rules.ts');
 const planted = mode => {
  const reads = [], sections = Object.fromEntries(TABLE_R.map(row => [row.section, name => { reads.push(row.section); return { [`${row.section}:${name}`]: true }; }]));
  return { reply: assemble(sections, 'W', mode), reads };
 };
 for (const row of TABLE_R) test(`the ${row.section} section rides ${[row.heartbeat && 'the heartbeat', row.combat && 'the channel'].filter(Boolean).join(' and ') || 'neither reply'} once`, () => {
  const heartbeat = planted(), combat = planted('combat');
  assert.equal(heartbeat.reads.filter(section => section === row.section).length, row.heartbeat ? 1 : 0);
  assert.equal(combat.reads.filter(section => section === row.section).length, row.combat ? 1 : 0);
  assert.equal(!!heartbeat.reply[`${row.section}:W`], row.heartbeat);
  assert.equal(!!combat.reply[`${row.section}:W`], row.combat);
 });
 test("the sections read in table R's order", () => {
  assert.deepEqual(planted().reads, TABLE_R.filter(row => row.heartbeat).map(row => row.section));
 });
}

// The event fields of one member's reply (events/coordinator/ reply.ts `eventReply`). The party
// hint is the member's selected event a reporting member lists live; the return cycle is the
// group's return, else the member's deferred row past admission; the sighting is the freshest
// Slenderman report on the member's realm and map; the Cipher context sums the round's stock over
// the leader's realm; the admission and the leads ride the report. The member's follow and event
// switches, its limits from the declared settings, the Cipher merchant and the anniversary ride
// the same reply, so the status owner's events section is that one read. The return cycle is
// `returnReply`, table R's return section, so the combat poll carries it.
test('the event reply names the hint, the return cycle, the sighting and the Cipher stock',()=>{
 const {createEventReply}=require('../../runtime/events/coordinator/reply.ts');
 const now=123456,cipher=(stock)=>({id:'witchcipher',cipher:{board:{id:'r1'},runtime:{stock}}});
 const sighting={id:'s1',server:'US I',map:'halloween',x:5,y:6,observedAt:now};
 const state={leader:'W',followers:{P:true},merchantCharacter:'M',eventReturn:{cycleId:'ret',participants:['W']},
  deferredEventReturns:{P:{cycleId:'old',phase:'awaiting-event-admission'},R:{cycleId:'own',phase:'awaiting-reconnect'}},
  eventLimitsByCharacter:{W:{mrgreen:{deathLimit:2,timeLimitMinutes:null}}},
  statuses:{
   W:{name:'W',seenAt:now,server:'US I',map:'halloween',serverLiveEvents:[{name:'mrgreen'}],eventAdmission:{event:'mrgreen',allowed:true},eventLeads:{mrgreen:42},
    eventSchedules:[cipher({verdantspore:1,frostscale:2})]},
   P:{name:'P',seenAt:now,server:'US I',map:'halloween',slendermanSighting:sighting,eventSchedules:[cipher({verdantspore:3})]},
   M:{name:'M',seenAt:now,server:'US I',map:'main',eventSchedules:[cipher({embercoal:4})]},
   R:{name:'R',seenAt:now,server:'US II',map:'halloween'}}};
 const reply=createEventReply(state,{now:()=>now,activeNames:()=>['W','P','R'],enabled:()=>true,
  selectedEvents:(s,name)=>name==='R'?[]:['mrgreen','witchcipher'],setting:({field})=>state[field],anniversary:()=>({round:'a1'})});
 const w=reply.eventReply('W');
 assert.equal(w.partyEventHint,'mrgreen');
 assert.deepEqual(reply.returnReply('W'),{eventReturnCycleId:'ret'});
 assert.equal('eventReturnCycleId' in w,false,'the cycle rides the return section, not the events section');
 assert.deepEqual(w.partySlendermanSighting,sighting);
 assert.deepEqual(w.eventAdmission,{event:'mrgreen',allowed:true});
 assert.deepEqual(w.eventLeads,{mrgreen:42});
 assert.deepEqual([w.followLeader,w.eventsEnabled,w.cipherMerchant,w.anniversary],[false,true,'M',{round:'a1'}]);
 assert.deepEqual(w.eventSettings,{mrgreen:{deathLimit:2,timeLimitMinutes:null}},'K1 limits over the declared settings');
 assert.deepEqual(reply.eventReply('P').eventSettings,w.eventSettings,"a follower takes the leader's limits");
 assert.deepEqual([w.cipherGathering.owner,w.cipherGathering.round,w.cipherGathering.ready],['W','r1',true]);
 assert.deepEqual(w.cipherGathering.stock,{verdantspore:4,frostscale:2,embercoal:4,gloomfeather:0},'leader, follower and merchant on the realm');
 assert.equal(reply.returnReply('P').eventReturnCycleId,null,'a deferred row waiting on admission names no cycle');
 const r=reply.eventReply('R');
 assert.equal(reply.returnReply('R').eventReturnCycleId,'own');
 assert.equal(r.partyEventHint,null,'no selected event');
 assert.equal(r.partySlendermanSighting,undefined,'another realm');
});

// Each table R section is its owner's published read, so the status owner's section map reads no
// member of the coordinator state itself; the owners' reads take the state whole. Red on v1.5.0:
// the event trip, the merchant hold, the hunting owner's paused flags and the leader.
test('table R sections in 12\'s reply read no owner state of their own', () => {
  const fs=require('node:fs'),path=require('node:path');
  const text=fs.readFileSync(path.join(__dirname,'..','..','runtime','status','coordinator','reply.ts'),'utf8');
  const start=text.indexOf('const sections: Sections = {');assert.ok(start>0);
  const block=text.slice(start,text.indexOf('\n  };',start));
  assert.deepEqual(block.match(/\bstate\.\w+/g)||[],[]);
});
