const test=require('node:test'),assert=require('node:assert/strict');
const {runtime,settle}=require('./helpers/native-convoy-runtime.cjs');
const {createSharedConvoyNavigation}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {publishSharedRoute,sharedRoute}=require('../../runtime/coordinator/navigation/shared-route-store.ts');
const {movementBarrier}=require('../../runtime/coordinator/navigation/movement-barrier.ts');
const {createConvoyAcknowledgementRoutes}=require('../../runtime/coordinator/http/convoy-acknowledgements.ts');
const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
const legacy=require('../convoy-navigation.cjs');
const vm=require('node:vm'),fs=require('node:fs');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
const copy=x=>JSON.parse(JSON.stringify(x));

for(const map of ['mansion','winterland'])for(const disableTown of [false,true])test('three managed runners return from '+map+' to Daisy on one itinerary; disableTown='+disableTown,async()=>{
 let now=1000;const names=['L','F','P'],errors=[],requests=[],barrierCalls=[];
 const p={nextCommandId:10,commands:{},navigationIntents:{},combatLogs:{},eventReturn:null,
  statuses:Object.fromEntries(names.map(n=>[n,{name:n,seenAt:now,hp:100,map,x:1000,y:0,speed:57,server:'USII',huntReturnProtocol:2,convoyProtocol:4,combatSelection:{runtimeId:n}}])),
  activeConvoy:{id:'return',epoch:1,routeProtocol:4,phase:'assemble',leader:'L',participants:names,completed:[],slowestSpeed:57,
   rally:{map,x:1000,y:0},location:{map:'main',x:120,y:0},purpose:'monster-hunt',returnRouting:true,nonPreemptible:true,disableTown,combatHandoffAllowed:false}};
 const engine=createSharedConvoyNavigation(legacy);engine.step(p,now);
 const convoy=p.activeConvoy;assert.equal(convoy.phase,'shared-prepare');
 const ids=names.map(n=>p.commands[n].id);
 const ack=createConvoyAcknowledgementRoutes(p,{now:()=>now,owned:()=>true,valid:b=>legacy.validReport(p,b),nextCommand:()=>p.nextCommandId++,persist(){},history(){},hold:(r,c)=>engine.hold(p,r,c),error:r=>errors.push(r)});
 const response=handler=>body=>{let result,status=200;handler({body},{status(n){status=n;return this;},json(v){result=v;return v;}});if(status!==200)throw Error(result.error);return result;};
 const runners=names.map(n=>{
  const r=runtime({plan:async b=>{await settle();requests.push([n,b.town]);return {...b,ms:1,plot:b.from.map==='main'?[{map:'main',x:120,y:0}]:[
   {map,x:0,y:0,...(b.town?{town:true}:{})},{map:'main',x:0,y:0,transport:true,s:0},{map:'main',x:120,y:0}]};}});
  const c=r.context;c.character.name=n;c.character.map=map;c.character.x=1000;c.convoyRuntimeId=n;
  c.currentPartyList=()=>names;c.isPassingEncounter=()=>false;
  c.get_entity=()=>({id:'passing-armadillo',type:'monster',mtype:'armadillo',target:n});
  c.groupedEntityReport=t=>t;c.joinedEvent=false;c.eventTargetTypes=[];
  vm.runInContext(['returnDepartureDefense','defendPartyHit','interruptConvoyForDefense'].map(name=>namedFunction(source,name)).join('\n'),c);
  c.G.maps[map]={spawns:[[0,0]],doors:[[0,0,20,20,'main',0,0]],npcs:[]};c.can_move=()=>true;
  c.setTimeout=fn=>setImmediate(fn);
  c.request=async(url,o)=>{
   if(url==='/convoy-route'){const error=publishSharedRoute(p,copy(o.body),now);if(error)throw Error(error);return {ok:true};}
   if(url.startsWith('/convoy-route?'))return {ok:true,route:copy(sharedRoute(convoy))};
   if(url==='/movement-barrier'){barrierCalls.push(copy(o.body));const result=movementBarrier(p,copy(o.body),now);if(result.error){errors.push(result.error);throw Error(result.error);}return result;}
   if(url==='/convoy-complete')return response(ack.complete)(copy(o.body));
   if(url==='/convoy-failed'){errors.push(o.body.reason);return response(ack.failed)(copy(o.body));}
   return {ok:true};
  };return r;
 });
 const starts=await Promise.all(runners.map((r,i)=>{r.context.convoySignal=engine.signal(p,names[i],now);return r.start(p.commands[names[i]]);}));
 for(let i=0;i<220 && p.activeConvoy;i++){
  now+=100;
  runners.forEach((r,j)=>{
   r.setNow(now-50);const c=r.context,s=p.statuses[names[j]],local=c.convoyTraveling;
   if(local) { c.defendPartyHit({id:names[j],hid:'passing-armadillo'});assert.equal(c.convoyTraveling,local,'incoming hits must retain return ownership');assert.notEqual(local.phase,'defending'); }
   Object.assign(s,{seenAt:now,map:c.character.map,x:c.character.x,y:c.character.y,moving:!!c.character.moving});
   if(local)s.convoyNavigation={...local,runtimeId:names[j],navigationRevision:0};
   c.convoySignal=engine.signal(p,names[j],now);
  });
  engine.step(p,now);
  for(let j=0;j<3;j++) {
   const r=runners[j],cmd=p.commands[names[j]];
   if(cmd && r.context.convoyTraveling?.commandId!==cmd.id) {
    await r.cancel();r.context.convoySignal=engine.signal(p,names[j],now);
    starts.push(await r.start(cmd));ids.push(cmd.id);
   }
  }
  // Deliberately stagger follower ticks and transition/barrier reports.
  for(let j=0;j<3;j++)if(i%(j+1)===0)runners[j].tick();
  await settle();
 }
 assert.deepEqual(errors,[]);assert.equal(p.activeConvoy,null,'complete only after every arrival');
 await Promise.all(starts.map(s=>s.promise));
 assert.equal(convoy.routeVersion,disableTown?2:1);assert.equal(convoy.epoch,disableTown?2:1);
 if(!disableTown)assert.equal(p.nextCommandId,13,'no per-leg command replacements');
 assert.deepEqual(requests,disableTown?[['L',false],['L',false],['L',true]]:[['L',false],['L',true]]);
 for(const r of runners){assert.equal(r.context.character.map,'main');assert.equal(r.context.character.x,120);
  assert.equal(r.calls.filter(c=>c[0]==='cruise'&&c[1]===57).length,disableTown?3:1);
  assert.equal(r.calls.filter(c=>c[0]==='use').length,disableTown?0:1);}
 assert.ok(barrierCalls.some(b=>b.completed));assert.ok(barrierCalls.every(b=>ids.includes(b.commandId)));
 assert.ok(now<18000,'single 4-second departure window; no per-leg setup waits');
});

test('a cancelled convoy cannot fake Daisy arrival, and confirmed arrival does not start another convoy',()=>{
 let starts=0,turnIns=0;
 const hunt={stage:'returning',convoyId:'cancelled',participants:['A']};
 const state={activeConvoy:null,monsterHunterLocation:{map:'main',x:126,y:-413},statuses:{A:{seenAt:1000,map:'winterland',x:0,y:0}}};
 const travel=createHuntTravel(state,{now:()=>1000,start:()=>starts++,processDaisy:()=>turnIns++});
 travel.step(hunt);assert.equal(starts,1);assert.equal(turnIns,0);assert.equal(hunt.stage,'returning');
 Object.assign(state.statuses.A,{map:'main',x:126,y:-413});travel.step(hunt);
 assert.equal(turnIns,1);assert.equal(hunt.stage,'at-daisy');
});
