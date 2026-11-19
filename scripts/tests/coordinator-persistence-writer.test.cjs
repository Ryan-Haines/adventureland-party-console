const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPersistence}=require('../../runtime/settings/coordinator/persistence/writer.ts');
const {hidden}=require('./helpers/declared.cjs');
// Storage that records each write's key and a copy of its value in `writes`. `only` keeps one key's
// writes; `fails` throws the disk's error while it answers true.
const recordingStorage=(writes,{only,fails=()=>false}={})=>({set(key,value){if(only&&key!==only)return;if(fails())throw Error('disk full');writes.push([key,JSON.parse(JSON.stringify(value))]);}});
test('settings persist selections, market and production before settings and exclude transient state and auth keys',()=>{
 const writes=[],state={monsterFocus:[],merchantCharacter:'M',commands:{secret:'runtime'},production:{attempts:{}},aldata:{key:'auth-secret',trades:[1]}};
 const writer=createCoordinatorPersistence(state,recordingStorage(writes),{setTimeout,clearTimeout});writer.settings();
 assert.deepEqual(writes.map(write=>write[0]),['party_dashboard_selections_state_v1','party_dashboard_market_state_v1','party_dashboard_production_state_v1','party_dashboard_settings_state_v1']);
 assert.deepEqual(writes[0][1].monsterFocus,[]);assert.deepEqual(writes[1][1].aldataTrades,[1]);assert.deepEqual(writes[2][1],{production:{attempts:{}}});
 assert.equal(writes[3][1].aldataTrades,undefined);assert.equal(writes[3][1].production,undefined);assert.equal(writes[3][1].persistenceLayout,2);
 assert.equal(writes[3][1].merchantCharacter,'M');assert.equal(writes[3][1].commands,undefined);assert.equal(JSON.stringify(writes).includes('auth-secret'),false);
 state.monsterFocus=['bat'];writer.settings();assert.deepEqual(writes.find((write,index)=>index>3&&write[0]==='party_dashboard_selections_state_v1')[1].monsterFocus,['bat']);
});
test('persistence writes separate roster, bank, capped history and authentication documents',()=>{
 const writes=[],state={headlessSlots:['F'],bankbois:{B:{}},merchantActivity:Array.from({length:501},(_,i)=>i),settingsChanges:[],combatLogs:{F:Array.from({length:501},(_,i)=>i)},aldata:{key:'key',auth:'YES',requestTimes:[1]}};
 const writer=createCoordinatorPersistence(state,recordingStorage(writes),{setTimeout,clearTimeout});writer.roster();writer.bank();writer.historyNow();writer.aldata();
 assert.deepEqual(writes.map(x=>x[0]),['party_dashboard_roster_state_v1','party_dashboard_bank_state_v1','party_dashboard_history_state_v1','party_dashboard_aldata_state_v1']);assert.deepEqual(writes[0][1],{headlessSlots:['F']});assert.deepEqual(writes[1][1],{bankbois:{B:{}}});assert.equal(writes[2][1].merchantActivity[0],1);assert.equal(writes[2][1].combatLogs.F.length,500);assert.deepEqual(writes[3][1],{key:'key',auth:'YES'});
});
test('failed first settings write prevents the second write',()=>{
 let calls=0;const writer=createCoordinatorPersistence({aldata:{}},{set(){calls++;throw Error('disk');}},{setTimeout,clearTimeout});
 assert.throws(()=>writer.settings(),/disk/);assert.equal(calls,1);
});

test('scheduled saves coalesce and immediate settings cancel the pending save',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],state={monsterFocus:[],aldata:{}};
 const writer=createCoordinatorPersistence(state,recordingStorage(writes),{setTimeout,clearTimeout});
 const saved=key=>writes.filter(write=>write[0]==='party_dashboard_'+key+'_state_v1').map(write=>write[1]);
 writer.scheduleSettings();state.monsterFocus=['bat'];writer.scheduleSettings();
 assert.equal(writes.length,0);writer.flush();assert.equal(saved('settings').length,1);assert.equal(saved('selections').length,1);
 assert.deepEqual(saved('selections')[0].monsterFocus,['bat']);state.monsterFocus.push('goo');
 assert.deepEqual(saved('selections')[0].monsterFocus,['bat']);
 state.threshold=5;writer.scheduleSettings();writer.settings();t.mock.timers.tick(hidden('settingsSaveDelayMs')+1);
 assert.equal(saved('settings').length,2);assert.equal(saved('selections').length,2);
});

