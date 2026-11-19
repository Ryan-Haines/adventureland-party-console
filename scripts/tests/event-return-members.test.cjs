const test=require('node:test'),assert=require('node:assert/strict');
const {createEventReturns}=require('../../runtime/events/coordinator/returns.ts');

// Observed in the reload rows: the priest stopped following mid-return, farmed in its own group, and
// the party's return sat in `evacuating` with the priest pending until the next rows timed out.
test('a member a Follow change moved into another group leaves the return, which then finishes for the rest',()=>{
 const recovery={phase:'evacuating',cycleId:'event-return-1-1',event:'trickortreat',occurrence:'doors',participants:['W','P'],pending:['P'],
  startedAt:1,checkpoint:{map:'main',x:1520,y:-70},waypoints:{W:{revision:2,location:{map:'main',x:1520,y:-70}},P:{revision:3,location:{map:'main',x:1260,y:-70}}},
  deferred:[],exited:['W']};
 const state={current:recovery,last:null,deferred:{}};
 const commands={P:{id:9,type:'event-return-town',cycleId:'event-return-1-1'}};
 const fresh={seenAt:1000,map:'main',x:1520,y:-70,eventRecovery:{phase:'idle'}};
 const dispatched=[],cleared=[];
 const ports={now:()=>1000,nextCommandId:()=>10,activeNames:()=>['W'],merchant:()=>'M',enabled:()=>true,moved:name=>name==='P',
  statuses:()=>({W:fresh,P:{...fresh,x:1260}}),commands:()=>commands,clearCommand:name=>{cleared.push(name);delete commands[name];},
  town:()=>assert.fail('no Town for a member outside the group'),checkpoint:()=>recovery.checkpoint,capture:names=>Object.fromEntries(names.map(n=>[n,recovery.waypoints[n]])),
  clearABStrategy(){},convoy:()=>null,cancelConvoy(){},startExit:()=>false,townBusy:()=>false,anniversary:()=>null,anniversaryParticipants:()=>[],
  sessions:()=>[],dispatch:(owner,names)=>{dispatched.push(names);owner.returnCompletedAt=1000;return true;},reconcile:()=>false,finish(){},persist(){}};
 createEventReturns(state,ports).reconcile();
 assert.deepEqual(cleared,['P'],"the moved member's Town command of this return leaves the slot");
 assert.deepEqual(dispatched,[['W']],'the return dispatches the members still in the group');
 assert.equal(state.current,null,'the return completes');
});
