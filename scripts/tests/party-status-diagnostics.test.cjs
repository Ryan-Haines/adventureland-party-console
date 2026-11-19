// A member's status report and its failure record: shared.js's coordinator `request`, the
// report tick (status/character/apply.ts `createApply`) and the status owner's telemetry (telemetry.ts
// `createTelemetry`), which records each failed report and posts the record after the next answered one.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');
const { processScope } = require('./helpers/run-scope.cjs');
const { planted } = require('./helpers/items-character.cjs');
const { createTelemetry, diagnosticText } = require('../../runtime/status/character/telemetry.ts');
const { boundFired, boundsPending, boundsSent } = require('../../runtime/status/api.ts');
const { createApply } = require('../../runtime/status/character/apply.ts');
const { TABLE_A } = require('../../runtime/status/rules.ts');
const request = namedFunction(fs.readFileSync('characters/shared.js', 'utf8'), 'request');
// `fail` plants the game's jQuery failure arguments, `response` its answer; every post lands in
// `requests`. The items owner's bag answers no inventory resend.
function fixture() {
  let now = 1000, response = {}, failure = null;
  const requests = [], logs = [];
  const r = vm.createContext({ root: { partyStatus: { diagnosticText, boundFired } }, Date: { now: () => now }, api: 'http://localhost/party-api',
    character: { name: 'Warrior', ctype: 'warrior' }, convoySignal: { id: 'convoy', epoch: 4, phase: 'travel' }, groupWalk: { travel: null },
    game_log: message => logs.push(message), acknowledgeStatusInventory() {}, statusInventoryResend: () => null,
    eventExit: { observe() {}, accepts: () => true, supersede() {}, run: async () => {}, pending: () => false, exiting: () => false, returning: () => false },
    $: { ajax(options) { requests.push(options); return {
      done(fn) { if (!failure) fn(response); return this; },
      fail(fn) { if (failure) fn(...failure); return this; },
    }; } },
  });
  vm.runInContext(request, r);
  require('./helpers/walk-reports.cjs').installWalkReports(r);
  processScope();
  // The status owner's telemetry over the context's character, root and request; its walk is the context's convoy.
  const telemetry = createTelemetry(planted({ me: () => r.character, root: () => r.root, current: () => true,
    request: (path, options) => r.request(path, options), walk: () => r.convoySignal, log: message => logs.push(message) }));
  return { r, telemetry, requests, logs, time: n => now = n, fail: f => failure = f, response: value => response = value };
}
for (const status of [400,409,500]) test('HTTP '+status+' retains endpoint and server explanation without payloads', async()=>{
  const f=fixture();f.fail([{status,responseJSON:{error:'stale convoy',private:'do not retain'}},'error','']);
  await assert.rejects(f.r.request('/status?token=secret',{method:'POST',body:{password:'private'}}),e=>{
    assert.equal(e.partyRequest.status,status);assert.equal(e.partyRequest.path,'/status');
    assert.match(e.message,/stale convoy/);assert.doesNotMatch(JSON.stringify(e),/secret|private/);return true;
  });
});
test('status timing records actual response receipt and failure without extra requests',async()=>{
 const f=fixture();let now=100;f.r.performance={now:()=>now};
 f.r.$.ajax=()=>({done(fn){now=450;fn({ok:true});return this;},fail(){return this;}});
 assert.equal((await f.r.request('/status')).ok,true);assert.equal(f.r.root.__partyConvoyHttp.responseAt,450);
 f.r.$.ajax=()=>({done(){return this;},fail(fn){now=900;fn({status:0},'error','');return this;}});
 await assert.rejects(f.r.request('/status'),/network/);
 assert.equal(f.r.root.__partyConvoyHttp.failure.durationMs,450);assert.equal(f.r.root.__partyConvoyHttp.failure.kind,'network');
 assert.equal(f.r.root.__partyConvoyHttp.responseAt,450);
 await assert.rejects(f.r.request('/merchant/native-stand'),/network/);
 assert.equal(f.r.root.__partyConvoyHttp.failure.durationMs,450,'other endpoints cannot replace status evidence');
 assert.equal(f.requests.length,0,'instrumentation never sends a request');
});
test('broken diagnostic state cannot reject an otherwise successful status response',async()=>{
 const f=fixture();Object.defineProperty(f.r.root,'__partyConvoyHttp',{get(){throw Error('diagnostic state unavailable');}});
 f.response({ok:true});assert.equal((await f.r.request('/status')).ok,true);
});
for(const [status,http,kind]of [['error',0,'network'],['timeout',0,'timeout'],['parsererror',200,'invalid-json'],['abort',0,'aborted']])
  test('classifies '+kind,async()=>{
    const f=fixture();f.fail([{status:http,responseText:'full response must not leak'},status,'']);
    boundsSent(boundsPending().length);
    await assert.rejects(f.r.request('/status'),e=>e.partyRequest.kind===kind&&!JSON.stringify(e).includes('full response'));
    // A request that names no timeout of its own ends at the default bound, which reports its cut.
    assert.deepEqual(boundsPending().map(b=>b.bound),kind==='timeout'?['REQUEST_DEFAULT_MS']:[]);
    boundsSent(boundsPending().length);
  });
