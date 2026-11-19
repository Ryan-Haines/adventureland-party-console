const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const { createSteamRecovery } = require('../../runtime/lifecycle/roster/recovery.ts');
const { steamBootstrap, previousSteamBootstrap, steamBridgeVersion } = require('../../runtime/lifecycle/roster/connection.ts');
const { installSteamBridge } = require('../../runtime/lifecycle/roster/bridge.ts');
const { hidden } = require('./helpers/declared.cjs');

// The coordinator's bridge session with no handoff in flight: the handoff service's arrival check and
// expiry find nothing to do (roster/routes.ts builds it with the real service, roster/handoff.ts).
function bridgeSession(BridgeSession, now) {
  return new BridgeSession({slots:[],steam:['P'],native:'P',handoff:null},{reconcileArrival(){},expire(){}},
    {now,owned:name=>name==='P',save(){},validateParticipants(){},bridgeChanged(){}});
}

function fixture() {
  const dom = new JSDOM('<iframe id="maincode"></iframe><iframe id="icharc"></iframe>', {url:'https://adventure.land'});
  const starts = [], logs = [];
  const host = { document:dom.window.document, localStorage:dom.window.localStorage,
    character:{name:'P'}, socket:{connected:true}, code_active:false, X:{codes:{}},
    start_runner(){starts.push('P');}, stop_runner(){} };
  const companion = host.document.getElementById('icharc').contentWindow;
  Object.assign(companion, {character:{name:'C'}, socket:{connected:true}, code_active:false,
    start_runner(){starts.push('C');}, stop_runner(){}});
  const reply = {primary:'P', steam:['P','C'], operation:null};
  let supervisor;
  const install = (persist=async()=> '100') => supervisor = createSteamRecovery(host,'bootstrap',persist,s=>logs.push(s));
  install();
  // The game page around installSteamBridge, with no supervisor of the fixture's own: the saved CODE
  // in slot 100 at `base`, the code cache and the page's calls, each replaceable by a row.
  const base='http://127.0.0.1:924', cache=new Map();
  const bridgeHost=page=>{
    supervisor.dispose();
    host.localStorage.setItem('party-console-bootstrap-slot-v1:'+base,'100');
    Object.assign(host,{sessionStorage:host.localStorage,location:{},X:{codes:{'100':['Existing CODE',0]},characters:[{name:'P',id:'p'}]},
      storage_get:k=>cache.get(k),storage_set:(k,v)=>cache.set(k,v),setTimeout:()=>1,clearTimeout(){},get_active_characters:()=>({}),
      api_call:async()=>({success:true})},page);
  };
  return {host, companion, reply, starts, logs, install, base, cache, bridgeHost, get supervisor(){return supervisor;},
    close(){supervisor.dispose();dom.window.close();}};
}

test('primary and connected companion recover after grace and confirm healthy status', async t => {
  t.mock.method(Date,'now',()=>1000); const f=fixture();
  try {
    await f.supervisor.tick(f.reply); assert.deepEqual(f.starts,[]);
    Date.now.mock.mockImplementation(()=>6000); await f.supervisor.tick(f.reply);
    assert.deepEqual(f.starts,['P','C']); await f.supervisor.tick(f.reply); assert.equal(f.starts.length,2);
    f.host.code_active=true; f.host.document.getElementById('maincode').contentWindow.__partyStatusSuccessAt=6001;
    Date.now.mock.mockImplementation(()=>7000); await f.supervisor.tick(f.reply);
    assert.ok(f.logs.some(s=>s.includes('P: recovery healthy')));
  } finally {f.close();}
});

test('trusted keyboard and click stops survive supervisor replacement; programmatic stops do not', async t => {
  t.mock.method(Date,'now',()=>1000); const f=fixture();
  try {
    await f.supervisor.tick(f.reply);
    f.host.stop_runner(); assert.equal(f.host.localStorage.getItem('party-code-stopped:P'),null);
    f.host.event={isTrusted:true,type:'keydown'}; f.host.stop_runner();
    f.host.event={isTrusted:true,type:'click'}; f.companion.stop_runner(); delete f.host.event;
    f.supervisor.dispose(); f.install(); await f.supervisor.tick(f.reply);
    Date.now.mock.mockImplementation(()=>30000); await f.supervisor.tick(f.reply); assert.deepEqual(f.starts,[]);
    f.host.event={isTrusted:true,type:'click'}; f.host.start_runner(); delete f.host.event;
    assert.equal(f.host.localStorage.getItem('party-code-stopped:P'),'0');
    Date.now.mock.mockImplementation(()=>35000); await f.supervisor.tick(f.reply);
    assert.deepEqual(f.starts,['P','P']);
  } finally {f.close();}
});

