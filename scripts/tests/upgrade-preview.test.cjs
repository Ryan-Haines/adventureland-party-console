const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {previewUpgrade}=require('../../runtime/items/character/production.ts');
const {createUpgradePreviews}=require('../../runtime/items/coordinator/routes/production.ts');
const {unavailablePreview}=require('../../runtime/items/rules.ts');

function fixture() {
 const item={name:'sword',level:8,rid:'exact'},items=[item,{name:'scroll1',q:4},{name:'offeringp'},{name:'offering'},{name:'offeringx'}],calls=[];
 const request={id:'r',executor:'M',session:'s',slot:0,item:{...item},expiresAt:11000};
 const ports={items:()=>items,grade:()=>1,current:()=>true,now:()=>1000,searched:'merchant inventory or accessible bank',preview:async(...args)=>{
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
 // The merchant's preview borrows from the bank first, so the refusal names both places it looked.
 assert.equal(missing.options.none.reason,'Missing scroll1 in merchant inventory or accessible bank');
 assert.equal(result.options.offeringp.reason,'Offering not in merchant inventory or accessible bank');
});
test('slot replacement, session changes and expiry discard previews',async()=>{
 const f=fixture();f.items[0]={name:'sword',level:8,rid:'different'};
 assert.match((await previewUpgrade(f.request,f.ports)).options.none.reason,/Item changed/);assert.equal(f.calls.length,0);
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>{const result=await run(...args);g.items[0]={name:'sword',level:9};return result;};
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/changed/);assert.equal(g.calls.length,1);
 // The preview runs while its command is current, past the request's expiresAt too.
 const h=fixture();h.ports.now=()=>12000;await previewUpgrade(h.request,h.ports);assert.equal(h.calls.length,4);
});
test('server rejections and mismatched response identities are unavailable',async()=>{
 const f=fixture();f.ports.preview=async()=>{throw {reason:'cant_in_bank'};};
 assert.equal((await previewUpgrade(f.request,f.ports)).options.none.reason,'Merchant is in the bank');
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>({...await run(...args),scroll:'scroll0'});
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/Mismatched/);
});

