const test=require('node:test'),assert=require('node:assert/strict');
const {createSendMailRoute}=require('../../runtime/coordinator/http/send-mail.ts');
const {createMailApi}=require('../../runtime/coordinator/commerce/mail-api.ts');
const {createMailInboxRoutes}=require('../../runtime/coordinator/http/mail-inbox.ts');
function fixture(){
 const item={name:'leather',q:10},entry={slot:2,item};
 const state={merchantCharacter:'M',merchantQueue:[],withdrawals:{},statuses:{M:{items:[entry]}},bankbois:{B:{items:[entry]}},bankSnapshot:{packs:{items0:[entry]}}};
 const calls=[],handler=createSendMailRoute(state,{now:()=>100,nextCommand:()=>1,stamp:j=>j,persist:()=>calls.push('persist'),persistBank:()=>calls.push('bank'),dispatch:()=>calls.push('dispatch'),bankboi:async()=>calls.push('bankboi'),log:(...args)=>calls.push(args),identity:item=>JSON.stringify(item)});
 function send(body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};handler({body:{recipient:' P ',subject:' hi ',message:'hello',...body}},res);return res;}
 return {state,calls,item,send};
}
test('mail staging appends its attachment without altering unrelated withdrawal requests',()=>{
 const f=fixture(),existing={pack:'items0'},requests=[existing];f.state.withdrawals.M=requests;
 assert.equal(f.send({source:{pack:'bankboi:B',slot:2,item:f.item},quantity:3}).code,200);
 assert.equal(f.state.withdrawals.M,requests);assert.equal(requests[0],existing);
 assert.deepEqual(existing,{pack:'items0'});assert.equal(requests.length,2);
 assert.equal(requests[1].mailJobId,f.state.merchantQueue[0].id);
});
for(const pack of ['merchant','items0','bankboi:B'])test('mail validates and stages attachment from '+pack,()=>{
 const f=fixture();assert.equal(f.send({source:{pack,slot:2,item:f.item},quantity:3}).code,200);
 const job=f.state.merchantQueue[0];assert.equal(job.mail.quantity,3);assert.equal(job.mail.recipient,'P');assert.equal(job.mail.source.pack,pack);
 assert.equal(job.blockedOnBankboi,pack.startsWith('bankboi:'));
 if(job.blockedOnBankboi){assert.equal(f.state.withdrawals.M[0].mailJobId,job.id);assert.ok(f.calls.indexOf('bank')<f.calls.indexOf('dispatch'));}
});
test('mail rejects blank quantities, stale attachments and invalid envelopes without enqueueing',()=>{
 const f=fixture(),source={pack:'merchant',slot:2,item:f.item};
 for(const quantity of ['',undefined,0,11,1.5])assert.equal(f.send({source,quantity}).code,400);
 assert.equal(f.send({source:{...source,item:{name:'other'}},quantity:1}).code,409);
 assert.equal(f.send({recipient:'bad name'}).code,400);assert.equal(f.send({subject:''}).code,400);assert.equal(f.send({message:'x'.repeat(1001)}).code,400);
 assert.deepEqual(f.state.merchantQueue,[]);assert.deepEqual(f.calls,[]);
});
test('text-only mail does not require an attachment quantity or BankBoi staging',()=>{
 const f=fixture();f.send({});assert.deepEqual(f.state.merchantQueue[0].mail,{recipient:'P',subject:'hi',message:'hello'});
 assert.deepEqual(f.calls,['persist','dispatch']);
});
test('mail API decodes envelopes and refuses HTTP and account-level failures',async()=>{
 const call=(raw,ok=true)=>createMailApi({post:async()=>({ok,json:async()=>raw})})('pull_mail',{});
 assert.deepEqual(await call({infs:[{type:'mail',mail:[]}]}),[{type:'mail',mail:[]}]);
 await assert.rejects(call([{type:'ui_error',message:'denied'}]),/denied/);
 await assert.rejects(call({result:{success:false,reason:'nope'}}),/nope/);
 await assert.rejects(call([],false),/Mail request failed/);
});
test('inbox action errors retain their HTTP contract',async()=>{
 const routes=createMailInboxRoutes({collect:async()=>{throw Error('Attachment unavailable');}});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
 await routes.action('collect')({body:{id:'mail'}},res);assert.equal(res.code,409);assert.equal(res.body.error,'Attachment unavailable');
});
test('full host completion callback reaches the initialized inbox',async()=>{
 const {run}=require('./helpers/coordinator-host.cjs'),policies=require('../../runtime/coordinator/index.ts');
 let party;const calls=[];
 const host=await run(1900000000000,{
  '../../.build/runtime/coordinator-policies.cjs':{...policies,createCoordinatorMerchantDeliveryActions(state,ports){party=state;return policies.createCoordinatorMerchantDeliveryActions(state,ports);}},
  '../../scripts/mail-inbox.cjs':()=>({refresh:async()=>({}),snapshot:()=>({}),complete:(...args)=>calls.push(args)})
 });
 party.merchantCurrent={id:'job',target:party.merchantCharacter,reason:'collect mail',mail:{id:'mail'}};
 const response={status(code){assert.fail('HTTP '+code);},json(body){assert.equal(body.ok,true);}};
 host.handlers.get('/party-api/merchant/complete')({body:{jobId:'job',success:true,error:null}},response);
 assert.deepEqual(calls,[['mail',true,null]]);
});
