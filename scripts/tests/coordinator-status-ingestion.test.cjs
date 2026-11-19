const test=require('node:test');
const assert=require('node:assert/strict');
const {consumeStatusCatalogs}=require('../../runtime/status/coordinator/intake.ts');
const {consumeOneShotReports}=require('../../runtime/hunting/coordinator/modes.ts');
const {consumeBankReport}=require('../../runtime/items/coordinator/storage.ts');
const {consumePontyReport}=require('../../runtime/items/coordinator/market.ts');

test('catalog discovery removes report payloads while retaining prior nonempty catalogs',()=>{
 const state={travelPlaces:['existing'],bestiaryCatalog:[],skillCatalog:[],monsterChoices:[],monsterHunterLocation:null,appearanceChoices:null,merchantCatalog:null,merchantCatalogVersion:null,bankVaults:['old']};
 const body={name:'P',travelPlaces:[],monsterChoices:[{id:'goo'}],monsterLocationsVersion:'4',monsterHunterLocation:{map:'main',x:'10',y:'20'},
  merchantCatalog:{version:12},skillCatalog:[{id:'attack'}],bankVaults:[],hp:100};
 consumeStatusCatalogs(body,state);assert.deepEqual(state.travelPlaces,['existing']);assert.equal(state.monsterLocationsVersion,4);
 assert.deepEqual(state.monsterHunterLocation,{map:'main',x:10,y:20});assert.equal(state.merchantCatalogVersion,12);
 assert.deepEqual(body,{name:'P',bankVaults:[],hp:100});
});

test('scatter learning respects epochs, validates IDs, and strips one-shot fields',()=>{
 const state={types:['goo'],epoch:2};
 const stale={oneShotMonsterTypes:['rat'],oneShotEpoch:1};consumeOneShotReports(stale,state);assert.deepEqual(state.types,['goo']);
 const body={oneShotMonsterTypes:['goo','rat','bad type',1,'rat'],oneShotEpoch:2};assert.deepEqual(consumeOneShotReports(body,state),['rat','rat']);
 assert.deepEqual(state.types,['goo','rat','rat']);assert.deepEqual(body,{});
});

test('bank observation deduplicates unchanged content but adopts staging before persistence on a change',()=>{
 const state={bankSnapshot:null,bankObserver:null},effects=[];
 const ports={now:()=>100,adoptReservedCargo:()=>effects.push(['adopt',state.bankSnapshot.character]),persist:()=>effects.push('persist')};
 const report=()=>({name:'M',bank:{packs:{items1:[]},gold:10}});
 const first=report();consumeBankReport(first,state,ports);assert.deepEqual(first,{name:'M'});assert.deepEqual(effects,[['adopt','M'],'persist']);
 consumeBankReport(report(),state,ports);assert.equal(effects.length,2);consumeBankReport({name:'M'},state,ports);assert.equal(state.bankObserver,null);
 consumeBankReport(report(),state,ports);assert.equal(effects.length,4);
});

test('local Ponty reports preserve realm keys, reject invalid offers, and do not overwrite an error-free observation on an error',()=>{
 const body={name:'M',server:'USII',ponty:{updatedAt:100,listings:[{rid:'r',item:{name:'coat'},price:50},{rid:'bad',item:{name:'coat'},price:0}]}};
 const result=consumePontyReport(body,'M',item=>item.name);assert.deepEqual(result.report,{realm:'US:II',seenAt:100});
 assert.equal(result.listings.length,1);assert.equal(result.listings[0].key,'US:II:r');assert.equal(body.ponty,undefined);
 const failed=consumePontyReport({name:'M',ponty:{error:'offline'}},'M',item=>item.name);assert.equal(failed.report,undefined);
 const other={name:'P',ponty:{listings:[]}};assert.equal(consumePontyReport(other,'M',item=>item.name),null);assert.equal(other.ponty,undefined);
});

