const test=require('node:test'),assert=require('node:assert/strict');
const {engageHunt}=require('../../runtime/coordinator/hunt/engagement.ts');
const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
const {createHuntConvoy}=require('../../runtime/coordinator/hunt/convoy.ts');
const {createConvoyEngagementRoutes}=require('../../runtime/coordinator/http/convoy-engagement.ts');
const {huntLootPending}=require('../../runtime/coordinator/hunt/loot.ts');
const safety=require('../hunt-safety.cjs'),legacy=require('../convoy-navigation.cjs');
const {contains}=require('../../dashboard/lib/farming-zones.ts');

function fixture(){
 let now=2000;const original={map:'main',x:-121,y:1360,boundary:[-180,1300,-60,1420]},point={map:'main',in:'main',x:-48,y:704};
 const state={leader:'A',followers:{B:true},nextCommandId:10,farmingPolicy:'hunt',partyFarmingMode:'default',
  monsterSearchRadiusByCharacter:{A:100},combatLogs:{},characterLocations:{},location:original,eventReturn:null,
  monsterHunterLocation:{map:'main',x:-100,y:-100},monsterChoices:[{id:'poisio',locations:[original]}],
  navigationIntents:{A:{revision:7},B:{revision:8}},statuses:{},
  activeConvoy:{id:'c',epoch:2,phase:'travel',departAt:1000,purpose:'monster-hunt',huntTarget:'poisio',combatHandoffAllowed:true,
   participants:['A','B'],completed:[],location:original,runtimes:{A:'r',B:'b'}},
  commands:{A:{id:3,type:'party-monster-travel',convoyId:'c',epoch:2,navigationRevision:7},B:{id:4,type:'party-monster-travel',convoyId:'c',epoch:2,navigationRevision:8}},
  monsterHunt:{stage:'mission-travel',cycleId:'h',convoyId:'c',currentIndex:0,target:'poisio',participants:['A','B'],
   missions:[{target:'poisio',owners:['A'],destination:original,destinationVersion:1}],owner:'A',selectionLeader:'A'}};
 const target={...point,id:'p1',mtype:'poisio',server:'USII',hp:100};
 for(const n of ['A','B'])state.statuses[n]={...point,server:'USII',seenAt:now,hp:100,convoyProtocol:4,
  monsterHunt:{id:'poisio',count:10,remainingMs:900000},groupedCombat:{currentAttackersAt:now,currentAttackers:[],candidates:[target],sightings:[],deaths:[]}};
 const body={character:'A',convoyId:'c',epoch:2,commandId:3,runtimeId:'r',navigationRevision:7,target};
 const starts=[];let persist=0;
 const ports={now:()=>now,intent:n=>state.navigationIntents[n],fresh:()=>Object.values(state.statuses).every(s=>now-s.seenAt<=3000),
  ownsTravel:()=>false,destination:h=>h.missions[h.currentIndex].destination,monsterDestination:()=>original,contains,
  arrivalProtected:(h,s,d)=>safety.arrivalProtected(h,'A',s,state.navigationIntents.A,d,now),
  partyFighting:h=>safety.partyFighting(h,state.statuses,now),persist:()=>persist++,cancelHuntConvoy(){state.activeConvoy=null;},
  returnToDaisy(h){starts.push({stage:'returning',location:state.monsterHunterLocation});h.stage='returning';delete h.encounter;},
  advance(){throw Error('unexpected advance');}};
 const convoy=createHuntConvoy(state,{now:ports.now,intent:ports.intent,authorize(){},processDaisy(){},
  start(location,label,names,purpose){starts.push({location,stage:'mission-travel'});state.activeConvoy={id:'new',phase:'assemble',purpose,participants:names};return true;}});
 ports.start=convoy.start;
 let travel=createHuntTravel(state,ports);
 const routes=createConvoyEngagementRoutes(state,{now:ports.now,intent:ports.intent,owned:()=>true,
  group:()=>({ready:true,anchor:{map:'main'},blockers:[]}),engage:(b,o)=>engageHunt(state,b,o,legacy,now),
  acceptArrival:(c,b,t)=>safety.acceptArrival(state.monsterHunt,c,b,t),persist:ports.persist});
 function handoff(){let result;routes.engage({body},{status(code){return {json(v){result={code,...v};}}},json(v){result=v;}});return result;}
 function tick(){travel.step(state.monsterHunt);}
 function time(t){now=t;for(const s of Object.values(state.statuses)){s.seenAt=now;s.groupedCombat.currentAttackersAt=now;}}
 function absent(){for(const s of Object.values(state.statuses)){s.groupedCombat.candidates=[];s.groupedCombat.sightings=[];}}
 function death(){absent();state.statuses.A.groupedCombat.deaths=[{...target,at:now}];}
 function loot(){const l=state.monsterHunt.loot;assert.ok(l,'loot barrier installed');state.statuses.A.huntLoot={...l,observedAt:now+1,complete:true};time(now+2);}
 function restart(){state.monsterHunt=JSON.parse(JSON.stringify(state.monsterHunt));travel=createHuntTravel(state,ports);}
 return {state,ports,original,target,body,starts,handoff,tick,time,absent,death,loot,restart,get now(){return now;},get hunt(){return state.monsterHunt;}};
}

