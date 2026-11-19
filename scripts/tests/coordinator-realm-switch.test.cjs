const test = require('node:test');
// The fixture's members report every 500 ms; each wait ends at the next report or its bound.
const REPORT_MS=500;
const assert = require('node:assert/strict');
const {createRealmSwitch} = require('../../runtime/merchant-realm/coordinator/party-switch.ts');
const {createShutdown} = require('../../runtime/lifecycle/coordinator/start.ts');
const {ARRIVAL_WINDOW_MS, REALM_LOGIN_MS, REALM_HOME_CONFIRM_MS, REALM_HOME_REPLY_MS} = require('../../runtime/merchant-realm/rules.ts');
const {merchantRealmSavedFields} = require('../../runtime/merchant-realm/coordinator/saved-fields.ts');

function fixture() {
  let now=1000, id=0;
  const effects=[], statuses={}, blocks={M:{enabled:true},P:{enabled:true},S:{enabled:true}};
  const operation={id:'switch',realm:'SR_EUI',participants:['M','P','S'],startedAt:1000,phase:'switching',characters:[]};
  const ports={now:()=>now,nextReport:async bound=>{const ms=Math.min(REPORT_MS,bound);now+=ms; if(operation.phase==="setting-home") for(const entry of operation.characters) entry.homeConfirmed=true;},pauseMerchant:()=>effects.push('pause'),
    clearCommand:name=>effects.push(['clear',name]),native:()=> 'S',steamMembers:()=>['S'],block:name=>blocks[name],
    stop:async block=>effects.push(['stop',block]),nextCommand:()=>++id,command:(...args)=>effects.push(['command',...args]),
    persist:()=>effects.push('persist'),status:name=>statuses[name],setActiveRealm:realm=>effects.push(['realm',realm]),
    characterHome:name=>operation.characters.find(entry=>entry.name===name&&entry.homeConfirmed)?operation.realm.replace(/^SR_/,''):null,
    refresh:async()=>{},start:()=>true,connectionCount:()=>0,label:realm=>realm,dispatchMerchant:()=>effects.push('dispatch')};
  return {operation,ports,effects,statuses,blocks,service:createRealmSwitch(ports)};
}

// The switch's three bounds are v1.5.0's values named in the call budget's rule
// table, and the settings owner holds no hidden field for them.
test('the realm switch bounds are rules.ts picks with no saved field',()=>{
  assert.deepEqual([REALM_LOGIN_MS,REALM_HOME_CONFIRM_MS,REALM_HOME_REPLY_MS],[60000,120000,30000]);
  assert.deepEqual(Object.keys(merchantRealmSavedFields.settings).filter(name=>/^realm.*Ms$/.test(name)),[]);
});

test('realm switch restarts headless workers and commands only the primary Steam character',async()=>{
  const {operation,service,statuses,effects,blocks,ports}=fixture();
  for(const name of operation.participants) statuses[name]={seenAt:1000,server:name==='S'?'USI':'EUI',ctype:name==='M'?'merchant':'priest'};
  // S is the only member still on the source realm; it logs in on the destination once it has its command.
  const nextReport=ports.nextReport;
  ports.nextReport=async bound=>{await nextReport(bound);if(effects.some(e=>Array.isArray(e)&&e[0]==='command'&&e[1]==='S'))statuses.S={...statuses.S,server:'EUI',seenAt:ports.now()};};
  await service.run(operation);
  assert.equal(operation.phase,'complete');
  assert.equal(blocks.M.realm,'SR_EUI');assert.equal(blocks.P.realm,'SR_EUI');assert.equal(blocks.S.realm,undefined);
  assert.deepEqual(effects.filter(e=>Array.isArray(e)&&e[0]==='command').map(e=>[e[1],e[2].type]),[['S','native-realm-switch']]);
  assert.equal(effects.at(-1),'dispatch');
});

test('stale destination reports do not satisfy the sixty-second arrival deadline',async()=>{
  const {operation,service,statuses,effects}=fixture();
  for(const name of operation.participants) statuses[name]={seenAt:999,server:'EUI'};
  await service.run(operation);
  assert.equal(operation.phase,'failed');assert.equal(operation.completedAt,61000);
  assert.match(operation.error,/No straggler made progress/);assert.equal(effects.includes('dispatch'),false);
});

