const test=require('node:test'),assert=require('node:assert/strict');
const {createCharacterCreation}=require('../../runtime/coordinator/characters/creation.ts');
const {createCharacterCreationRoutes}=require('../../runtime/coordinator/http/character-creation.ts');
test('accepted account snapshot retains the original roster and metadata identities',async()=>{
 const character={name:'Mage',type:'mage'},snapshot={type:'servers_and_characters',characters:[character],servers:[{name:'II'}]};
 let adopted;
 const service=createCharacterCreation({request:async()=>({ok:true,statusText:'OK',payload:[snapshot]}),
  adopt:value=>{adopted=value;},owned:()=>adopted?.characters[0],refresh:async()=>assert.fail('already confirmed'),delay:async()=>{}});
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
  delay:async()=>assert.fail('first refresh must not wait'),
 });
 const result=await service.create('Mage','mage',0);
 assert.equal(result.accepted,true);assert.equal(result.confirmed,owned);
 assert.deepEqual(calls,['owned','refresh','owned','owned']);
});
function fixture(){
 const names=new Set(),calls=[],delays=[];
 const ports={request:async(name,ctype,look)=>{calls.push({name,ctype,look});return {ok:true,statusText:'OK',payload:[{type:'servers_and_characters',characters:[{name}]}]};},
  adopt:snapshot=>snapshot.characters.forEach(c=>names.add(c.name)),owned:name=>names.has(name),refresh:async()=>{},delay:async ms=>delays.push(ms)};
 return {names,calls,delays,ports,service:()=>createCharacterCreation(ports)};
}
test('creation trusts returned roster snapshot before requesting potentially stale account data',async()=>{
 const t=fixture();let refreshes=0;t.ports.refresh=async()=>refreshes++;
 assert.equal((await t.service().create('NewMage','mage',2)).confirmed,true);
 assert.equal(refreshes,0);assert.deepEqual(t.calls,[{name:'NewMage',ctype:'mage',look:2}]);
});
test('accepted but unconfirmed BankBoi creation stops after bounded refreshes without creating another character',async()=>{
 const t=fixture();let calls=0,refreshes=0;t.ports.request=async()=>{calls++;return {ok:true,payload:{},statusText:'OK'};};t.ports.refresh=async()=>refreshes++;
 await assert.rejects(t.service().bankboi("bankboi"),/No additional name was attempted/);
 assert.equal(calls,1);assert.equal(refreshes,5);assert.deepEqual(t.delays,[500,500,500,500]);
});
test('BankBoi retries occupied names but stops on non-name failures',async()=>{
 const t=fixture(),request=t.ports.request;let calls=0;t.ports.request=async(...args)=>++calls===1?{ok:true,payload:[{type:'ui_error',reason:'name used'}]}:request(...args);
 assert.equal(await t.service().bankboi("bankboi"),'bankboi1');
 t.ports.request=async()=>({ok:false,payload:{result:{failed:true,reason:'not authorized'}},statusText:'Forbidden'});
 await assert.rejects(t.service().bankboi("bankboi"),/not authorized/);
});
test('creation endpoints refuse paid slots and deduplicate simultaneous BankBoi requests',async()=>{
 const t=fixture(),state={bankboiPrefix:"bankboi",headlessSlots:[null],bankbois:{}};let count=8,release;
 Object.assign(t.ports,{now:()=>100,classes:['mage'],includedSlots:8,characterCount:()=>count,assign(){},persistBank(){},serviceBank(){},log(){}});
 const routes=createCharacterCreationRoutes(state,t.ports);
 const res=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 let r=res();await routes.roster({body:{name:'NewMage',class:'mage'}},r);assert.equal(r.code,409);assert.equal(t.calls.length,0);
 r=res();await routes.bankboi({},r);assert.equal(r.code,409);
 count=0;const request=t.ports.request;t.ports.request=(...args)=>new Promise(resolve=>{release=()=>resolve(request(...args));});
 const first=routes.bankboi({},res());r=res();await routes.bankboi({},r);assert.equal(r.code,409);
 release();await first;assert.equal(state.bankbois.bankboi0.state,'provisioning');
});

test('bankboi creation requires a saved prefix and uses numbered custom names',async()=>{
 const t=fixture(),state={headlessSlots:[],bankbois:{}};
 Object.assign(t.ports,{now:()=>100,classes:['merchant'],includedSlots:8,characterCount:()=>0,assign(){},persistBank(){},serviceBank(){},log(){}});
 const routes=createCharacterCreationRoutes(state,t.ports),res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await routes.bankboi({},res);assert.equal(res.code,400);assert.equal(t.calls.length,0);
 assert.equal(await t.service().bankboi('MyBank'),'MyBank0');
});