function coordinator(saved) {
 const item={name:'sword',level:8},state=saved||{merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],statuses:{M:{seenAt:1000,upgradePreviewSession:'session',upgradePreviewRevision:'0',items:[{slot:0,item}]}}};
 const routes={},service=createUpgradePreviews(state,withDoor(state,{persist(){},dispatch(){},stamp:j=>({...j,priority:70})}),()=>1000);
 service.install({post:(path,handler)=>routes[path]=handler});
 function send(path,body) {const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;}};routes['/party-api/upgrade-preview'+path]({body},res);return res;}
 const body={character:'M',slot:0,item};
 return {state,item,send,body};
}
test('preview reads do not enqueue; explicit refresh deduplicates and obeys normal job priority',()=>{
 const f=coordinator();assert.equal(f.send('',f.body).value.status,'idle');assert.equal(f.state.merchantQueue.length,0);
 assert.equal(f.send('',{...f.body,refresh:true}).value.status,'queued');f.send('',{...f.body,refresh:true});
 assert.equal(f.state.merchantQueue.length,1);assert.equal(f.state.merchantQueue[0].priority,70);
 f.state.merchantCurrent={...f.state.merchantQueue.shift(),commandId:7};assert.equal(f.send('',f.body).value.status,'running');
});
test('results survive restart and reopening but a real upgrade invalidates every previous preview',()=>{
 const f=coordinator();f.send('',{...f.body,refresh:true});f.state.merchantCurrent={...f.state.merchantQueue.shift(),commandId:7};
 const payload={character:'M',id:f.state.merchantCurrent.id,commandId:7,session:'session',revision:'0',result:unavailablePreview('M',f.item,'not in bank')};
 assert.equal(f.send('/result',{...payload,commandId:8}).statusCode,409);
 assert.equal(f.send('/result',{...payload,session:'stale'}).statusCode,409);
 assert.equal(f.send('/result',payload).statusCode,200);f.state.merchantCurrent=null;
 const g=coordinator(JSON.parse(JSON.stringify(f.state)));
 assert.equal(g.send('',g.body).value.status,'unavailable');
 g.state.statuses.M.upgradePreviewRevision='123';assert.equal(g.send('',g.body).value.status,'invalidated');
 assert.equal(g.send('',g.body).value.result,undefined);
});
test('changed or foreign items cannot create jobs',()=>{
 const f=coordinator();assert.equal(f.send('',{...f.body,character:'F',refresh:true}).statusCode,400);
 assert.equal(f.send('',{...f.body,item:{name:'sword',level:9},refresh:true}).statusCode,409);assert.equal(f.state.merchantQueue.length,0);
});
// The items owner's merchantUpgradePreview and restoreUpgradePreviewSupplies (runtime/items/character/production.ts)
// on the items harness. bank.ts's waitForBankPack runs over the same character; the vault's lookup,
// withdrawal and return are planted. The game's chance reply answers each option and changes nothing.
function bankFixture({character:extra={}}={}) {
 const {productionHarness,bankHarness}=require('./helpers/items-character.cjs');
 const calls=[],state={waits:0,bank:null,reply:null};
 const items=[{name:'sword',level:8},{name:'scroll1',q:3},null,null,null],bank={items0:[{name:'offeringp',q:2},{name:'offeringx'},null]};
 const character={name:'M',ctype:'merchant',map:'main',items,bank,...extra};
 const vault={
  waitForBankPack:pack=>bankHarness({character,tick:()=>{state.waits++;if(state.bank)character.bank=state.bank;}}).bank.waitForBankPack(pack),
  findBankItem:w=>{const slot=bank.items0.findIndex(i=>i?.name===w.name);return slot>=0?{pack:'items0',slot}:null;},
  bankRetrieveConfirmed:async(pack,slot)=>{calls.push(['withdraw',bank[pack][slot].name]);items[items.indexOf(null)]=bank[pack][slot];bank[pack][slot]=null;},
  bankStageConfirmed:async(slot,pack,target)=>{calls.push(['return',items[slot].name]);bank[pack][target]=items[slot];items[slot]=null;},
 };
 const h=productionHarness({character,bank:vault,ports:{
  grade:()=>1,bankPacks:()=>({items0:['bank']}),job:()=>({commandId:7}),upgradeSettling:()=>false,
  move:async d=>{calls.push(['move',d]);character.map=d;},
  upgrade:async(slot,scroll,offering,calculate)=>{assert.equal(calculate,true);await state.reply;
   return {calculate:true,chance:0.15,item:{...items[slot]},scroll:items[scroll].name,...(offering==null?{}:{offering:items[offering].name})};},
  request:async path=>{calls.push([path]);return {};},
 }});
 const preview=()=>h.production.merchantUpgradePreview({id:7,jobId:'job',upgradePreview:{slot:0,item:{...items[0]}}});
 return {h,c:vault,character,items,bank,state,calls,preview,supplies:()=>h.stored['party-preview-supplies']};
}
test('bank supplies are borrowed without buying or consuming, then returned without touching owned scrolls',async()=>{
 const f=bankFixture(),before=JSON.stringify({items:f.items,bank:f.bank});
 await f.preview();assert.equal(f.calls.filter(c=>c[0]==='withdraw').length,2);
 assert.equal(JSON.stringify({items:f.items,bank:f.bank}),before);assert.equal(f.supplies(),null);
});
test('lost withdrawal acknowledgement keeps recovery journal and safely returns borrowed supplies',async()=>{
 const f=bankFixture(),withdraw=f.c.bankRetrieveConfirmed;
 f.c.bankRetrieveConfirmed=async(...args)=>{await withdraw(...args);throw Error('lost reply');};
 await f.preview();
 assert.equal(f.calls.filter(c=>c[0]==='withdraw').length,1);assert.equal(f.bank.items0[0].name,'offeringp');assert.equal(f.supplies(),null);
});
test('lost deposit acknowledgement is reconciled without another withdrawal or duplicate return',async()=>{
 const f=bankFixture(),deposit=f.c.bankStageConfirmed;
 f.c.bankStageConfirmed=async(...args)=>{await deposit(...args);throw Error('lost reply');};
 await assert.rejects(f.preview(),/lost reply/);f.c.bankStageConfirmed=deposit;
 await f.h.production.restoreUpgradePreviewSupplies();
 assert.equal(f.calls.filter(c=>c[0]==='withdraw').length,2);assert.equal(f.calls.filter(c=>c[0]==='return').length,2);assert.equal(f.supplies(),null);
});


test('preview job retains the upgrade guard until calculation settles and returns supplies before publishing',async()=>{
 const f=bankFixture();let finish;f.state.reply=new Promise(resolve=>{finish=resolve;});
 const job=f.preview();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.h.bag.facts().previewing,true);assert.equal(f.h.bag.facts().upgrading,true);
 const step=c=>c[0]==='move'?c[1]:c[0];
 assert.deepEqual(f.calls.map(step),['bank','withdraw','withdraw','newupgrade']);
 finish();await job;
 assert.equal(f.h.bag.facts().holder,null);
 assert.deepEqual(f.calls.map(step).slice(4),['bank','return','return','/upgrade-preview/result','/merchant/complete']);
});

