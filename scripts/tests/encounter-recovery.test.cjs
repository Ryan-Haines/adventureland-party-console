const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {handoffAnniversaryToHunt}=require('../../runtime/coordinator/anniversary/hunt-handoff.ts');
const {refreshRareApproach}=require('../../runtime/coordinator/navigation/rare-progress.ts');
const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
const {updateHuntTravel}=require('../../runtime/combat/hunt-travel.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function catchup(){
 let moves=0,stops=0,time=10000;
 const target={id:'phoenix',mtype:'phoenix',map:'main',in:'main',server:'USII',x:100,y:0};
 const control={id:'C',epoch:1,defending:true,primary:target};
 const c=vm.createContext({character:{map:'mtunnel',in:'mtunnel'},root:{},smart:{},Date:{now:()=>time},
  convoyTraveling:{id:'C',epoch:1,commandId:2,navigationRevision:3,phase:'defending',defensePaused:true},
  navigationIntent:{revision:3},eventTraveling:false,joinedEvent:null,escapeOwns:()=>false,groupedFresh:()=>true,
  huntTravelControl:()=>control,reunionRealm:()=> 'USII',passingKey:t=>JSON.stringify([t.server,t.map,t.in,t.id]),
  smart_move(destination){moves++;c.smart.on_done=()=>{};return new Promise(()=>{});},stop(){stops++;return Promise.resolve();}});
 vm.runInContext(['cancelEncounterCatchup','encounterCatchup'].map(n=>namedFunction(source,n)).join('\n'),c);
 return {c,control,target,moves:()=>moves,stops:()=>stops,advance:n=>time+=n};
}
test('split-map Phoenix keeps the same owner while the trailing member crosses maps',()=>{
 const r=catchup();assert.equal(r.c.encounterCatchup(),true);assert.equal(r.moves(),1);
 r.c.encounterCatchup();assert.equal(r.moves(),1);
 r.c.character.map=r.c.character.in='main';assert.equal(r.c.encounterCatchup(),false);assert.equal(r.stops(),1);
 assert.equal(r.c.convoyTraveling.id,'C');
});
for(const reason of ['death','hold','manual','runtime','instance','failure'])test('catch-up handles '+reason+' without an obsolete route restart',()=>{
 const r=catchup();r.c.encounterCatchup();
 if(reason==='death')r.control.primary=null;
 if(reason==='hold')r.c.convoyTraveling.holdRequested=true;
 if(reason==='manual')r.c.navigationIntent.revision++;
 if(reason==='runtime')r.c.groupedFresh=()=>false;
 if(reason==='instance')r.target.in='other-instance';
 if(reason==='failure')r.advance(30001);
 r.c.encounterCatchup();
 assert.equal(r.moves(),1);
 if(reason==='instance'||reason==='failure')assert.ok(r.c.convoyTraveling.encounterCatchup.failed);
 else assert.equal(r.c.convoyTraveling.encounterCatchup,undefined);
});
function handoff(){
 const cycle={id:'anniversary',returnDispatchedAt:1000,participants:['W'],waypoints:{W:{revision:3}},returnRoutes:{W:{revision:3,convoyId:'C'}}};
 const state={farmingPolicy:'hunt',monsterHunt:{stage:'paused-event',resumeStage:'checking-quests',target:null,message:'old'},
  activeConvoy:{id:'C',phase:'assemble'},commands:{W:{convoyId:'C'}},deferredEventReturns:{},statuses:{W:{seenAt:10000,hp:100,groupedCombat:{currentAttackersAt:10000,currentAttackers:[]}}}};
 const ports={now:()=>10000,persist(){},navigation:{intent:()=>({revision:3}),finish(c){c.returnCompletedAt=10000;state.activeConvoy=null;}}};
 return {cycle,state,ports};
}
test('completed osnake with a retained anniversary return hands back to quest policy',()=>{
 const r=handoff();assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),true);
 assert.equal(r.state.monsterHunt.stage,'checking-quests');assert.equal(r.state.activeConvoy,null);
 assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),false);
});
for(const reason of ['manual','new-command','loot','attacker','stale','hold','defending','visit'])test('anniversary Hunt handoff preserves '+reason+' ownership',()=>{
 const r=handoff(),s=r.state.statuses.W;
 if(reason==='manual')r.ports.navigation.intent=()=>({revision:4});
 if(reason==='new-command')r.state.commands.W={id:42};
 if(reason==='loot')s.groupedCombat.lootPending=true;
 if(reason==='attacker')s.groupedCombat.currentAttackers=[{id:'hawk'}];
 if(reason==='stale')s.seenAt=1;
 if(reason==='hold')r.state.activeConvoy.communicationHold={};
 if(reason==='defending')r.state.activeConvoy.phase='defending';
 if(reason==='visit')s.anniversaryVisit={};
 assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),false);
});
test('Fairy wandering does not count as party approach progress',()=>{
 const e={target:{id:'fairy',map:'main',in:'main'},progress:1000};
 const s={server:'USII',x:0,y:0,seenAt:1000,groupedCombat:{approach:{target:JSON.stringify(['USII','main','main','fairy']),at:1000,active:true,deficit:100}}};
 refreshRareApproach(e,[s],1000);s.groupedCombat.approach.deficit=10;s.seenAt=s.groupedCombat.approach.at=2000;
 refreshRareApproach(e,[s],2000);assert.equal(e.progress,1000);
 s.x=20;refreshRareApproach(e,[s],2000);assert.equal(e.progress,2000);
});
test('verified mission arrival is reconciled before optional rare movement',()=>{
 const h={stage:'mission-travel',convoyId:'C',target:'osnake',participants:['W']},s={activeConvoy:{id:'C',purpose:'monster-hunt'},statuses:{W:{seenAt:10000,hp:100,map:'main',in:'main',x:0,y:0}}};
 const ports={now:()=>10000,destination:()=>({map:'main',x:0,y:0}),intent:()=>({revision:1}),persist(){}};
 const travel=createHuntTravel(s,ports);travel.reconcileArrival(h);
 assert.equal(h.stage,'farming');assert.equal(h.originArrivedAt,10000);
 h.stage='mission-travel';s.statuses.W.x=51;travel.reconcileArrival(h);assert.equal(h.stage,'mission-travel');
});
test('restored anniversary Fairy stop retires optional commitment and does not reacquire it',()=>{
 const t={id:'225',mtype:'tinyp',map:'main',in:'main',server:'USII',x:0,y:0,hp:5600};
 const c={id:'C',phase:'defending',purpose:'anniversary-return',huntTravel:{primary:t,committed:[t],searches:{},reason:'passive-setting'}};
 const members=[{name:'W',status:{seenAt:10000,hp:100,map:'main',in:'main',server:'USII',groupedCombat:{currentAttackersAt:10000,currentAttackers:[],travelCandidates:[t],sightings:[t]}}}];
 updateHuntTravel(c,members,10000,undefined,{rules:{tinyp:{enabled:true,keepMoving:false,priority:101}}});
 assert.equal(c.huntTravel.committed.length,0);assert.equal(c.huntTravel.reason,undefined);
 updateHuntTravel(c,members,10000,undefined,{rules:{tinyp:{enabled:true,keepMoving:false,priority:101}}});assert.equal(c.huntTravel.committed.length,0);
});

