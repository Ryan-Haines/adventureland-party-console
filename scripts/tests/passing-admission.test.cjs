require('./fixtures/coordinator-core.cjs');
// No member of these fixtures is at an event: The tasks owner's `presence` answers none.
require('./helpers/requesters.cjs').publishPresence();
const {productionFunction} = require('./helpers/production-functions.cjs');
const {targetingModule,walksDoor,drivePositions}=require('./helpers/targeting-module.cjs');
const {testScope}=require('./helpers/run-scope.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const {createPassingAdmission}=require('../../runtime/characters/targeting/queue-client.ts');
const {passingControl}=require('../../runtime/coordinator/targeting/queue.ts');
const {collectPassing}=require('../../runtime/characters/targeting/api.ts');
const {installQueueClient}=require('../../runtime/characters/targeting/queue-client.ts');
const {createCombatChannel}=require('../../runtime/status/coordinator/channel.ts');
const {step}=require('../../runtime/movement/coordinator/defense.ts');
const {namedFunction}=require('./helpers/named-function.cjs');
// The walk asks survival's verdict for a fight on the way; the coordinator's answer reads this party.
const {installCoordinatorAnswers}=require('./helpers/survival-answers.cjs');
const functions=['committedHuntEncounter','passingKey','passingEncounterReport','isPassingEncounter','beginPassingAttack',
 'groupedEntityReport','returnDepartureDefense','isAttackingPartyMember','defendPartyHit'].map(n=>productionFunction(n)).join('\n');

function fixture() {
 let now=10000,stops=0;
 const monster={id:'snake1',mtype:'snake',type:'monster',visible:true,hp:100,x:20,y:0,map:'main',in:'main'};
 const members=['W','P'].map(name=>({name,ctype:'warrior',revision:1,status:{seenAt:now,hp:100,map:'main',in:'main',server:'USII',x:0,y:0,
  combatSelection:{runtimeId:name},groupedCombat:{passingEncounters:[],currentAttackersAt:now,currentAttackers:[]}}}));
 // The realm and the party list are shared.js's reads, which the walk client and the targeting owner's doors both take.
 const realm=()=>'USII',party=()=>['W','P'];
 // The party's passive rules, which a row sets (`setPassive`).
 let passive={rules:{},useFieldGenerators:false};
 const contexts=members.map(m=>createMovementContext({Date:{now:()=>now},Math,Object,String,Number,Promise,
  character:{name:m.name,map:'main',in:'main'},parent:{entities:{snake1:monster}},root:{},
  passingEncounters:{},peerPassingEncounters:[],groupedCombat:null,coordinatorClockOffset:0,
  reunionRealm:realm,get_entity:id=>id===monster.id?monster:null,
  navigationIntent:{revision:1},currentPartyList:party,
  eventTargetTypes:[],stop(){stops++;},
  groupWalk:{travel:{id:'C',epoch:1,commandId:m.name==='W'?1:2,navigationRevision:1,phase:'travelling',purpose:'anniversary-return'}}}));
 contexts.forEach(c=>{
  // 04 reads the walk client's group walk on movement's walks door and the passive rules on the hunting owner's rare client.
  targetingModule(c,{},{walks:walksDoor(c,{reunionRealm:realm}),tasks:{partyList:party},
   hunting:{rares:{passive:()=>passive}}});
  drivePositions(c,[{name:'W',map:'main'},{name:'P',map:'main'}]);vm.runInContext(functions,c);require('./helpers/walk-reports.cjs').installWalkDefense(c);});
 // Each client's report interval, the default 1 s.
 const clients=contexts.map(c=>createPassingAdmission({now:()=>now,interval:()=>1000,reserve:(t,a)=>c.beginPassingAttack(t,a,true)}));
 function report(i) {
  members[i].status.seenAt=now;
  members[i].status.groupedCombat={passingEncounters:contexts[i].passingEncounterReport(),passingAcknowledgement:clients[i].report(),currentAttackersAt:now,currentAttackers:[]};
 }
 function deliver(i,control=passingControl(members,['C',1],now)) {
  const encounters=collectPassing(members,[],now);
  contexts[i].peerPassingEncounters=encounters;
  clients[i].apply(control,encounters,now);
 }
 const target=()=>({...monster,server:'USII',at:now});
 function ready() {for(let round=0;round<3;round++){members.forEach((_,i)=>deliver(i));members.forEach((_,i)=>report(i));}}
 ready();
 return {members,contexts,clients,monster,target,report,deliver,ready,stops:()=>stops,advance(ms){now+=ms;},now:()=>now,setPassive(next){passive=next;}};
}

for(const delay of [0,100,900])test(`retaliation after ${delay}ms projectile delay never freezes an acknowledged convoy`,()=>{
 const f=fixture();
 assert.equal(f.clients[0].prepare(f.target()),false,'first attack waits for shared ownership');f.report(0);
 f.deliver(0);f.report(0);
 assert.equal(f.clients[0].prepare(f.target()),false,'sender acknowledgement cannot stand in for priest');
 f.deliver(1);f.report(1);f.deliver(0);
 assert.equal(f.clients[0].prepare(f.target()),true);
 f.advance(delay);f.monster.target='W';
 for(const c of f.contexts)c.defendPartyHit({id:'W',hid:'snake1'});
 assert.equal(f.stops(),0);
 assert.ok(f.contexts.every(c=>c.groupWalk.travel.phase==='travelling'));
 assert.equal(f.contexts[1].isAttackingPartyMember({...f.monster,id:'unrelated'}),true);
});

test('missing acknowledgement skips repeated optional shots without surrendering the travelling handle',()=>{
 const f=fixture();let shots=0;
 for(let tick=0;tick<100;tick++) {
  if(f.clients[0].prepare(f.target()))shots++;
  f.report(0);f.deliver(0);f.advance(50);
  assert.ok(f.contexts.every(c=>c.groupWalk.travel.phase==='travelling'));
 }
 assert.equal(shots,0);assert.equal(f.stops(),0);
});

test('simultaneous senders reserve the same identity without starving each other',()=>{
 const f=fixture();f.clients.forEach(c=>assert.equal(c.prepare(f.target()),false));
 f.members.forEach((_,i)=>f.report(i));f.ready();
 f.clients.forEach(c=>assert.equal(c.prepare(f.target()),true));
});

test('reordered controls cannot restore a grant after runtime, route, realm or membership changes',()=>{
 for(const change of [f=>f.members[1].status.combatSelection.runtimeId='reloaded',f=>f.members[1].revision++,
  f=>f.members[1].status.in='other',f=>f.members[1].status.server='EUI',f=>f.members.pop()]) {
  const f=fixture();f.clients[0].prepare(f.target());f.report(0);f.ready();
  const old=passingControl(f.members,['C',1],f.now());assert.equal(f.clients[0].prepare(f.target()),true);
  f.advance(10);change(f);f.deliver(0);
  assert.equal(f.clients[0].prepare(f.target()),false);
  f.clients[0].apply(old,collectPassing(f.members,[],f.now()),f.now()-10);
  assert.equal(f.clients[0].prepare(f.target()),false);
 }
});

test('stale approval, dead target, and reused identity cannot use an old grant',()=>{
 const f=fixture();f.clients[0].prepare(f.target());f.report(0);f.ready();assert.equal(f.clients[0].prepare(f.target()),true);
 f.advance(1001);assert.equal(f.clients[0].prepare(f.target()),false);
 f.monster.dead=true;f.report(0);assert.equal(f.members[0].status.groupedCombat.passingEncounters.length,0);
 f.monster.dead=false;f.ready();assert.equal(f.clients[0].prepare(f.target(),[]),false);
 const encounter={...f.target(),startedAt:10000};
 f.members[0].status.groupedCombat.deaths=[{...f.target(),at:f.now()}];
 assert.equal(collectPassing(f.members,[encounter],f.now()).length,0);
});

test('three real convoy executors reach the endpoint through successive passing retaliations',async()=>{
 const {runtime,settle}=require('./helpers/native-convoy-runtime.cjs');
 const {createSharedConvoyNavigation}=require('../../runtime/movement/coordinator/walk.ts');
 const {publishSharedRoute,sharedRoute}=require('../../runtime/movement/coordinator/route-store.ts');
 const engine=()=>createSharedConvoyNavigation(step);
 const helpers=createMovementContext({runtime,settle,publishSharedRoute,sharedRoute,engine,copy:x=>JSON.parse(JSON.stringify(x))});
 const fixtures=fs.readFileSync('scripts/tests/fixtures/shared-convoy-scenario.cjs','utf8');
 vm.runInContext(['party','report','publication','client'].map(n=>namedFunction(fixtures,n)).join('\n'),helpers);
 const p=helpers.party(),e=engine(),names=['L','F','P'];
 p.activeConvoy.purpose='anniversary-return';p.activeConvoy.navigationExempt=true;
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 e.step(p,1000);
 const runners=names.map(n=>helpers.client(n,p));
 const starts=await Promise.all(runners.map((r,i)=>r.start(p.commands[names[i]])));
 try {
  for(let tick=0;tick<200&&!runners.every(r=>r.context.groupWalk.travel.routeReady);tick++) {
   runners.forEach((r,i)=>{r.context.groupWalk.signal=e.signal(p,names[i],1000);r.tick();});await settle();
  }
  assert.ok(runners.every(r=>r.context.groupWalk.travel.routeReady));
  // The walk departs on each member's first ready report that acknowledges its command.
  names.forEach(n=>helpers.report(p,n));e.step(p,1000);
  const members=names.map(name=>({name,ctype:'warrior',revision:0,status:{seenAt:5600,hp:100,map:'main',in:'main',server:'USII',
   combatSelection:{runtimeId:name},groupedCombat:{}}}));
  runners.forEach((r,i)=>{
   Object.assign(r.context,{passingEncounters:{},peerPassingEncounters:[],groupedCombat:null,passiveHunting:{rules:{},useFieldGenerators:false},
    reunionRealm:()=> 'USII',currentPartyList:()=>names,eventTargetTypes:[],
    get_entity:id=>r.context.parent.entities[id]});
   r.context.parent.entities={};
   // The targeting owner's module answers the passing report on each executor's context, as in the fixture above.
   targetingModule(r.context,{},{walks:walksDoor(r.context,{reunionRealm:()=>'USII'}),tasks:{partyList:()=>names},
    hunting:{rares:{passive:()=>({rules:{},useFieldGenerators:false})}}});
   drivePositions(r.context,names.map(name=>({name,map:'main'})));
   vm.runInContext(functions,r.context);
   r.context.groupWalk.signal={...e.signal(p,names[i],1600),validUntil:9000};r.tick();r.setNow(5550);
  });
  const admissions=runners.map(r=>createPassingAdmission({now:()=>5600,interval:()=>1000,reserve:(t,a)=>r.context.beginPassingAttack(t,a,true)}));
  let encounters=0;
  for(let tick=0;tick<30;tick++) {
   const monster={id:'snake-'+tick,mtype:'snake',type:'monster',visible:true,hp:100,map:'main',in:'main',server:'USII',x:50,y:0,at:5600};
   runners.forEach(r=>{r.context.parent.entities[monster.id]=monster;});
   for(let round=0;round<5;round++) {
    const control=passingControl(members,['test',7],5600),passing=collectPassing(members,[],5600);
    runners.forEach((r,i)=>{
     r.context.peerPassingEncounters=passing;admissions[i].apply(control,passing,5600);admissions[i].prepare(monster);
     members[i].status.groupedCombat={passingEncounters:r.context.passingEncounterReport(),passingAcknowledgement:admissions[i].report()};
    });
   }
   assert.ok(admissions.every(a=>a.prepare(monster)));monster.target='F';encounters++;
   runners.forEach(r=>{
    r.context.beginPassingAttack(monster);r.context.defendPartyHit({id:'F',hid:monster.id});
    assert.equal(r.context.groupWalk.travel?.defensePaused,undefined);r.tick();
   });
   await settle();
  }
  await Promise.all(starts.map(s=>s.promise));
  assert.equal(encounters,30);assert.deepEqual(runners.map(r=>r.context.character.x),[120,120,120]);
  assert.deepEqual(runners.map(r=>r.searches),[1,0,0]);assert.equal(p.activeConvoy.epoch,7);
 } finally {await Promise.all(runners.map(r=>r.cancel()));}
});

test('fresh heartbeats cannot renew an acknowledgement from a lost response channel',()=>{
 const f=fixture();f.clients[0].prepare(f.target());f.report(0);f.ready();
 assert.equal(f.clients[0].prepare(f.target()),true);
 const oldAck=f.members[1].status.groupedCombat.passingAcknowledgement;
 f.advance(3001);f.members.forEach(m=>m.status.seenAt=f.now());
 assert.equal(f.clients[1].report(),undefined);
 f.members[1].status.groupedCombat.passingAcknowledgement=oldAck;
 assert.equal(passingControl(f.members,['C',1],f.now()).ready,false);
});

test('unused reservations expire even while the un-attacked monster remains visible',()=>{
 const f=fixture();f.clients[0].prepare(f.target());assert.equal(f.contexts[0].passingEncounterReport().length,1);
 f.advance(60001);assert.equal(f.contexts[0].passingEncounterReport().length,0);
});

test('explicit keep-moving reservations get acknowledged without becoming a Hunt primary',()=>{
 const f=fixture(),settings={rules:{snake:{enabled:true,keepMoving:true,priority:100}}};
 const convoy={id:'C',epoch:1,purpose:'monster-hunt',requester:{kind:'group-walk',owner:'monster-hunt',tier:'hunt-mission'},huntTarget:'mole',phase:'travel'};
 f.setPassive(settings);
 const target={...f.target(),keepMoving:true};
 assert.equal(f.clients[0].prepare(target),false);f.report(0);
 for(let round=0;round<4;round++) {
  const control=passingControl(f.members,['C',1],f.now(),convoy,settings);
  for(let i=0;i<2;i++){f.deliver(i,control);f.report(i);}
 }
 const control=passingControl(f.members,['C',1],f.now(),convoy,settings);
 assert.equal(control.hunt.primary,null,'optional attacks never reserve the route or Hunt primary');
 assert.equal(control.admitted.length,1);f.deliver(0,control);assert.equal(f.clients[0].prepare(target),true);
 f.members[0].status.groupedCombat.currentAttackers=[{...f.monster,target:'W'}];
 assert.equal(passingControl(f.members,['C',1],f.now(),convoy,settings).hunt.primary,null);
 f.advance(1001);assert.equal(f.clients[0].prepare(target),false,'still requires fresh authorization');
});

function stopped() {
 const f=fixture(),c=f.contexts[1];f.monster.target='W';c.defendPartyHit({id:'W',hid:'snake1'});
 assert.equal(f.stops(),1);assert.equal(c.groupWalk.travel.defensePaused,true);
 const p={statuses:Object.fromEntries(f.members.map(m=>[m.name,m.status])),commands:{W:{id:1,convoyId:'C',navigationRevision:1},P:{id:2,convoyId:'C',navigationRevision:1}},
  activeConvoy:{id:'C',epoch:1,phase:'travel',purpose:'anniversary-return',navigationExempt:true,participants:['W','P'],leader:'W',completed:[],location:{map:'spookytown',x:677,y:129}}};
 p.statuses.P.convoyNavigation={...c.groupWalk.travel,runtimeId:'P'};installCoordinatorAnswers(()=>p);
 f.contexts[0].beginPassingAttack(f.monster);f.report(0);
 return {f,p};
}
const commandFor=(_,c,phase)=>({id:100,convoyId:c.id,navigationRevision:1,phase});
const lateKinds={
 attacker:(f,p)=>{p.statuses.P.groupedCombat.currentAttackers=[{...f.target(),id:'other',target:'P'}];},
 manual:(f,p)=>{p.navigationIntents={P:{cancelled:true}};},
 replacement:(f,p)=>{p.commands.P={id:20,type:'travel'};},
};
const lateRefused=kind=>({f,p})=>{
 lateKinds[kind](f,p);
 step(p,f.now(),commandFor);
 assert.equal(p.activeConvoy.epoch,1);
 if(kind==='attacker')assert.equal(p.activeConvoy.phase,'defending');
};
const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('a passing classification that arrives after the stop is applied only to the stop it names',stopped,[
['late passing evidence rebuilds the latched owned route without a combat loot hold',({f,p})=>{
 const destination=p.activeConvoy.location;
 assert.equal(step(p,f.now(),commandFor),true);
 assert.equal(p.activeConvoy.phase,'assemble');assert.equal(p.activeConvoy.epoch,2);
 assert.equal(p.activeConvoy.location,destination);assert.equal(p.activeConvoy.loot,undefined);
 assert.equal(p.statuses.P.convoyNavigation.defenseInterruption.phase,'travelling');
}],
['late classification cannot clear another attacker',lateRefused('attacker')],
['late classification cannot clear manual navigation',lateRefused('manual')],
['late classification cannot clear a newer command',lateRefused('replacement')],
['an already acknowledged coordinator defense also releases a corrected passing-only cause',({f,p})=>{
 const target=f.target();
 p.activeConvoy.phase='defending';p.activeConvoy.defenseTargets=[target];
 p.statuses.W.convoyNavigation={id:'C',epoch:1,commandId:1,navigationRevision:1,runtimeId:'W',phase:'defending',
  defenseTargets:[],defenseInterruption:{source:'coordinator'}};
 step(p,f.now(),commandFor);
 assert.equal(p.activeConvoy.epoch,2);assert.equal(p.activeConvoy.loot,undefined);
}],
['a later passing classification cannot erase loot owed to an earlier genuine defensive kill',({f,p})=>{
 const genuine={...f.target(),id:'genuine',target:'P'};
 p.activeConvoy.phase='defending';p.activeConvoy.defenseTargets=[genuine];
 // The snake has not yet been classified by the coordinator.
 p.statuses.W.groupedCombat.passingEncounters=[];
 p.statuses.P.groupedCombat.currentAttackers=[{...f.target(),target:'P'}];
 step(p,f.now(),commandFor);assert.equal(p.activeConvoy.defenseTargets.length,2);
 f.report(0);p.statuses.P.groupedCombat.currentAttackers=[];
 step(p,f.now(),commandFor);
 assert.equal(p.activeConvoy.phase,'defending');assert.ok(p.activeConvoy.loot);
}],
]);

test('combat transport publishes reservations and returns peer acknowledgements without a selected target',async()=>{
 const keys=['parent','character','get_entity','setInterval','clearInterval'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
 const f=fixture();let client,serverResponse;
 const reports=[];
 const root={};
 const shared={
  targeting:{state:{},sharedTargetId:()=>null,passingEncounterReport:()=>f.contexts[0].passingEncounterReport(),isPassingEncounter:t=>f.contexts[0].isPassingEncounter(t),
  beginPassingAttack:(...args)=>f.contexts[0].beginPassingAttack(...args),acceptQueue(){},
  acceptCombatControl:data=>{f.contexts[0].peerPassingEncounters=data.passingEncounters;},
  queueReport:()=>({name:'W',map:'main',in:'main',server:'USII',groupedCombat:{
   passingEncounters:f.contexts[0].passingEncounterReport(),passingAcknowledgement:client?.passingAcknowledgement()}}),
  // The module's acknowledgement read (queue-client.ts queueAcknowledgement), which a reply compares with
  // the last report's: this character's report.
  queueAcknowledgement(){return this.queueReport();},
  queueRequest:report=>report.combatWait?new Promise(()=>{}):new Promise(resolve=>{reports.push(report);serverResponse=resolve;})}};
 root.partyStatus={character:{applyChannel:(data,combat)=>combat(data),handoffTiming:require('../../runtime/status/character/rings.ts').createHandoffTiming([],()=>true)}};root.partyTasks={partyList:()=>['W','P']};root.partyHunting={farm:{grouped:()=>false,mode:()=>'default'}};root.partyMovement={coordinatorNow:()=>Date.now()+0,convoyActive:()=>false,independentApproachClient:()=>null,terrainRecoveryClient:()=>null,queueSightRecovery:()=>null};
 Object.assign(global,{parent:{},character:{name:'W',map:'main',in:'main'},get_entity:()=>null,setInterval:()=>0,clearInterval(){}});
 const read=()=>({serverNow:f.now(),passingControl:passingControl(f.members,['C',1],f.now()),passingEncounters:collectPassing(f.members,[],f.now())});
 const channel=createCombatChannel({read,send:read});
 async function reply() {
  f.members[0].status.groupedCombat=reports.at(-1).groupedCombat;
  serverResponse(channel.snapshot('W'));await new Promise(resolve=>setImmediate(resolve));
 }
 try {
  client=installQueueClient(root,shared,testScope('04','act'));
  client.tick();await reply();assert.ok(client.passingAcknowledgement());
  client.flush();await reply();
  assert.equal(client.preparePassing(f.monster),false);
  client.flush();await reply();
  assert.equal(client.preparePassing(f.monster),false);
  f.deliver(1);f.report(1);
  client.flush();await reply();
  assert.equal(client.preparePassing(f.monster),true);
  assert.ok(reports.some(r=>r.groupedCombat.passingAcknowledgement?.tokens.length));
 } finally {client?.stop();for(const key of keys)if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}
});
