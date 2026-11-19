const test=require('node:test'),assert=require('node:assert/strict');
// The fixture's members report every 500 ms; each wait ends at the next report or its bound.
const REPORT_MS=500;
const {createCoordinatorRealmActions}=require('../../runtime/merchant-realm/coordinator/routes.ts');
function fixture(){
 const state={commands:{F:{type:'old'},M:{type:'old'}},steamMembers:['F'],nextCommandId:80,
  statuses:{F:{seenAt:100000,server:'USII',ctype:'priest'},M:{seenAt:100000,server:'USII',ctype:'merchant'}},
  activeRealm:'SR_USII',leader:'F',realmSwitch:null,bankboiTransaction:null,merchantCharacter:null,merchantCurrent:null,merchantQueue:[]};
 const calls=[],block={enabled:true,realm:'SR_USII'};let home='SR_USII';
 const routes=createCoordinatorRealmActions(state,{
  now:()=>100000,nextReport:async bound=>{const ms=Math.min(REPORT_MS,bound);await new Promise(resolve=>setImmediate(resolve));calls.push(['report',ms]);state.statuses={F:{seenAt:100000,server:'EUI',ctype:'priest'},M:{seenAt:100000,server:'EUI',ctype:'merchant'}};},
  stamp:job=>job,realm:{want:()=>'moving',release(){}},groups:()=>[],endWalk(){},native:()=> 'F',block:name=>{assert.equal(name,'M');return block;},
  stop:async worker=>{assert.equal(worker,block);calls.push(['stop',worker.realm]);},persist:()=>calls.push('persist'),label:realm=>realm,
  dispatch:()=>calls.push('dispatch'),resolve:realm=>realm==='SR_EUI',bankBusy:()=>false,participants:()=>['F','M'],current:()=>state.activeRealm,
  start:()=>true,
  // The lifecycle owner's roster and account: the party switch builds the homes, the roster and the refresh from
  // them.
  roster:{owned:()=>({home}),homeRealm:()=>home},
  account:{response:{characters:[{name:'F',online:true},{name:'M',online:true}]},updateInfo:async()=>{calls.push('refresh');if(Object.values(state.commands).some(command=>command.type==='realm-set-home'))home='SR_EUI';}},
 });
 async function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body},res);return res;}
 async function settled(){for(let i=0;i<30&&state.realmSwitch.phase==='switching';i++)await new Promise(resolve=>setImmediate(resolve));assert.notEqual(state.realmSwitch.phase,'switching');}
 return {state,calls,routes,invoke,settled};
}

// Each phase of 3.10.1 sends `realm.switch.phase` once.
test('home-realm changes wait for the HTTP acknowledgement before dispatching the merchant',async ctx=>{
 // The row listens on a registry of its own; the process-wide one comes back when the row ends.
 const had=Object.getOwnPropertyDescriptor(globalThis,'__partyHooks');delete globalThis.__partyHooks;
 ctx.after(()=>{if(had)Object.defineProperty(globalThis,'__partyHooks',had);else delete globalThis.__partyHooks;});
 const {partyHooks}=require('../../runtime/hooks/index.ts'),phases=[];
 partyHooks().register({name:'core:switch-phase-fixture',folder:'core',author:'test',summary:'Hears the switch phases.',
  hooks:{'realm.switch.phase':payload=>phases.push(payload.code)}});
 const t=fixture();await t.invoke(t.routes.switchRealm,{realm:'SR_EUI',setHome:true});await t.settled();
 assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.commands.F.type,'realm-set-home');assert.equal(t.state.commands.F.id,81);
 assert.equal(t.calls.includes('dispatch'),false);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'F',operationId:'wrong',success:true})).code,409);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'F',operationId:t.state.realmSwitch.id,success:true})).code,200);
 assert.equal(t.state.realmSwitch.phase,'setting-home');assert.equal(t.state.commands.F,undefined);
 assert.equal((await t.invoke(t.routes.homeComplete,{character:'M',operationId:t.state.realmSwitch.id,success:true})).code,200);
 for(let i=0;i<30&&t.state.realmSwitch.phase!=='complete';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.state.realmSwitch.phase,'complete');
 assert.equal(t.calls.at(-1),'dispatch');
 assert.deepEqual(phases,['switching','setting-home','complete']);
});
// protocol/realm.ts parses every realm id; the market, the roster, the Steam bridge and the
// merchant routes read it.
test('realm.ts parses a realm id, a bare server name and a typed realm', () => {
  const { realmParts, isRealm, typedRealm, realmLabel } = require('../../runtime/protocol/realm.ts');
  assert.deepEqual([realmParts('SR_USII'), realmParts('ASIAI'), realmParts('SR_EUPVP')],
    [{ region: 'US', identifier: 'II' }, { region: 'ASIA', identifier: 'I' }, { region: 'EU', identifier: 'PVP' }]);
  assert.equal(realmParts('SR_XXII'), null);
  assert.deepEqual([isRealm('SR_USII'), isRealm('USII'), isRealm(7)], [true, false, false]);
  assert.deepEqual([typedRealm('us ii'), typedRealm('SRUSII'), typedRealm('SR_EUI'), typedRealm(3)], ['SR_USII', 'SR_USII', 'SR_EUI', '']);
  assert.equal(realmLabel('SR_USII'), 'US II');
});
