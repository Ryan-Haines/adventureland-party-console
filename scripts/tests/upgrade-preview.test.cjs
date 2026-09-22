const {test}=require('node:test'),assert=require('node:assert/strict');
const {previewUpgrade}=require('../../runtime/characters/upgrade-preview.ts');
const {createUpgradePreviews}=require('../../runtime/coordinator/merchant/upgrade-preview.ts');
const {unavailablePreview}=require('../../runtime/upgrade-preview.ts');

function fixture() {
 const item={name:'sword',level:8,rid:'exact'},items=[item,{name:'scroll1',q:4},{name:'offeringp'},{name:'offering'},{name:'offeringx'}],calls=[];
 const request={id:'r',executor:'M',session:'s',slot:0,item:{...item},expiresAt:11000};
 const ports={items:()=>items,grade:()=>1,current:()=>true,now:()=>1000,preview:async(...args)=>{
  calls.push(args);return {calculate:true,chance:0.15321,item:{...item},scroll:'scroll1',...(args[2]===null?{}:{offering:items[args[2]].name}),grace:2};
 }};
 return {items,calls,request,ports};
}
test('all four previews use calculate=true and preserve items, quantities and item grace',async()=>{
 const f=fixture(),before=JSON.stringify(f.items),result=await previewUpgrade(f.request,f.ports);
 assert.deepEqual(f.calls,[[0,1,null,true],[0,1,2,true],[0,1,3,true],[0,1,4,true]]);
 assert.equal(JSON.stringify(f.items),before);assert.equal(result.options.offeringp.preview.grace,2);
 assert.equal(result.options.none.preview.chance,0.15321);
});
test('missing scrolls and offerings never issue fake substitute attempts',async()=>{
 const f=fixture();f.items.splice(2);const result=await previewUpgrade(f.request,f.ports);
 assert.equal(f.calls.length,1);assert.match(result.options.offeringp.reason,/Offering not/);
 f.items.splice(1);f.calls.length=0;const missing=await previewUpgrade(f.request,f.ports);
 assert.equal(f.calls.length,0);assert.match(missing.options.none.reason,/Missing scroll1/);
});
test('slot replacement, session changes and expiry discard previews',async()=>{
 const f=fixture();f.items[0]={name:'sword',level:8,rid:'different'};
 assert.match((await previewUpgrade(f.request,f.ports)).options.none.reason,/Item changed/);assert.equal(f.calls.length,0);
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>{const result=await run(...args);g.items[0]={name:'sword',level:9};return result;};
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/changed/);assert.equal(g.calls.length,1);
 const h=fixture();h.ports.now=()=>12000;await previewUpgrade(h.request,h.ports);assert.equal(h.calls.length,0);
});
test('server rejections and mismatched response identities are unavailable',async()=>{
 const f=fixture();f.ports.preview=async()=>{throw {reason:'cant_in_bank'};};
 assert.equal((await previewUpgrade(f.request,f.ports)).options.none.reason,'Merchant is in the bank');
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>({...await run(...args),scroll:'scroll0'});
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/Mismatched/);
});
function coordinator() {
 const item={name:'sword',level:8},state={merchantCharacter:'M',statuses:{M:{seenAt:1000,upgradePreviewSession:'session',items:[{slot:0,item}]}}};
 let now=1000;const routes={},service=createUpgradePreviews(state,()=>now);
 service.install({post:(path,handler)=>routes[path]=handler});
 function send(path,body) {const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;}};routes['/party-api/upgrade-preview'+path]({body},res);return res;}
 return {state,item,service,send,setTime:value=>now=value};
}
test('coordinator transports ephemeral previews without altering inventory or jobs',()=>{
 const f=coordinator(),before=JSON.stringify(f.state),response=f.send('',{character:'M',slot:0,item:f.item});
 const request=f.service.next('M');assert.equal(request.session,'session');assert.equal(response.value,undefined);
 const result=unavailablePreview('M',f.item,'Missing scroll');
 assert.equal(f.send('/result',{character:'M',id:request.id,session:request.session,result}).statusCode,200);
 assert.deepEqual(response.value,result);assert.equal(f.service.next('M'),undefined);assert.equal(JSON.stringify(f.state),before);
});
test('coordinator explains unavailable sources and offline runtime',()=>{
 const f=coordinator();
 assert.match(f.send('',{character:'F',slot:0,item:f.item}).value.options.none.reason,/not in merchant/);
 assert.match(f.send('',{character:'M',slot:0,equipped:true,item:f.item}).value.options.none.reason,/not in merchant/);
 f.setTime(20000);assert.match(f.send('',{character:'M',slot:0,item:f.item}).value.options.none.reason,/offline/);
});
test('timeout and replaced sessions reject late results',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=coordinator(),response=f.send('',{character:'M',slot:0,item:f.item});
 const request=f.service.next('M'),payload={character:'M',id:request.id,session:'session',result:unavailablePreview('M',f.item,'x')};
 f.state.statuses.M.upgradePreviewSession='replacement';assert.equal(f.send('/result',payload).statusCode,409);
 t.mock.timers.tick(10000);assert.match(response.value.options.none.reason,/timed out/);assert.equal(f.send('/result',payload).statusCode,409);
});

test('character integration rejects busy work and holds the upgrade guard until the preview settles',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{namedFunction}=require('./helpers/named-function.cjs');
 const source=fs.readFileSync('characters/shared.js','utf8'),calls=[];
 let resolvePreview;
 const root={localStorage:{getItem:()=>null},previewPartyUpgrade:()=>new Promise(resolve=>{resolvePreview=resolve;})};
 const r=vm.createContext({root,parent:{},character:{name:'M',items:[]},upgradePreviewSession:'s',lastUpgradePreview:null,upgradePreviewActive:false,
  upgrading:false,consoleMaintenanceBusy:()=>true,productionJournalKey:()=>'',item_grade:()=>1,runtimeCurrent:()=>true,
  coordinatorClockOffset:0,upgrade:()=>{throw Error('No actual upgrade allowed');},setTimeout,clearTimeout,
  request:async(path,options)=>calls.push({path,body:options.body})});
 vm.runInContext(namedFunction(source,'handleUpgradePreview'),r);
 await r.handleUpgradePreview({id:'busy',session:'s',executor:'M',item:{name:'sword'}});
 assert.equal(calls[0].body.result.options.none.reason,'Merchant busy');assert.equal(r.upgrading,false);
 r.consoleMaintenanceBusy=()=>false;
 const work=r.handleUpgradePreview({id:'ready',session:'s',executor:'M',item:{name:'sword'}});
 assert.equal(r.upgrading,true);assert.ok(root.__partyUpgradePreviewInFlight);
 resolvePreview(unavailablePreview('M',{name:'sword'},'Missing scroll'));await work;
 assert.equal(r.upgrading,false);assert.equal(root.__partyUpgradePreviewInFlight,null);assert.equal(calls.length,2);
 await r.handleUpgradePreview({id:'ready',session:'s',executor:'M'});assert.equal(calls.length,2);
});
