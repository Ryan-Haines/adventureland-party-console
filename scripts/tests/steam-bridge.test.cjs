const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const { installSteamBridge } = require('../../runtime/lifecycle/roster/bridge.ts');
const { createSwitcher } = require('../../runtime/lifecycle/roster/switcher.ts');

for(const mode of ['group','legacy','interrupted']) test(`intentional primary release suppresses game auto-reconnect (${mode})`,async()=>{
 const multi=mode!=='legacy';
 const dom=new JSDOM('',{url:'https://adventure.land'});let timer,scheduled=false,receipt;
 const operation={id:'logout',from:'P',target:null,phase:'release',...(multi?{multi:{action:'headless',subject:'P',before:['P'],desired:[],primary:null,release:['P']}}:{})};
 const host={document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
  character:{name:'P'},code_active:true,auto_reload:'auto',character_to_load:'P',reload_state:'schedule',
  socket:{connected:true,disconnect(){
   receipt=JSON.parse(host.sessionStorage.getItem('party-console-steam-release-v1')||'null');
   scheduled=host.auto_reload==='auto'||host.auto_reload==='on'||!!host.character_to_load||!!host.reload_state;
   this.connected=false;
  }},stop_runner(){host.code_active=false;},location:{href:''},
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},fetch:async()=>Response.json({operation,primary:'P',steam:['P'],realm:'SR_USII',members:[]})};
 if(mode==='interrupted') {
  operation.phase='failed';operation.failure='coordinator-restart';
  operation.error='Coordinator restarted during handoff; confirm offline ownership before recovery';
  operation.multi.releaseIssued=true;
  host.sessionStorage.setItem('party-console-steam-release-v1',JSON.stringify({operationId:operation.id,from:'P',released:true}));
 }
 try {
  installSteamBridge(host);await new Promise(r=>setImmediate(r));
  assert.equal(scheduled,false);assert.equal(host.socket.connected,false);
  assert.equal(receipt?.operationId,'logout');assert.equal(receipt?.released,true);
 }finally{host.__partySteamBridge?.dispose();dom.window.close();}
});
test('X requires explicit confirmation before asking the server for a bulk handoff',async()=>{
 const dom=new JSDOM(''),doc=dom.window.document,calls=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 const switcher=createSwitcher({document:doc},async(...args)=>calls.push(args));
 try {
  switcher.render({primary:'P',steam:['P'],members:[{name:'P',online:true,hosting:'steam'}]});
  doc.querySelector('[aria-label="Run all Steam characters headless"]').click();
  assert.match(doc.querySelector('dialog').textContent,/Log out all characters from Steam and run on the headless device/);
  assert.deepEqual(calls,[]);doc.querySelector('dialog [aria-label="Cancel"]').click();assert.deepEqual(calls,[]);
  doc.querySelector('[aria-label="Run all Steam characters headless"]').click();
  doc.querySelector('dialog [aria-label="Confirm"]').click();await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls,[['','headless-all']]);
 }finally{switcher.dispose();dom.window.close();}
});

test('console orders Steam before headless, with merchant last unless primary', () => {
 const dom = new JSDOM(''), doc = dom.window.document;
 const switcher = createSwitcher({ document: doc }, async () => {});
 const reply = { primary: 'GDroidPT', members: [
  {name:'GDroidPT',ctype:'warrior',online:true,hosting:'steam'},
  {name:'GoldMajesty',ctype:'merchant',online:true,hosting:'headless'},
  {name:'GermanicHP',ctype:'priest',online:true,hosting:'steam'},
  {name:'Qwentina',ctype:'mage',online:true,hosting:'steam'},
 ]};
 const names = () => [...doc.querySelectorAll('#party-console-switcher button[aria-label$="primary Steam control"]')]
  .map(button => button.textContent);
 try {
  switcher.render(reply);
  assert.deepEqual(names(), ['GDroidPT','GermanicHP','Qwentina','GoldMajesty']);
  reply.members[1].hosting = 'steam'; reply.members[2].hosting = 'headless';
  switcher.render(reply);
  assert.deepEqual(names(), ['GDroidPT','Qwentina','GermanicHP','GoldMajesty']);
  reply.primary = 'GoldMajesty'; switcher.render(reply);
  assert.deepEqual(names(), ['GoldMajesty','GDroidPT','Qwentina','GermanicHP']);
  assert.deepEqual(reply.members.map(member => member.name), ['GDroidPT','GoldMajesty','GermanicHP','Qwentina']);
 } finally { switcher.dispose(); dom.window.close(); }
});

