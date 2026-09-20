const test=require('node:test'),assert=require('node:assert/strict');
const {createALDataRoutes,createMailPostageRoute}=require('../../runtime/coordinator/http/aldata.ts');
function fixture(){
 const state={aldata:{key:'old',auth:'CORRECT',authCheckedAt:1,publishStatus:'published',error:null},merchantCharacter:'M',statuses:{M:{}},merchantCurrent:null,merchantQueue:[]};
 const calls=[];const ports={now:()=>100,key:()=> 'new',nextCommand:()=>7,snapshot:()=>({listings:[]}),fetch:async path=>{calls.push(path);return {auth:'CORRECT'};},
  refresh:async()=>({fresh:true}),persistMarket:()=>calls.push('market'),publish:()=>calls.push('publish'),stamp:job=>job,log(){},persist:()=>calls.push('settings'),dispatch:()=>calls.push('dispatch')};
 const routes=createALDataRoutes(state,ports);
 async function send(route){const r={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await routes[route]({},r);return r;}
 return {state,ports,calls,send};
}
test('ALData key replacement resets authentication and successful auth schedules publication',async()=>{
 const t=fixture();assert.equal((await t.send('generateKey')).body.key,'new');assert.equal(t.state.aldata.auth,'NO');assert.equal(t.state.aldata.authCheckedAt,0);
 assert.equal((await t.send('auth')).body.checkedAt,100);assert.ok(t.calls.includes('/auth/M/new'));assert.ok(t.calls.includes('publish'));
});
test('ALData authentication mail requires an online merchant and key and deduplicates queued work',async()=>{
 const t=fixture();t.state.aldata.key='';assert.equal((await t.send('sendAuth')).code,409);
 t.state.aldata.key='key';assert.equal((await t.send('sendAuth')).body.jobId,'merchant-100-7');assert.equal((await t.send('sendAuth')).body.duplicate,true);
 assert.equal(t.state.merchantQueue.length,1);assert.deepEqual(t.calls,['settings','dispatch']);
});
test('ALData fetch and unavailable mail source errors retain their public failure contracts',async()=>{
 const t=fixture();t.ports.fetch=async()=>{throw new Error('offline');};assert.equal((await t.send('auth')).code,502);assert.equal(t.state.aldata.error,'offline');
 let result;await createMailPostageRoute(async()=>{throw new Error('missing');})({}, {json:body=>result=body});assert.deepEqual(result,{gold:null});
});