test('handoffs, disconnects, ownership changes and occupied CODE suppress recovery', async t => {
  t.mock.method(Date,'now',()=>1000); const f=fixture();
  try {
    await f.supervisor.tick(f.reply);
    for (const phase of ['release','navigate','awaiting-realm-choice','failed']) {
      Date.now.mock.mockImplementation(()=>Date.now.mock.callCount()*10000);
      await f.supervisor.tick({...f.reply,operation:{phase}});
    }
    f.host.socket.connected=false; await f.supervisor.tick(f.reply);
    f.host.socket.connected=true; await f.supervisor.tick({...f.reply,primary:'C'});
    assert.deepEqual(f.starts,[]);
    f.reply.steam=['P']; f.host.code_active=true;
    const code=f.host.document.getElementById('maincode').contentWindow;
    code.sharedRoutine={canReload:()=>false};
    Date.now.mock.mockImplementation(()=>1000000); await f.supervisor.tick(f.reply); assert.deepEqual(f.starts,[]);
    code.sharedRoutine.canReload=()=>true; await f.supervisor.tick(f.reply); assert.deepEqual(f.starts,['P']);
  } finally {f.close();}
});

test('confirmed Steam arrivals repair stale connected CODE after a coordinator restart', async t => {
  let now=1000; t.mock.method(Date,'now',()=>now); const f=fixture();
  try {
    f.host.code_active=true;
    f.host.document.getElementById('maincode').contentWindow.__partyStatusSuccessAt=now;
    Object.assign(f.companion,{code_active:true,server_region:'US',server_identifier:'II'});
    f.reply.operation={phase:'failed',releasedAt:500,destinationRealm:'SR_USII',multi:{primary:'P',desired:['P','C']}};
    await f.supervisor.tick(f.reply); now=22000;
    await f.supervisor.tick(f.reply);
    assert.deepEqual(f.starts,['C']);
    // Wrong realm, unconfirmed release, removed ownership, deliberate stops,
    // and disconnected games must never be restarted by arrival recovery.
    for (const change of [
      ()=>{f.companion.server_identifier='I';},
      ()=>{f.companion.server_identifier='II';f.reply.operation.releasedAt=undefined;},
      ()=>{f.reply.operation.releasedAt=500;f.reply.operation.multi.desired=['P'];},
      ()=>{f.reply.operation.multi.desired=['P','C'];f.host.localStorage.setItem('party-code-stopped:C','1');},
      // LF25: another window (Q) holds the released handoff.
      ()=>{f.host.localStorage.removeItem('party-code-stopped:C');f.reply.operation.multi={primary:'Q',desired:['Q','C']};},
      ()=>{f.reply.operation.multi={primary:'P',desired:['P','C']};f.companion.socket.connected=false;},
    ]) { change(); now+=30000; await f.supervisor.tick(f.reply); }
    assert.deepEqual(f.starts,['C']);
    f.companion.socket.connected=true;f.reply.operation.phase='navigate';now+=30000;
    await f.supervisor.tick(f.reply);assert.deepEqual(f.starts,['C','C']);
    // A reply that names no primary leaves the handoff with the window that holds it.
    f.reply.primary=null;now+=30000;
    await f.supervisor.tick(f.reply);assert.deepEqual(f.starts,['C','C','C'],'this window holds the handoff and repairs its member');
  } finally {f.close();}
});

test('one pending restart, capped backoff, and disposal during persistence', async t => {
  let now=1000; t.mock.method(Date,'now',()=>now); const f=fixture(); let release;
  try {
    f.supervisor.dispose(); f.install(()=>new Promise(r=>release=r)); f.reply.steam=['P'];
    await f.supervisor.tick(f.reply); now=6000;
    const pending=f.supervisor.tick(f.reply); await f.supervisor.tick(f.reply); assert.deepEqual(f.starts,[]);
    f.supervisor.dispose(); release('100'); await pending; assert.deepEqual(f.starts,[]);
    f.install(async()=>{throw Error('offline');}); await f.supervisor.tick(f.reply);
    for (const delta of [5000,5000,10000,20000,30000]) {now+=delta;await f.supervisor.tick(f.reply);}
    assert.equal(f.logs.filter(s=>/recovery failed/.test(s)).length,5);
    assert.ok(f.logs.some(s=>s.includes('prolonged recovery failure')));
  } finally {f.close();}
});