// History saves: docs/efficiency.md (Persistence), failure inventory P2.
const {hiddenValue}=require('../../runtime/settings/coordinator/table.ts');
const HISTORY_SAVE_MS=hiddenValue('historySaveMs');
function historyFixture(t,storage){
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],state={aldata:{},merchantActivity:[],settingsChanges:[],combatLogs:{W:[]}};
 const writer=createCoordinatorPersistence(state,storage||recordingStorage(writes,{only:'party_dashboard_history_state_v1'}),{setTimeout,clearTimeout});
 return {writes,state,writer};
}
test('a burst of history lines saves one ordered document inside the save window',t=>{
 const {writes,state,writer}=historyFixture(t);
 assert.ok(HISTORY_SAVE_MS>0);
 for(let i=0;i<50;i++){state.combatLogs.W.push({at:i,message:'line '+i});writer.history();}
 assert.equal(writes.length,0,'no document per line');
 t.mock.timers.tick(HISTORY_SAVE_MS-1);assert.equal(writes.length,0);
 state.combatLogs.W.push({at:50,message:'line 50'});writer.history();
 t.mock.timers.tick(1);
 assert.equal(writes.length,1);assert.equal(writes[0][0],'party_dashboard_history_state_v1');
 assert.deepEqual(writes[0][1].combatLogs.W.map(entry=>entry.at),Array.from({length:51},(_,i)=>i),'every line, in order, once');
 t.mock.timers.tick(HISTORY_SAVE_MS*3);assert.equal(writes.length,1,'clean history does not save again');
 state.merchantActivity.push({at:99,message:'merchant'});writer.history();t.mock.timers.tick(HISTORY_SAVE_MS);
 assert.equal(writes.length,2);assert.equal(writes[1][1].merchantActivity.length,1);
});
test('shutdown flush saves pending history once and cancels the timer',t=>{
 const {writes,state,writer}=historyFixture(t);
 state.combatLogs.W.push({at:1,message:'last words'});writer.history();
 writer.flush();assert.equal(writes.length,1);assert.equal(writes[0][1].combatLogs.W[0].message,'last words');
 t.mock.timers.tick(HISTORY_SAVE_MS*2);assert.equal(writes.length,1);
 writer.flush();assert.equal(writes.length,1,'nothing pending after flush');
});
test('historyNow saves at once and replaces a pending save',t=>{
 const {writes,state,writer}=historyFixture(t);
 state.combatLogs.W.push({at:1,message:'old'});writer.history();
 state.combatLogs.W=[];writer.historyNow();
 assert.equal(writes.length,1);assert.deepEqual(writes[0][1].combatLogs.W,[]);
 t.mock.timers.tick(HISTORY_SAVE_MS);assert.equal(writes.length,1);
});
test('a failed timed history save is reported, stays pending and succeeds on flush',t=>{
 let fail=true;const writes=[];
 const {state,writer}=historyFixture(t,recordingStorage(writes,{only:'party_dashboard_history_state_v1',fails:()=>fail}));
 const errors=t.mock.method(console,'error',()=>{});
 state.combatLogs.W.push({at:1,message:'kept'});writer.history();
 assert.doesNotThrow(()=>t.mock.timers.tick(HISTORY_SAVE_MS));
 assert.equal(errors.mock.callCount(),1);assert.equal(writes.length,0);
 fail=false;writer.flush();
 assert.equal(writes.length,1);assert.equal(writes[0][1].combatLogs.W[0].message,'kept');
});
// The history timer belongs to the settings owner's run scope handle, so the run's stop clears it
// and no pending save keeps the process alive.
test('the run stop clears a pending history save',()=>{
 const {createCoordinatorRun}=require('../../runtime/lifecycle/character/run.ts');
 const started=[],cleared=[];
 const timers={setTimeout:(fn,ms)=>{const handle={fn,ms};started.push(handle);return handle;},clearTimeout:handle=>cleared.push(handle),setInterval,clearInterval};
 const run=createCoordinatorRun(timers);
 const writer=createCoordinatorPersistence({aldata:{},merchantActivity:[],settingsChanges:[],combatLogs:{}},{set(){}},run.scope('11','act'));
 writer.history();
 assert.deepEqual(started.map(handle=>handle.ms),[HISTORY_SAVE_MS]);
 run.stop();
 assert.deepEqual(cleared,started);
});
// Settings layout 2: docs/efficiency.md (Persistence), failure inventory P3 items 4-11.
const SETTINGS_LIVENESS_MS=hiddenValue('settingsLivenessMs');
function settingsFixture(t){
 const fs=require('node:fs'),path=require('node:path');
 const {CoordinatorJsonlStore}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
 fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/settings-'));
 const main=path.join(dir,'state.jsonl'),store=new CoordinatorJsonlStore(main,path.join(dir,'state.new.jsonl'),{setTimeout,clearTimeout});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000_000});
 const state={aldata:{marketListings:[{item:'a'}],marketBuyOrders:[],trades:[],merchantsUpdatedAt:1,tradesUpdatedAt:1,key:'auth-secret'},
  production:{attempts:{a1:{journal:{phase:'running'}}}},threshold:1,monsterFocus:[],commands:{secret:'runtime'},
  eventAttendance:{F:{mrpumpkin:{lastLiveAt:1,lastObservedAt:1,elapsedMs:0,attending:true,deaths:0}}},
  eventSessions:{F:{event:'mrpumpkin',lastLiveAt:1,authorizedAt:1,participants:['F']}},
  farmingProfiles:{F:{farmAreaState:{quiet:{area:1}},eventSessions:{F:{lastLiveAt:1}}}},
  farmAreaState:{quiet:{area:1},seen:{}},standPriceHistory:{coat:{seenAt:1,recent:10}}};
 const writer=createCoordinatorPersistence(state,store,{setTimeout,clearTimeout});
 const records=key=>fs.readFileSync(main,'utf8').split('\n').filter(line=>line.startsWith('{"party_dashboard_'+key+'_state_v1":')).map(line=>Object.values(JSON.parse(line))[0]);
 return {state,writer,records,store};
}
function liveness(state){
 const now=Date.now(),entry=state.eventAttendance.F.mrpumpkin;
 entry.lastLiveAt=entry.lastObservedAt=now;entry.elapsedMs+=1000;
 state.eventSessions.F.lastLiveAt=state.eventSessions.F.authorizedAt=now;
 state.farmingProfiles.F.eventSessions.F.lastLiveAt=now;state.farmingProfiles.F.farmAreaState.quiet.area=now;
 state.farmAreaState.quiet.area=now;state.farmAreaState.seen['["X","1"]']=now;state.standPriceHistory.coat.seenAt=now;
}
test('liveness timestamps save at most once per window and never rewrite market or production',t=>{
 const {state,writer,records}=settingsFixture(t);
 writer.settings();const base={settings:records('settings').length,market:records('market').length,production:records('production').length};
 let lastSeen=0;
 for(let second=1;second<=65;second++){liveness(state);writer.scheduleSettings();t.mock.timers.tick(1000);if(second===29)lastSeen=Date.now();}
 const saved=records('settings').slice(base.settings);
 // Mocked time starts at 1_000_000 ms: the saves land when the 30 s window opens after second 29 and second 59.
 assert.deepEqual(saved.map(doc=>doc.eventAttendance.F.mrpumpkin.lastLiveAt),[1_000_000+29_000,1_000_000+59_000],'one save per 30 s window');
 assert.equal(lastSeen,1_000_000+29_000);
 assert.equal(records('market').length,base.market);assert.equal(records('production').length,base.production);
});
test('a material change saves within a second and carries pending timestamps',t=>{
 const {state,writer,records}=settingsFixture(t);
 writer.settings();const before=records('settings').length;
 liveness(state);writer.scheduleSettings();t.mock.timers.tick(1000);assert.equal(records('settings').length,before);
 liveness(state);const at=Date.now();state.threshold=2;writer.scheduleSettings();t.mock.timers.tick(1000);
 const saved=records('settings');assert.equal(saved.length,before+1);
 assert.equal(saved.at(-1).threshold,2);assert.equal(saved.at(-1).eventAttendance.F.mrpumpkin.lastLiveAt,at);
});
test('other changes inside liveness fields save within a second',t=>{
 const {state,writer,records}=settingsFixture(t);
 writer.settings();let count=records('settings').length;
 for(const change of [
  ()=>{state.eventAttendance.F.mrpumpkin.ignored='time limit';},
  ()=>{state.eventAttendance.F.mrgreen={lastLiveAt:Date.now(),attending:false};},
  ()=>{state.farmAreaState.quiet.other=Date.now();},
  ()=>{state.eventSessions.F.participants.push('G');},
  ()=>{state.standPriceHistory.coat.recent=11;},
 ]){
  t.mock.timers.tick(1000);change();writer.scheduleSettings();t.mock.timers.tick(1000);
  assert.equal(records('settings').length,++count);
 }
});
test('a market refresh saves the market document once',t=>{
 const {state,writer,records}=settingsFixture(t);
 writer.settings();const before=records('market').length;
 state.aldata.marketListings=[{item:'b'}];state.aldata.merchantsUpdatedAt=2;writer.scheduleSettings();t.mock.timers.tick(1000);
 assert.equal(records('market').length,before+1);assert.deepEqual(records('market').at(-1).aldataMarketListings,[{item:'b'}]);
 state.threshold=3;writer.scheduleSettings();t.mock.timers.tick(1000);assert.equal(records('market').length,before+1);
 state.production.attempts.a1.journal.phase='complete';writer.scheduleSettings();t.mock.timers.tick(1000);
 assert.equal(records('production').at(-1).production.attempts.a1.journal.phase,'complete');assert.equal(records('market').length,before+1);
});
test('shutdown leaves a settings document a v1.4.0 build reads in full',t=>{
 const {state,writer,records}=settingsFixture(t);
 // Every farming scope saves the single mode a v1.4.0 build reads, derived from its pair.
 Object.assign(state,{leader:'F',followers:{},merchantCharacter:null});
 Object.assign(state.farmingProfiles.F,{combatMode:'scatter',targetMode:'farming',farmAreaState:state.farmAreaState});
 state.farmingProfiles.G={combatMode:'default',targetMode:'hunt'};state.farmingProfiles.H={combatMode:'default',targetMode:'achievements'};
 require('../../runtime/tasks/coordinator/groups.ts').createFarmingScopes(state, require('../../runtime/settings/coordinator/table.ts').coordinatorSettings().lists);
 writer.settings();liveness(state);writer.scheduleSettings();writer.flush();
 const settings=records('settings').at(-1);
 assert.deepEqual(settings.production,state.production);assert.deepEqual(settings.aldataMarketListings,[{item:'a'}]);
 assert.equal(settings.aldataMerchantsUpdatedAt,1);assert.equal(settings.threshold,1);assert.equal(settings.persistenceLayout,2);
 assert.equal(settings.eventAttendance.F.mrpumpkin.lastLiveAt,Date.now(),'pending timestamps are saved');
 for(const key of ['settings','market','production'])assert.equal(JSON.stringify(records(key)).includes('auth-secret'),false);
 assert.equal(settings.commands,undefined);
 assert.equal(settings.farmingPolicy,'scatter','the party scope saves its derived mode');
 assert.deepEqual(Object.fromEntries(Object.entries(settings.farmingProfiles).map(([n,p])=>[n,[p.combatMode,p.targetMode,p.farmingPolicy]])),
  {F:['scatter','farming','scatter'],G:['default','hunt','hunt'],H:['default','achievements','achievements']});
});