test('pixel bar shows hosting independently of primary and persists minimization', () => {
 const dom=new JSDOM('',{url:'https://adventure.land'}),doc=dom.window.document;
 const host={document:doc,localStorage:dom.window.localStorage};
 const reply={primary:'P',steam:['P','M'],members:[
  {name:'P',online:true,hosting:'steam'},{name:'M',online:true,hosting:'steam'},
  {name:'W',online:true,hosting:'headless'},{name:'Offline',online:false,hosting:'offline'}]};
 // dispose sits in finally because the switcher's audio interval keeps the file running after a
 // failed assertion, which hung the unit run.
 let s=createSwitcher(host,async()=>{});
 try {
 s.render(reply);
 assert.equal(doc.querySelector('[aria-label="This character has primary Steam control"]').style.color,'rgb(80, 238, 80)');
 assert.equal(doc.querySelector('[aria-label="Give this character primary Steam control"]').style.color,'rgb(255, 255, 255)');
 assert.equal(doc.querySelector('[aria-label="Run M headless"]').textContent,'✓');
 assert.equal(doc.querySelector('[aria-label="Log in Offline"]').textContent,'↪');
 const minimize = doc.querySelector('[aria-label="Minimize Steam character controls"]');
 minimize.getBoundingClientRect = () => ({left:600,top:16});
 minimize.click();
 assert.equal(doc.querySelector('#party-console-switcher').style.right,'8px');
 assert.equal(doc.querySelector('#party-console-switcher').style.top,'8px');
 assert.equal(doc.querySelectorAll('#party-console-switcher button').length,1);
 s.dispose();s=createSwitcher(host,async()=>{});s.render(reply);
 assert.equal(doc.querySelectorAll('#party-console-switcher button').length,1);
 } finally {s.dispose();dom.window.close();}
});

test('background game frames install no competing Steam bridge',()=>{
 installSteamBridge({no_html:true});installSteamBridge({is_bot:true});
});

test('v2 bridge starts background CODE without navigating or disconnecting primary',async()=>{
 const dom=new JSDOM('',{url:'https://adventure.land'}),cache=new Map(),started=[];
 let timer;
 const op={id:'multi',phase:'navigate',target:'P',from:'P',startedAt:Date.now(),releasedAt:1,
  multi:{action:'login',subject:'M',before:['P'],desired:['P','M'],primary:'P',release:[]}};
 const host={document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
  character:{name:'P'},socket:{connected:true,disconnect(){assert.fail('primary disconnected');}},code_active:true,
  X:{codes:{},characters:[{name:'M',id:'m'}]},location:{href:''},get_active_characters:()=>({P:'self'}),
  start_character_runner:(name,slot)=>{started.push([name,slot]);return new Promise(()=>{});},
  storage_get:key=>cache.get(key),storage_set:(key,v)=>cache.set(key,v),api_call:async()=>({success:true}),
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
  fetch:async()=>Response.json({operation:op,primary:'P',steam:['P','M'],realm:'SR_USII',members:[]})};
 const settle=()=>new Promise(r=>setImmediate(r));installSteamBridge(host);await settle();
 assert.equal(started.length,1);assert.equal(started[0][0],'M');assert.equal(started[0][1],'100');
 timer();await settle();assert.equal(started.length,1);assert.equal(host.location.href,'');
 host.__partySteamBridge.dispose();dom.window.close();
});

// Separate: the live reconnect, where the restore after a companion's stop logged the priest in
// again but never the merchant. The merchant's first launch still counted as starting, since the
// operation completed before any bridge poll saw it in the active list.
test('a completed operation forgets its launches, so the next restore starts the companion again',async()=>{
 const dom=new JSDOM('',{url:'https://adventure.land'}),cache=new Map(),started=[];
 let timer;
 const login={id:'login',phase:'navigate',target:'P',from:'P',startedAt:Date.now(),releasedAt:1,
  multi:{action:'login',subject:'M',before:['P'],desired:['P','M'],primary:'P',release:[]}};
 const restore={id:'restore',phase:'navigate',target:'P',from:'P',startedAt:Date.now(),releasedAt:2,
  multi:{action:'primary',subject:'P',before:['P','M'],desired:['P','M'],primary:'P',release:['M']}};
 const replies=[login,{...login,phase:'complete'},restore];let reply=0;
 const host={document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
  character:{name:'P'},socket:{connected:true,disconnect(){assert.fail('primary disconnected');}},code_active:true,
  X:{codes:{},characters:[{name:'M',id:'m'}]},location:{href:''},get_active_characters:()=>({P:'self'}),
  start_character_runner:(name,slot)=>{started.push([name,slot]);return new Promise(()=>{});},
  storage_get:key=>cache.get(key),storage_set:(key,v)=>cache.set(key,v),api_call:async()=>({success:true}),
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
  fetch:async()=>Response.json({operation:replies[Math.min(reply++,replies.length-1)],primary:'P',steam:['P','M'],realm:'SR_USII',members:[]})};
 const settle=()=>new Promise(r=>setImmediate(r));
 try {
  installSteamBridge(host);await settle();
  assert.deepEqual(started.map(entry=>entry[0]),['M']);
  timer();await settle();timer();await settle();
  assert.deepEqual(started.map(entry=>entry[0]),['M','M']);
 } finally {host.__partySteamBridge.dispose();dom.window.close();}
});