test('managed catch-up actually executes a portal transition before joining Phoenix combat',async()=>{
 const {runtime,settle}=require('./helpers/native-convoy-runtime.cjs');
 const r=runtime({plan:async body=>({id:body.id,version:body.version,fingerprint:body.fingerprint,ms:1,plot:[{map:'main',x:0,y:0,transport:true,s:0},{map:'main',x:100,y:0}]})}),c=r.context;
 c.G.maps.mtunnel={spawns:[[0,0]],doors:[[0,0,0,0,'main',0,0]],npcs:[]};
 c.character.map=c.character.in='mtunnel';
 c.convoyTraveling={id:'C',epoch:1,commandId:2,navigationRevision:0,phase:'defending',defensePaused:true};
 c.smart=c.movement.state;c.smart_move=c.movement.move;c.stop=c.movement.stop;
 c.huntTravelControl=()=>({defending:true,primary:{id:'phoenix',mtype:'phoenix',map:'main',in:'main',server:'USII',x:100,y:0}});
 c.joinedEvent=null;c.eventTraveling=false;c.escapeOwns=()=>false;c.groupedFresh=()=>true;c.reunionRealm=()=> 'USII';c.passingKey=t=>t.id;
 vm.runInContext(['cancelEncounterCatchup','encounterCatchup'].map(n=>namedFunction(source,n)).join('\n'),c);
 assert.equal(c.encounterCatchup(),true);
 for(let i=0;i<50 && c.character.map!=='main';i++){c.movement.tick();await settle();}
 assert.equal(c.character.map,'main');c.character.in='main';
 assert.equal(c.encounterCatchup(),false);assert.equal(c.convoyTraveling.id,'C');
 assert.ok(r.calls.some(call=>call[0]==='transport'));
});
