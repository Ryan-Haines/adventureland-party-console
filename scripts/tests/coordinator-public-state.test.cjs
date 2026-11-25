const test=require('node:test');
const assert=require('node:assert/strict');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
const {testRegistry}=require('./helpers/test-registry.cjs');
// The items owner's bank and stock reads on the test's own registry (items/coordinator/owner.ts
// answers them in the coordinator): the bank is the state's snapshot, and the merchant's bag
// counts nothing.
function itemsReads(t,r){
 assert.equal(testRegistry(t).register({name:'core:items',folder:'core',author:'test',summary:'planted 10 reads',
  hooks:{'items.bank':()=>r.party.bankSnapshot,'items.stock':()=>0}}).ok,true);
 return r;
}
test('pending command projection preserves empty entries and excludes absent values from JSON',()=>{
 const {pendingCommands}=require('../../runtime/status/coordinator/state.ts');
 const command={id:7,type:'travel',privateValue:'keep private'},state={missing:undefined,empty:null,P:command};
 const output=pendingCommands(state);
 assert.equal(Object.hasOwn(output,'missing'),true);assert.equal(output.missing,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),{empty:null,P:{id:7,type:'travel',phase:null,convoyId:null}});
 assert.equal(state.P,command);assert.equal(command.privateValue,'keep private');
});
// The bank, logs and market sections send serialized text with an ETag (runtime/status/coordinator/state.ts, table S).
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

// The card line is derived state; a read hands it out in each section's own copy.
test('a state read hands out the card line and stores none',()=>{
 const r=publicStateRuntime();r.ports.activity=name=>({text:'Idle '+name});r.party.merchantCharacter=null;
 assert.equal(read(r,{section:'core',dashboard:'1'}).characterDetails.P.activity.text,'Idle P');
 assert.equal(read(r,{section:'fast'}).characters.P.activity.text,'Idle P');
 assert.equal(read(r,{}).characters.P.activity.text,'Idle P');
 assert.equal(Object.hasOwn(r.party.statuses.P,'activity'),false);
});

// The account's gold counts an offline slot's last gold apart, leaves bank storage
// characters out, and an unknown balance leaves the totals unknown. It carries v1.5.0's
// gold row: a member in two slots counts
// once, and zero balances stay known.
test('account gold marks the offline share, excludes bankbois and answers null when a balance is unknown',()=>{
 const r=publicStateRuntime();
 r.party.bankSnapshot={gold:1000,packs:{}};
 Object.assign(r.party.statuses,{B:{name:'B',gold:7}});r.party.statuses.P.gold=100;r.party.statuses.Q.gold=50;
 r.ports.slots=()=>[{character:'P',state:'online'},{character:'Q',state:'offline'},{character:'B',state:'online'},{state:'empty'}];
 assert.deepEqual(read(r,{section:'core',dashboard:'1'}).accountGold,{carried:150,offline:50,total:1150});
 r.ports.slots=()=>[{character:'P',state:'online'},{character:'P',state:'online'},{character:'Q',state:'offline'}];
 assert.deepEqual(read(r,{section:'core',dashboard:'1'}).accountGold,{carried:150,offline:50,total:1150});
 delete r.party.statuses.Q.gold;
 assert.deepEqual(read(r,{section:'core',dashboard:'1'}).accountGold,{carried:null,offline:null,total:null});
 r.party.bankSnapshot={gold:0,packs:{}};r.party.statuses.P.gold=0;r.party.statuses.Q.gold=0;
 assert.deepEqual(read(r,{section:'core',dashboard:'1'}).accountGold,{carried:0,offline:0,total:0});
});

// The giveaway list counts a character by the one presence rule `online`, so it
// agrees with the card at the presence age itself, and holds every merchant of the latest ALData
// snapshot whatever its lastSeen.
test('the giveaway list reads online for characters and every merchant of the latest snapshot',()=>{
 const {ageOf}=require('../../runtime/protocol/reports.ts');
 const r=publicStateRuntime(),now=r.ports.now();
 r.party.statuses.P.seenAt=now-ageOf('presence');r.party.statuses.Q.seenAt=now;
 const players=read(r,{section:'core',dashboard:'1'}).giveawayPlayers.SR_USII;
 assert.equal(players.includes('Alice'),false,'a report at the presence age is offline');
 assert.ok(players.includes('Stale'),'a fresh report is in');
 assert.ok(players.includes('Trader')&&players.includes('OldTrader'),'every merchant of the snapshot is in');
});

