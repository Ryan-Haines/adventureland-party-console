const {productionFunction} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/passive-hunting-scenario.cjs');

scenarioTable('a passing attack hits in range without stopping the walk or taking normal combat (MOV-044)', fixture, [
 ['real attack controller hits a passing goo during continuous return without normal combat or movement ownership', async ()=>{
 const {createAttackController}=require('../../runtime/characters/turns/attack.ts');
 const {turnsWorld}=require('./fixtures/turns-world.cjs');
 const {c,bee,passive}=fixture();bee.mtype='goo';passive.rules={goo:{enabled:true,keepMoving:true,priority:100}};
 c.character.moving=true;c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 const convoy=c.groupWalk.travel={id:'C',epoch:1,commandId:4,navigationRevision:3,purpose:'monster-hunt',continuousReturn:1,phase:'travelling'};
 c.groupWalk.signal={id:'C',epoch:1,commandId:4,runtimeId:'runtime',phase:'travel',validUntil:Date.now()+10000};
 vm.runInContext(['returnCombatActive','returnAttacker','returnDefenseTarget'].map(n=>productionFunction(n)).join('\n'),c);
 const keys=['parent','character','sharedRoutine','attack','can_attack','is_in_range','get_entity','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));let hits=0,controller,world;
 try {
  Object.assign(global,{parent:{},character:{range:100,frequency:1},setTimeout:()=>0,clearTimeout(){},
   sharedRoutine:{isAllowedTarget:()=>true,consoleDrainAllows:()=>true,groupedAttackAllowed:()=>false,rareAttackAllowed:()=>true,queueEvidence:()=>assert.fail('normal combat evidence'),noteAttack:()=>assert.fail('normal combat hit')},
   attack:async()=>{hits++;},can_attack:()=>true,is_in_range:t=>Math.hypot(t.x-c.character.x,t.y)<=100});
  const state={};
  // The crab range recovery and the attack gates are the targeting owner's.
  const {createCrabRangeRecovery}=require('../../runtime/characters/targeting/gates.ts');
  const {createAnswers}=require('../../runtime/characters/targeting/gates.ts');
  const answers=createAnswers({hooks:{targeting:{refuses:()=>undefined},calls:{band:()=>'send'}},currentTarget:()=>null,passingTarget:()=>c.passingTarget(),
   reflect:()=>({magic:[],physical:[]}),world:()=>null,pullSafe:()=>true,module:require('./helpers/targeting-module.cjs').answerModule(()=>global.sharedRoutine)});
  controller=createAttackController({recovery:createCrabRangeRecovery(),target:()=>c.passingTarget(),selected:()=>c.passingTarget()?.id,active:()=>true,
   passing:t=>t===c.passingTarget(),preparePassing:t=>{c.beginPassingAttack(t);return true;},state:()=>state,report:assert.fail,dropped:()=>undefined});
  // The pass's one target answer: the passing target, as targeting answers it.
  const answer=()=>c.passingTarget()?{target:c.passingTarget(),passing:true,support:false}:null;
  // The attack family's edge in the turns executor, which sends the source's request.
  world=turnsWorld({actor:global.character,own:['attack'],asks:()=>[answer()&&controller.request(answer())].filter(Boolean),
   allows:(t,skill)=>skill==='attack'&&t?answers.allows(t,skill):undefined,selected:()=>c.passingTarget()?.id??null});
  world.turns.pass('edge');await Promise.resolve();await Promise.resolve();assert.equal(hits,1);
  bee.target='W';c.character.x=150;controller.reset();world.turns.reset();world.turns.pass('edge');assert.equal(hits,1,'walking beyond range ends attacks');
  assert.equal(c.returnDefenseTarget(),null);assert.equal(c.groupWalk.travel,convoy);assert.equal(convoy.phase,'travelling');
 } finally {world?.restore();for(const key of keys)if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}
 }],
]);

scenarioTable('passive hunting rules decide which monster may stop travel (MOV-105)', fixture, [
 ['passing chooses priority only in range, without any movement dependency, including stationary attacks', ({c,bee,passive,assignment})=>{
 assert.equal(c.passingTarget().id,bee.id);
 c.parent.entities.phoenix={...bee,id:'phoenix1',mtype:'phoenix',x:30};passive.rules.phoenix={enabled:true,keepMoving:true,priority:101};
 assert.equal(c.passingTarget().id,'phoenix1');c.parent.entities.phoenix.x=200;assert.equal(c.passingTarget().id,bee.id);
 bee.claimed=true;assert.equal(c.passingTarget(),null);bee.claimed=false;bee.x=101;assert.equal(c.passingTarget(),null);
 bee.x=20;c.escapeOwns=()=>true;assert.equal(c.passingTarget(),null);c.escapeOwns=()=>false;assignment.combatRecoveryHolds=()=>true;assert.equal(c.passingTarget(),null);
 }],
 ['passing retaliation cannot cancel a return convoy; unrelated attackers still defend', async ({c,bee})=>{
 c.beginPassingAttack(bee);bee.target='W';
 let stops=0,evidence=0;c.stop=async()=>{stops++;};c.releaseConvoyCruise=()=>{};c.eventTargetTypes=[];
 // The queue client is the module's (install.ts state `queueClient`), which records the defense evidence.
 c.queueClient={evidence(){evidence++;}};
 c.groupWalk.travel={id:'return',epoch:1,phase:'travelling',purpose:'monster-hunt',nonPreemptible:true};
 vm.runInContext(['returnDepartureDefense','defendPartyHit'].map(n=>productionFunction(n)).join('\n'),c);require('./helpers/walk-reports.cjs').installWalkDefense(c);
 const convoy=c.groupWalk.travel;c.defendPartyHit({id:'W',hid:bee.id});
 assert.equal(c.groupWalk.travel,convoy);assert.equal(convoy.cancelled,undefined);assert.equal(stops,0);assert.equal(evidence,0);
 c.parent.entities.other={...bee,id:'other'};c.defendPartyHit({id:'W',hid:'other'});
 assert.equal(c.groupWalk.travel,convoy);assert.equal(convoy.defensePaused,true);assert.equal(convoy.phase,'defending');assert.equal(stops,1);assert.equal(evidence,1);
 }],
]);

const settings=require('../../runtime/hunting/saved-fields.ts'),rules=require('../../runtime/hunting/rules.ts');
const {reconcileQueue}=require('../../runtime/coordinator/targeting/queue.ts');
const {classifyTravelDefense}=require('../../runtime/movement/coordinator/defense.ts');
const {collectPassing}=require('../../runtime/characters/targeting/api.ts');
// One attacker 'A' on member W, reported as a current attacker, a threat, a candidate and a passing encounter.
function reports(){
 const target={id:'A',mtype:'bee',map:'main',in:'main',server:'USII',x:20,y:0,hp:100,target:'W'};
 const status={seenAt:1000,hp:100,map:'main',in:'main',server:'USII',x:0,y:0,groupedCombat:{currentAttackersAt:1000,currentAttackers:[target],passingEncounters:[{...target,at:1000}],candidates:[target],threats:[target],evidence:[{...target,at:1000,action:'a',state:'engaged'}]}};
 return {target,status,members:[{name:'W',ctype:'warrior',revision:0,status}]};
}
// A walk the leader's live travel signal owns, as the passing column reads it.
function ownedRoute(c,walk,signalPhase='travel'){
 c.convoyRuntimeId='runtime';c.navigationIntent.revision=3;
 c.groupWalk.travel={id:'C',epoch:2,commandId:4,navigationRevision:3,phase:'travelling',...walk};
 c.groupWalk.signal={id:c.groupWalk.travel.id,epoch:2,commandId:4,runtimeId:'runtime',phase:signalPhase,validUntil:Date.now()+10000};
}

scenarioTable('a passing attack on a return, event or assembly walk follows the owned route (MOV-044)', fixture, [
 ['Hunt return attacks nearby aggressors while walking without requiring a passive hunting rule', ({c,bee,passive})=>{
 // A continuous return's defence is the return combat's own target, not a passing target.
 vm.runInContext(['returnCombatActive','returnAttacker','returnDefenseTarget'].map(n=>productionFunction(n)).join(';'),c);
 passive.rules={};bee.target='W';
 ownedRoute(c,{id:'return',purpose:'monster-hunt',nonPreemptible:true,continuousReturn:1,returnWalking:true});
 assert.equal(c.returnCombatActive(),true);assert.equal(c.passingTarget(),null);assert.equal(c.returnDefenseTarget(),bee);
 bee.target='outsider';assert.equal(c.returnDefenseTarget(),null);bee.target='W';
 c.navigationIntent.cancelled=true;assert.equal(c.returnCombatActive(),false);assert.equal(c.passingTarget(),null);
 }],
 ['Hunt return passing attacks wait for an owned travelling route and yield to every transition', ({c,bee,focus,movement})=>{
 focus.lootPending=true;
 assert.equal(c.passingTarget(),null);
 ownedRoute(c,{id:'return',purpose:'monster-hunt',nonPreemptible:true});
 assert.equal(c.passingTarget(),bee);
 for(const phase of ['assembling','assembled','preparing-route','route-ready','waiting-for-departure','held','failed','arrived']) {
  c.groupWalk.travel.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.groupWalk.travel.phase='travelling';movement.transition=()=> 'transport';assert.equal(c.passingTarget(),null);
 movement.transition=()=>null;c.groupWalk.signal.epoch=1;assert.equal(c.passingTarget(),null);
 c.groupWalk.signal.epoch=2;c.navigationIntent.revision=4;assert.equal(c.passingTarget(),null);
 c.navigationIntent.revision=3;c.groupWalk.signal.validUntil=0;assert.equal(c.passingTarget(),null);
 c.groupWalk.travel=null;assert.equal(c.passingTarget(),null,'Daisy claims have no travelling route');
 }],
 ['assembly walking and independent event walking allow passing attacks without releasing movement', ({c,bee})=>{
 c.character.moving=true;c.eventTraveling=true;c.joinedEvent='anniversary';
 assert.equal(c.passingTarget(),bee);
 ownedRoute(c,{routeProtocol:4,phase:'assembling'},'assemble');
 assert.equal(c.passingTarget(),bee);
 c.character.moving=false;assert.equal(c.passingTarget(),null,'stationary assembly is unchanged');
 c.character.moving=true;c.groupWalk.signal.commandId++;assert.equal(c.passingTarget(),null);
 }],
 ['ordinary protocol 4 passing attacks require the current travelling signal', ({c,bee})=>{
 ownedRoute(c,{epoch:1,commandId:8,routeProtocol:4,purpose:'anniversary-return'});
 c.groupWalk.signal.epoch=1;c.groupWalk.signal.commandId=8;
 assert.equal(c.passingTarget(),bee);
 for(const phase of ['assemble','preparing','scheduled','defending','arrived']) {
  c.groupWalk.travel.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.groupWalk.travel.phase='travelling';c.groupWalk.signal.epoch=0;assert.equal(c.passingTarget(),null);
 c.groupWalk.signal.epoch=1;c.groupWalk.signal.validUntil=0;assert.equal(c.passingTarget(),null);
 }],
 ['passing attacks yield to Town from reservation through settled transition', ({c,bee,movement})=>{
 assert.equal(c.passingTarget(),bee);
 c.character.c={town:{}};assert.equal(c.passingTarget(),null);
 c.character.c={};movement.transition=()=> 'town';assert.equal(c.passingTarget(),null);
 movement.transition=()=>null;assert.equal(c.passingTarget(),bee);
 }],
 ['Phoenix patrol permits in-range passing attacks but encounters and recovery still take precedence', ({c,bee,passive,focus,assignment})=>{
 focus.rare.control={kind:'patrol',revision:1};focus.rare.active=true;
 for(const mtype of ['bee','armadillo']) {
  bee.mtype=mtype;passive.rules[mtype]={enabled:true,keepMoving:true,priority:100};
  assert.equal(c.passingTarget(),bee);
  bee.x=101;assert.equal(c.passingTarget(),null);bee.x=20;
 }
 focus.rare.control={kind:'encounter',revision:1};assert.equal(c.passingTarget(),null);
 focus.rare.control={kind:'patrol',revision:1};assignment.combatRecoveryHolds=()=>true;assert.equal(c.passingTarget(),null);
 assignment.combatRecoveryHolds=()=>false;c.escapeOwns=()=>true;assert.equal(c.passingTarget(),null);
 c.escapeOwns=()=>false;c.unfinishedFight=()=>true;assert.equal(c.passingTarget(),null);
 }],
 ['walking retains an existing passing reservation before a nearer equal-priority newcomer', ({c,bee,passive})=>{
 c.character.moving=true;bee.x=80;
 const newcomer=c.parent.entities.newcomer={...bee,id:'nearby',x:20};
 c.beginPassingAttack(bee,{scope:'route',token:'reserved-first'},true);
 assert.equal(c.walkingPassiveTarget(),bee,'finish the existing admission exchange while still in range');
 newcomer.mtype='phoenix';passive.rules.phoenix={enabled:true,keepMoving:true,priority:101};
 assert.equal(c.walkingPassiveTarget(),newcomer,'higher configured priority remains authoritative');
 newcomer.mtype='bee';bee.claimed=true;assert.equal(c.walkingPassiveTarget(),newcomer);
 bee.claimed=false;bee.x=101;assert.equal(c.walkingPassiveTarget(),newcomer,'a reservation never permits chasing');
 }],
]);

scenarioTable('a passing encounter is movement-neutral and owned by its identity (MOV-044)', fixture, [
 ['an unreserved monster attacking first stays a genuine defensive target', ({c,bee})=>{
 bee.target='W';
 assert.equal(c.passingTarget(),null);assert.equal(c.isAttackingPartyMember(bee),true);
 }],
 ['retaliation stays movement-neutral for the attacked identity, not other monsters of that type', ({c,bee})=>{
 c.beginPassingAttack(bee);bee.target='W';
 assert.equal(c.isPassingEncounter(bee),true);assert.equal(c.isAttackingPartyMember(bee),false);
 assert.equal(c.isAttackingPartyMember({...bee,id:'unrelated'}),true);
 const report=c.passingEncounterReport();assert.equal(report.length,1);
 c.character.in='another';assert.equal(c.isPassingEncounter({...bee,in:'another'}),false);
 c.character.map='cave';c.character.in='cave';assert.equal(c.passingEncounterReport().length,0);
 }],
 ['verified Hunt farming releases local and peer passing ownership without changing outbound travel', ({c,bee,focus})=>{
 c.beginPassingAttack(bee);
 c.peerPassingEncounters=[...c.passingEncounterReport()];
 c.groupedCombat={passingEncounters:[...c.peerPassingEncounters]};
 assert.equal(c.isPassingEncounter(bee),true);
 focus.huntTarget='bee';c.groupWalk.travel={id:'C',epoch:1,purpose:'monster-hunt',phase:'travelling'};
 assert.equal(c.isPassingEncounter(bee),true);
 assert.equal(c.passingEncounterReport().length,1);
 c.groupWalk.travel=null;
 assert.equal(c.isPassingEncounter(bee),false);
 assert.equal(c.passingEncounterReport().length,0);
 assert.equal(c.passingTarget(),null,'Hunt farming must use normal combat even with keep-moving enabled');
 const unrelated={...bee,id:'other',mtype:'goo'};c.beginPassingAttack(unrelated);
 assert.equal(c.isPassingEncounter(unrelated),true);
 }],
 ['field-generator preference governs passing Fairy use without moving', async ({c,bee,passive})=>{
 bee.mtype='tinyp';passive.rules.tinyp={enabled:true,keepMoving:true,priority:101};c.character.items=[{name:'fieldgen0'}];let equips=0;c.equip=()=>{equips++;return Promise.resolve();};
 // The call budget's band answers send, as it does with room in the window.
 const sent=c.__partyTestHooks().publish({name:'core:calls',folder:'core',author:'test',summary:'Sends every call.',hooks:{'calls.band':()=>'send','calls.window':()=>0,'calls.margin':()=>0}});assert.equal(sent.ok,true);
 c.beginPassingAttack(bee);await new Promise(r=>setImmediate(r));assert.equal(equips,0);assert.equal(c.rareAttackAllowed(bee,'attack'),true);
 passive.useFieldGenerators=true;c.beginPassingAttack(bee);c.beginPassingAttack(bee);await new Promise(r=>setImmediate(r));assert.equal(equips,1);
 }],
]);

scenarioTable('an outbound Hunt walk attacks and stops by its own rules (MOV-044, MOV-105)', fixture, [
 ['outbound Hunt attacks its in-range target without passive settings and never during route preparation', ({c,bee,passive,hunt,movement})=>{
 passive.rules={};
 ownedRoute(c,{id:'hunt',purpose:'monster-hunt',huntTarget:'bee'});
 const control={id:'hunt',epoch:2,primary:null,defending:false};
 hunt.outbound=()=>true;hunt.control=()=>control;c.root.__partyHuntTravelAt=Date.now();
 c.unfinishedFight=()=>true;c.groupedCombat={target:bee};
 assert.equal(c.passingTarget(),bee);
 bee.x=200;assert.equal(c.passingTarget(),null);bee.x=20;
 bee.mtype='goo';assert.equal(c.passingTarget(),null);bee.mtype='bee';
 bee.claimed=true;assert.equal(c.passingTarget(),null);bee.claimed=false;
 for(const phase of ['assembling','route-ready','waiting-for-departure','arrived','failed']){
  c.groupWalk.travel.phase=phase;assert.equal(c.passingTarget(),null,phase);
 }
 c.groupWalk.travel.phase='travelling';movement.transition=()=> 'transport';assert.equal(c.passingTarget(),null);
 movement.transition=()=>null;c.groupWalk.signal.epoch++;assert.equal(c.passingTarget(),null);
 }],
 ['outbound Phoenix stop setting excludes passing attacks and reports eligible neutral sightings', ({c,bee,passive,hunt})=>{
 bee.mtype='phoenix';
 passive.rules={phoenix:{enabled:true,keepMoving:false,priority:100,maxLevel:-1}};
 ownedRoute(c,{id:'hunt',purpose:'monster-hunt',requester:{kind:'group-walk',owner:'monster-hunt',tier:'hunt-mission'},huntTarget:'phoenix'});
 const control={id:'hunt',epoch:2,primary:null};
 hunt.outbound=()=>true;hunt.control=()=>control;c.root.__partyHuntTravelAt=Date.now();
 assert.equal(c.passingTarget(),null);assert.equal(c.travelStopCandidates()[0].id,bee.id);
 c.beginPassingAttack(bee);assert.equal(c.isPassingEncounter(bee),false);
 bee.target='outsider';assert.equal(c.travelStopCandidates().length,0);
 }],
]);

scenarioTable('passive rule settings keep saved selections and moving defaults (MOV-105)', ()=>null, [
 ['legacy selections migrate; independent edits preserve selections and keep moving defaults off', ()=>{
 let s=rules.migratePassiveSettings(null,{tinyp:true,phoenix:false});
 assert.deepEqual(s.rules.tinyp,{enabled:true,keepMoving:false,priority:101,maxLevel:-1});assert.equal(s.useFieldGenerators,true);
 s=settings.applyPassivePatch(s,{rules:{bee:{enabled:true}}});assert.deepEqual(s.rules.bee,{enabled:true,keepMoving:false,priority:100,maxLevel:-1});
 s=settings.applyPassivePatch(s,{rules:{bee:{keepMoving:true,priority:99}},useFieldGenerators:false});
 assert.equal(s.rules.tinyp.enabled,true);assert.equal(s.rules.bee.enabled,true);assert.equal(s.useFieldGenerators,false);
 assert.equal(rules.committedPassiveRules(s).bee,false);assert.equal(rules.committedPassiveRules(s).tinyp,true);
 assert.deepEqual(rules.migratePassiveSettings(s,{phoenix:true}),s);
 for(const bad of [{rules:{bee:{priority:-1}}},{rules:{bee:{priority:1001}}},{rules:{bee:{priority:1.1}}},{rules:{bee:{enabled:'yes'}}},{rules:{fieldgen0:{enabled:true}}},{rules:{bee:{unknown:true}}}])assert.equal(settings.validPassivePatch(bad),false);
 }],
]);

scenarioTable('the queue and the travel defense never take passing ownership (MOV-044)', ()=>null, [
 ['farming Hunt queue accepts a target with cached and freshly reported travel passing marks', ()=>{
 const {target,members}=reports();
 const travelling=reconcileQueue(null,members,'W',1000,'k');
 assert.equal(travelling.target,null);
 const farming=reconcileQueue(travelling,members,'W',1000,'k',0,false,'bee');
 assert.equal(farming.passingEncounters.length,0);
 assert.equal(farming.target.id,target.id);
 }],
 ['queue and travel defense reject passing ownership from nominations, hits and retaliation', ()=>{
 const {target,status,members}=reports();const q=reconcileQueue(null,members,'W',1000,'k');assert.equal(q.target,null);assert.equal(q.fights.length,0);assert.equal(q.passingEncounters.length,1);
 const party={statuses:{W:status},groupedCombat:q};assert.equal(classifyTravelDefense(party,['W'],1000).state,'clear');
 status.groupedCombat.currentAttackers.push({...target,id:'B'});status.groupedCombat.threats.push({...target,id:'B'});
 assert.equal(classifyTravelDefense(party,['W'],1000).state,'defending');assert.equal(reconcileQueue(null,members,'W',1000,'k').target.id,'B');
 status.groupedCombat.passingEncounters[0].in='other';assert.equal(collectPassing(members,[],1000).length,0);
 status.groupedCombat.passingEncounters[0].in='main';assert.equal(collectPassing(members,[],100000).length,0);
 }],
 ['return and Hunt defense cannot promote explicit keep-moving retaliation into combat ownership', ()=>{
 // The coordinator's targeting answers, which the travel defense asks for a Hunt walk's passing column.
 require('./fixtures/coordinator-core.cjs');
 for(const purpose of ['anniversary-return','monster-hunt']) {
  const {target,status,members}=reports();status.groupedCombat.returnDefense=true;
  status.groupedCombat.passingEncounters[0].keepMoving=true;
  const activeConvoy={id:'C',epoch:1,purpose,phase:'travel',navigationExempt:purpose==='anniversary-return',continuousReturn:purpose==='monster-hunt'?1:undefined};
  const party={activeConvoy,statuses:{W:status},passiveHunting:{rules:{bee:{enabled:true,keepMoving:true}}}};
  assert.equal(classifyTravelDefense(party,['W'],1000).state,'clear');
  const q=reconcileQueue(null,members,'W',1000,'k');assert.equal(q.target,null);assert.equal(q.fights.length,0);
  status.groupedCombat.currentAttackers.push({...target,id:'unrelated'});
  assert.equal(classifyTravelDefense(party,['W'],1000).state,'defending');
 }
 }],
]);
