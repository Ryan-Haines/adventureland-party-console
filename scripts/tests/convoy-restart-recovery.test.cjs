const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPartyConvoys}=require('../../runtime/coordinator/navigation/convoy-composition.ts');
const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
function fixture(){
 let now=1000;
 const status=()=>({seenAt:now,map:'main',x:1,y:2,hp:100,server:'USII',convoyProtocol:4,convoyNavigation:{runtimeId:'fresh'}});
 const state={leader:'W',merchantCharacter:'M',followers:{P:true},statuses:{W:status(),P:status()},commands:{},activeConvoy:null,navigationEpoch:1,nextCommandId:2,location:null,farmingPolicy:'focus'};
 const intents={W:{revision:1},P:{revision:1}},logs=[];
 const service=createCoordinatorPartyConvoys(state,{now:()=>now,activeNames:()=>['W','P'],intent:n=>intents[n],persist(){},resolveArea:(_a,_b,x)=>x,log:m=>logs.push(m)});
 service.start({map:'cave',x:50,y:60},'cave',['W','P']);
 const original=state.activeConvoy;
 Object.assign(state,initialCommandState({activeConvoy:original},()=>now));
 return {state,service,logs,intents,original,advance(ms){now+=ms;for(const s of Object.values(state.statuses))s.seenAt=now;}};
}
test('restart rebuilds a current ordinary convoy once from fresh positions with fresh identities',()=>{
 const f=fixture();f.advance(4999);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,f.original.id);
 f.advance(1);f.service.recoverRestart();
 assert.notEqual(f.state.activeConvoy.id,f.original.id);assert.equal(f.state.activeConvoy.phase,'assemble');
 assert.deepEqual(f.state.activeConvoy.location,f.original.location);assert.equal(f.state.activeConvoy.expected.W.runtimeId,'fresh');
 assert.equal(f.state.activeConvoy.restartAttempts,1);
 const id=f.state.activeConvoy.id;f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,id);
});
test('restart waits for current reports and command ownership and logs the wait once',()=>{
 const f=fixture();f.advance(5000);f.state.statuses.P.seenAt=0;
 f.service.recoverRestart();f.service.recoverRestart();assert.equal(f.logs.length,1);
 f.advance(1);f.state.commands.P={id:777,convoyId:'manual'};f.service.recoverRestart();assert.equal(f.state.commands.P.id,777);
 delete f.state.commands.P;f.service.recoverRestart();assert.notEqual(f.state.activeConvoy.id,f.original.id);
});
for(const change of [f=>f.intents.P.cancelled=true,f=>f.intents.P.revision++,f=>f.state.followers.P=false])
 test('changed navigation invalidates the restored convoy without replacing newer commands '+change,()=>{
 const f=fixture();change(f);f.state.commands.P={id:777,convoyId:'new'};f.advance(5000);f.service.recoverRestart();
 assert.equal(f.state.activeConvoy,null);assert.equal(f.state.commands.P.id,777);
});
test('event and Hunt owners retain their own recovery; unrelated failures do not auto-retry',()=>{
 for(const purpose of ['monster-hunt','anniversary-return','franky-exit']){
  const f=fixture();f.state.activeConvoy.purpose=purpose;f.advance(90000);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,f.original.id);
 }
 const f=fixture();f.state.activeConvoy.restartRecovery=false;f.advance(90000);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,f.original.id);
});
test('hold acknowledgements and a second restart cannot replace the original navigation authority',()=>{
 const f=fixture();f.intents.P.revision=2;f.state.activeConvoy.expected.P.revision=2;
 Object.assign(f.state,initialCommandState({activeConvoy:f.state.activeConvoy},()=>1000));
 f.advance(5000);f.service.recoverRestart();assert.equal(f.state.activeConvoy,null);
});
test('repeated coordinator restarts preserve the three-attempt budget and backoff',()=>{
 const f=fixture();for(const [index,delay] of [5000,15000,30000].entries()){
  f.advance(delay-1);f.service.recoverRestart();assert.equal(f.state.activeConvoy.restartAttempts||0,index);
  f.advance(1);f.service.recoverRestart();assert.equal(f.state.activeConvoy.restartAttempts,index+1);
  const active=f.state.activeConvoy;Object.assign(f.state,initialCommandState({activeConvoy:active},()=>f.state.statuses.W.seenAt));
 }
 const id=f.state.activeConvoy.id;f.advance(90000);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,id);assert.match(f.logs.at(-1),/exhausted/);
});