test('verified distinct realm arrivals preserve a progressing native group through a late seventy-five-second follower',async()=>{
 const f=fixture();let elapsed=0;
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;for(const [name,arrivesAt] of [['M',20000],['S',40000],['P',75000]])
   f.statuses[name]={seenAt:1000+elapsed,server:elapsed>=arrivesAt?'EUI':'USI'};};
 f.ports.now=()=>1000+elapsed;
 await f.service.run(f.operation);assert.equal(f.operation.phase,'complete');
 assert.equal(f.operation.completedAt,76000);assert.ok(f.operation.characters.every(c=>c.arrived));
});

// An arrival never renews the window; a straggler's own report, fresh at the window's
// end, does, and a window in which no straggler reports so ends the switch. The old renewal per arrival is the bound
// this replaces (00-method answer 2).
test('a window with no straggler progress ends the switch, whatever another member reports',async()=>{
 const f=fixture();let elapsed=0;
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;f.statuses.M={seenAt:1000+elapsed,server:elapsed>=10000?'EUI':'USI'};
  f.statuses.P={seenAt:999,server:'EUI'};f.statuses.S={seenAt:1000+Math.min(elapsed,30000),server:'USI'};};
 f.ports.now=()=>1000+elapsed;
 await f.service.run(f.operation);assert.equal(f.operation.phase,'failed');assert.equal(f.operation.completedAt,61000);
 assert.match(f.operation.error,/P, S/);assert.equal(f.effects.includes('dispatch'),false);
});

// A half-failed switch with no progress rolls every participant back to the realm it left and ends
// failed:rolled-back with the stragglers named; a set home that fails sets the party's realm back.
test('a switch whose straggler makes no progress rolls the party back and names it',async()=>{
 const f=fixture();let elapsed=0;f.operation.fromRealm='SR_USI';
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;const back=f.operation.phase==='rolling-back';
  f.statuses.M={seenAt:1000+elapsed,server:back?'USI':'EUI'};f.statuses.S={seenAt:1000+elapsed,server:back?'USI':'EUI'};
  f.statuses.P={seenAt:999,server:'USI'};};
 f.ports.now=()=>1000+elapsed;
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'failed');assert.match(f.operation.error,/^failed:rolled-back; P did not reach SR_EUI/);
 assert.match(f.operation.error,/; P did not return to SR_USI$/);
 assert.equal(f.blocks.M.realm,'SR_USI');assert.equal(f.blocks.P.realm,'SR_USI');
 assert.deepEqual(f.effects.filter(e=>Array.isArray(e)&&e[0]==='command').map(e=>[e[1],e[2].type,e[2].realm]),[['S','native-realm-switch','SR_EUI'],['S','native-realm-switch','SR_USI']]);
 assert.equal(f.effects.some(e=>Array.isArray(e)&&e[0]==='realm'),false);
});
test('a straggler whose login progresses is asked again in a retrying window',async()=>{
 const f=fixture();let elapsed=0;
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;f.statuses.M={seenAt:1000+elapsed,server:'EUI'};f.statuses.S={seenAt:1000+elapsed,server:'EUI'};
  f.statuses.P={seenAt:1000+elapsed,server:elapsed>=90000?'EUI':'USI'};};
 f.ports.now=()=>1000+elapsed;
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'complete');assert.equal(f.effects.filter(e=>Array.isArray(e)&&e[0]==='stop'&&e[1]===f.blocks.P).length,2);
});
test('a set home that fails inside finish sets the party realm back',async()=>{
 const f=fixture();f.operation.fromRealm='SR_USI';f.operation.setHome=true;
 for(const name of f.operation.participants) f.statuses[name]={seenAt:1000,server:'EUI'};
 let elapsed=0;f.ports.now=()=>1000+elapsed;f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;};f.ports.characterHome=()=>null;
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'failed');
 assert.deepEqual(f.effects.filter(e=>Array.isArray(e)&&e[0]==='realm').map(e=>e[1]),['SR_EUI','SR_USI']);
});
// The game refuses M's set_home; the operation fails only once every participant is back on the
// realm it left, so the merchant stands there when the failure shows.
test('a refused set home rolls the party back before the operation fails',async()=>{
 const f=fixture();f.operation.fromRealm='SR_USI';f.operation.setHome=true;let elapsed=0;const seen=[];
 f.ports.now=()=>1000+elapsed;f.ports.characterHome=()=>null;
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;seen.push(f.operation.phase);
  if(f.operation.phase==='setting-home')f.operation.error='M: Adventure Land rejected the home realm change';
  const server=f.operation.phase==='rolling-back'&&elapsed>=5000?'USI':'EUI';
  for(const name of f.operation.participants)f.statuses[name]={seenAt:1000+elapsed,server};};
 for(const name of f.operation.participants)f.statuses[name]={seenAt:1000,server:'EUI'};
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'failed');assert.match(f.operation.error,/^M: Adventure Land rejected the home realm change/);
 assert.ok(seen.includes('rolling-back'));assert.ok(f.operation.characters.every(entry=>entry.arrived&&entry.realm==='SR_USI'));
 assert.equal(f.blocks.P.realm,'SR_USI');
 assert.deepEqual(f.effects.filter(e=>Array.isArray(e)&&e[0]==='command'&&e[2].type==='native-realm-switch').map(e=>[e[1],e[2].realm]),[['S','SR_USI']]);
 assert.deepEqual(f.effects.filter(e=>Array.isArray(e)&&e[0]==='realm').map(e=>e[1]),['SR_EUI','SR_USI']);
});

