const test=require('node:test'),assert=require('node:assert/strict');
const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
const {events}=require('./fixtures/coordinator-core.cjs');
// A Hunt farming ghost on a farm-recovery walk, through the hunting owner's Hunt service (hunt.ts `createHunt`).
function fixture(){
 const names=['W','P'],now=1000000,daisy={map:'main',x:126,y:-413};
 const hunt={cycleId:'hunt',stage:'farming',participants:names,owner:'W',selectionLeader:'W',policyVersion:3,
  missions:[{target:'ghost',owners:['W'],destination:{map:'halloween',x:-405,y:-1642},destinationVersion:1}],currentIndex:0,target:'ghost',turnIn:{owner:'W',phase:'complete'}};
 const state={nextCommandId:10,leader:'W',followers:{P:true},monsterHunt:hunt,targetMode:'hunt',commands:{},statuses:{},navigationIntents:{},monsterHunterLocation:daisy,monsterSearchRadiusByCharacter:{},combatLogs:{},
  monsterChoices:[{id:'ghost',locations:[hunt.missions[0].destination]}],
  activeConvoy:{id:'farm',purpose:'shared-walk',walkingActivity:'farm-recovery',phase:'failed',failureCode:'assembly-timeout',participants:names,walkingParents:{W:{revision:3},P:{revision:4}}}};
 for(const [i,n]of names.entries()){state.navigationIntents[n]={revision:3+i};state.commands[n]={id:i,type:'party-monster-travel',convoyId:'farm'};
  state.statuses[n]={seenAt:now,server:'II',hp:100,convoyProtocol:4,map:'halloween',x:218,y:-584,monsterHunt:n==='W'?{id:'ghost',count:22,remainingMs:0}:null};}
 require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
 events.party=()=>state;
 let starts=0;
 const service=createHunt(state,{now:()=>now,participants:()=>names,online:()=>true,ownsTravel:require('../../runtime/tasks/api.ts').priority,
  cancelConvoy(){const id=state.activeConvoy?.id;for(const n of names)if(state.commands[n]?.convoyId===id)delete state.commands[n];state.activeConvoy=null;},
  persist(){},selectedDestination:()=>null,
  start(location){starts++;state.activeConvoy={id:'daisy',purpose:'monster-hunt',phase:'assemble',location,participants:names};return true;},
  navigation:{authorize(){},intent:n=>state.navigationIntents[n]}});
 return {state,hunt,tick:()=>service.tick(),starts:()=>starts};
}
for(const phase of ['failed','shared-travel'])test('Daisy deadline preempts owned '+phase+' farm walk before event pause, despite optional attacks',()=>{
 const f=fixture();f.state.activeConvoy.phase=phase;f.tick();assert.equal(f.hunt.stage,'returning');assert.equal(f.hunt.turnIn.phase,'returning');
 assert.equal(f.starts(),1);assert.deepEqual(f.state.activeConvoy.location,{map:'main',x:126,y:-413});f.tick();assert.equal(f.starts(),1);
});
test('expired quest stranded behind failed farm walk still goes to Daisy without restarting the hunt',()=>{
 const f=fixture();f.state.statuses.W.monsterHunt=null;f.tick();assert.equal(f.hunt.stage,'returning');assert.equal(f.hunt.cycleId,'hunt');
});
test('healthy farming walk remains owned through the final second, then yields exactly once',()=>{
 const f=fixture();f.state.activeConvoy.phase='shared-travel';f.state.statuses.W.monsterHunt.remainingMs=180001;
 f.tick();assert.equal(f.starts(),0);assert.equal(f.hunt.stage,'farming');
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
