const test=require('node:test');
const assert=require('node:assert/strict');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
const {appendGameLogs}=require('../../runtime/coordinator/telemetry/game-logs.ts');

// C3 failure modes (docs/efficiency.md § Requests and logs):
// 1. an unchanged bank, logs or market section resends its whole body on every poll;
// 2. the revision stays the same although a field the section carries changed,
//    so the dashboard keeps showing old bank contents, jobs, logs or prices;
// 3. a client that sends no revision (PWA, APK, metrics) gets anything but the full body;
// 4. a stale or malformed revision answers 304;
// 5. sections outside bank, logs and market start answering 304.
function respond(r,query,headers={}){
 const result={status:200,headers:{},body:undefined,sent:undefined};
 const response={status(code){result.status=code;return response;},set(name,value){result.headers[name.toLowerCase()]=value;return response;},
  json(value){result.body=JSON.parse(JSON.stringify(value));return response;},send(text){result.sent=text;result.body=JSON.parse(text);return response;},end(){return response;}};
 r.route({query,get:name=>headers[name.toLowerCase()]},response);return result;
}
const revisionOf=answer=>answer.headers.etag.replace(/^"|"$/g,'');
const sections={
 // Bank observation replaces the snapshot object (status/storage-composition.ts), and
 // telemetry/item-meta-projection.ts caches the compact bank projection per snapshot object.
 bank:[r=>{const bank=r.party.bankSnapshot;r.party.bankSnapshot={...bank,packs:{...bank.packs,items0:[...bank.packs.items0,{slot:0,item:{name:'coat'}}]}};},r=>{r.party.bankVaults.push({pack:'items1'});},
  r=>{r.party.bankCurrent={id:'job'};},r=>{r.party.bankQueue=[{id:'next'}];},r=>{r.ports.bankbois=()=>[{name:'B',gold:5}];}],
 logs:[r=>{r.party.combatLogs={P:[{at:1}]};},r=>{r.party.merchantActivity=[{at:2}];},
  r=>{appendGameLogs({body:{character:'P',events:[{session:'s',seq:Date.now(),message:'P killed a Goo',color:'gray'}]}},{json(){}},()=>true);}],
 market:[r=>{r.party.ponty={listings:[{name:'coat'}]};},r=>{r.party.standPriceHistory={coat:[1]};},
  r=>{r.ports.aldata=()=>({hasKey:true,listings:[{id:'new'}]});}],
};

for(const [section,mutations] of Object.entries(sections)) test(`${section}: unchanged polls answer 304 and every carried field changes the revision`,()=>{
 const r=publicStateRuntime(),query={section,dashboard:'1',catalog:'0'};
 const first=respond(r,query);
 assert.equal(first.status,200);assert.ok(first.sent,'the body is serialized once and sent as text');
 const revision=revisionOf(first);
 assert.match(revision,/^[A-Za-z0-9_-]{20,}$/);
 const again=respond(r,{...query,revision});
 assert.equal(again.status,304);assert.equal(again.body,undefined);assert.equal(revisionOf(again),revision);
 assert.equal(respond(r,query,{'if-none-match':`"${revision}"`}).status,304,'If-None-Match is honored too');
 let previous=revision;
 for(const mutate of mutations){
  mutate(r);
  const changed=respond(r,{...query,revision:previous});
  assert.equal(changed.status,200,mutate.toString());
  assert.notEqual(revisionOf(changed),previous,mutate.toString());
  previous=revisionOf(changed);
 }
});

test('clients without a revision get the same full body as before',()=>{
 const r=publicStateRuntime();
 for(const section of Object.keys(sections)){
  const query={section,dashboard:'1',catalog:'0'};
  // The v1.4.0 bodies, field for field.
  const p=r.party,legacy=JSON.parse(JSON.stringify({
   bank:{bank:p.bankSnapshot,bankVaults:p.bankVaults,bankCurrent:p.bankCurrent,bankQueue:p.bankQueue,bankbois:r.ports.bankbois()},
   logs:{gameLogs:require('../../runtime/coordinator/telemetry/game-logs.ts').gameLogs,combatLogs:p.combatLogs,merchantActivity:p.merchantActivity},
   market:{aldata:r.ports.aldata(),ponty:p.ponty,standPriceHistory:p.standPriceHistory},
  }[section]));
  const answer=respond(r,query);
  assert.equal(answer.status,200);assert.deepEqual(answer.body,legacy,section);
  for(const revision of ['','garbage','"quoted"']) assert.equal(respond(r,{...query,revision}).status,200,section+revision);
 }
});

test('other sections never answer 304',()=>{
 const r=publicStateRuntime();
 for(const section of ['fast','inventory','catalog','config','core']){
  const answer=respond(r,{section,dashboard:'1'});
  assert.equal(answer.status,200);assert.equal(answer.headers.etag,undefined,section);
 }
});