test('superseded realm operation cannot complete or clear its successor commands',async()=>{
 const f=fixture();let owned=true;
 f.ports.ownsOperation=()=>owned;
 // The reports arrive at the fixture's frozen now: a coordinator stamp is its receive time, never
 // ahead of the clock.
 f.ports.nextReport=async()=>{owned=false;for(const name of f.operation.participants)f.statuses[name]={seenAt:1000,server:'EUI'};};
 await f.service.run(f.operation);assert.notEqual(f.operation.phase,'complete');
 assert.equal(f.effects.includes('dispatch'),false);assert.equal(f.effects.filter(e=>Array.isArray(e)&&e[0]==='realm').length,0);
});

test('all-headless participants reconnect to the destination without a native command',async()=>{
 for(const setHome of [false,true]) {
  const {operation,service,ports,statuses,effects,blocks}=fixture();
  operation.setHome=setHome;ports.native=()=>null;ports.steamMembers=()=>[];
  for(const name of operation.participants) statuses[name]={seenAt:999,server:'USII',ctype:name==='M'?'merchant':'priest'};
  // A destination report at the frozen now: a coordinator stamp is never ahead of its clock.
  ports.nextReport=async()=>{
   for(const name of operation.participants) statuses[name]={...statuses[name],seenAt:1000,server:'EUI'}; if(operation.phase==='setting-home') for(const entry of operation.characters) entry.homeConfirmed=true;
  };
  await service.run(operation);
  assert.equal(operation.phase,'complete');
  for(const name of operation.participants) assert.equal(blocks[name].realm,'SR_EUI');
  assert.equal(effects.filter(e=>Array.isArray(e)&&e[0]==='stop').length,3);
  assert.ok(operation.characters.every(entry=>entry.arrived));
  const commands=effects.filter(e=>Array.isArray(e)&&e[0]==='command');
  assert.deepEqual(commands.map(e=>[e[1],e[2].type]),setHome?[['M','realm-set-home'],['P','realm-set-home'],['S','realm-set-home']]:[]);
  assert.equal(effects.includes('dispatch'),true);
 }
});

test('home assignment waits for every participant including the merchant',async()=>{
  const {operation,service,statuses,effects}=fixture();operation.setHome=true;
  for(const name of operation.participants) statuses[name]={seenAt:1000,server:'EUI',ctype:name==='M'?'merchant':'priest'};
  await service.run(operation);
  assert.equal(operation.phase,'complete');assert.deepEqual(operation.homeExecutors,['M','P','S']);
  assert.ok(operation.characters.every(entry=>entry.homeConfirmed));assert.equal(effects.at(-1),'dispatch');
});