test('Poisio (-48,704) is a temporary stop on the way to (-121,1360); death and loot resume the retained spawn',()=>{
 const r=fixture(),response=r.handoff();assert.equal(response.handoff,'temporary');assert.deepEqual(response.destination,r.original);
 assert.equal(r.hunt.arrivalHandoff,undefined);assert.deepEqual(r.hunt.missions[0].destination,r.original);
 assert.equal(r.state.commands.B.location.y,704);assert.equal(r.hunt.stage,'farming');
 r.tick();assert.match(r.hunt.message,/Fighting encountered poisio; continuing/);assert.equal(r.starts.length,0);
 r.time(3000);r.death();r.tick();assert.equal(r.starts.length,0);assert.match(r.hunt.message,/loot/);
 r.loot();r.tick();assert.equal(r.starts.length,1);assert.deepEqual(r.starts[0].location,r.original);
 assert.equal(r.hunt.encounter,undefined);assert.equal(r.hunt.missions[0].owners[0],'A');
 assert.match(r.state.combatLogs.A.at(-1).message,/encountered monster died/);
 assert.equal(r.handoff().code,409);assert.equal(r.state.activeConvoy.id,'new');
});

test('another catalogued Poisio area is adopted with boundaries without doubling back',()=>{
 const r=fixture();r.state.monsterChoices[0].locations.push({...r.target,boundary:[-90,660,0,750]});
 assert.equal(r.handoff().handoff,'spawn');assert.equal(r.hunt.encounter,undefined);
 assert.deepEqual(r.hunt.missions[0].destination.boundary,[-90,660,0,750]);
 r.time(15000);delete r.state.commands.B;r.absent();r.tick();assert.equal(r.starts.length,0);
});

test('continuous Goo passing attacks do not retain the completed encounter or block real convoy departure',()=>{
 const r=fixture();r.handoff();r.death();
 for(const s of Object.values(r.state.statuses)){
  const goo={...r.target,id:'g1',mtype:'goo',target:'A'};s.target=goo;s.combat={lastAttackAt:r.now,inRange:true};
  s.groupedCombat.currentAttackers=[goo];s.groupedCombat.passingEncounters=[{...goo,at:r.now}];
 }
 r.tick();r.loot();r.tick();assert.equal(r.starts.length,1);
});

test('five observed seconds without the target resumes; stale reports pause the timer and a restart adds no time',()=>{
 const r=fixture();r.handoff();r.absent();r.tick();r.time(3000);r.tick();r.time(4000);r.tick();
 assert.equal(r.hunt.encounter.missingMs,2000);
 r.time(14000);r.state.statuses.B.groupedCombat.currentAttackersAt=4000;r.tick();
 assert.equal(r.hunt.encounter.missingMs,2000);r.restart();r.time(20000);r.tick();
 assert.equal(r.hunt.encounter.missingMs,2000);
 for(const t of [21000,22000,23000]){r.time(t);r.tick();}
 assert.match(r.hunt.encounter.resumeReason,/five seconds/);r.loot();r.tick();assert.equal(r.starts.length,1);
});

test('a fresh sighting resets disappearance; unrelated monsters do not count as encounter progress',()=>{
 const r=fixture();r.handoff();r.absent();r.tick();r.time(4000);r.tick();
 r.state.statuses.A.groupedCombat.sightings=[r.target];r.time(5000);r.tick();assert.equal(r.hunt.encounter.missingMs,0);
 r.absent();r.state.statuses.A.groupedCombat.candidates=[{...r.target,id:'g',mtype:'goo'}];
 for(const t of [6000,7000,8000,9000,10000]){r.time(t);r.tick();}
 r.loot();r.tick();assert.equal(r.starts.length,1);
});

for(const block of ['cancel','new-revision','new-command','escape','death-recovery','other-convoy'])test('encounter recovery respects '+block,()=>{
 const r=fixture();r.handoff();r.death();
 if(block==='cancel')r.state.navigationIntents.A.cancelled=true;
 if(block==='new-revision')r.state.navigationIntents.A.revision++;
 if(block==='new-command')r.state.commands.A={id:99,type:'character-travel'};
 if(block==='escape')r.state.escape={stage:'active'};
 if(block==='death-recovery')r.state.combatRecovery={phase:'reviving'};
 if(block==='other-convoy')r.state.activeConvoy={id:'manual',purpose:'manual'};
 r.tick();assert.equal(r.starts.length,0);assert.ok(r.hunt.encounter);assert.equal(r.hunt.loot,undefined);
});

