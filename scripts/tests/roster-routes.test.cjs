const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installRosterRoutes } = require('../../runtime/roster/routes.ts');

function fixture() {
  const state = { native: 'Priest', slots: ['Mage', 'Warrior', 'Merchant', null], handoff: null };
  const online = new Set(['Priest', 'Mage', 'Warrior', 'Merchant']), routes = new Map();
  let now = 100;
  const ports = {
    now: () => now, id: () => 'op', save() {}, bridgeReady: () => false,
    owned: name => ['Priest', 'Mage', 'Warrior', 'Merchant', 'Ranger'].includes(name),
    validateParticipants(names) { if (new Set(names).size > 4) throw new Error('capacity'); },
    async stopHeadless(name) { online.delete(name); },
    startHeadless(name) { assert.ok(!online.has(name)); online.add(name); },
    async confirmOffline(name) { return !online.has(name); },
    nativeBusy: () => false, bridgeChanged() {}, realm: () => 'SR_USII', members: () => [],
  };
  const installed = installRosterRoutes({ get: (route, handler) => routes.set(route, handler), post: (route, handler) => routes.set(route, handler) }, state, ports);
  const request = async (path, body = {}, slot = '') => {
    const response = { code: 200, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes.get('/party-api' + path)({ body, params: { slot } }, response);
    return response;
  };
  const bridge = (body = {}) => request('/steam/bridge', { version: 1, clientId: 'window', character: 'Priest', ...body });
  return { state, ports, online, installed, request, bridge, advance: value => { now += value; } };
}
test('bridge realm recovers an unknown-realm operation without a CODE heartbeat',async()=>{
 const f=fixture();f.ports.realmContext=()=>({current:null,home:'SR_USII'});
 try {
  await f.bridge({version:2});
  await f.request('/steam/action',{action:'primary',character:'Mage'});
  assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
  for(const body of [{realm:'invalid'},{realm:'SR_USII',character:null},{realm:'SR_USII',character:'Warrior'}]) {
   await f.bridge({version:2,...body});
   assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
  }
  await f.bridge({version:2,realm:'SR_USII'});
  assert.equal(f.state.handoff.phase,'release');
  assert.equal(f.state.handoff.destinationRealm,'SR_USII');
  assert.equal(f.online.has('Mage'),false);
 }finally{f.installed.dispose();}
});

test('fresh bridge realm overrides telemetry and expires with the accepted session',async()=>{
 const f=fixture();f.ports.realmContext=()=>({current:'SR_USII',home:'SR_USII'});
 try {
  await f.bridge({version:2,realm:'SR_USIV'});
  await f.request('/steam/action',{action:'primary',character:'Mage'});
  assert.equal(f.state.handoff.realmChoice.current,'SR_USIV');
  assert.equal((await f.bridge({version:2,clientId:'other',realm:'SR_USII'})).code,409);
  assert.equal(f.state.handoff.realmChoice.current,'SR_USIV');
  f.advance(8001);
  await f.request('/steam/realm-choice',{operationId:'op',choice:'stay'});
  assert.equal(f.state.handoff.realmChoice.current,'SR_USII');
  assert.equal(f.state.handoff.phase,'awaiting-realm-choice');
 }finally{f.installed.dispose();}
});

test('connection status requires a live bridge, its current character, and a fresh code heartbeat',async()=>{
 const f=fixture();let fresh=false;f.ports.codeRunning=()=>fresh;
 try {
  const connected=async()=>(await f.request('/steam/connection')).body.connected;
  assert.equal(await connected(),false);
  await f.bridge();assert.equal(await connected(),false);
  fresh=true;assert.equal(await connected(),true);
  fresh=false;assert.equal(await connected(),false);
  fresh=true;f.advance(9000);assert.equal(await connected(),false);
  await f.bridge({character:null});assert.equal(await connected(),false);
 }finally{f.installed.dispose();}
});

test('roster endpoints reject primitive and empty request bodies without changing ownership',async()=>{
  const f=fixture(),before=JSON.stringify(f.state);
  try {
    for(const body of [null,false,0,'Mage',[],{}]) {
      const result=await f.request('/steam/switch',body);
      assert.equal(result.code,409);assert.match(result.body.error,/Choose a character/);
    }
    assert.equal(JSON.stringify(f.state),before);
  } finally {f.installed.dispose();}
});

test('explicit Steam login releases a BankBoi reservation before capacity and inventory checks',async()=>{
 const f=fixture();let storageBusy=true,calls=0;f.state.slots[2]='BankBoi';f.online.delete('Merchant');
 f.ports.characterBusy=()=>storageBusy;
 f.ports.prepareSteam=async name=>{assert.equal(name,'Merchant');calls++;storageBusy=false;f.state.slots[2]=null;};
 try {
  assert.equal((await f.request('/steam/action',{action:'login',character:'Merchant'})).code,409);
  assert.equal(calls,0,'an unavailable bridge must not interrupt storage');
  await f.bridge({version:2,running:['Priest']});
  const result=await f.request('/steam/action',{action:'login',character:'Merchant'});
  assert.equal(result.code,200);assert.equal(calls,1);assert.ok(f.state.handoff.multi.desired.includes('Merchant'));
  assert.equal(f.state.slots[2],null);
 } finally {f.installed.dispose();}
});
test('headless logout action retains its slot until offline confirmation succeeds',async()=>{
  const f=fixture(),calls=[];
  try {
    f.ports.stopHeadless=async name=>calls.push(['stop',name]);
    f.ports.confirmOffline=async name=>{calls.push(['confirm',name]);return false;};
    f.ports.save=()=>calls.push(['save']);
    const failed=await f.request('/steam/action',{action:'logout',character:'Mage'});
    assert.equal(failed.code,409);assert.equal(f.state.slots[0],'Mage');
    assert.deepEqual(calls,[['stop','Mage'],['confirm','Mage']]);
    calls.length=0;
    f.ports.confirmOffline=async name=>{calls.push(['confirm',name]);return true;};
    assert.equal((await f.request('/steam/action',{action:'logout',character:'Mage'})).code,200);
    assert.equal(f.state.slots[0],null);
    assert.deepEqual(calls,[['stop','Mage'],['confirm','Mage'],['save']]);
  } finally {f.installed.dispose();}
});
test('bridge ownership survives stale heartbeats and rejects a second active window', async () => {
  const f = fixture();
  try {
    assert.equal((await f.bridge()).code, 200);
    assert.equal((await f.bridge({ clientId: 'other' })).code, 409);
    f.advance(9000);
    assert.equal((await f.request('/steam/headless')).code, 409);
    assert.equal(f.state.native, 'Priest');
    await f.bridge({ character: null });
    assert.equal(f.state.native, 'Priest');
  } finally { f.installed.dispose(); }
});
test('slot is retained until logout is confirmed and becomes reusable for an offline character', async () => {
  const f = fixture();
  try {
    f.ports.stopHeadless = async () => {};
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 409);
    assert.equal(f.state.slots[0], 'Mage');
    f.online.delete('Mage');
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 200);
    assert.equal(f.state.slots[0], null);
    assert.equal((await f.request('/slots/:slot/spawn', { character: 'Ranger' }, '1')).code, 200);
    assert.equal(f.state.slots[0], 'Ranger');
    assert.ok(f.online.has('Ranger'));
  } finally { f.installed.dispose(); }
});
test('a pending spawn reserves its slot and serializes competing roster mutations', async () => {
  const f = fixture();
  try {
    f.state.native = null;
    f.state.steam = [];
    let release;
    f.ports.confirmOffline = () => new Promise(resolve => { release = resolve; });
    const spawning = f.request('/slots/:slot/spawn', { character: 'Ranger' }, '4');
    assert.equal(f.state.slots[3], 'Ranger');
    assert.equal((await f.request('/slots/:slot/logout', {}, '1')).code, 409);
    release(false);
    assert.equal((await spawning).code, 409);
    assert.equal(f.state.slots[3], null);
  } finally { f.installed.dispose(); }
});

test('arrival without navigation storage recovers a timed-out legacy handoff', async () => {
  const f = fixture();
  try {
    await f.bridge();
    await f.request('/steam/switch', { character: 'Mage' });
    f.online.delete('Priest');
    await f.bridge({ character: null, operationId: 'op', released: true, from: 'Priest' });
    assert.equal(f.state.handoff.phase, 'navigate');
    delete f.state.handoff.releasedAt;
    f.advance(100000);
    await f.bridge({ character: null });
    assert.equal(f.state.handoff.phase, 'failed');
    await f.bridge({ character: 'Mage' });
    assert.equal(f.state.handoff.phase, 'complete');
    assert.equal(f.state.native, 'Mage');
    assert.deepEqual(f.state.slots, ['Priest', 'Warrior', 'Merchant', null]);
  } finally { f.installed.dispose(); }
});