// Every persistence window reads its hidden setting's declared value, and none keeps its own
// literal. The row plants a short value in each declaration before the persistence starts and
// checks that window follows it.
test('each persistence window reads its declared hidden setting',t=>{
 const {table}=require('../../runtime/settings/coordinator/table.ts').coordinatorSettings();
 const planted={historySaveMs:40,settingsSaveDelayMs:20,settingsLivenessMs:300,historyKept:3,rosterSnapshotSaveMs:50};
 for(const [field,value] of Object.entries(planted)){
  const d=table.fields.get(field);assert.ok(d&&!d.record&&d.setting.hidden,field+' is a hidden setting');
  const was=d.setting.default;d.setting.default=value;t.after(()=>{d.setting.default=was;});
 }
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000_000});
 const writes=[],state={aldata:{},monsterFocus:[],merchantActivity:Array.from({length:5},(_,i)=>i),settingsChanges:[],combatLogs:{W:[]},
  eventAttendance:{F:{e:{lastLiveAt:1}}}};
 const writer=createCoordinatorPersistence(state,recordingStorage(writes),{setTimeout,clearTimeout});
 const saved=key=>writes.filter(w=>w[0]==='party_dashboard_'+key+'_state_v1').map(w=>w[1]);
 writer.history();t.mock.timers.tick(39);assert.equal(saved('history').length,0);t.mock.timers.tick(1);
 assert.equal(saved('history').length,1,'historySaveMs');assert.deepEqual(saved('history')[0].merchantActivity,[2,3,4],'historyKept');
 writer.scheduleSettings();t.mock.timers.tick(19);assert.equal(saved('settings').length,0);t.mock.timers.tick(1);
 assert.equal(saved('settings').length,1,'settingsSaveDelayMs');
 state.eventAttendance.F.e.lastLiveAt=Date.now();writer.scheduleSettings();t.mock.timers.tick(100);
 assert.equal(saved('settings').length,1,'a liveness change waits for settingsLivenessMs');
 t.mock.timers.tick(200);assert.equal(saved('settings').length,2,'settingsLivenessMs');
 const {snapshotSaveDue}=require('../../runtime/settings/coordinator/persistence/roster-snapshots.ts');
 const roster={characterSnapshots:{F:{}}},refresh=()=>{};
 assert.equal(snapshotSaveDue(roster,'F',false,0,refresh),true);assert.equal(snapshotSaveDue(roster,'F',false,49,refresh),false);
 assert.equal(snapshotSaveDue(roster,'F',false,50,refresh),true,'rosterSnapshotSaveMs');
});