for(const due of ['complete','expiry'])test('quest '+due+' during encounter follows loot then Daisy',()=>{
 const r=fixture();r.handoff();r.state.statuses.A.monsterHunt[due==='complete'?'count':'remainingMs']=0;
 r.tick();assert.equal(r.starts.length,0);r.loot();r.tick();assert.equal(r.starts[0].stage,'returning');
});

test('anniversary and restart retain destination and revalidate the target before resuming',()=>{
 const r=fixture();r.handoff();r.state.statuses.A.activeEvent='anniversary';r.tick();assert.equal(r.hunt.stage,'paused-event');
 r.restart();r.time(20000);r.state.eventReturn={event:'anniversary'};delete r.state.statuses.A.activeEvent;r.tick();assert.equal(r.starts.length,0);
 r.state.eventReturn=null;r.tick();assert.equal(r.hunt.stage,'farming');assert.ok(r.hunt.encounter);
 r.death();r.tick();r.loot();r.tick();assert.deepEqual(r.starts[0].location,r.original);
});

function corrupted(){const r=fixture();r.state.activeConvoy=null;r.state.commands={};r.hunt.stage='farming';r.hunt.convoyId=null;
 r.hunt.missions[0].destination={map:'main',x:-48,y:704};delete r.hunt.missions[0].destinationVersion;r.absent();return r;}
test('legacy point destination is repaired without changing quest progress or cycle',()=>{
 const r=corrupted();r.tick();assert.deepEqual(r.hunt.missions[0].destination,r.original);assert.equal(r.hunt.missions[0].destinationVersion,1);
 assert.equal(r.hunt.cycleId,'h');assert.equal(r.state.statuses.A.monsterHunt.count,10);assert.equal(r.starts.length,1);
});
test('recognized legacy spawn is retained; missing catalog waits and retries',()=>{
 const valid=corrupted();valid.hunt.missions[0].destination=valid.original;Object.values(valid.state.statuses).forEach(s=>Object.assign(s,valid.original));
 valid.tick();assert.equal(valid.hunt.missions[0].destinationVersion,1);assert.equal(valid.starts.length,0);
 const r=corrupted(),catalog=r.state.monsterChoices;r.state.monsterChoices=null;r.tick();assert.match(r.hunt.message,/Waiting for poisio spawn catalog/);
 assert.equal(r.starts.length,0);r.state.monsterChoices=catalog;r.tick();assert.equal(r.starts.length,1);
});
test('legacy repair waits for combat, fresh reports, cancellation and competing movement',()=>{
 for(const mode of ['combat','stale','cancel','command','revision']){
  const r=corrupted();
  if(mode==='combat')r.state.statuses.A.target=r.target;
  if(mode==='stale')r.state.statuses.B.seenAt=-10000;
  if(mode==='cancel')r.state.navigationIntents.A.cancelled=true;
  if(mode==='command')r.state.commands.A={id:99,type:'character-travel'};
  if(mode==='revision')r.hunt.missions[0].destinationRevisions={A:6,B:8};
  r.tick();assert.equal(r.starts.length,0,mode);assert.equal(r.hunt.missions[0].destination.y,704,mode);
 }
});

test('externally claimed target becomes invalid even while sightings remain visible',()=>{
 const r=fixture();r.handoff();
 for(const t of [2000,3000,4000,5000,6000,7000]){
  r.time(t);r.state.statuses.A.groupedCombat.claims=[{...r.target,external:true,at:t}];r.tick();
 }
 assert.match(r.hunt.encounter.resumeReason,/five seconds/);r.loot();r.tick();assert.equal(r.starts.length,1);
});

test('pending encounter loot cannot cancel a newer journey, including through the tick loot preflight',()=>{
 const r=fixture();r.handoff();r.death();r.tick();assert.ok(r.hunt.loot);
 r.state.activeConvoy={id:'newer',purpose:'monster-hunt'};r.state.navigationIntents.A.revision++;
 assert.equal(huntLootPending(r.hunt,r.state,r.ports),false);r.tick();
 assert.equal(r.state.activeConvoy.id,'newer');assert.equal(r.starts.length,0);
});

test('delayed completion of the retired convoy cannot complete or cancel resumed travel',()=>{
 const r=fixture();r.handoff();r.death();r.tick();r.loot();r.tick();
 const {createConvoyAcknowledgementRoutes}=require('../../runtime/coordinator/http/convoy-acknowledgements.ts');
 const routes=createConvoyAcknowledgementRoutes(r.state,{owned:()=>true,valid:b=>legacy.validReport(r.state,b)});
 let status;routes.complete({body:r.body},{status(code){status=code;return this;},json(){}});
 assert.equal(status,409);assert.equal(r.state.activeConvoy.id,'new');
});
