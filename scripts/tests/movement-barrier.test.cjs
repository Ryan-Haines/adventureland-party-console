const test=require('node:test'),assert=require('node:assert/strict');
const {movementBarrier}=require('../../runtime/coordinator/navigation/movement-barrier.ts');
function fixture(){
 const names=['L','F'];
 const state={activeConvoy:{id:'c',epoch:1,routeVersion:1,routeProtocol:4,phase:'travel',participants:names,completed:[],runtimes:{L:'L',F:'F'}},
  commands:Object.fromEntries(names.map(name=>[name,{convoyId:'c',epoch:1,id:1,navigationRevision:0}])),
  statuses:Object.fromEntries(names.map(name=>[name,{seenAt:1000,convoyNavigation:{runtimeId:name}}]))};
 const body=name=>({character:name,convoyId:'c',epoch:1,commandId:1,routeVersion:1,navigationRevision:0,runtimeId:name,step:0,destination:{map:'main',x:0,y:0,town:true},ready:true});
 return {state,body};
}
test('town release waits for every member; completion waits for regroup and ignores harmless waypoint metadata',()=>{
 const {state,body}=fixture();const leader=body('L');leader.destination.method='town';
 assert.equal(movementBarrier(state,leader,1000).ready,false);
 assert.equal(movementBarrier(state,body('F'),1000).ready,true);
 assert.equal(movementBarrier(state,leader,1100).ready,true);
 assert.equal(movementBarrier(state,{...leader,completed:true},1200).ready,false);
 assert.equal(movementBarrier(state,{...body('F'),completed:true},1300).ready,true);
 assert.equal(movementBarrier(state,{...leader,completed:true},1400).ready,true);
});
test('unready member, stale runtime and cancelled command cannot authorize a warp',()=>{
 const {state,body}=fixture();movementBarrier(state,body('L'),1000);
 assert.equal(movementBarrier(state,{...body('F'),ready:false},1000).ready,false);
 assert.match(movementBarrier(state,{...body('F'),runtimeId:'old'},1000).error,/Stale/);
 state.navigationIntents={F:{revision:1,cancelled:true}};
 assert.match(movementBarrier(state,body('F'),1000).error,/Stale/);
});
test('scheduled departure accepts a barrier only when departure time has arrived; new epoch cannot reuse readiness',()=>{
 const {state,body}=fixture();state.activeConvoy.phase='scheduled';state.activeConvoy.departAt=1100;
 assert.match(movementBarrier(state,body('L'),1000).error,/Stale/);
 assert.equal(movementBarrier(state,body('L'),1100).ready,false);
 assert.equal(movementBarrier(state,body('F'),1100).ready,true);
 state.activeConvoy.epoch=2;state.commands.L.epoch=state.commands.F.epoch=2;
 assert.equal(movementBarrier(state,{...body('L'),epoch:2},1200).ready,false);
});
test('three-member leave waits for the last arrival before releasing the convoy',()=>{
 const {state,body}=fixture();state.activeConvoy.participants.push('P');state.activeConvoy.runtimes.P='P';state.commands.P={...state.commands.F};state.statuses.P={seenAt:1000,convoyNavigation:{runtimeId:'P'}};
 const leave=name=>({...body(name),destination:{map:'main',x:0,y:0,method:'leave'}});
 for(const name of ['L','F'])assert.equal(movementBarrier(state,leave(name),1000).ready,false);
 assert.equal(movementBarrier(state,leave('P'),1000).ready,true);
 for(const name of ['L','F'])assert.equal(movementBarrier(state,{...leave(name),completed:true},1200).ready,false);
 assert.equal(movementBarrier(state,{...leave('P'),completed:true},1300).ready,true);
});

test('released transition remains latched when casting makes a member unready, and duplicate arrivals are idempotent',()=>{
 const {state,body}=fixture();movementBarrier(state,body('L'),1000);movementBarrier(state,body('F'),1000);
 assert.equal(movementBarrier(state,{...body('L'),ready:false},1100).ready,true);
 for(const s of Object.values(state.statuses))s.seenAt=15000;
 assert.equal(movementBarrier(state,body('F'),15000).ready,true,'release must not expire while a slower member finishes');
 for(let i=0;i<2;i++)assert.equal(movementBarrier(state,{...body('L'),completed:true},15000).ready,false);
 assert.equal(movementBarrier(state,{...body('F'),completed:true},15000).ready,true);
});
test('delayed heartbeat waits without losing identity, whereas replacement stays rejected',()=>{
 const {state,body}=fixture();assert.equal(movementBarrier(state,body('L'),5000).waiting,'fresh observations');
 state.commands.L.id++;
 assert.equal(movementBarrier(state,body('L'),5000).code,'superseded');
});
