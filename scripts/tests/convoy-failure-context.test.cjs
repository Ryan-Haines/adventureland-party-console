const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 let now=5000,mono=5000;const logs=[];
 const r=vm.createContext({Date:{now:()=>now},performance:{now:()=>mono},coordinatorClockOffset:100,convoyRuntimeId:'runtime-1',
 character:{map:'arena',x:-129,y:-208},root:{},game_log:message=>logs.push(message),
 convoySignal:{id:'convoy-1',epoch:7,commandId:9,runtimeId:'runtime-1',routeVersion:3,validUntil:6000}});
 for(const name of ['convoySignalExpired','captureConvoyFailureContext','logConvoyFailureContext','convoyDiagnosticClock','rememberConvoyStatusRequest'])vm.runInContext(namedFunction(source,name),r);
 const convoy={id:'convoy-1',epoch:7,commandId:9,phase:'travelling'},command={routeProtocol:4,routeVersion:3,location:{map:'arena',x:384,y:-420}};
 return {r,logs,convoy,command,time(wall,elapsed=wall){now=wall;mono=elapsed;},capture(){r.captureConvoyFailureContext(convoy,command);return convoy.failureContext;}};
}
test('expired matching signal produces copyable pre-cancellation context and HTTP timings',()=>{
 const f=fixture();f.r.rememberConvoyStatusRequest(4000,'success');f.time(6800);f.r.rememberConvoyStatusRequest(5500,'network');
 const c=f.capture();assert.equal(c.signal.state,'expired');assert.equal(c.signal.expiredByMs,900);assert.equal(c.lastStatusResponseAgeMs,1800);
 f.convoy.phase='failed';f.r.character.x=999;f.command.location.x=999;f.time(9000);f.capture();
 assert.equal(c.phase,'travelling');assert.equal(c.position.x,-129);assert.equal(c.destination.x,384);
 f.r.logConvoyFailureContext(c);assert.equal(f.logs.length,2);
 assert.match(f.logs[0],/phase=travelling.*position=arena \(-129,-208\).*destination=arena \(384,-420\).*convoy=convoy-1.*epoch=7.*command=9.*runtime=runtime-1.*route=3/);
 assert.match(f.logs[1],/expired.*900ms.*1800ms ago.*network after 1300ms/);
});
for(const field of ['id','epoch','commandId','runtimeId','routeVersion'])test('identity mismatch identifies '+field,()=>{
 const f=fixture();f.r.convoySignal[field]='different';const c=f.capture();
 assert.equal(c.signal.state,'identity mismatch');assert.equal(c.signal.mismatches[0].field,field);
 f.r.logConvoyFailureContext(c);assert.match(f.logs[1],new RegExp(field+' expected=.* received=different'));
});
test('missing signals and timing data are explicitly unknown',()=>{
 const f=fixture();f.r.convoySignal=null;const c=f.capture();assert.equal(c.signal.state,'missing');
 f.r.logConvoyFailureContext(c);assert.match(f.logs[1],/missing.*expiry overrun=unknown.*last status response=unknown.*latest status failure=unknown/);
});
test('valid signals stay matching and numeric wire identities follow existing comparisons',()=>{
 const f=fixture();f.r.convoySignal.epoch='7';f.r.convoySignal.commandId='9';assert.equal(f.capture().signal.state,'matching');
});
test('legacy route gate does not diagnose an unchecked route-version mismatch',()=>{
 const f=fixture();f.command.routeProtocol=undefined;f.r.convoySignal.routeVersion=999;assert.equal(f.capture().signal.state,'matching');
});
test('HTTP elapsed time is unaffected by a wall-clock adjustment',()=>{
 const f=fixture(),start=f.r.convoyDiagnosticClock();f.time(-10000,5500);f.r.rememberConvoyStatusRequest(start,'timeout');
 const c=f.capture();assert.equal(c.lastStatusFailure.durationMs,500);assert.equal(c.lastStatusFailure.ageMs,0);
});
test('diagnostic collection and output failures do not throw',()=>{
 const f=fixture();Object.defineProperty(f.r.root,'__partyConvoyHttp',{get(){throw Error('diagnostic failure');}});
 assert.doesNotThrow(()=>f.r.rememberConvoyStatusRequest(1,'network'));assert.doesNotThrow(()=>f.capture());
 f.r.game_log=()=>{throw Error('log unavailable');};assert.doesNotThrow(()=>f.r.logConvoyFailureContext(null));
});
