const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMarketAccountActions}=require('../../runtime/coordinator/http/market-account-actions.ts');
const {mailPostage}=require('../mail-postage.cjs');
function fixture(){
 const state={merchantCharacter:'M',statuses:{M:{}},merchantCurrent:null,merchantQueue:[],nextCommandId:40,
  aldata:{key:'',auth:'CORRECT',authCheckedAt:1,publishStatus:'published',error:null}};
 const calls=[];let versions=[2,1],fail=false;
 const service=createCoordinatorMarketAccountActions(state,{
  now:()=>100000,randomBytes:size=>{calls.push(['random',size]);return {toString:encoding=>{calls.push(encoding);return 'generated-key';}};},
  snapshot:()=>state.aldata,fetch:async path=>{calls.push(path);return {auth:'CORRECT'};},refresh:async kind=>{calls.push(['refresh',kind]);return {};},
  persistMarket:()=>calls.push('market'),publish:()=>calls.push('publish'),stamp:job=>({...job,priority:50}),log:()=>{},
  persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),versions:async()=>{calls.push('versions');return versions;},
  locate:(path,version)=>{calls.push(['locate',path,version]);return 'cache-'+version;},
  read:async(path,encoding)=>{calls.push(['read',path,encoding]);if(fail)throw Error('missing cache');return 'Send Mail Cost: <span style="color:gold">1,200</span>';},
  postage:html=>{calls.push('parse');return mailPostage(html);},
 });
 async function invoke(handler){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body:{}},res);return res;}
 return {state,calls,service,invoke,versions:value=>{versions=value;},fail:()=>{fail=true;}};
}

test('postage reads the first current cache version in order and retains the null-on-failure contract',async()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 assert.deepEqual((await t.invoke(t.service.postage)).body,{gold:1200});
 assert.deepEqual(t.calls,['versions',['locate','/js/html.js',2],['read','cache-2','utf8'],'parse']);
 t.versions([3]);t.calls.length=0;t.fail();
 assert.deepEqual((await t.invoke(t.service.postage)).body,{gold:null});
 assert.deepEqual(t.calls,['versions',['locate','/js/html.js',3],['read','cache-3','utf8']]);
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