test('switcher stays at top right and switches only after explicit confirmation', async () => {
  const dom = new JSDOM('');
  const doc = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const calls = [];
  const switcher = createSwitcher({ document: doc }, async name => { calls.push(name); });
  const reply = {members:[{name:'Mage',ctype:'mage',group:'primary',online:true,hosting:'headless'}]};
  try {
    switcher.render(reply);
    const panel = doc.querySelector('#party-console-switcher');
    assert.equal(panel.style.right, '8px');
    assert.equal(panel.style.top, '8px');
    assert.equal(panel.style.transform, '');
    assert.equal(panel.style.backgroundColor, 'rgb(17, 17, 17)');
    panel.querySelector('[aria-label="Make Mage Steam Primary"]').click();
    assert.deepEqual(calls, []);
    assert.equal(doc.activeElement.textContent, 'Cancel');
    switcher.render(reply);
    assert.ok(doc.querySelector('dialog'), 'heartbeat must preserve confirmation');
    doc.querySelector('dialog button').click();
    assert.deepEqual(calls, []);
    panel.querySelector('[aria-label="Make Mage Steam Primary"]').click();
    doc.querySelector('dialog button:last-child').click();
    assert.deepEqual(calls, ['Mage']);
    assert.equal(doc.querySelector('dialog'), null);
    await Promise.resolve();
  } finally { switcher.dispose(); dom.window.close(); }
});

test('confirmation cannot switch after a competing handoff starts', () => {
  const dom = new JSDOM('');
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const calls=[];
  const switcher=createSwitcher({document:dom.window.document}, async name=>calls.push(name));
  const members=[{name:'Mage',ctype:'mage',group:'primary',online:true,hosting:'headless'}];
  try {
    switcher.render({members});
    dom.window.document.querySelector('[aria-label="Make Mage Steam Primary"]').click();
    switcher.render({members,operation:{phase:'release'}});
    dom.window.document.querySelector('dialog button:last-child').click();
    assert.deepEqual(calls,[]);
  } finally {switcher.dispose();dom.window.close();}
});

test('game-window bridge persists one generic bootstrap, releases once, and waits for navigation authorization', async () => {
  const dom = new JSDOM('', { url: 'https://adventure.land' });
  let timer, stops = 0, disconnects = 0;
  const requests = [], saved = [], cache = new Map();
  const operation = { id: 'handoff', from: 'Priest', target: 'Mage', phase: 'release', error: null };
  const host = {
    document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    character: { name: 'Priest' }, socket: { connected: true, disconnect() { this.connected = false; disconnects++; } },
    X: { codes: {}, characters: [{ name: 'Mage', id: 'mage-id' }] }, location: { href: '' },
    storage_get: key => cache.get(key), storage_set: (key, value) => cache.set(key, value),
    stop_runner() { stops++; }, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = undefined; },
    async api_call(method, payload) { saved.push({ method, payload }); return { success: true }; },
    async fetch(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      return Response.json({ operation: { ...operation }, realm: 'SR_USII', members: [{ name: 'Mage', ctype: 'mage', group: 'primary' }] });
    },
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    installSteamBridge(host);
    await settle();
    assert.equal(stops, 1);
    assert.equal(disconnects, 1);
    assert.equal(host.location.href, '', 'release is not navigation permission');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].method, 'save_code');
    assert.equal(saved[0].payload.slot, '100');
    assert.equal(saved[0].payload.electron, true, 'do not change the current code editor slot');
    const codeCache = JSON.parse(cache.get('code_cache'));
    assert.equal(codeCache['run_mage-id'], '1');
    assert.equal(codeCache['slot_mage-id'], saved[0].payload.slot);
    const sessionId = requests[0].body.sessionId;
    assert.equal(typeof sessionId, 'string');
    // A bridge/CODE reload can happen before the server receives the receipt.
    installSteamBridge(host); await settle();
    assert.equal(requests.at(-1).body.sessionId, sessionId);
    assert.equal(requests.at(-1).body.released, true);
    assert.equal(requests.at(-1).body.character, null);
    assert.equal(stops, 1);
    operation.phase = 'confirm-release';
    timer(); await settle();
    operation.phase = 'navigate';
    timer(); await settle();
    assert.equal(host.location.href, '/character/Mage/in/US/II/');
    assert.equal(saved.length, 1);
    assert.ok(host.document.querySelector('[aria-label="Give this character primary Steam control"]'));
  } finally { host.__partySteamBridge?.dispose(); dom.window.close(); }
});

