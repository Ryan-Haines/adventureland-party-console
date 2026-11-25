// Gives a vm context that runs sliced shared.js code the member's group walk
// (runtime/movement/character/walk-client.ts `createWalkClient`, with its defense and reports)
// once, each port read from or written to the context's own state, as shared.js's install does. A
// stand-in the context leaves out answers as absent, as shared.js's `typeof` checks did before
// the move: no farm target, entry point or hunt travel and no grouped farming. The event reach is
// The events owner's fact (`characterEvents.reachable`, helpers/character-events.cjs), none in a context without
// the facts, and the pending return is the context's `eventExit`. The context's own
// `groupWalk.travel` and `convoySignal` become the client's, and from then on `context.groupWalk`
// is the client's state; a stub the context defines of a client function stays the sliced code's.
// The host is the context's `root` as it stands at
// each read, which is the global in production, so a test that sets `root` after creation (often
// `c.root=c`) reaches the client; the game calls are the context's, and its eval runs code there.
const vm=require('node:vm');
const {walkStatePorts}=require('./walk-state-ports.cjs');
const {plantWalkState}=require('./walk-state.cjs');
const {createWalkClient}=require('../../../runtime/movement/character/walk-client.ts');
const {walkClientPorts,farmSpotPorts}=require('../../../runtime/movement/character/install.ts');
const {contextHost}=require('./context-host.cjs');
const {contextScope}=require('./run-scope.cjs');
// The walk's cruise asks the call budget (executor.ts sendCruise), which answers send here.
require('./planted-calls.cjs').plantCalls();
const walkClient=exports.walkClient=context=>{
 if(context.__walkClient)return context.__walkClient;
 if(!context.root)context.root={};
 // The owner's walk state starts its clock offset at 0 (owner.ts `installPartyMovement`).
 plantWalkState(context);context.coordinatorClockOffset??=0;
 const read=(name,absent)=>(...args)=>typeof context[name]==='function'?context[name](...args):absent;
 const host=contextHost(context,new Set(['game_log','parent','performance','setTimeout','can_use','can_move_to','is_in_range','is_transporting',
  'is_on_cooldown','can_walk','G','cruise']),{eval:code=>vm.runInContext(code,context)});
 // Movement's own ports (install.ts `walkClientPorts`) over the context's walk state, service, stop
 // and requesters (helpers/requesters.cjs). The defense's stop names its walk through the requesters'
 // convoyRequest, as install.ts passes it, so a context with none gets them on that first read.
 const requesters=()=>{if(typeof context.convoyRequest!=='function')require('./requesters.cjs').installRequesters(context,{missingOnly:true});return context;};
 const parts={movement:()=>context.movement,stop:(...args)=>context.stop(...args),requesters};
 const client=createWalkClient(host,{...walkStatePorts(context),...farmSpotPorts(context.walkState),
  ...walkClientPorts(context.walkState,parts,()=>context.reunionRealm()),
  scope:contextScope(context,'02','act'),generation:()=>context.runtimeGeneration,
  baseSpeed:read('unrestrictedRunSpeed',null),dungeonOwned:read('dungeonOwned',false),walkCommand:()=>context.coordinatorCommand,
  now:()=>(context.Date||Date).now(),character:()=>context.character,current:()=>context.runtimeCurrent(),
  request:(path,options)=>context.request(path,options),
  smartMove:(...args)=>context.smart_move(...args),
  leader:()=>context.leader,followLeader:()=>context.followLeader,
  // The owner's next scheduler pass (owner.ts `nextPass`). A sliced context runs no scheduler, so a
  // 100 ms turn of its own timer stands in for a pass, as the timer the loops used before did.
  nextPass:()=>new Promise(resolve=>(context.setTimeout||setTimeout)(resolve,100)),
  activeEvent:()=>context.eventAttend.active(),
  eventTarget:()=>context.nearestEventTarget(),eventReachable:target=>!!context.characterEvents?.reachable(target),
  eventReturnHolds:()=>context.eventReturnHolds(),
  eventReturnPending:()=>!!context.eventExit?.pending?.(),escaping:()=>context.escapeOwns(),
  departurePending:()=>context.departureCombatPending(),chests:()=>context.eligibleDepartureChests(),
  farmTravel:()=>context.farmingTravelToken,huntOutbound:read('outboundHuntTravel',false),huntReturnPlan:command=>require('../../../runtime/hunting/character/hunt.ts').huntReturnPlan(command),huntExtraAggro:read('huntTravelExtraAggro',false),
  huntControl:read('huntTravelControl',null),
  // The convoy defence triggers' event facts (shared.js:520, :546): The events owner's joined event, the event
  // target types and the targeting owner's attacker fact.
  joinedEvent:()=>context.eventAttend.joined(),eventTargetTypes:()=>context.eventTargetTypes,attacking:entity=>context.isAttackingPartyMember(entity),
  grouped:read('groupedFarming',false),groupedCombat:()=>context.groupedCombat,
  partyList:()=>context.currentPartyList(),fightDeaths:()=>context.fightDeaths,
  engaged:entity=>context.departureTargetEngaged(entity),entityReport:entity=>context.groupedEntityReport(entity),
  passingKey:target=>context.passingKey(target),
  farmTarget:read('farmingTravelTarget',null),entryPoint:location=>read('farmingEntryPoint',location)(location),
  huntLog:read('huntAcquisitionLog'),setHuntTarget:name=>{context.huntCombatTarget=name;},
  setCombatTarget:id=>{context.combatTargetId=id;},
  publishSelection:read('publishCombatSelection'),
  eventReturnComplete:()=>{context.eventRecoveryState.phase='complete';},
  // The member's next status report (owner.ts `nextReport`). A sliced context sends no status
  // reports, so its next timer turn stands in for one, which a test advances as it advanced the retry
  // timers this replaced.
  nextReport:()=>new Promise(resolve=>(context.setTimeout||setTimeout)(resolve,0))});
 if(context.groupWalk)client.groupWalk.travel=context.groupWalk.travel;
 if(context.convoySignal)client.groupWalk.signal=context.convoySignal;
 context.groupWalk=client.groupWalk;
 for(const [name,value] of Object.entries(client))if(!(name in context))context[name]=value;
 Object.defineProperty(context,'__walkClient',{value:client,enumerable:false,configurable:true});
 Object.defineProperty(context,'__walkHost',{value:host,enumerable:false,configurable:true});
 return client;
};
// The walk client builds its reports and defense (walk-client.ts `createWalkReports`,
// `createWalkDefense`); these installs put the client's own over the context's names, as
// shared.js's installs did. The names are the ones each factory returns.
const {createWalkReports,createWalkDefense}=require('../../../runtime/movement/character/walk-client.ts');
const own=(context,names)=>{const client=walkClient(context);for(const name of names)context[name]=client[name];return context;};
const reportNames=Object.keys(createWalkReports({},{},{},{})),defenseNames=Object.keys(createWalkDefense({},{},{}));
exports.installWalkReports=context=>own(context,reportNames);
exports.installWalkDefense=context=>own(context,defenseNames);
// Gives a vm context the navigation intent (walk-client.ts `createNavigation`), each port read
// from or written to the context's own walks, as shared.js's install does.
const {createNavigation}=require('../../../runtime/movement/character/walk-client.ts');
exports.installNavigation=context=>{
 const client=walkClient(context),host=context.__walkHost;
 return Object.assign(context,createNavigation(host,client,{
  intent:()=>context.navigationIntent,setIntent:next=>{context.navigationIntent=next;},
  farmTravel:()=>context.farmingTravelToken,
  follows:()=>context.followingLeader||context.forceTraveling,endFollows:()=>{context.followingLeader=false;context.forceTraveling=false;},
  // The anniversary drops its saved return (anniversary.ts `clearReturn`); a context with no
  // anniversary has none to drop.
  clearEventReturn:()=>{context.eventAnniversary?.clearReturn();},
  stop:(...args)=>context.stop(...args)}));
};
