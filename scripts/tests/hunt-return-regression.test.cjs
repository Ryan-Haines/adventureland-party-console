const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,settle,command}=require('./helpers/native-convoy-runtime.cjs');
const {createSharedConvoyNavigation}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const legacy=require('../convoy-navigation.cjs');

function planner(body){return {id:body.id,version:body.version,fingerprint:body.fingerprint,ms:1,plot:[body.to]};}
for(const phase of ['plan-return','prepare'])test('delayed ALClient result finalizes Hunt '+phase+' without premature movement',async()=>{
 const pending=[],requests=[];
 const r=runtime({plan:body=>{requests.push(body);return new Promise(resolve=>pending.push(()=>resolve(planner(body))));}});
 r.context.convoySignal.phase=phase;
 const {promise}=await r.start({...command,phase,purpose:'monster-hunt'});
 const before=r.moves().length;
 for(let i=0;i<30 && r.context.convoyTraveling.phase!==(phase==='plan-return'?'return-route-ready':'route-ready');i++){
  r.tick();await settle();
  if(pending.length){assert.equal(r.context.movement.state.found,false);pending.shift()();await settle();}
 }
 const c=r.context.convoyTraveling;
 assert.ok(!c.failure);
 assert.equal(c.phase,phase==='plan-return'?'return-route-ready':'route-ready');
 assert.equal(r.moves().length,before);assert.equal(r.calls.some(x=>x[0]==='use'),false);
 if(phase==='plan-return'){
  assert.deepEqual(requests.map(b=>b.town),[false,true]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.returnPlan)),[{type:'walk',location:command.location}]);
 }else assert.equal(requests.length,1);
 await r.cancel();await promise;
});

test('Hunt planning diagnostics retain both candidate failures',async()=>{
 const r=runtime();let i=0;
 r.context.prepareConvoyRoute=async()=>{throw Error(++i===1?'walking planner timed out':'town planner disconnected');};
 await assert.rejects(r.context.planHuntReturn({},command,()=>true,()=>{}),/walking only: walking planner timed out; Town allowed: town planner disconnected/);
});

test('a cancelled Hunt cannot install a delayed planner response',async()=>{
 let resolvePlan;const r=runtime({plan:body=>new Promise(resolve=>{resolvePlan=()=>resolve(planner(body));})});
 r.context.convoySignal.phase='plan-return';
 const {promise}=await r.start({...command,phase:'plan-return',purpose:'monster-hunt'});
 r.tick();await settle();assert.ok(resolvePlan);
 await r.cancel();resolvePlan();await settle();await promise;
 assert.equal(r.context.movement.state.moving,false);
 assert.equal(r.context.movement.state.found,false);
});

function party(){
 const now=Date.now(),names=['L','F'];
 return {nextCommandId:10,navigationIntents:Object.fromEntries(names.map(n=>[n,{revision:1}])),
 commands:Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'return',navigationRevision:1}])),
 statuses:Object.fromEntries(names.map(n=>[n,{name:n,seenAt:now,hp:100,map:'mansion',x:0,y:0,server:'USII',speed:57,convoyProtocol:4,returnTownReady:true,combatSelection:{runtimeId:n},groupedCombat:{currentAttackersAt:now,currentAttackers:[]}}])),
 activeConvoy:{id:'return',epoch:1,routeProtocol:4,phase:'plan-return',leader:'L',participants:names,completed:[],
 slowestSpeed:57,rally:{map:'mansion',x:0,y:0},location:{map:'main',x:126,y:-413},purpose:'monster-hunt',returnRouting:true}};
}

test('generic route recovery does not disable Town from error text alone',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy),c=p.activeConvoy;
 p.monsterHunt={stage:'returning'};
 c.phase='assemble';for(const s of Object.values(p.statuses))s.huntReturnProtocol=2;
 e.step(p,Date.now());const firstVersion=c.routeVersion;
 p.statuses.L.x=100;p.statuses.F.x=0;
 e.hold(p,'Town transition did not complete','route-failed');
 assert.equal(c.phase,'shared-hold');assert.equal(!!c.disableTown,false);
 assert.equal(c.location.map,'main');assert.equal(c.location.x,126);
 for(const n of c.participants){const cmd=p.commands[n];p.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:1,runtimeId:n,phase:'held'};}
 e.step(p,Date.now());assert.equal(c.phase,'shared-prepare');assert.equal(c.routeVersion,firstVersion+1);
 assert.equal(c.rally.x,100);assert.equal(!!p.commands.F.disableTown,false);
 const checkpoint=JSON.parse(JSON.stringify(p.monsterHunt.travelCheckpoint));
 assert.equal(checkpoint.stage,'returning');assert.equal(checkpoint.destination.map,'main');
 assert.equal(checkpoint.positions.L.x,0); // Last persisted observation before the interruption.
 assert.equal(checkpoint.revisions.F,1);assert.equal(checkpoint.barriers,undefined);
});
test('failed Hunt itinerary reassembles before shared identity exists, retaining Daisy and bounded retries',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy),c=p.activeConvoy,destination=c.location;
 e.hold(p,'No route to Daisy could be prepared','route-failed');
 assert.equal(c.phase,'assemble');assert.equal(c.epoch,2);assert.equal(c.recoveryAttempts,1);
 e.step(p,Date.now());assert.notEqual(c.phase,'failed');assert.equal(c.location,destination);
 // Mixed-version clients must wait rather than entering the old multi-leg path.
 assert.match(c.failure,/protocol 2/);
 for(const name of c.participants)p.statuses[name].huntReturnProtocol=2;
 e.step(p,Date.now());assert.equal(c.phase,'shared-prepare');
 assert.equal(p.commands.L.continuousReturn,1);
 // Exercise another pre-initialization failure independently of the installed route.
 delete c.routeVersion;delete c.routeServer;delete c.continuousReturn;
 c.phase='plan-return';e.hold(p,'second failure','route-failed');assert.equal(c.recoveryAttempts,2);
 c.phase='plan-return';e.hold(p,'third failure','route-failed');assert.equal(c.phase,'failed');assert.equal(c.retryExhausted,true);
 assert.equal(c.failureCode,'route-failed');
});
test('already stranded Hunt return rebuilds once under matching ownership',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy),c=p.activeConvoy;
 Object.assign(c,{phase:'failed',failureCode:'realm-lost',failure:'Convoy realm-lost'});
 e.step(p,Date.now());assert.equal(c.phase,'assemble');assert.equal(c.returnRuntimeRetries,1);
 Object.assign(c,{phase:'failed',failureCode:'realm-lost'});e.step(p,Date.now());assert.equal(c.phase,'failed');
});
for(const reason of ['cancelled','revision','command','realm','stale','exhausted','initialized'])test('stranded Hunt recovery rejects '+reason,()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy),c=p.activeConvoy;
 Object.assign(c,{phase:'failed',failureCode:'realm-lost'});
 if(reason==='cancelled')p.navigationIntents.F.cancelled=true;
 if(reason==='revision')p.navigationIntents.F.revision++;
 if(reason==='command')p.commands.F={id:99,type:'character-travel'};
 if(reason==='realm')p.statuses.F.server='EUI';
 if(reason==='stale')p.statuses.F.seenAt=0;
 if(reason==='exhausted')c.retryExhausted=true;
 if(reason==='initialized'){c.routeVersion=1;c.routeServer='EUI';}
 e.step(p,Date.now());assert.equal(c.phase,'failed');assert.equal(c.returnRuntimeRetries,undefined);
});
