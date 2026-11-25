const {test}=require('node:test'),assert=require('node:assert/strict');
const {installProductionRoutes}=require('../../runtime/items/coordinator/routes/production.ts');
const {httpFixture}=require('./helpers/coordinator-http.cjs');

test('production inspection is read-only and explicit unknown resolution survives replay and late completion',()=>{
 const http=httpFixture(),state={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{M:{'cap@+0':{tiers:1,quantity:2}}},autoCompounds:{}};
 let writes=0;installProductionRoutes(http.router,state,()=>writes++);
 const body={character:'M',id:'old',kind:'upgrade',item:{name:'cap',level:0}};
 const call=value=>http.invoke('POST','/party-api/merchant/production',value).response;
 assert.equal(call(body).code,200);
 const inspection=call({...body,id:'new',action:'inspect'});
 assert.equal(inspection.body.attempt,null);assert.equal(inspection.body.pending[0].id,'old');assert.equal(writes,1);
 assert.equal(call({...body,character:'Other',action:'resolve-unknown',reason:'review'}).code,400);
 assert.equal(call({...body,item:{name:'sword',level:0},action:'resolve-unknown',reason:'review'}).code,409);
 assert.equal(call({...body,action:'resolve-unknown'}).code,409);
 const resolution=call({...body,action:'resolve-unknown',reason:'Local journal belongs to another attempt'});
 assert.equal(resolution.body.attempt.resolution.outcome,'unknown');assert.equal(resolution.body.attempt.success,undefined);
 const saved=JSON.stringify(state.production);
 call({...body,action:'complete',success:true});call({...body,action:'resolve-unknown',reason:'duplicate'});
 assert.equal(JSON.stringify(state.production),saved);assert.equal(state.autoUpgradeMarks.M['cap@+0'].quantity,2);
 assert.equal(call(body).body.attempt.completed,true);assert.equal(call({...body,id:'next'}).code,200);
});

test('a checkpoint moves the journal phase forward, and pending lists the unfinished attempt with its journal',()=>{
 const http=httpFixture(),state={merchantCharacter:'M',statuses:{},production:{attempts:{}},autoUpgradeMarks:{},autoCompounds:{}};
 installProductionRoutes(http.router,state,()=>{});
 const call=value=>http.invoke('POST','/party-api/merchant/production',value).response;
 const body={character:'M',id:'a1',kind:'upgrade',item:{name:'cap',level:0}};
 const journal=phase=>({id:'a1',item:{name:'cap',level:0},phase,slots:[0]});
 assert.equal(call(body).code,200);
 assert.equal(call({...body,action:'checkpoint',journal:journal('prepared')}).code,200);
 assert.equal(call({...body,action:'checkpoint',journal:journal('running')}).code,200);
 assert.equal(state.production.attempts.a1.journal.phase,'running');
 assert.equal(call({...body,action:'checkpoint',journal:journal('prepared')}).code,200);
 assert.equal(state.production.attempts.a1.journal.phase,'running','an earlier phase never replaces a later one');
 assert.equal(call({...body,action:'checkpoint',journal:{...journal('running'),id:'other'}}).code,409);
 const pending=call({character:'M',action:'pending'}).body;
 assert.deepEqual(pending.pending.map(entry=>[entry.id,entry.journal.phase]),[['a1','running']]);
 call({...body,action:'complete',success:true});
 assert.deepEqual(call({character:'M',action:'pending'}).body.pending,[],'a completed attempt is no longer pending');
});