// The merchant's leg is the realm owner's want (3.10): a retrying window asks it again, which starts
// the move's next attempt, and a blacklisted destination moves the merchant only with the
// confirmation the route accepted; a refusal ends the operation at once.
function merchantLeg(f, answer = () => 'moving') {
 const wants=[];f.ports.merchant=()=> 'M';
 f.ports.realm={want:(owner,realm,options)=>{wants.push([owner,realm,!!options.confirm,!!options.again]);return answer(options);},release:()=>{}};
 return wants;
}
test('a merchant straggler whose login progresses is asked again, and its want carries the confirmation',async()=>{
 const f=fixture();let elapsed=0;f.operation.confirmed=true;
 const wants=merchantLeg(f,options=>options.confirm?'moving':'confirm:blacklisted');
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;f.statuses.P={seenAt:f.operation.startedAt+elapsed,server:'EUI'};f.statuses.S={seenAt:f.operation.startedAt+elapsed,server:'EUI'};
  f.statuses.M={seenAt:f.operation.startedAt+elapsed,server:elapsed>=ARRIVAL_WINDOW_MS*3/2?'EUI':'USI'};};
 f.ports.now=()=>f.operation.startedAt+elapsed;
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'complete');
 assert.deepEqual(wants,[['party-switch:switch','SR_EUI',true,false],['party-switch:switch','SR_EUI',true,true]]);
});
test('A3: an unconfirmed switch to a blacklisted realm ends at the merchant leg with its reason',async()=>{
 const f=fixture();merchantLeg(f,options=>options.confirm?'moving':'confirm:blacklisted');
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'failed');assert.match(f.operation.error,/^Merchant realm want confirm:blacklisted for SR_EUI$/);
});
// A set home also visits the account characters that are offline: each logs in on the destination,
// sets its home and is stopped again, its block back as it was.
test('set home logs an offline account character in, sets its home and restores its block',async()=>{
 const f=fixture();let elapsed=0;f.operation.setHome=true;f.operation.homeTargets=['M','P','S','O'];f.blocks.O={enabled:false};
 for(const name of f.operation.participants) f.statuses[name]={seenAt:f.operation.startedAt,server:'EUI',ctype:'priest'};
 f.ports.now=()=>f.operation.startedAt+elapsed;
 f.ports.start=name=>{f.statuses[name]={seenAt:f.operation.startedAt+elapsed,server:'EUI',ctype:'priest'};return true;};
 f.ports.nextReport=async bound=>{const ms=Math.min(REPORT_MS,bound);elapsed+=ms;if(f.operation.phase==='setting-home') for(const entry of f.operation.characters) entry.homeConfirmed=true;};
 await f.service.run(f.operation);
 assert.equal(f.operation.phase,'complete');
 assert.deepEqual(f.effects.filter(e=>Array.isArray(e)&&e[0]==='command'&&e[1]==='O').map(e=>e[2].type),['realm-set-home']);
 assert.ok(f.effects.some(e=>Array.isArray(e)&&e[0]==='stop'&&e[1]===f.blocks.O));
 assert.deepEqual([f.blocks.O.enabled,f.blocks.O.realm],[false,undefined]);
});

// The coordinator run stops after the workers and before storage closes.
test('shutdown waits for workers, stops the run before closing storage and ignores duplicate requests',async()=>{
  const effects=[];let finish;
  const shutdown=createShutdown({log:()=>{},stopCharacters:()=>new Promise(resolve=>{effects.push('stop');finish=resolve;}),
    stopRun:()=>effects.push('run'),timers:{setTimeout,clearTimeout},closeStorage:()=>effects.push('close'),exit:()=>effects.push('exit')});
  const pending=shutdown('SIGTERM');await shutdown('reload');assert.deepEqual(effects,['stop']);
  finish();await pending;assert.deepEqual(effects,['stop','run','close','exit']);
});

// A switch's wait ends on the member's report (the status owner's `status.received`, which the realm source
// answers), not on a poll of the statuses; with no report, its bound ends it.
test('a realm wait ends at the next member report, or at its bound with none',async()=>{
 const {nextReport}=require('../../runtime/merchant-realm/coordinator/report-wait.ts');
 const {merchantRealmSource}=require('../../runtime/merchant-realm/api.ts');
 let release;const scope={sleep:()=>new Promise(r=>{release=r;})};
 let woke=false;const waiting=nextReport(scope,60000).then(()=>{woke=true;});
 await new Promise(r=>setImmediate(r));assert.equal(woke,false);
 merchantRealmSource(()=>({}),()=>undefined).hooks['status.received']({character:'P'});await waiting;assert.equal(woke,true);
 let bounded=false;const silent=nextReport(scope,60000).then(()=>{bounded=true;});release();await silent;assert.equal(bounded,true);
});