// MJ49: the committed bridge bundle is the build of
// its source, so a Steam window never runs a bridge older than the console that installs it.
test('MJ49: the committed characters/steam-bridge.js carries the source steamBridgeVersion', () => {
  const { readFileSync } = require('node:fs'), path = require('node:path');
  const { steamBridgeVersion } = require('../../runtime/lifecycle/roster/connection.ts');
  const bundle = readFileSync(path.join(__dirname, '../../characters/steam-bridge.js'), 'utf8');
  assert.equal(Number(/var steamBridgeVersion = (\d+);/.exec(bundle)?.[1]), steamBridgeVersion);
});

// The version literal moves only when someone bumps it, so a source change with no bump leaves a stale
// bundle that the literal never shows. `build:runtime --check` builds in memory and names each
// committed bundle that differs from its source.
test('MJ49: the committed characters/steam-bridge.js is the build of its source', () => {
  const { spawnSync } = require('node:child_process'), path = require('node:path');
  const result = spawnSync(process.execPath, ['tools/build-runtime.mts', '--check'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
  const differing = result.stderr.split(/\r?\n/).filter(line => /steam-bridge\.js differs/.test(line));
  assert.deepEqual(differing, [], 'run npm run build:runtime -- --publish');
});

// LF25: a fresh bridge on a document already at its destination leaves
// the page, so the login it is loading finishes; a page elsewhere navigates. One fixture, two rows.
test('LF25: a fresh bridge navigates only a page that is not at the destination', async () => {
  for (const [pathname, expected] of [['/character/Mage/in/US/II/', 'unchanged'], ['/', '/character/Mage/in/US/II/']]) {
    const dom = new JSDOM('', { url: 'https://adventure.land' });
    const operation = { id: 'handoff', from: 'Priest', target: 'Mage', phase: 'navigate', error: null };
    const host = { document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
      character: null, socket: { connected: false, disconnect() {} }, X: { codes: {}, characters: [] },
      location: { pathname, href: 'unchanged' }, stop_runner() {}, setTimeout() { return 1; }, clearTimeout() {},
      fetch: async () => Response.json({ operation, realm: 'SR_USII', members: [] }) };
    try {
      installSteamBridge(host);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(host.location.href, expected, pathname);
    } finally { host.__partySteamBridge?.dispose(); dom.window.close(); }
  }
});

// LF25: the desktop injects the active release's bridge, checked against the release's hash.
test("LF25: the desktop's bridge is the active release's, and a changed one is refused", async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto');
  const { steamBridgeSource } = require('../../tools/steam/service.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-bridge-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hash = text => createHash('sha256').update(text).digest('hex');
  fs.mkdirSync(path.join(root, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(root, 'characters/steam-bridge.js'), 'source tree bridge');
  assert.equal(await steamBridgeSource(root), 'source tree bridge', 'with no release the source tree runs');
  const id = hash('release'), release = path.join(root, '.build/console/releases', id), bridge = 'active release bridge';
  fs.mkdirSync(path.join(release, 'app/characters'), { recursive: true });
  fs.writeFileSync(path.join(release, 'app/characters/steam-bridge.js'), bridge);
  const manifest = { schema: 1, id, files: { 'characters/steam-bridge.js': hash(bridge) } };
  fs.writeFileSync(path.join(release, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(release, 'complete.json'), JSON.stringify({ id, manifestHash: hash(JSON.stringify(manifest)) }));
  fs.writeFileSync(path.join(root, '.build/console/references.json'), JSON.stringify({ active: id }));
  assert.equal(await steamBridgeSource(root), bridge, "a deploy changes the desktop's bridge with no restart");
  fs.writeFileSync(path.join(release, 'app/characters/steam-bridge.js'), 'changed after the build');
  await assert.rejects(steamBridgeSource(root), /integrity/);
});