test('diagnostics survive reload, deduplicate repeats, stay bounded and retry only after success',async()=>{
  const f=fixture();f.telemetry.statusFailure(new Error('broken'),'apply navigation');
  f.telemetry.statusFailure(new Error('broken'),'apply navigation');
  assert.equal(f.logs.length,1);assert.equal(f.requests.length,0);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].details.repeats,2);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].details.convoy.epoch,4);
  f.fail([{status:0},'error','']);await f.telemetry.flushStatusFailures();
  assert.equal(f.requests.length,1);assert.equal(f.logs.length,1);
  assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,false);
  // A reload builds the telemetry again over the same root, where the record waits.
  const reloaded=createTelemetry(planted({me:()=>f.r.character,root:()=>f.r.root,current:()=>true,request:(path,options)=>f.r.request(path,options),walk:()=>f.r.convoySignal}));
  f.fail(null);await reloaded.flushStatusFailures();
  assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,true);
  await reloaded.flushStatusFailures();assert.equal(f.requests.length,2);
  for(let i=0;i<25;i++)reloaded.statusFailure(new Error('failure '+i),'request status');
  assert.equal(f.r.root.__partyStatusDiagnostics.length,20);
  // A failure that keeps repeating stays one entry and one red line however long it lasts; when a
  // different failure follows, the delivered entry goes again once with its final repeat count.
  const g=fixture(),realNow=Date.now;let clock=1e6;Date.now=()=>clock;
  try{
   g.telemetry.statusFailure(new Error('down'),'request status');await g.telemetry.flushStatusFailures();
   clock+=60000;g.telemetry.statusFailure(new Error('down'),'request status');
   assert.equal(g.logs.length,1);assert.equal(g.r.root.__partyStatusDiagnostics.length,1);
   await g.telemetry.flushStatusFailures();assert.equal(g.requests.length,1,'a repeat alone sends nothing');
   g.telemetry.statusFailure(new Error('other'),'request status');assert.equal(g.logs.length,2);
   await g.telemetry.flushStatusFailures();
   const events=JSON.parse(JSON.stringify(g.requests[1].data||g.requests[1].body||'{}'));
   const sent=(typeof events==='string'?JSON.parse(events):events).events;
   assert.deepEqual(sent.map(e=>[e.details.error,e.details.repeats]),[['down',2],['other',1]]);
   assert.notEqual(sent[0].seq,1,'the resent entry takes a new seq, so the combat log keeps its count');
  }finally{Date.now=realNow;}
});
test('diagnostic strings redact credentials and URL queries',()=>{
 const text=diagnosticText('token=abc password="def ghi" Bearer xyz https://host/path?session=123');
 assert.doesNotMatch(text,/abc|def ghi|xyz|123/);
});
// The report tick (apply.ts `tick`) over the fixture's request, its failures recorded by the
// telemetry. Table A's rows answer nothing, save the status owner's `failures` row, which posts the record, and
// The lifecycle owner's `command` row, counted in `handled`. `wakes` counts the merchant jobs owner's gathering wake after each report;
// `pin` plants the items owner's Tracktrix pin.
function statusFixture() {
 const f=fixture(),rows=Object.fromEntries(TABLE_A.map(({row})=>[row,()=>undefined]));
 f.handled=0;f.wakes=0;f.pin=()=>null;f.snapshot=()=>({boundsFired:[]});
 Object.assign(rows,{failures:f.telemetry.failuresReply,command:()=>{f.handled++;}});
 f.rows=rows;
 f.apply=createApply({farmingMode(){},deathSeen(){},telemetry(){},gatheringCooldown(){},rows,host:()=>f.r.root,current:()=>true,held:()=>false,
  startReports(){},observeVisit(){},pin:()=>f.pin(),snapshot:()=>f.snapshot(),request:(path,options)=>f.r.request(path,options),
  failed:f.telemetry.statusFailure,observe(){},reported:()=>{f.wakes++;},log:message=>f.logs.push(message)});
 // The failures row posts without holding the apply; a tick's test reads after that post.
 f.tick=async()=>{await f.apply.tick();await new Promise(resolve=>setImmediate(resolve));};
 return f;
}
test('status request failure releases busy and the next successful update dispatches normally',async()=>{
 const f=statusFixture();f.fail([{status:500,responseJSON:{error:'coordinator exception'}},'error','']);
 await f.tick();
 assert.equal(f.r.root.__partyStatusDiagnostics[0].details.phase,'request status');
 f.fail(null);await f.tick();assert.equal(f.handled,1);
 assert.equal(f.wakes,2);
 assert.equal(f.r.root.__partyStatusDiagnostics[0].delivered,true);
});

test('bank recovery cannot block ordinary status and command delivery',async()=>{
 const f=statusFixture();f.pin=async()=>{throw new Error('Bank stack buffer changed');};
 await f.tick();assert.equal(f.handled,1);
 assert.ok(f.requests.some(r=>r.url.endsWith('/status')));
 assert.deepEqual(f.r.root.__partyStatusDiagnostics??[],[]);
 f.pin=()=>null;await f.tick();assert.equal(f.handled,2);
});
test('snapshot and post-response navigation exceptions identify their actual stage',async()=>{
 const f=statusFixture();f.snapshot=()=>{throw new Error('snapshot broke');};
 await f.tick();
 assert.equal(f.r.root.__partyStatusDiagnostics[0].details.phase,'snapshot');
 f.snapshot=()=>({boundsFired:[]});f.rows.navigation=async()=>{throw new Error('navigation broke');};
 await f.tick();
 assert.equal(f.r.root.__partyStatusDiagnostics[1].details.phase,'apply navigation');
 f.rows.navigation=()=>undefined;await f.tick();assert.equal(f.handled,1);
});

// /map-frame answers 204, which jQuery hands to `done` with no body. The transport row read its
// transportTiming off it and threw: the request never settled, so the map frame loop stayed busy,
// and a headless worker's process ended on the uncaught error (the live Cave map rows saw about one
// frame in 6 s).
test('a reply with no body settles the request',async()=>{
 const f=fixture();
 f.r.$.ajax=()=>({done(fn){fn(undefined);return this;},fail(){return this;}});
 assert.equal(await f.r.request('/map-frame',{method:'POST',body:{name:'Warrior'}}),undefined);
});
