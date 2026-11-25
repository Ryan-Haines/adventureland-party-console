const test=require('node:test'),assert=require('node:assert/strict');
const {createCharacterCreation}=require('../../runtime/items/coordinator/storage.ts');
const {createCharacterCreationRoutes}=require('../../runtime/items/coordinator/routes/characters.ts');
test('accepted account snapshot retains the original roster and metadata identities',async()=>{
 const character={name:'Mage',type:'mage'},snapshot={type:'servers_and_characters',characters:[character],servers:[{name:'II'}]};
 let adopted;
 const service=createCharacterCreation({request:async()=>({ok:true,statusText:'OK',payload:[snapshot]}),
  adopt:value=>{adopted=value;},owned:()=>adopted?.characters[0],refresh:async()=>assert.fail('already confirmed')});
 assert.equal((await service.create('Mage','mage',0)).confirmed,character);
 assert.equal(adopted,snapshot);assert.equal(adopted.characters,snapshot.characters);assert.equal(adopted.servers,snapshot.servers);
});
test('creation preserves roster-object confirmation and ignores account-refresh payload',async()=>{
 const owned={name:'Mage',type:'mage'},calls=[];let available=false;
 const service=createCharacterCreation({
  request:async()=>({ok:true,statusText:'OK',payload:{}}),
  adopt:()=>assert.fail('no snapshot to adopt'),
  owned:()=>{calls.push('owned');return available?owned:undefined;},
  refresh:async()=>{calls.push('refresh');available=true;return {characters:[owned]};},
 });
 const result=await service.create('Mage','mage',0);
 assert.equal(result.accepted,true);assert.equal(result.confirmed,owned);
 assert.deepEqual(calls,['owned','refresh','owned']);
});
function fixture(){
 const names=new Set(),calls=[];
 const ports={request:async(name,ctype,look)=>{calls.push({name,ctype,look});return {ok:true,statusText:'OK',payload:[{type:'servers_and_characters',characters:[{name}]}]};},
  adopt:snapshot=>snapshot.characters.forEach(c=>names.add(c.name)),owned:name=>names.has(name),refresh:async()=>{}};
 // The creation routes over `state` with these ports, offering `classes`; `count` answers the
 // account's character count.
 const routes=(state,classes,count=()=>0)=>{
  Object.assign(ports,{now:()=>100,classes,includedSlots:8,characterCount:count,assign(){},persistBank(){},serviceBank(){},log(){}});
  return createCharacterCreationRoutes(state,ports);
 };
 return {names,calls,ports,routes,service:()=>createCharacterCreation(ports)};
}
const res=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('creation trusts returned roster snapshot before requesting potentially stale account data',async()=>{
 const t=fixture();let refreshes=0;t.ports.refresh=async()=>refreshes++;
 assert.equal((await t.service().create('NewMage','mage',2)).confirmed,true);
 assert.equal(refreshes,0);assert.deepEqual(t.calls,[{name:'NewMage',ctype:'mage',look:2}]);
});
test('accepted but unconfirmed BankBoi creation stops after one account refresh (G52) without creating another character',async()=>{
 const t=fixture();let calls=0,refreshes=0;t.ports.request=async()=>{calls++;return {ok:true,payload:{},statusText:'OK'};};t.ports.refresh=async()=>refreshes++;
 await assert.rejects(t.service().bankboi("bankboi"),/No additional name was attempted/);
 assert.equal(calls,1);assert.equal(refreshes,1);
});
test('BankBoi retries occupied names but stops on non-name failures',async()=>{
 const t=fixture(),request=t.ports.request;let calls=0;t.ports.request=async(...args)=>++calls===1?{ok:true,payload:[{type:'ui_error',reason:'name used'}]}:request(...args);
 assert.equal(await t.service().bankboi("bankboi"),'bankboi1');
 t.ports.request=async()=>({ok:false,payload:{result:{failed:true,reason:'not authorized'}},statusText:'Forbidden'});
 await assert.rejects(t.service().bankboi("bankboi"),/not authorized/);
});
test('creation endpoints refuse paid slots and deduplicate simultaneous BankBoi requests',async()=>{
 const t=fixture(),state={bankboiPrefix:"bankboi",headlessSlots:[null],bankbois:{}};let count=8,release;
 const routes=t.routes(state,['mage'],()=>count);
 let r=res();await routes.roster({body:{name:'NewMage',class:'mage'}},r);assert.equal(r.code,409);assert.equal(t.calls.length,0);
 r=res();await routes.bankboi({},r);assert.equal(r.code,409);
 count=0;const request=t.ports.request;t.ports.request=(...args)=>new Promise(resolve=>{release=()=>resolve(request(...args));});
 const first=routes.bankboi({},res());r=res();await routes.bankboi({},r);assert.equal(r.code,409);
 release();await first;assert.equal(state.bankbois.bankboi0.state,'provisioning');
});

test('bankboi creation requires a saved prefix and uses numbered custom names',async()=>{
 const t=fixture(),state={headlessSlots:[],bankbois:{}};
 const routes=t.routes(state,['merchant']),r=res();
 await routes.bankboi({},r);assert.equal(r.code,400);assert.equal(t.calls.length,0);
 assert.equal(await t.service().bankboi('MyBank'),'MyBank0');
});
// B161: the BankBoi name search walks every name the game's 12-character rule allows.
// b9b5c91e creation.ts:77 gave up after 10,000 names, so an account holding Bankboi0 to Bankboi9999
// got "no available Bankboi name" while Bankboi10000 was free.
test('B161: the BankBoi name search goes past 10,000 taken names',async()=>{
 // b9b5c91e's cap: ten to the fourth names.
 const taken=10**4,names=new Set(Array.from({length:taken},(_,number)=>'Bankboi'+number)),asked=[];
 const service=createCharacterCreation({request:async name=>{asked.push(name);return {ok:true,statusText:'OK',payload:[{type:'servers_and_characters',characters:[{name}]}]};},
  adopt:snapshot=>snapshot.characters.forEach(c=>names.add(c.name)),owned:name=>names.has(name),refresh:async()=>{}});
 assert.equal(await service.bankboi('Bankboi'),'Bankboi'+taken);
 assert.deepEqual(asked,['Bankboi'+taken]);
});

// The account refresh (caracal's `updateInfo`) sends its request with no bound of its own, so a reply
// the network lost held a creation or a deletion open. It ends at the account API's kept bound,
// `mailRequestBoundMs`, which every other account call already holds, and tells the status owner's bound record.
// Isolated: a live row cannot drop the account API's reply.
test('an account refresh whose reply never comes ends at the account bound and reports it',async()=>{
 const {accountRefresh}=require('../../runtime/items/coordinator/storage.ts');
 const {boundFirings}=require('../../runtime/status/coordinator/bounds.ts');
 const fired=()=>boundFirings().counts.mailRequestBoundMs||0,before=fired();
 let ended;const later=(action,ms)=>{ended=ms;setImmediate(action);};
 await assert.rejects(accountRefresh(()=>new Promise(()=>{}),later),/did not answer/);
 assert.ok(ended>0);assert.equal(fired(),before+1,'the lost reply did not tell the bound record');
 assert.equal(await accountRefresh(async()=>'roster',later),'roster');
 await new Promise(setImmediate);
 assert.equal(fired(),before+1,'an answered refresh fired the bound');
});
