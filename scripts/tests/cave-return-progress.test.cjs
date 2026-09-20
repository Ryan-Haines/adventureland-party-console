const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createReturnProgressRoute}=require('../../runtime/coordinator/http/return-progress.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
test('coordinator startup retains return progress and the active Town cycle',()=>{
 const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
 const saved={returnProgress:{L:{kind:'town',cycleId:'town',revision:2,phase:'exiting-map'}}};
 assert.deepEqual(initialCommandState(saved,()=>100).returnProgress,saved.returnProgress);
});
function coordinator(){
 const state={townCycle:{id:'town',pending:['L']},deferredEventReturns:{},returnProgress:{}};let saves=0,revision=2;
 const route=createReturnProgressRoute(state,{owned:()=>true,intent:()=>({revision}),persist:()=>saves++});
 return {state,saves:()=>saves,rev:n=>revision=n,call(body){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 route({body:{character:'L',kind:'town',cycleId:'town',navigationRevision:2,...body}},res);return res;}};
}
test('return progress is monotonic and belongs to the current cycle and navigation revision',()=>{
 const f=coordinator();f.call({phase:'exiting-map'});f.call({phase:'local-town'});assert.equal(f.state.returnProgress.L.phase,'exiting-map');assert.equal(f.saves(),1);
 assert.equal(f.call({cycleId:'old',phase:'complete'}).code,409);f.rev(3);assert.equal(f.call({phase:'complete'}).code,409);
});
test('local Town is skipped at cave spawn and never repeated after reload or a map change',async()=>{
 const f=coordinator();let casts=0;
 const context={root:{},parent:{},character:{name:'L',map:'level2w',x:16,y:9},navigationIntent:{revision:2},G:{maps:{level2w:{spawns:[[16,9]]},level2:{}}},
  runtimeCurrent:()=>true,Date,town:async()=>casts++,anniversaryWithTimeout:async p=>p,sleep:async()=>{},request:async(url,options)=>f.call(options.body).body};
 const helper=source.slice(source.indexOf('  function returnPhaseRecord('),source.indexOf('  async function enforcePartyTownOverride('));
 let c=vm.createContext(context);vm.runInContext(helper,c);await c.prepareReturnExit({cycleId:'town'},'town',()=>true);assert.equal(casts,0);
 c=vm.createContext({...context,root:{},parent:{},character:{...context.character,map:'level2',x:400},__unused:null});
 c.root.__partyReturnProgress=structuredClone(f.state.returnProgress.L);vm.runInContext(helper,c);
 await c.prepareReturnExit({cycleId:'town'},'town',()=>true);assert.equal(casts,0);
});
test('Escape route progresses for longer than twenty seconds without restart, and a stalled route is bounded',async()=>{
 for(const progressing of [true,false]){
  let now=0,starts=0,stops=0;
  const c=vm.createContext({character:{map:'level2w',x:0,y:0},escapeOwns:()=>false,Date:{now:()=>now},smart:{},
   smart_move:()=>{starts++;c.smart.on_done=()=>{};return new Promise(()=>{});},stop:async()=>stops++,
   sleep:async()=>{now+=100;if(progressing){c.character.x+=1;if(now>=40000)c.character.map='main';}}});
  vm.runInContext(source.slice(source.indexOf('  async function eventReturnRouteToMain('),source.indexOf('  async function anniversaryApproach(')),c);
  const run=c.eventReturnRouteToMain({map:'main',x:0,y:0},180000,()=>true);
  if(progressing){await run;assert.equal(starts,1);assert.equal(now,40000);}
  else{await assert.rejects(run,/stalled or exhausted/);assert.equal(starts,4);assert.equal(now,60000);}
  assert.equal(stops,starts*2);
 }
});
test('late escape cleanup does not stop replacement navigation',async()=>{
 let stops=0;const c=vm.createContext({character:{map:'level2w',x:0,y:0},Date,smart:{},smart_move:()=>{c.smart.on_done=()=>{};return new Promise(()=>{});},
  sleep:async()=>{c.smart.on_done=()=>{};},stop:async()=>stops++});
 vm.runInContext(source.slice(source.indexOf('  async function eventReturnRouteToMain('),source.indexOf('  async function anniversaryApproach(')),c);
 await assert.rejects(c.eventReturnRouteToMain({map:'main',x:0,y:0},Date.now()+180000,()=>true),/superseded/);assert.equal(stops,0);
});
