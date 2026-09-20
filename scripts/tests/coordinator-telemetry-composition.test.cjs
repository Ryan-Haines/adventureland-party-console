const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorTelemetry}=require('../../runtime/coordinator/telemetry/composition.ts');
const {httpFixture}=require('./helpers/coordinator-http.cjs');
function fixture(){
 const http=httpFixture(),logs={},calls=[],timers=[];let owned=false,fail=true;
 const service=createCoordinatorTelemetry('host',123,logs,{
  owned:()=>owned?{name:'P'}:null,now:()=>1000,persistHistory:()=>calls.push('persist'),
  every:(callback,ms)=>{const timer={callback,ms};timers.push(timer);return timer;},cancel:timer=>calls.push(timer),
  data:{read:path=>{calls.push(['read',path]);if(fail)throw Error('cache unavailable');return 'source';},
   evaluate:(source,context,filename)=>{calls.push(['evaluate',source,filename]);context.G={geometry:{main:{min_x:0,max_x:100}}};},warn:()=>{}},
 });
 service.maps.install(http.router);service.combat.install(http.router);
 return {http,logs,calls,timers,service,own:()=>{owned=true;},readable:()=>{fail=false;}};
}

test('telemetry loads map data lazily, retries failed reads and caches successful definitions',()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 const get=()=>t.http.invoke('GET','/party-api/maps/:map',undefined,{map:'main'}).response;
 assert.throws(get,/cache unavailable/);t.readable();const first=get();assert.equal(first.body.name,'main');
 assert.equal(get().body,first.body);
 assert.deepEqual(t.calls,[['read','host/../game_files/123/data.js'],['read','host/../game_files/123/data.js'],['evaluate','source','game_files/123/data.js']]);
 assert.equal(first.headers['Cache-Control'],'public, max-age=3600');
});

test('map and combat routes share current ownership and preserve subscription cleanup and log identity',()=>{
 const t=fixture(),event={character:'P',events:[{message:'hello'}]};
 assert.equal(t.http.invoke('POST','/party-api/combat-log',event).response.code,400);
 assert.equal(t.http.invoke('GET','/party-api/map-stream/:character',undefined,{character:'P'}).response.code,404);
 t.own();assert.equal(t.http.invoke('POST','/party-api/combat-log',event).response.code,200);
 assert.deepEqual(t.logs.P,[{at:1000,type:'event',message:'hello',details:null}]);
 const stream=t.http.invoke('GET','/party-api/map-stream/:character',undefined,{character:'P'});
 assert.equal(t.service.maps.count('P'),1);assert.equal(t.timers[0].ms,15000);
 stream.request.close();assert.equal(t.service.maps.count('P'),0);assert.equal(t.calls.at(-1),t.timers[0]);
 assert.equal(t.calls.filter(call=>call==='persist').length,1);
});

test('prepared game data stays inactive until publication, then invalidates cached map definitions',()=>{
 const t=fixture();t.readable();const get=()=>t.http.invoke('GET','/party-api/maps/:map',undefined,{map:'main'}).response.body;
 const previous=get(),activate=t.service.prepareVersion(124);assert.equal(get(),previous);activate();assert.notEqual(get(),previous);
 assert.ok(t.calls.some(call=>Array.isArray(call)&&call[1]==='host/../game_files/124/data.js'));
});
