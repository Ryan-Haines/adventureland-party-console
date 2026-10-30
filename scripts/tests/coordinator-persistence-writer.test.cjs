const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPersistence}=require('../../runtime/coordinator/persistence/writer.ts');
test('settings persist selections, market and production before settings and exclude transient state and auth keys',()=>{
 const writes=[],state={monsterFocus:[],merchantCharacter:'M',commands:{secret:'runtime'},production:{attempts:{}},aldata:{key:'auth-secret',trades:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.settings();
 assert.deepEqual(writes.map(write=>write[0]),['party_dashboard_selections_state_v1','party_dashboard_market_state_v1','party_dashboard_production_state_v1','party_dashboard_settings_state_v1']);
 assert.deepEqual(writes[0][1].monsterFocus,[]);assert.deepEqual(writes[1][1].aldataTrades,[1]);assert.deepEqual(writes[2][1],{production:{attempts:{}}});
 assert.equal(writes[3][1].aldataTrades,undefined);assert.equal(writes[3][1].production,undefined);assert.equal(writes[3][1].persistenceLayout,2);
 assert.equal(writes[3][1].merchantCharacter,'M');assert.equal(writes[3][1].commands,undefined);assert.equal(JSON.stringify(writes).includes('auth-secret'),false);
 state.monsterFocus=['bat'];writer.settings();assert.deepEqual(writes.find((write,index)=>index>3&&write[0]==='party_dashboard_selections_state_v1')[1].monsterFocus,['bat']);
});
test('persistence writes separate roster, bank, capped history and authentication documents',()=>{
 const writes=[],state={headlessSlots:['F'],bankbois:{B:{}},merchantActivity:Array.from({length:501},(_,i)=>i),combatLogs:{F:Array.from({length:501},(_,i)=>i)},aldata:{key:'key',auth:'YES',requestTimes:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.roster();writer.bank();writer.historyNow();writer.aldata();
 assert.deepEqual(writes.map(x=>x[0]),['party_dashboard_roster_state_v1','party_dashboard_bank_state_v1','party_dashboard_history_state_v1','party_dashboard_aldata_state_v1']);assert.deepEqual(writes[0][1],{headlessSlots:['F']});assert.deepEqual(writes[1][1],{bankbois:{B:{}}});assert.equal(writes[2][1].merchantActivity[0],1);assert.equal(writes[2][1].combatLogs.F.length,500);assert.deepEqual(writes[3][1],{key:'key',auth:'YES'});
});
test('failed first settings write prevents the second write',()=>{
 let calls=0;const writer=createCoordinatorPersistence({aldata:{}},{set(){calls++;throw Error('disk');}});
 assert.throws(()=>writer.settings(),/disk/);assert.equal(calls,1);
});

test('scheduled saves coalesce and immediate settings cancel the pending save',async()=>{
 const writes=[],state={monsterFocus:[],aldata:{}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});
 const saved=key=>writes.filter(write=>write[0]==='party_dashboard_'+key+'_state_v1').map(write=>write[1]);
 writer.scheduleSettings();state.monsterFocus=['bat'];writer.scheduleSettings();
 assert.equal(writes.length,0);writer.flush();assert.equal(saved('settings').length,1);assert.equal(saved('selections').length,1);
 assert.deepEqual(saved('selections')[0].monsterFocus,['bat']);state.monsterFocus.push('goo');
 assert.deepEqual(saved('selections')[0].monsterFocus,['bat']);
 state.threshold=5;writer.scheduleSettings();writer.settings();await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(saved('settings').length,2);assert.equal(saved('selections').length,2);
});

// History saves: docs/efficiency.md (Persistence), failure inventory P2.
const {HISTORY_SAVE_MS}=require('../../runtime/coordinator/persistence/writer.ts');
function historyFixture(t,storage){
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],state={aldata:{},merchantActivity:[],combatLogs:{W:[]}};
 const writer=createCoordinatorPersistence(state,storage||{set:(key,value)=>{if(key==='party_dashboard_history_state_v1')writes.push([key,JSON.parse(JSON.stringify(value))]);}});
 return {writes,state,writer};
}
test('a burst of history lines saves one ordered document inside the save window',t=>{
 const {writes,state,writer}=historyFixture(t);
 assert.ok(HISTORY_SAVE_MS>0&&HISTORY_SAVE_MS<=5000);
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
 const {state,writer}=historyFixture(t,{set(key,value){if(key!=='party_dashboard_history_state_v1')return;if(fail)throw Error('disk full');writes.push([key,JSON.parse(JSON.stringify(value))]);}});
 const errors=t.mock.method(console,'error',()=>{});
 state.combatLogs.W.push({at:1,message:'kept'});writer.history();
 assert.doesNotThrow(()=>t.mock.timers.tick(HISTORY_SAVE_MS));
 assert.equal(errors.mock.callCount(),1);assert.equal(writes.length,0);
 fail=false;writer.flush();
 assert.equal(writes.length,1);assert.equal(writes[0][1].combatLogs.W[0].message,'kept');
});
test('a pending history save does not keep the process alive',()=>{
 const {spawnSync}=require('node:child_process');
 const script=`const {createCoordinatorPersistence}=require('./runtime/coordinator/persistence/writer.ts');const w=createCoordinatorPersistence({aldata:{},merchantActivity:[],combatLogs:{}},{set(){}});w.history();`;
 const started=Date.now();const result=spawnSync(process.execPath,['--experimental-strip-types','-e',script],{timeout:20000});
 assert.equal(result.status,0,String(result.stderr));assert.ok(Date.now()-started<HISTORY_SAVE_MS,'exit does not wait for the history timer');
});
test('clearing a combat log saves history at once',()=>{
 const {createCombatLogRoutes}=require('../../runtime/coordinator/telemetry/combat-log.ts');
 const calls=[],routes={};
 const logs={W:[{at:1,message:'old'}]};
 createCombatLogRoutes(logs,{owned:()=>true,now:()=>1,persist:()=>calls.push('later'),persistNow:()=>calls.push('now')})
  .install({post:(path,handler)=>{routes[path]=handler;}});
 const response={status(){return this;},json(body){return body;}};
 routes['/party-api/combat-log']({body:{character:'W',events:[{message:'new'}]}},response);
 routes['/party-api/combat-log/:character/clear']({params:{character:'W'}},response);
 assert.deepEqual(calls,['later','now']);assert.deepEqual(logs.W,[]);
});

// Settings layout 2: docs/efficiency.md (Persistence), failure inventory P3 items 4-11.
const {SETTINGS_LIVENESS_MS}=require('../../runtime/coordinator/persistence/writer.ts');
function settingsFixture(t){
 const fs=require('node:fs'),path=require('node:path');
 const {CoordinatorJsonlStore}=require('../../runtime/coordinator/persistence/jsonl-store.ts');
 fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/settings-'));
 const main=path.join(dir,'state.jsonl'),store=new CoordinatorJsonlStore(main,path.join(dir,'state.new.jsonl'));
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000_000});
 const state={aldata:{marketListings:[{item:'a'}],marketBuyOrders:[],trades:[],merchantsUpdatedAt:1,tradesUpdatedAt:1,key:'auth-secret'},
  production:{attempts:{a1:{journal:{phase:'running'}}}},threshold:1,monsterFocus:[],commands:{secret:'runtime'},
  eventAttendance:{F:{mrpumpkin:{lastLiveAt:1,lastObservedAt:1,elapsedMs:0,attending:true,deaths:0}}},
  eventSessions:{F:{event:'mrpumpkin',lastLiveAt:1,authorizedAt:1,participants:['F']}},
  farmingProfiles:{F:{farmAreaState:{quiet:{area:1}},eventSessions:{F:{lastLiveAt:1}}}},
  farmAreaState:{quiet:{area:1},seen:{}},standPriceHistory:{coat:{seenAt:1,recent:10}}};
 const writer=createCoordinatorPersistence(state,store);
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
 assert.equal(SETTINGS_LIVENESS_MS,30000);
 writer.settings();const base={settings:records('settings').length,market:records('market').length,production:records('production').length};
 let lastSeen=0;
 for(let second=1;second<=65;second++){liveness(state);writer.scheduleSettings();t.mock.timers.tick(1000);if(second===29)lastSeen=Date.now();}
 const saved=records('settings').slice(base.settings);
 assert.ok(saved.length>=2&&saved.length<=3,'one save per 30 s window, saw '+saved.length);
 assert.ok(saved[0].eventAttendance.F.mrpumpkin.lastLiveAt>=lastSeen,'the window save carries the newest timestamp');
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
 writer.settings();liveness(state);writer.scheduleSettings();writer.flush();
 const settings=records('settings').at(-1);
 assert.deepEqual(settings.production,state.production);assert.deepEqual(settings.aldataMarketListings,[{item:'a'}]);
 assert.equal(settings.aldataMerchantsUpdatedAt,1);assert.equal(settings.threshold,1);assert.equal(settings.persistenceLayout,2);
 assert.equal(settings.eventAttendance.F.mrpumpkin.lastLiveAt,Date.now(),'pending timestamps are saved');
 for(const key of ['settings','market','production'])assert.equal(JSON.stringify(records(key)).includes('auth-secret'),false);
 assert.equal(settings.commands,undefined);
});