test('previous managed bootstrap remains recognizable for migration', async()=>{
  const timers=[], delays=[]; let requests=0, installs=0;
  const parent={character:{name:'P'},__partySteamBridge:{},localStorage:{getItem:()=>null}};
  const context=vm.createContext({parent,AbortSignal,console:{warn(){}},setTimeout(fn,delay){timers.push(fn);delays.push(delay);},
    fetch:async()=>{requests++;if(requests<3)throw Error('offline');return {ok:true,text:async()=> 'installed()'};},installed(){installs++;}});
  const source=previousSteamBootstrap('http://localhost:924');
  const settle=()=>new Promise(r=>setImmediate(r));
  vm.runInContext(source,context);vm.runInContext(source,context);await settle();
  assert.equal(requests,1);timers.shift()();await settle();timers.shift()();await settle();
  assert.deepEqual(delays,[1000,2000]);assert.equal(installs,1);
  parent.localStorage.getItem=()=> '1';vm.runInContext(source,context);await settle();assert.equal(requests,3);
});

test('managed slot upgrades preserve unrelated saved code and install primary and companion autorun',async()=>{
  for (const variant of ['current', 'legacy', 'previous', 'unrelated']) {
    const unrelated=variant==='unrelated';
    const f=fixture(), saved=[], base=f.base;
    const legacy=`globalThis.__partyServer=${JSON.stringify(base)};parent.__partyServer=globalThis.__partyServer;$.getScript(${JSON.stringify(base+'/CODE/adventure_land/universal-loader.js')});`;
    f.bridgeHost({X:{codes:{'100':['Existing CODE',0]},characters:[{name:'P',id:'p'},{name:'C',id:'c'}]},get_active_characters:()=>({C:'code'}),
      api_call:async(method,body)=>{saved.push(body);return {success:true};},
      fetch:async url=>url.startsWith('/code.js') ? new Response(unrelated?'// my personal code':variant==='previous'?previousSteamBootstrap(base):variant==='current'?steamBootstrap(base):legacy) : Response.json({...f.reply,members:[]})});
    try {
      let disposed=0;f.host.__partySteamBridge={realmProtocol:2,dispose(){disposed++;}};
      installSteamBridge(f.host);await new Promise(r=>setImmediate(r));
      assert.equal(disposed,1);assert.equal(f.host.__partySteamBridge.version,steamBridgeVersion);assert.equal(f.host.__partySteamBridge.server,base);
      assert.equal(saved.length,1);
      assert.equal(saved[0].slot,unrelated?'99':'100');
      const stored=JSON.parse(f.cache.get('code_cache'));
      for(const id of ['p','c']){assert.equal(stored['run_'+id],'1');assert.equal(stored['code_'+id],steamBootstrap(base));}
    } finally {f.host.__partySteamBridge.dispose();f.close();}
  }
});

// steamRecoveryAttemptsBound (lifecycle/fields.ts, bigcheck/bounds.md): a game window whose CODE never
// reports healthy trips the bound once, at the restart that reaches it; it queues on the Steam window
// (status/character/bounds.ts), the bridge sends the queue with its next report and the coordinator's
// bridge session hands it to the status owner's bound record.
test('steamRecoveryAttemptsBound: a CODE that never reports healthy trips the bound and records it', async t => {
  let now=1000; t.mock.method(Date,'now',()=>now); const f=fixture();
  const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
  try {
    boundsSent(boundsPending().length);
    f.reply.steam=['P']; await f.supervisor.tick(f.reply);
    for (const delta of [5000,5000,10000,20000,30000]) {now+=delta;await f.supervisor.tick(f.reply);}
    const firings=boundsPending();
    assert.equal(firings.length,1); assert.equal(firings[0].bound,'steamRecoveryAttemptsBound'); assert.equal(firings[0].subject,'P');
    const {BridgeSession}=require('../../runtime/lifecycle/roster/bridge-session.ts');
    const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
    const before=boundFirings().counts.steamRecoveryAttemptsBound||0;
    const session=bridgeSession(BridgeSession,()=>now);
    await session.receive({clientId:'bridge-1',version:1,character:'P',boundsFired:firings});
    assert.equal(boundFirings().counts.steamRecoveryAttemptsBound,before+1);
    const entry=boundFirings().entries.at(-1); assert.equal(entry.owner,'13'); assert.equal(entry.subject,'P');
    boundsSent(firings.length); assert.deepEqual(boundsPending(),[]);
  } finally {f.close();}
});

