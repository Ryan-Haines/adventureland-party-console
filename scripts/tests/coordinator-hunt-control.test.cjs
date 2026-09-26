const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntControlRoutes}=require('../../runtime/coordinator/http/hunt-control.ts');
function fixture(){
 const state={monsterHunt:{stage:'returning',participants:['P'],convoyId:'old',returnRetries:2},activeConvoy:{id:'old',purpose:'monster-hunt',phase:'failed'},
  statuses:{P:{convoyProtocol:4}},commands:{},monsterHunterLocation:{map:'main',x:1,y:2}};
 const calls=[],ports={owned:name=>name==='P',ownsTravel:()=>true,fresh:()=>true,cancelled:()=>false,cancelConvoy:()=>calls.push('cancel'),
  start:hunt=>{calls.push('start');hunt.convoyId='new';},persist:()=>calls.push('persist')};
 const routes=createHuntControlRoutes(state,ports);
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,ports,calls,send};
}
test('manual hunt-return retry waits for runtime compatibility and existing command ownership',()=>{
 const t=fixture();t.state.statuses.P.convoyProtocol=1;assert.equal(t.send('retryReturn').code,409);
 t.state.statuses.P.convoyProtocol=4;t.state.commands.P={convoyId:'other'};assert.equal(t.send('retryReturn').code,409);assert.equal(t.calls.length,0);
 t.state.commands.P.convoyId='old';assert.equal(t.send('retryReturn').body.convoyId,'new');assert.deepEqual(t.calls,['cancel','start','persist']);
});
test('interaction acknowledgements cannot clear a newer command and success waits for quest telemetry',()=>{
 const t=fixture(),command={id:7,type:'monster-hunt-interact',cycleId:'cycle',action:'claim'};t.state.commands.P=command;
 assert.equal(t.send('interactionComplete',{character:'P',commandId:6,cycleId:'cycle',success:false}).code,409);assert.equal(t.state.commands.P,command);
 t.send('interactionComplete',{character:'P',commandId:7,cycleId:'cycle',success:true});assert.equal(t.state.commands.P,command);
 t.send('interactionComplete',{character:'P',commandId:7,cycleId:'cycle',success:false,error:'busy'});assert.equal(t.state.commands.P,undefined);assert.equal(t.state.monsterHunt.message,'Retrying claim for P: busy');
});

test('permission polling alone does not create event protection, and completed anniversary protection closes',()=>{
 const t=fixture();t.ports.ownsTravel=()=>false;
 assert.equal(t.send('permission',{character:'P'}).body.allowed,true);
 assert.equal(t.state.huntEventTrips,undefined);
 const response=t.send('permission',{character:'P',event:'icegolem'}).body;
 assert.equal(response.eventTrip.event,'icegolem');
 t.send('permission',{character:'P',event:'icegolem'});assert.equal(t.state.huntEventTrips.P.length,1);
 t.send('permission',{character:'P',event:'anniversary'});
 t.state.anniversary={eventCycle:{returnCompletedAt:Date.now()}};
 t.send('permission',{character:'P'});
 assert.ok(t.state.huntEventTrips.P.at(-1).endedAt);
 t.state.huntEventTrips.P.push({event:'null',startedAt:Date.now()});
 t.send('permission',{character:'P',event:null});
 assert.ok(t.state.huntEventTrips.P.at(-1).endedAt,'obsolete empty permission context cannot leave protection active');
});

test('event return blocks repeated event departures until recovery completes',()=>{
 const t=fixture();t.ports.ownsTravel=()=>false;
 t.state.eventReturn={participants:['P']};
 let departures=0;t.ports.eventDeparture=()=>{departures++;return {allowed:true};};
 for(let i=0;i<3;i++)assert.equal(t.send('permission',{character:'P',event:'icegolem'}).body.allowed,false);
 assert.equal(departures,0);assert.equal(t.state.huntEventTrips,undefined);
 t.state.eventReturn={participants:['other']};
 assert.equal(t.send('permission',{character:'P',event:'icegolem'}).body.allowed,true);
 t.state.eventReturn=null;
 assert.equal(t.send('permission',{character:'P',event:'icegolem'}).body.allowed,true);
});