// A BankBoi checkpoint writes the bank snapshot through the one writer, so an unchanged bank
// is not written a second time.
test('a BankBoi checkpoint with an unchanged bank writes the snapshot once',()=>{
 const {createBankboiStorageRoutes}=require('../../runtime/items/coordinator/storage.ts');
 const state={merchantCharacter:'M',bankSnapshot:null,bankObserver:null,bankboiTransaction:null,bankbois:{},bankboiQueue:[],commands:{},withdrawals:{},standListings:[]},effects=[];
 const routes=createBankboiStorageRoutes(state,{now:()=>1,adopt:()=>effects.push('adopt'),persist:()=>effects.push('persist'),log(){}});
 const res=()=>({status(){return this;},json(body){this.body=body;return this;}});
 const body=()=>({character:'M',bank:{packs:{items0:[]},gold:5}});
 routes.checkpoint({body:body()},res());routes.checkpoint({body:body()},res());
 assert.deepEqual(effects,['adopt','persist']);
});

// and: a report runs every owner's intake row in table I's order, each under its own stage timer,
// and a report's `lastCommandId` moves the command sequence past it, so a command given after a
// character's reload is newer than any it holds.
{
 const { TABLE_I } = require('../../runtime/status/rules.ts');
 const { run } = require('./helpers/coordinator-host.cjs');
 const report = extra => ({ name: 'P', ctype: 'priest', map: 'main', x: 0, y: 0, server: 'USII', gold: 0, items: Array(42).fill(null), hp: 100, max_hp: 100, ...extra });
 const post = (host, body) => { let reply; host.handlers.get('/party-api/status')({ body }, { status() { return this; }, json(value) { reply = value; } }); return reply; };
 test('a report runs table I in order, each row timed', async () => {
  const rows = TABLE_I.map(row => row.stage);
  // The hunting owner's rare steps right after its report and before bankboi, as.
  assert.deepEqual(rows.slice(rows.indexOf('rareReport'), rows.indexOf('rareReport') + 3), ['rareReport', 'rareTick', 'bankboi']);
  const host = await run(1900000000000);
  const stages = Object.keys(post(host, report()).transportTiming.statusStages);
  assert.deepEqual(rows.filter(stage => !stages.includes(stage)), [], 'every row has its stage time');
  assert.deepEqual(stages.filter(stage => rows.includes(stage)), rows, "the stages ran in table I's order");
 });
 // The items owner's lucky slot evidence runs right after the bounds and ahead of the add-on stores and
 // the roster evidence, as v1.5.0 ran it first.
 test("table I runs the items owner's lucky evidence before every other report row", () => {
  const rows = TABLE_I.map(row => row.row);
  assert.deepEqual(rows.slice(0, 4), ['bounds', 'lucky-evidence', 'addon-stores', 'roster-evidence']);
  assert.equal(TABLE_I[1].owner, '10');
 });
 // The bound path: table I's `bounds` row hands each firing a report carries to
 // the status owner's bound record, the reporter as its subject unless it names one.
 test('queued bound firings in a report reach the bound record', async () => {
  const boundFirings = () => host.door('runtime/status/coordinator/api.ts').boundFirings();
  const host = await run(1900000000000);
  const before = boundFirings().counts.callMargin || 0;
  const malformed = boundFirings().counts.malformedFiring || 0;
  const firings = [{ bound: 'callMargin', owner: '06', state: { method: 'join' }, session: 's1', seq: 1 },
    { bound: 'loaderFetchMs', owner: '13', subject: 'X', state: {}, session: 's1', seq: 2 }, { owner: '06', session: 's1', seq: 3 }];
  post(host, report({ boundsFired: firings }));
  assert.equal(boundFirings().counts.callMargin, before + 1);
  assert.equal(boundFirings().counts.malformedFiring, malformed + 1, 'a malformed firing shows as its own bound');
  assert.deepEqual(boundFirings().entries.slice(-3).map(e => [e.bound, e.subject]), [['callMargin', 'P'], ['loaderFetchMs', 'X'], ['malformedFiring', 'P']]);
  // A report sent again after a lost answer carries the same firings, which count once.
  post(host, report({ boundsFired: firings }));
  assert.equal(boundFirings().counts.callMargin, before + 1, 'a resent firing counts once');
  // A cap reached in the window adds to one count per cap: the report carries one entry for it, which
  // takes no ring entry and counts once when the report goes again.
  const { capReached, boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  const capsBefore = boundFirings().caps.FIGHT_PACKETS?.count || 0, ring = boundFirings().entries.length;
  capReached('FIGHT_PACKETS', '12'); capReached('FIGHT_PACKETS', '12', 2);
  const capped = boundsPending();
  assert.deepEqual(capped.map(f => [f.bound, f.cap, f.state.count]), [['FIGHT_PACKETS', true, 3]]);
  post(host, report({ boundsFired: capped }));
  post(host, report({ boundsFired: capped }));
  assert.deepEqual(boundFirings().caps.FIGHT_PACKETS, { owner: '12', count: capsBefore + 3 });
  assert.equal(boundFirings().entries.length, ring, 'a cap takes no ring entry');
  boundsSent(capped.length);
  // The dashboard sends no report, so it posts its caps (the doll cache, an estimate's budget, yields
  // and cache) to the caps route, which counts cap entries only and fires no bound for the page.
  const dollBefore = boundFirings().caps.DOLL_CACHE_ENTRIES?.count || 0, countsBefore = { ...boundFirings().counts };
  const page = [{ bound: 'DOLL_CACHE_ENTRIES', owner: '12', cap: true, state: { count: 2 }, session: 'page', seq: 1 },
    { bound: 'callMargin', owner: '09', state: {}, session: 'page', seq: 2 }];
  for (let i = 0; i < 2; i++) host.handlers.get('/party-api/diagnostics/caps')({ body: { firings: page } }, { json() {} });
  assert.deepEqual(boundFirings().caps.DOLL_CACHE_ENTRIES, { owner: '12', count: dollBefore + 2 }, 'a resent post counts once');
  assert.deepEqual(boundFirings().counts, countsBefore, 'a dashboard post fires no bound');
 });
 test('a command given after a reload is newer than the last one the character holds', async () => {
  const host = await run(1900000000000);
  post(host, report({ lastCommandId: 900 }));
  host.handlers.get('/party-api/command')({ body: { character: 'P', type: 'town' } }, { status() { return this; }, json() {} });
  const reply = post(host, report({ lastCommandId: 900 }));
  assert.ok(Number(reply.command?.id) > 900, `the reply's command id ${reply.command?.id} is past 900`);
  // A fractional or unsafe id leaves the sequence an integer sequence.
  post(host, report({ lastCommandId: 900.5 }));
  post(host, report({ lastCommandId: Number.MAX_SAFE_INTEGER }));
  host.handlers.get('/party-api/command')({ body: { character: 'P', type: 'town' } }, { status() { return this; }, json() {} });
  assert.ok(Number.isSafeInteger(post(host, report({ lastCommandId: 900 })).command?.id), 'the next id is a safe integer');
 });
}

// A read key reaches only reads that change nothing a character does, and
// every player route the PWA, the APK and the dashboard send names its scope.
test('the app scope table sorts player routes and keeps a lease renewal from a read key', () => {
 const { appRouteScope } = require('../../runtime/status/coordinator/routes.ts');
 assert.equal(appRouteScope('GET', '/party-api/state'), 'read');
 assert.equal(appRouteScope('GET', '/party-api/diagnostics/records'), 'command', 'the read renews a lease');
 assert.equal(appRouteScope('POST', '/party-api/anniversary/chat-advertise'), 'command');
 assert.equal(appRouteScope('POST', '/party-api/dashboard-state/preview'), 'settings');
 assert.equal(appRouteScope('POST', '/party-api/dashboard-state/import'), 'settings');
 assert.equal(appRouteScope('POST', '/party-api/bank/unlock'), 'spend', 'a vault unlock pays gold');
 assert.equal(appRouteScope('POST', '/party-api/steam/switch'), 'command');
 assert.equal(appRouteScope('POST', '/party-api/slots/2/logout'), 'command');
 assert.equal(appRouteScope('POST', '/party-api/steam/bridge'), null, "the Steam window's own post takes no key");
});
// Each merchant route takes the scope of what it does.
test('the merchant stand location takes settings, and its gather, force stand and clear take command', () => {
 const { appRouteScope } = require('../../runtime/status/coordinator/routes.ts');
 assert.deepEqual(['stand-location', 'gather', 'force-stand', 'clear', 'stand', 'stale-orders/clear'].map(route => appRouteScope('POST', '/party-api/merchant/' + route)),
  ['settings', 'command', 'command', 'command', 'spend', 'spend']);
});
// The rule conflict choice writes settings, so it takes the settings scope, and the items owner's
// inventory route answers it through its area file.
test('the rule conflict choice takes the settings scope and answers a gone choice with 404', () => {
 const { appRouteScope } = require('../../runtime/status/coordinator/routes.ts');
 const { createRuleConflictRoute } = require('../../runtime/items/coordinator/routes/inventory.ts');
 assert.equal(appRouteScope('POST', '/party-api/merchant/rule-conflict'), 'settings');
 const answers = [];
 const res = { status(code) { answers.push(code); return this; }, json(body) { answers.push(body); return this; } };
 createRuleConflictRoute({ merchantCharacter: 'M', merchantRules: { conflicts: [] }, autoCompounds: {}, autoUpgradeMarks: {} }, () => {}, () => ({ ok: true }))({ body: { id: 'x', owner: 'A' } }, res);
 assert.deepEqual(answers, [404, { error: 'Rule choice no longer available' }]);
});

// The offline snapshot keeps the fields of status/rules.ts sectionFields.snapshot and the item meta of
// SNAPSHOT_META_FIELDS, so the field registry names the snapshot as a place a field is kept.
test('the offline snapshot keeps the snapshot section fields and drops every other report field', () => {
  const { createStatusIntake } = require('../../runtime/status/coordinator/intake.ts');
  const { sectionFields, SNAPSHOT_META_FIELDS } = require('../../runtime/status/rules.ts');
  const state = { statuses: {}, headlessSlots: [], steamMembers: [], steamSwitch: null, nativeOwner: null, merchantCharacter: null, scatterMonsterTypes: [], scatterEpoch: 1 };
  const ports = new Proxy({ hunting:{reportTick:(name,taskTick)=>taskTick(),oneShots:()=>[],scatterReport(){}}, now: () => 100, owned: () => true, activeNames: () => [], items: { lucky() {}, observe() {}, marketReport() {} },
    reply: { read: () => ({ ok: true }), send: () => ({ ok: true }) } }, { get: (o, k) => o[k] || (() => {}) });
  const body = { name: 'Offline', ctype: 'priest', level: 40, xp: 5, gold: 9, server: 'USII', ping: 30, command: 'x',
    items: [{ slot: 0, item: { name: 'coat' }, meta: { title: 'Coat', world: { all: true } } }], slots: {} };
  createStatusIntake(state, { Offline: {} }, ports).handle({ body }, { status() { return this; }, json() {} });
  const snapshot = state.characterSnapshots.Offline;
  assert.deepEqual(Object.keys(snapshot).filter(key => key !== 'updatedAt').sort(),
    sectionFields.snapshot.filter(key => key in body || key === 'seenAt').sort());
  assert.deepEqual(Object.keys(snapshot.items[0].meta), SNAPSHOT_META_FIELDS.filter(key => key === 'title'));
});
// The hunting owner's save window holds the tasks owner's task tick and the Hunt's own tick,
// so a task change that moves the shared Hunt persists once, and a report that moves nothing
// persists nothing.
test('D-D3: a task change that moves the shared Hunt persists once', () => {
  const { tickHuntSaved } = require('../../runtime/hunting/coordinator/api.ts');
  const party = { monsterHunt: { phase: 'before' } };
  let saves = 0;
  tickHuntSaved(party, () => { party.monsterHunt = { phase: 'task' }; party.monsterHunt.phase = 'hunt'; }, () => saves++);
  assert.equal(saves, 1);
  tickHuntSaved(party, () => {}, () => saves++);
  assert.equal(saves, 1);
});
