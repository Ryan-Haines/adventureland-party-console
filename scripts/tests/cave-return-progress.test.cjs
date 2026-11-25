const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {coordinator}=require('./fixtures/cave-return-progress-scenario.cjs');
// returnPhaseRecord is walk-client.ts's.
const {installNavigation}=require('./helpers/walk-reports.cjs');

scenarioTable('a return exit tries local Town once and never at the map spawn (MOV-052)', coordinator, [

 // Step 12: the exit climbs the owner ladder, so the progress keeps the exit map and no attempt count.
 ['event exit map survives phase advancement and coordinator restoration', f=>{
 f.state.eventReturn={cycleId:'event',pending:['L']};
 f.call({kind:'event',cycleId:'event',phase:'local-town',exitMap:'ship0',exitAttempts:3});
 f.call({kind:'event',cycleId:'event',phase:'exiting-map',exitMap:'ship0'});
 const restored=JSON.parse(JSON.stringify(f.state));
 assert.equal(restored.returnProgress.L.exitMap,'ship0');
 assert.equal('exitAttempts' in restored.returnProgress.L,false,'a count from an old client is not stored');
 assert.equal(restored.returnProgress.L.phase,'exiting-map');
 assert.equal(f.call({kind:'event',cycleId:'other',phase:'complete',exitMap:'ship0'}).code,409);
 }],
 // EV31: the A/B exit's reconnect mark asks the calls owner's `realm.reconnect` once
 // per return cycle; a reconnect the calls owner could not send now leaves the rung open.
 ['the reconnect mark asks the realm owner once, and stays open when nothing was sent', f=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts'),hooks=partyHooks(),asked=[];let answer='not-now';
 hooks.register({name:'core:merchant-realm-test',folder:'core',author:'test',summary:'t',hooks:{'realm.reconnect':name=>{asked.push(name);return answer;}}});
  f.state.eventReturn={cycleId:'event',pending:['L']};
  const mark={kind:'event',cycleId:'event',phase:'exiting-map',exitMap:'abtesting',exitReconnectAttempted:true};
  assert.equal(f.call(mark).body.progress.exitReconnectAttempted,undefined,'not-now leaves the rung open');
  answer='sent';
  assert.equal(f.call(mark).body.progress.exitReconnectAttempted,true);
  f.call(mark);
  assert.deepEqual(asked,['L','L'],'a spent rung asks no second reconnect');
 }],
 ['local Town is skipped at cave spawn and never repeated after reload or a map change', async f=>{
 let casts=0;
 const context={root:{},parent:{},character:{name:'L',map:'level2w',x:16,y:9},navigationIntent:{revision:2},G:{maps:{level2w:{spawns:[[16,9]]},level2:{}}},
  runtimeCurrent:()=>true,Date,town:async()=>casts++,anniversaryWithTimeout:async p=>p,sleep:async()=>{},request:async(url,options)=>f.call(options.body).body};
 let c=createMovementContext(context);installNavigation(c);await c.prepareReturnExit({cycleId:'town'},'town',()=>true);assert.equal(casts,0);
 c=createMovementContext({...context,root:{},parent:{},character:{...context.character,map:'level2',x:400},__unused:null});
 c.root.__partyReturnProgress=structuredClone(f.state.returnProgress.L);installNavigation(c);
 await c.prepareReturnExit({cycleId:'town'},'town',()=>true);assert.equal(casts,0);
 }],
]);
