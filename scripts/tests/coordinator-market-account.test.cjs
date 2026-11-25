const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {createCoordinatorMarketAccountActions}=require('../../runtime/items/coordinator/routes/market.ts');
function fixture(){
 const state={merchantCharacter:'M',statuses:{M:{}},merchantCurrent:null,merchantQueue:[],nextCommandId:40,
  aldata:{key:'',auth:'CORRECT',authCheckedAt:1,publishStatus:'published',error:null}};
 const calls=[];
 const service=createCoordinatorMarketAccountActions(state,withDoor(state,{
  now:()=>100000,randomBytes:size=>{calls.push(['random',size]);return {toString:encoding=>{calls.push(encoding);return 'generated-key';}};},
  snapshot:()=>state.aldata,fetch:async path=>{calls.push(path);return {auth:'CORRECT'};},refresh:async kind=>{calls.push(['refresh',kind]);return {};},
  persistMarket:()=>calls.push('market'),publish:()=>calls.push('publish'),stamp:job=>({...job,priority:50}),log:()=>{},
  persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),write:settingsWriter(state).write,
 }));
 async function invoke(handler){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body:{}},res);return res;}
 return {state,calls,service,invoke};
}

// The dialog's postage is the amount a mail job holds gold for; the answer
// carries the price with an item too, so the write form names the one that applies.
test('postage answers the letter and item postage a mail job needs',async()=>{
 const {MAIL_POSTAGE}=require('../../runtime/items/rules.ts');
 const t=fixture();assert.deepEqual((await t.invoke(t.service.postage)).body,{gold:MAIL_POSTAGE.letter,withItem:MAIL_POSTAGE.item});assert.deepEqual(t.calls,[]);
});

test('market account controls generate the original key format and share current command state',async()=>{
 const t=fixture();await t.invoke(t.service.market.generateKey);
 assert.deepEqual(t.calls,[['random',32],'hex','market']);assert.equal(t.state.aldata.auth,'NO');
 assert.equal(t.state.aldata.authCheckedAt,0);assert.equal(t.state.aldata.publishStatus,'idle');
 t.state.nextCommandId=80;t.state.merchantQueue=[];
 assert.equal((await t.invoke(t.service.market.sendAuth)).body.jobId,'merchant-100000-80');
 assert.equal((await t.invoke(t.service.market.sendAuth)).body.duplicate,true);
 assert.equal(t.state.nextCommandId,81);assert.equal(t.state.merchantQueue[0].priority,50);
 await t.invoke(t.service.market.refresh);assert.deepEqual(t.calls.at(-1),['refresh','all']);
});