// steamSlotCheckMs and steamBridgeRequestMs (lifecycle/fields.ts, bigcheck/bounds.md): a slot check the
// game's server never answers, and a bridge post the coordinator never answers, end at their kept
// bounds; each firing queues on the Steam window for the bridge's next report.
test('a slot check and a bridge post that never answer end at their kept bounds and queue the firings',async t=>{
  const bounds=[];
  t.mock.method(AbortSignal,'timeout',ms=>{const c=new AbortController();bounds.push({ms,trip:()=>c.abort(new DOMException('bound','TimeoutError'))});return c.signal;});
  const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  const f=fixture(), polls=[];
  let bridgeHangs=false;
  const hang=init=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));
  f.bridgeHost({setTimeout:fn=>{polls.push(fn);return 1;},
    fetch:async(url,init)=>url.startsWith('/code.js')||bridgeHangs?hang(init):Response.json({...f.reply,steam:['P'],members:[]})});
  try {
    installSteamBridge(f.host);await new Promise(r=>setImmediate(r));
    bounds.filter(b=>b.ms===hidden('steamSlotCheckMs')).at(-1).trip();await new Promise(r=>setImmediate(r));
    bridgeHangs=true;polls.at(-1)();await new Promise(r=>setImmediate(r));
    bounds.filter(b=>b.ms===hidden('steamBridgeRequestMs')).at(-1).trip();await new Promise(r=>setImmediate(r));
    const firings=boundsPending();
    assert.deepEqual(firings.map(x=>[x.bound,x.owner,x.state.what]),
      [['steamSlotCheckMs','13','code.js'],['steamBridgeRequestMs','13','/steam/bridge']]);
    // A window with no character connected still reports its firings, under its own name.
    const {BridgeSession}=require('../../runtime/lifecycle/roster/bridge-session.ts');
    const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
    const session=bridgeSession(BridgeSession,()=>Date.now());
    await session.receive({clientId:'bridge-2',version:1,character:null,boundsFired:firings});
    assert.deepEqual(boundFirings().entries.slice(-2).map(e=>[e.bound,e.subject]),[['steamSlotCheckMs','Steam window'],['steamBridgeRequestMs','Steam window']]);
  } finally {boundsSent(boundsPending().length);f.host.__partySteamBridge?.dispose();f.close();}
});

test('a running CODE whose reports fail for less than steamRunnerStaleMs keeps running', async t => {
  let now=1000; t.mock.method(Date,'now',()=>now); const f=fixture();
  try {
    f.reply.steam=['P']; f.host.code_active=true;
    f.host.document.getElementById('maincode').contentWindow.__partyStatusSuccessAt=now;
    await f.supervisor.tick(f.reply);
    // The live walking-return row drops every report for 10 to 20 s and expects the CODE that held
    // its walk to resume with its route cache.
    now=16000; await f.supervisor.tick(f.reply);
    assert.deepEqual(f.starts,[],'a 15 s report outage is the coordinator hold, not a dead CODE');
    const {boundsPending}=require('../../runtime/status/api.ts');
    const fired=()=>boundsPending().filter(e=>e.bound==='steamRunnerStaleMs'&&e.subject==='P').length,before=fired();
    now=1000+hidden('steamRunnerStaleMs'); await f.supervisor.tick(f.reply);
    assert.deepEqual(f.starts,['P']);
    // The silence that restarts the CODE tells the status owner's bound record once, not on each restart after it.
    assert.equal(fired(),before+1,'the stale bound did not report');
    now+=hidden('steamRecoveryMaxMs'); await f.supervisor.tick(f.reply);
    assert.equal(fired(),before+1,'the stale bound reported again within one run of restarts');
  } finally {f.close();}
});
