const test=require('node:test');
const assert=require('node:assert/strict');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
test('pending command projection preserves empty entries and excludes absent values from JSON',()=>{
 const {pendingCommands}=require('../../runtime/coordinator/telemetry/public-state-characters.ts');
 const command={id:7,type:'travel',privateValue:'keep private'},state={missing:undefined,empty:null,P:command};
 const output=pendingCommands(state);
 assert.equal(Object.hasOwn(output,'missing'),true);assert.equal(output.missing,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),{empty:null,P:{id:7,type:'travel',phase:null,convoyId:null}});
 assert.equal(state.P,command);assert.equal(command.privateValue,'keep private');
});
// The bank, logs and market sections send serialized text with an ETag (telemetry/section-revision.ts).
function read(r,query){let result;const response={json:value=>{result=value;},set:()=>response,status:()=>response,send:body=>{result=JSON.parse(body);}};
 r.route({query},response);return JSON.parse(JSON.stringify(result));}

test('dashboard config and core partition settings without slowing live progress or changing legacy core', () => {
 const r=publicStateRuntime();
 const core=read(r,{section:'core',dashboard:'1'}), config=read(r,{section:'config',dashboard:'1'});
 for(const field of ['threshold','marked','monsterFocus','huntSettings','merchantRules']) {
  assert.equal(Object.hasOwn(core,field),false,field);
  assert.deepEqual(config[field],r.party[field]);
 }
 for(const field of ['monsterHunt','activeConvoy','anniversary','activeSlots','gameVersion','clientUpdate','nativeStand','partyFarmingMode']) {
  assert.ok(Object.hasOwn(core,field),field);
  assert.equal(Object.hasOwn(config,field),false,field);
 }
 assert.deepEqual(read(r,{section:'core'}).threshold,r.party.threshold);
 assert.deepEqual(read(r,{}).marked,r.party.marked);
 for(const field of Object.keys(config)) assert.equal(Object.hasOwn(core,field),false,field);
});

test('fresh headless telemetry supersedes a lost Steam observation after handoff',()=>{
 const r=publicStateRuntime();
 require('../../runtime/roster/connection-status.ts').recordConnections(r.party,
  [{name:'P',primary:false,state:'waiting'}],r.ports.now()-30000);
 r.party.statuses.P.runtime='headless';
 for(const query of [{},{section:'core',dashboard:'1'}]) {
  const connection=read(r,query).characterConnections[0];
  assert.equal(connection.status,'connected');
  assert.equal(connection.delayed,false);
 }
 r.party.statuses.P.seenAt=r.ports.now()-5000;
 assert.equal(read(r,{}).characterConnections[0].status,'lost');
 r.party.statuses.P.runtime='native';
 r.party.statuses.P.seenAt=r.ports.now();
 assert.equal(read(r,{}).characterConnections[0].status,'connected');
});

test('inventory presentation trims metadata without mutating the live inventory',()=>{
 const r=publicStateRuntime(),before=JSON.stringify(r.party.statuses.P.items);
 const value=read(r,{section:'inventory'});assert.equal(value.characters.P.items[0].meta.unneeded,undefined);
 assert.equal(value.characters.P.items[0].meta.sprite,'sprite');assert.equal(JSON.stringify(r.party.statuses.P.items),before);
 const full=read(r,{});assert.equal(full.characters.P.items[0].meta.unneeded,'omit-me');
});

// Failure inventory for per-copy reports: (1) the inventory section, the bank
// section or the debug state loses a definition the report left to the
// catalog; (2) the bank section still carries world data; (3) the catalog's
// value replaces a per-copy field; (4) a report from a client that still
// sends full meta changes shape; (5) presentation mutates stored reports.
test('sections join per-type catalog meta onto per-copy report meta',()=>{
 const r=publicStateRuntime();
 const known={definition:{name:'Coat',type:'chest'},upgradeable:true,compoundable:false,buyable:true,scaling:{armor:1},
  maxLevel:12,usage:{classes:[],hands:[]},world:{drops:[{monsterId:'bee'}]},sprite:{x:1}};
 r.party.merchantCatalog={allItems:[{id:'coat',meta:known}]};
 r.party.statuses.P.items=[{slot:0,item:{name:'coat',level:3},meta:{properties:{armor:13}}},
  {slot:1,item:{name:'coat',level:0},meta:{...known,properties:{armor:10},sprite:{x:9}}},null];
 r.party.bankSnapshot={gold:5,packs:{items0:[{slot:0,item:{name:'coat',level:1},meta:{properties:{armor:11}}},null]}};
 const before=JSON.stringify([r.party.statuses.P.items,r.party.bankSnapshot]);
 const inventory=read(r,{section:'inventory'}).characters.P.items;
 assert.deepEqual(inventory[0].meta,{definition:known.definition,upgradeable:true,compoundable:false,buyable:true,
  properties:{armor:13},scaling:{armor:1},maxLevel:12,sprite:{x:1}});
 assert.equal(inventory[1].meta.sprite.x,9);assert.equal(inventory[1].meta.properties.armor,10);assert.equal(inventory[2],null);
 const bank=read(r,{section:'bank',dashboard:'1'}).bank.packs.items0;
 assert.equal(bank[0].meta.definition.name,'Coat');assert.equal(bank[0].meta.properties.armor,11);
 assert.equal(bank[0].meta.world,undefined);assert.equal(bank[0].meta.usage,undefined);assert.equal(bank[1],null);
 const full=read(r,{});
 assert.deepEqual(full.characters.P.items[0].meta.world,known.world);assert.equal(full.characters.P.items[0].meta.properties.armor,13);
 assert.deepEqual(full.bank.packs.items0[0].meta.usage,known.usage);
 assert.equal(JSON.stringify([r.party.statuses.P.items,r.party.bankSnapshot]),before);
});

test('overview does not expose unlisted private state',()=>{
 const r=publicStateRuntime();r.party.sessionToken='never expose';r.party.worker={pid:123};
 const value=read(r,{});assert.equal(value.sessionToken,undefined);assert.equal(value.worker,undefined);
 assert.deepEqual(value.giveawayPlayers.SR_USII,['Alice','Bob','Trader']);assert.equal(value.characters.P.name,'P');
});

// C5 failure modes (docs/efficiency.md § Requests and logs): a mistyped or
// prototype section name answers with the full payload; a request without a
// section stops getting the full payload; a known section changes shape.
function respond(r,query){
 const result={status:200,body:undefined};
 const response={status(code){result.status=code;return response;},json(value){result.body=JSON.parse(JSON.stringify(value));return response;},
  send(text){result.body=JSON.parse(text);return response;},set(){return response;},end(){return response;}};
 r.route({query},response);return result;
}
test('unknown sections answer 400 without building a payload; no section keeps the full payload',()=>{
 const r=publicStateRuntime();r.party.sessionToken='never expose';
 for(const section of ['mail','Bank','constructor','__proto__','toString','hasOwnProperty']){
  const answer=respond(r,{section});
  assert.equal(answer.status,400,section);
  assert.equal(answer.body.characters,undefined,section);assert.equal(answer.body.sessionToken,undefined,section);
  assert.match(answer.body.error,/Unknown state section/,section);
  assert.ok(answer.body.sections.includes('bank'),section);
 }
 for(const query of [{},{section:''},{catalog:'0'}]){
  const answer=respond(r,query);
  assert.equal(answer.status,200);assert.equal(answer.body.characters.P.name,'P');
 }
 for(const section of ['fast','inventory','logs','bank','market','catalog','config','core'])
  assert.equal(respond(r,{section,dashboard:'1'}).status,200,section);
});