// `settings.saved` hears a document only when the store appended it. The journal store
// skips a document equal to its last record, so a second save of unchanged state announces
// nothing, and a change announces only the document it changed.
test('the saved notice hears only the documents the journal store appended',t=>{
 const fs=require('node:fs'),path=require('node:path');
 const {CoordinatorJsonlStore}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
 fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/saved-'));
 const store=new CoordinatorJsonlStore(path.join(dir,'state.jsonl'),path.join(dir,'state.new.jsonl'),{setTimeout,clearTimeout});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const heard=[],state={monsterFocus:[],merchantCharacter:'M',production:{attempts:{}},aldata:{trades:[]}};
 const writer=createCoordinatorPersistence(state,store,{setTimeout,clearTimeout},document=>heard.push(document));
 writer.settings();assert.deepEqual(heard,['selections','market','production','settings']);
 heard.length=0;writer.settings();assert.deepEqual(heard,[]);
 state.monsterFocus=['bat'];writer.settings();assert.deepEqual(heard,['selections']);
});
// The settings and history save timers go through the settings owner's run scope handle, so the
// run's stop clears them; the writer starts no timer of its own.
test('the save timers go through the run scope handle the writer is given',()=>{
 const set=[],cleared=[];let next=0;
 const timers={setTimeout:(callback,ms)=>{set.push(ms);return ++next;},clearTimeout:id=>{if(id!==undefined)cleared.push(id);}};
 const state={monsterFocus:[],production:{attempts:{}},aldata:{},merchantActivity:[],combatLogs:{},settingsChanges:[]};
 const writer=createCoordinatorPersistence(state,{set(){return true;}},timers);
 writer.scheduleSettings();writer.history();
 assert.deepEqual(set,[hidden('settingsSaveDelayMs'),hidden('historySaveMs')]);
 writer.settings();writer.historyNow();
 assert.deepEqual(cleared,[1,2]);
});
