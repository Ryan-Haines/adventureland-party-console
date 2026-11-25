const {productionFunctions} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyGameLog,showGameLog,defaultLogFilters}=require('../../runtime/status/game-log.ts');
const {installGameLogs}=require('../../runtime/status/character/telemetry.ts');
const {appendGameLogs,gameLogs}=require('../../runtime/status/coordinator/logs.ts');
const {exportDashboardSettings,parseDashboardImport,applyDashboardImport}=require('../../runtime/settings/coordinator/persistence/dashboard-import.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {initialAnniversaryState}=require('../../runtime/events/coordinator/anniversary.ts');
function response(){return {code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('game filters prioritize errors and retain unmatched entries',()=>{
 assert.equal(classifyGameLog('Upgrade failed: not enough gold'),'errors');assert.equal(classifyGameLog('Found a ring'),'items');
 assert.equal(showGameLog(classifyGameLog('Killed goo'),defaultLogFilters),false);
 assert.equal(showGameLog(classifyGameLog('Welcome'),defaultLogFilters),true);
});
test('capture retains failed batches, preserves original logging and survives reinstall without duplicate hooks',async()=>{
 const rendered=[],sent=[],host={add_log:(...args)=>rendered.push(args)};
 const first=installGameLogs(host,async()=>{throw Error('offline');});host.add_log('found item','#fff');await first.pulse();
 const second=installGameLogs(host,async events=>sent.push(events));host.add_log('gold received','gold');await second.pulse();await second.pulse();
 assert.equal(rendered.length,2);assert.equal(sent.length,1);assert.equal(sent[0].length,2);assert.deepEqual(sent[0].map(e=>e.seq),[1,2]);
});
test('game ingestion rejects outsiders, deduplicates retries and bounds history',()=>{
 const event={session:'session',seq:1,at:10,message:'gold',color:'#fff'};
 assert.equal(appendGameLogs({body:{character:'X',events:[event]}},response(),()=>false).code,400);
 for(let i=0;i<12;i++)appendGameLogs({body:{character:'Test',events:Array.from({length:100},(_,n)=>({...event,seq:i*100+n+1}))}},response(),()=>true);
 appendGameLogs({body:{character:'Test',events:[{...event,seq:1200}]}},response(),()=>true);
 assert.equal(gameLogs.Test.length,1000);assert.equal(gameLogs.Test[0].seq,201);delete gameLogs.Test;
});
test('settings JSON round trip includes new preferences without credentials or active work',()=>{
 const original={bankboiPrefix:'MyBank',anniversaryAutoChat:false,threshold:10,autoCompounds:{M:[]},secret:'hide',merchantQueue:[1],anniversary:{blacklist:['old']}};
 const exported=exportDashboardSettings(original),parsed=parseDashboardImport(JSON.stringify(exported),n=>n==='M');
 assert.deepEqual(parsed.values,{bankboiPrefix:'MyBank',anniversaryAutoChat:false,threshold:10,autoCompounds:{M:[]}});
 assert.ok(!JSON.stringify(exported).includes('hide'));assert.ok(!JSON.stringify(exported).includes('blacklist'));
 assert.throws(()=>parseDashboardImport(JSON.stringify({...exported,version:99}),()=>true));
 // An add-on setting declared importable
 // travels under its add-on's name; the import sets it for the characters the account owns and
 // keeps the add-on's switch; a setting the add-on does not mark importable stays out.
 const addons=[{name:'planted',settings:{stance:{label:'Stance',kind:'per-character',choices:['near','far'],default:{},importable:true},
  hidden:{label:'Hidden',kind:'boolean',default:false}}}];
 const carried=exportDashboardSettings({...original,addons:{planted:{enabled:true,settings:{stance:{M:'far',Gone:'near'},hidden:true}}}},addons);
 assert.deepEqual(carried.settings.addons,{planted:{settings:{stance:{M:'far',Gone:'near'}}}});
 const back=parseDashboardImport(JSON.stringify(carried),n=>n==='M',addons);
 assert.deepEqual(back.values.addons,{planted:{settings:{stance:{M:'far'}}}});
 assert.deepEqual(back.skippedCharacters,{Gone:['addons']});
 // Since the settings rework the writer checks each imported add-on value by its kind, as an
 // addressed change per key and per fighter.
 const {loaded}=require('./fixtures/hook-registry-scenario.cjs'),hooks=loaded();
 hooks.register({...addons[0],folder:'addons',author:'test',summary:'test',hooks:{}});
 const state={addons:{planted:{enabled:false,settings:{hidden:true}}}};
 assert.equal(applyDashboardImport(state,back,settingsWriter(state,{hooks,fighters:()=>['M']}).write),null);
 assert.deepEqual(state.addons,{planted:{enabled:false,settings:{hidden:true,stance:{M:'far'}}}});
 const bad=parseDashboardImport(JSON.stringify({...carried,settings:{addons:{planted:{settings:{stance:{M:'sideways'}}}}}}),()=>true,addons);
 const refused=applyDashboardImport(state,bad,settingsWriter(state,{hooks,fighters:()=>['M']}).write);
 assert.equal(refused.error,'Stance takes one of near, far for each character');
 assert.deepEqual(state.addons.planted.settings.stance,{M:'far'},'a refused import writes nothing');
});
test('blacklist migration drops blacklist aborts but preserves failed-round protection',()=>{
 const state=initialAnniversaryState({blacklist:['old'],abortedRounds:{a:{reason:'target-blacklisted'},b:{reason:'kiss-timeout'}}});
 assert.equal(Object.hasOwn(state,'blacklist'),false);assert.deepEqual(Object.keys(state.abortedRounds),['b']);
});

// Ported from v1.5.0 4cbaff64. The schedule report is the event clock's (runtime/events/character/clock.ts)
// with movement's report clock offset as its `reportOffset`.
test('published daily occurrences retain UTC day rollover without guessing legacy slots',()=>{
 const {installEventClock}=require('../../runtime/events/character/clock.ts');
 const now=Date.UTC(2026,8,18,0,0);
 const clock=installEventClock({now:()=>now,reportOffset:()=>0,names:()=>['franky','goobrawl'],
  feed:()=>({schedule:{time_offset:-5,events:[
 {id:'old',event:'franky',at:now-1,status:'scheduled'},
 {id:'franky-next',event:'franky',at:Date.UTC(2026,8,18,4),status:'scheduled'},
 {id:'goo-next',event:'goobrawl',at:Date.UTC(2026,8,18,1),status:'scheduled'}]}}),
  game:()=>({events:{franky:{name:'Franky'},goobrawl:{name:'Goobrawl'}}}),doors:()=>null,cipher:()=>({merchant:null,gathering:null})});
 const schedule=clock.schedule();assert.equal(schedule.find(e=>e.id==='franky').next,Date.UTC(2026,8,18,4));
 assert.equal(schedule.find(e=>e.id==='goobrawl').next,Date.UTC(2026,8,18,1));assert.equal(schedule[0].occurrences.length,1);
});