test('only a real upgrade packet invalidates saved previews',()=>{
 const {productionHarness}=require('./helpers/items-character.cjs');
 // The items owner's observe handle (lifecycle `scope`) hands the listener to the test, not a socket.
 const game=globalThis.parent??={},before=game.__partyRunScope;let listener=null;
 game.__partyRunScope={scope:()=>({on:(socket,name,run)=>{assert.equal(name,'q_data');listener=run;}}),dispose(){}};
 try{
  const h=productionHarness({character:{name:'M',items:[]}});
  h.production.listen({});
  listener({calculate:true,chance:0.2});listener({q:{compound:{}}});assert.equal(h.stored['party-upgrade-preview-revision'],undefined);
  listener({q:{upgrade:{ms:100}}});assert.equal(h.stored['party-upgrade-preview-revision'],0);
 }finally{game.__partyRunScope=before;}
});


test('borrowing waits for bank data after arrival instead of reporting an empty bank',async()=>{
 const f=bankFixture({character:{bank:null}});f.state.bank=f.bank;
 await f.preview();assert.equal(f.state.waits,1);
 assert.equal(f.calls.filter(c=>c[0]==='withdraw').length,2);assert.equal(f.supplies(),null);
});

test('one calculated option is a partial preview, never an all-options success',()=>{
 const f=coordinator();f.send('',{...f.body,refresh:true});f.state.merchantCurrent={...f.state.merchantQueue.shift(),commandId:7};
 const result=unavailablePreview('M',f.item,'Offering missing');
 result.options.none={preview:{calculate:true,chance:0.15,item:f.item,scroll:'scroll1'},observedAt:1000};
 f.send('/result',{character:'M',id:f.state.merchantCurrent.id,commandId:7,session:'session',revision:'0',result});f.state.merchantCurrent=null;
 assert.equal(f.send('',f.body).value.status,'partial');assert.equal(f.send('',f.body).value.result.options.none.preview.chance,0.15);
});

// The open panel used to read the stored preview every 2 s, so a result showed up to 2 s after the
// merchant stored it and the panel read on every tick while nothing changed. It now reads when the
// core read's preview signal changes: the stored results, the preview job's start, a queued job, or
// the executor's bag.
test('the open preview panel reads on the store write and the job start, and not while nothing changes',async()=>{
 const {load,queryRoot}=require('./helpers/dashboard-query-module.cjs');
 const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const oldDocument=global.document;global.document={hidden:false,addEventListener(){},removeEventListener(){}};
 const reads=[],answer={status:'queued'};
 const {UpgradePreviewPanel}=load('upgrade-preview-panel.tsx',{'@/components/ui/*':new Proxy({},{get:(_,name)=>String(name)}),
  './query-actions':{performAction:async(_client,path,body)=>{reads.push(body.refresh);return answer;}},
  './upgrade-offering-controls':{useUpgradeOfferings:()=>({character:'M',executor:'M'})}});
 const {key}=load('query-cache.tsx'),{characterKey}=load('character-cache.ts');
 const {client,wrap}=queryRoot(),settle=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
 const core=fields=>client.setQueryData(key('core'),{merchantCurrent:null,merchantQueue:[],upgradePreviewResults:{},...fields});
 try {
  core({merchantQueue:[{id:'p1',reason:'upgrade preview'}]});
  let tree;await act(async()=>{tree=create(wrap(React.createElement(UpgradePreviewPanel,{item:{name:'sword',level:8},source:{slot:0}})));});
  await settle();assert.deepEqual(reads,[false]);
  core({merchantQueue:[{id:'p1',reason:'upgrade preview'}],gold:5});await settle();
  assert.deepEqual(reads,[false],'a core read that changes nothing the preview reads');
  core({merchantCurrent:{id:'p1',reason:'upgrade preview'}});await settle();
  assert.deepEqual(reads,[false,false],'the preview job starts');
  core({merchantCurrent:{id:'p1',reason:'upgrade preview'},upgradePreviewResults:{k:{at:1}}});await settle();
  assert.deepEqual(reads,[false,false,false],'the estimate writes its result to the store');
  await act(async()=>client.setQueryData(characterKey('M','inventory'),{items:[]}));await settle();
  assert.equal(reads.length,4,'the executor bag changes');
  await act(async()=>tree.unmount());
 } finally { global.document=oldDocument; }
});
