const test=require('node:test'),assert=require('node:assert/strict');
const {createRealmRoutes}=require('../../runtime/coordinator/http/realms.ts');
function fixture(){
 const state={realmSwitch:null,bankboiTransaction:null,statuses:{P:{server:'USII',seenAt:100000}},commands:{P:{id:1}}};
 const calls=[],ports={now:()=>100000,resolve:realm=>['SR_USII','SR_EUI','SR_PVP'].includes(realm),bankBusy:()=>false,participants:()=>['P'],native:()=> 'P',
  current:()=> 'SR_USII',home:()=> 'SR_USII',persist:()=>calls.push('persist'),run:operation=>calls.push(operation),refresh:async()=>{},label:realm=>realm,dispatch:()=>calls.push('dispatch')};
 const routes=createRealmRoutes(state,ports);
 async function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await routes[route]({body},res);return res;}
 return {state,ports,calls,send};
}
test('realm changes reject missing participants, stale reports, active BankBoi and PVP before dispatch',async()=>{
 const t=fixture();assert.equal((await t.send('switchRealm',{realm:'unknown'})).code,400);
 assert.equal((await t.send('switchRealm',{realm:'SR_PVP'})).code,409);
 t.state.bankboiTransaction={};assert.equal((await t.send('switchRealm',{realm:'SR_EUI'})).code,409);t.state.bankboiTransaction=null;
 t.state.statuses.P.seenAt=1;assert.deepEqual((await t.send('switchRealm',{realm:'SR_EUI'})).body.characters,['P']);
 assert.equal(t.calls.length,0);
});
test('realm request persists its exact operation before dispatch and refuses a concurrent switch',async()=>{
 const t=fixture(),result=await t.send('switchRealm',{realm:'SR_EUI',setHome:true});
 assert.equal(result.code,202);assert.equal(result.body.operation,t.state.realmSwitch);assert.equal(t.calls[0],'persist');
 assert.deepEqual(t.state.realmSwitch.characters,[{name:'P',realm:'SR_USII',arrived:false}]);
 assert.equal((await t.send('switchRealm',{realm:'SR_USII'})).code,409);
});
test('home completion validates the command and confirms server state before resuming merchant',async()=>{
 const t=fixture();t.state.realmSwitch={id:'switch',realm:'SR_EUI',phase:'setting-home',homeExecutor:'P'};
 assert.equal((await t.send('homeComplete',{operationId:'stale',character:'P',success:true})).code,409);assert.ok(t.state.commands.P);
 const body={operationId:'switch',character:'P',success:true};assert.equal((await t.send('homeComplete',body)).code,502);assert.equal(t.state.realmSwitch.phase,'failed');
 assert.equal(t.calls.includes('dispatch'),false);t.state.realmSwitch.phase='setting-home';t.ports.home=()=> 'SR_EUI';
 assert.equal((await t.send('homeComplete',body)).body.homeRealm,'SR_EUI');assert.equal(t.state.realmSwitch.phase,'complete');assert.equal(t.calls.at(-1),'dispatch');
});

test('realm operations preserve unknown prior realms and ignore the account refresh return value',async()=>{
 const t=fixture();t.ports.current=()=>null;t.ports.home=()=>null;
 const result=await t.send('switchRealm',{realm:'SR_EUI',setHome:true});
 assert.equal(result.code,202);assert.equal(result.body.operation.fromRealm,null);assert.equal(result.body.operation.homeRealm,null);
 t.state.realmSwitch.phase='setting-home';t.state.realmSwitch.homeExecutor='P';
 t.ports.refresh=async()=>{t.ports.home=()=> 'SR_EUI';return {characters:[],servers:[]};};
 const completed=await t.send('homeComplete',{operationId:t.state.realmSwitch.id,character:'P',success:true});
 assert.equal(completed.code,200);assert.equal(t.state.realmSwitch.phase,'complete');assert.equal(t.calls.at(-1),'dispatch');
});
