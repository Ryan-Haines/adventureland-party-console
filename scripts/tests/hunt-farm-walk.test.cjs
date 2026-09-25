const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntTick}=require('../../runtime/coordinator/hunt/tick.ts');
const {createHuntQuests}=require('../../runtime/coordinator/hunt/quests.ts');
const policy=require('../../runtime/hunt/policy.ts');
function fixture(){
 const names=['W','P'],now=1000000,daisy={map:'main',x:126,y:-413};
 const hunt={cycleId:'hunt',stage:'paused-event',resumeStage:'farming',participants:names,owner:'W',selectionLeader:'W',policyVersion:3,
  missions:[{target:'ghost',owners:['W'],destination:{map:'halloween',x:-405,y:-1642},destinationVersion:1}],currentIndex:0,target:'ghost',turnIn:{owner:'W',phase:'complete'}};
 const state={leader:'W',followers:{P:true},monsterHunt:hunt,farmingPolicy:'hunt',commands:{},statuses:{},navigationIntents:{},monsterHunterLocation:daisy,monsterSearchRadiusByCharacter:{},combatLogs:{},
  activeConvoy:{id:'farm',purpose:'shared-walk',walkingActivity:'farm-recovery',phase:'failed',failureCode:'assembly-timeout',participants:names,walkingParents:{W:{revision:3},P:{revision:4}}}};
 for(const [i,n]of names.entries()){state.navigationIntents[n]={revision:3+i};state.commands[n]={id:i,type:'party-monster-travel',convoyId:'farm'};state.statuses[n]={seenAt:now,hp:100,map:'halloween',x:218,y:-584,monsterHunt:n==='W'?{id:'ghost',count:22,remainingMs:0}:null};}
 let starts=0;const cancel=()=>{const id=state.activeConvoy?.id;for(const n of names)if(state.commands[n]?.convoyId===id)delete state.commands[n];state.activeConvoy=null;};
 const ports={now:()=>now,rareEncounter:()=>false,ownsTravel:policy.priority,intent:n=>state.navigationIntents[n],fresh:()=>names.every(n=>now-state.statuses[n].seenAt<=3000),
  cancelConvoy:cancel,cancelHuntConvoy(){if(state.activeConvoy?.purpose==='monster-hunt')cancel();},persist(){},recordDeaths:()=>[],participants:()=>names,
  start(h,destination,label,stage){starts++;h.stage=stage;state.activeConvoy={id:'daisy',purpose:'monster-hunt',phase:'assemble',location:destination};},partyFighting:()=>true};
 const quests=createHuntQuests(state,{...ports,cancelConvoy:ports.cancelHuntConvoy});ports.returnToDaisy=quests.returnToDaisy;
 return {state,hunt,ports,tick(){createHuntTick(state,ports).tick();},starts:()=>starts};
}
function orphan(){
 const f=fixture();f.state.activeConvoy=null;f.state.commands={};
 f.state.farmAreaState={pending:{destination:f.hunt.missions[0].destination,revisions:{W:3,P:4},reason:'Travel failed: Regroup retries exhausted: Shared route game geometry mismatch'}};
 f.ports.destination=h=>h.missions[h.currentIndex].destination;return f;
}
test('orphaned failed farming relocation releases expired Hunt to Daisy',()=>{
 const f=orphan();f.tick();assert.equal(f.state.farmAreaState.pending,null);assert.equal(f.hunt.stage,'returning');assert.equal(f.starts(),1);
});
test('stale relocation with its failed walk and expired anniversary checkpoint yields to Daisy',()=>{
 const f=fixture();f.ports.destination=h=>h.missions[h.currentIndex].destination;
 f.state.farmAreaState={pending:{destination:f.hunt.missions[0].destination,revisions:{W:3,P:4},reason:'Travel failed: Shared route game geometry mismatch'}};
 f.state.anniversary={eventCycle:{endsAt:900000,returnDispatchedAt:950000,participants:['W','P'],waypoints:{W:{revision:3},P:{revision:4}}}};
 f.tick();assert.equal(f.state.farmAreaState.pending,null);assert.equal(f.hunt.stage,'returning');assert.equal(f.starts(),1);
 assert.equal(f.state.anniversary.eventCycle.supersededAt,1000000);
});
test('orphaned failed farming relocation restores the actual Hunt mission origin',()=>{
 const f=orphan();f.state.statuses.W.monsterHunt.remainingMs=900000;
 require('../../runtime/coordinator/hunt/farm-walk.ts').recoverHuntFarmWalk(f.hunt,f.state,f.ports);
 assert.equal(f.state.farmAreaState.pending,null);assert.equal(f.hunt.stage,'mission-travel');assert.equal(f.hunt.originArrivedAt,undefined);
});
for(const blocker of ['revision','command','event','destination','stale','cancelled','paused'])test('orphan recovery preserves '+blocker,()=>{
 const f=orphan(),s=f.state,pending=s.farmAreaState.pending;
 if(blocker==='revision')s.navigationIntents.P.revision++;
 if(blocker==='command')s.commands.P={type:'character-travel'};
 if(blocker==='event')s.statuses.P.activeEvent='abtesting';
 if(blocker==='destination')pending.destination={map:'other',x:0,y:0};
 if(blocker==='stale')s.statuses.P.seenAt=0;
 if(blocker==='cancelled')s.navigationIntents.P.cancelled=true;
 if(blocker==='paused')s.farmAreaState.paused=true;
 require('../../runtime/coordinator/hunt/farm-walk.ts').recoverHuntFarmWalk(f.hunt,s,f.ports);
 assert.equal(s.farmAreaState.pending,pending);assert.equal(f.starts(),0);
});
test('failed geometry repair stays held with an accurate Hunt message',()=>{
 const f=fixture();Object.assign(f.state.activeConvoy,{failureCode:'geometry-mismatch',failure:'Geometry recovery failed after one reload'});
 f.tick();assert.equal(f.starts(),0);assert.match(f.hunt.message,/Travel held: Geometry recovery failed/);
});
for(const phase of ['failed','shared-travel'])test('Daisy deadline preempts owned '+phase+' farm walk before event pause, despite optional attacks',()=>{
 const f=fixture();f.state.activeConvoy.phase=phase;f.tick();assert.equal(f.hunt.stage,'returning');assert.equal(f.hunt.turnIn.phase,'returning');
 assert.equal(f.starts(),1);assert.deepEqual(f.state.activeConvoy.location,{map:'main',x:126,y:-413});f.tick();assert.equal(f.starts(),1);
});
test('expired quest stranded behind failed farm walk still goes to Daisy without restarting the hunt',()=>{
 const f=fixture();f.state.statuses.W.monsterHunt=null;f.tick();assert.equal(f.hunt.stage,'returning');assert.equal(f.hunt.cycleId,'hunt');
});
test('healthy farming walk remains owned through the final second, then yields exactly once',()=>{
 const f=fixture();f.state.activeConvoy.phase='shared-travel';f.state.statuses.W.monsterHunt.remainingMs=180001;
 f.tick();assert.equal(f.starts(),0);assert.equal(f.hunt.stage,'paused-event');
 for(const remaining of [180000,179999,40000,1]){f.state.statuses.W.monsterHunt.remainingMs=remaining;f.tick();assert.equal(f.starts(),0);}
 f.state.statuses.W.monsterHunt.remainingMs=0;f.tick();assert.equal(f.starts(),1);assert.equal(f.hunt.stage,'returning');
});
test('restored failed farming walk with fresh reports recovers without changing quest progress',()=>{
 const f=fixture();f.state.activeConvoy=JSON.parse(JSON.stringify(f.state.activeConvoy));
 f.tick();assert.equal(f.starts(),1);assert.equal(f.state.statuses.W.monsterHunt.count,22);
});
test('reported Ghost stall: expired anniversary checkpoint yields failed farm recovery to Daisy',()=>{
 const f=fixture(),cycle={endsAt:900000,participants:['W','P'],waypoints:{W:{revision:3},P:{revision:4}}};
 f.state.anniversary={eventCycle:cycle};f.tick();assert.equal(f.hunt.stage,'returning');assert.equal(cycle.supersededAt,1000000);
});
for(const blocker of ['ongoing','busy','kiss','new-revision','dispatched'])test('anniversary checkpoint handoff preserves '+blocker,()=>{
 const f=fixture(),cycle={endsAt:900000,participants:['W','P'],waypoints:{W:{revision:3},P:{revision:4}}};
 f.state.anniversary={eventCycle:cycle};
 if(blocker==='ongoing')cycle.endsAt=1100000;
 if(blocker==='busy')f.state.statuses.P.anniversaryState={busy:true};
 if(blocker==='kiss')cycle.kissOperations={P:{expiresAt:1100000}};
 if(blocker==='new-revision')cycle.waypoints.P.revision++;
 if(blocker==='dispatched')cycle.returnDispatchedAt=950000;
 const convoy=f.state.activeConvoy;f.tick();assert.equal(f.starts(),0);assert.equal(f.state.activeConvoy,convoy);assert.equal(cycle.supersededAt,undefined);
});
for(const blocker of ['stale','cancelled','new-revision','new-command','other-walk','protected','event-return','anniversary','death','escape'])test('farm walk deadline preserves '+blocker,()=>{
 const f=fixture(),s=f.state;
 if(blocker==='stale')s.statuses.P.seenAt=0;
 if(blocker==='cancelled')s.navigationIntents.P.cancelled=true;
 if(blocker==='new-revision')s.navigationIntents.P.revision++;
 if(blocker==='new-command')s.commands.P={id:99,type:'character-travel'};
 if(blocker==='other-walk')s.activeConvoy.walkingActivity='event';
 if(blocker==='protected')s.activeConvoy.nonPreemptible=true;
 if(blocker==='event-return')s.eventReturn={event:'abtesting'};
 if(blocker==='anniversary')s.anniversary={eventCycle:{}};
 if(blocker==='death')s.combatRecovery={phase:'recovering'};
 if(blocker==='escape')s.escape={stage:'escaping'};
 const convoy=s.activeConvoy;f.tick();assert.equal(f.starts(),0);assert.equal(s.activeConvoy,convoy);
});
