const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('characters/shared.js','utf8');
const code=source.slice(source.indexOf('  function reloadConvoyGeometry('),source.indexOf('  function sharedConvoyDistance('));
function fixture(headless=false){
 const calls=[],timers=[],signal={id:'c',epoch:2,commandId:9,geometryReload:{id:'repair',runtimeId:'old',deadline:2000}};
 const context=vm.createContext({Date:{now:()=>1000},coordinatorClockOffset:0,convoyRuntimeId:'old',navigationIntent:{revision:4},
 convoyTraveling:{id:'c',epoch:2,commandId:9,phase:'held',navigationRevision:4},runtimeCurrent:()=>true,game_log(){},
 parent:{caracAL:headless,setTimeout:fn=>timers.push(fn),start_runner:(...args)=>calls.push(args)},
 $:{ajax:options=>{calls.push(options);return {then:fn=>fn('globalThis.installed=true;')};}}});
 vm.runInContext(code,context);return {context,signal,calls,timers};
}
for(const headless of [false,true])test('geometry reload runs once in '+(headless?'headless':'browser')+' runtime',()=>{
 const f=fixture(headless);f.context.reloadConvoyGeometry(f.signal);f.context.reloadConvoyGeometry(f.signal);
 assert.equal(f.timers.length,1);f.timers[0]();assert.equal(f.calls.length,1);
 if(headless)assert.equal(f.context.installed,true);else assert.equal(f.calls[0][0],'maincode');
});
test('an old browser game build reloads the game page once, not just CODE',()=>{
 const f=fixture();f.signal.geometryReload.expected={version:17175,fingerprint:'same'};
 f.context.movement={identity:{version:17139,fingerprint:'same'}};
 let reloads=0;f.context.parent.location={reload:()=>reloads++};
 f.context.reloadConvoyGeometry(f.signal);f.context.reloadConvoyGeometry(f.signal);f.timers[0]();
 assert.equal(reloads,1);assert.equal(f.calls.length,0);
});
for(const field of ['id','epoch','commandId','runtimeId','deadline','revision','cancelled','phase'])test('geometry reload rejects stale '+field,()=>{
 const f=fixture(),c=f.context;
 if(['id','epoch','commandId'].includes(field))f.signal[field]='other';
 if(field==='runtimeId')f.signal.geometryReload.runtimeId='new';
 if(field==='deadline')f.signal.geometryReload.deadline=900;
 if(field==='revision')c.navigationIntent.revision++;
 if(field==='cancelled')c.navigationIntent.cancelled=true;
 if(field==='phase')c.convoyTraveling.phase='travelling';
 c.reloadConvoyGeometry(f.signal);assert.equal(f.timers.length,0);
});