test('fresh headless telemetry supersedes a lost Steam observation after handoff',()=>{
 const r=publicStateRuntime();
 require('../../runtime/lifecycle/roster/connection-status.ts').recordConnections(r.party,
  [{name:'P',primary:false,state:'waiting'}],r.ports.now()-30000);
 r.party.statuses.P.runtime='headless';
 for(const query of [{},{section:'core',dashboard:'1'}]) {
  const connection=read(r,query).characterConnections[0];
  assert.equal(connection.status,'connected');
  assert.equal(connection.delayed,false);
 }
 const {ageOf}=require('../../runtime/protocol/reports.ts');
 r.party.statuses.P.seenAt=r.ports.now()-ageOf('presence')+1;
 assert.equal(read(r,{}).characterConnections[0].status,'connected');
 r.party.statuses.P.seenAt=r.ports.now()-ageOf('presence');
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
test('sections join per-type catalog meta onto per-copy report meta',t=>{
 const r=itemsReads(t,publicStateRuntime());
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
 assert.deepEqual(value.giveawayPlayers.SR_USII,['Alice','Bob','OldTrader','Trader']);assert.equal(value.characters.P.name,'P');
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
test('unknown sections answer 400 without building a payload; no section keeps the full payload',t=>{
 const r=itemsReads(t,publicStateRuntime());r.party.sessionToken='never expose';
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

// Every interface v1 field answers until release removes it; the config's per-scope fields are
// rows of runtime/status/rules.ts `INTERFACE_VERSIONS`.: the apps read a scope's Hunt cycle and farm
// area from config, though core's farmingLive carries them too.
test('the interface v1 fields still answer', () => {
 const {INTERFACE_VERSIONS}=require('../../runtime/status/rules.ts');
 const r=publicStateRuntime();
 r.party.farmingProfiles={party:{farmingPolicy:'farming',monsterHunt:{target:'bee'},farmAreaState:{map:'main'}}};
 const config=read(r,{section:'config',dashboard:'1'});
 const rows=INTERFACE_VERSIONS.filter(row=>row.at==='GET /party-api/state?sections=config');
 for(const row of rows){
  const field=row.field.split('.').at(-1);
  assert.equal(row.version,'v1');
  assert.deepEqual(config.farmingProfiles.party[field],r.party.farmingProfiles.party[field],field);
 }
 assert.deepEqual(rows.map(row=>row.field.split('.').at(-1)),['farmingPolicy','monsterHunt','farmAreaState']);
});
// The Hunt line rides core, so a coordinator-side Hunt change shows on the next core read with
// no config read between.
test('a coordinator-side Hunt change shows on the next core read', () => {
 const r=publicStateRuntime();
 const before=read(r,{section:'core',dashboard:'1'});
 r.party.monsterHunt={...(r.party.monsterHunt||{}),target:'bee',stage:'hunting',dashboardRow:'DF12'};
 const after=read(r,{section:'core',dashboard:'1'});
 assert.notDeepEqual(after.monsterHunt,before.monsterHunt);
 assert.equal(after.monsterHunt.dashboardRow,'DF12');
});

// Live WTB's "You have" counts a copy held only in the bank, from the items owner's `items.bank()`,
// and the merchant's bag up to the items owner's `items.stock`, keyed by `ownedStockKey`.
test('the bank section counts a copy held only in the bank', t => {
 const {ownedStockKey}=require('../../runtime/items/identity.ts');
 const r=itemsReads(t,publicStateRuntime());
 r.party.bankSnapshot={packs:{items0:[{item:{name:'wbook0',level:0,q:1}},{item:{name:'hpot0',q:200}}]}};
 const section=read(r,{section:'bank',dashboard:'1'});
 assert.equal(section.ownedStock[ownedStockKey({name:'wbook0',level:0})].count,1);
 assert.equal(section.ownedStock[ownedStockKey({name:'hpot0'})].count,200);
 // Each key carries the cells it counted, so the stand sheet offers that bank copy.
 assert.deepEqual(section.ownedStock[ownedStockKey({name:'wbook0',level:0})].sources,[{entry:{item:{name:'wbook0',level:0,q:1}},bankPack:'items0'}]);
});
