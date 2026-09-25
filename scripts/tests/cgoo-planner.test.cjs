const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const {createPlannerService}=require('../../runtime/coordinator/navigation/planner-service.ts');
const {validateRoute}=require('../../runtime/navigation/validation.ts');
const {repairDoorApproaches}=require('../../runtime/navigation/door-approach.ts');
const fixture=require('./fixtures/cgoo-routes-17175.json');
const directory=path.resolve('.caracal/game_files/17175');
const installed=fs.existsSync(path.join(directory,'data.js'));
test('reported cgoo segment is blocked in both directions with processed game 17175 and the actual character base',{skip:!installed},()=>{
 const native=createNative(directory),[a,b]=fixture.blocked;
 assert.deepEqual(JSON.parse(JSON.stringify(native.context.character.base)),fixture.base);
 assert.equal(native.canWalk(a,b),false);assert.equal(native.canWalk(b,a),false);
});
for(const route of fixture.routes)test('fresh planner and bounded connector: '+route.name,{skip:!installed},async(t)=>{
 const native=createNative(directory),service=createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'));
 const ports={game:native.game,walk:(a,b)=>native.canWalk(a,b),door:(p,d)=>native.context.is_door_close(p.map,d,p.x,p.y)&&native.context.can_use_door(p.map,d,p.x,p.y),hasKey:()=>false};
 try {
  const prepared=service.prepare(native.game,17175);await prepared.ready;assert.equal(prepared.fingerprint,fixture.fingerprint);
  const result=await service.plan({id:route.name,version:17175,fingerprint:prepared.fingerprint,...route,town:false,speed:60,base:fixture.base});
  const plot=repairDoorApproaches(ports,route.from,result.plot),issue=validateRoute(ports,route.from,route.to,plot,false);
  if(!issue){t.diagnostic('Full route validates without cheat edges');return;}
  assert.equal(issue.reason,'collisions detected');assert.equal(issue.from.map,route.from.map);
  const connector=native.query({from:route.from,to:issue.to,town:false},42,3000);
  // The graph can choose different edges across fresh processes. Either a valid
  // repair is produced, or the planner remains bounded and the invalid route is rejected.
  if(connector.error){assert.equal(connector.error,'timeout');t.diagnostic('Native connector hit its 3-second bound; full native fallback required');return;}
  const bridge=connector.path.map(p=>({...p,transport:p.method==='transport',town:p.method==='town',s:p.spawn}));
  const repaired=[...bridge,...plot.slice(plot.indexOf(issue.to)+1)];
  const remaining=validateRoute(ports,route.from,route.to,repaired,false);
  if(remaining){
    assert.notEqual(remaining,issue,'full revalidation must expose any later invalid segment');
    const full=native.query({from:route.from,to:route.to,town:false},42,30000);
    if(full.error){assert.ok(['timeout','no-path'].includes(full.error));t.diagnostic('Full native fallback ended with '+full.error+'; bounded relocation required');return;}
    const nativePlot=full.path.map(p=>({...p,transport:p.method==='transport',town:p.method==='town',s:p.spawn}));
    assert.equal(validateRoute(ports,route.from,route.to,nativePlot,false),null);
    t.diagnostic('Repaired prefix rejected by later geometry; full native route validates');return;
  }
  t.diagnostic('Rejected segment repaired and complete route revalidated');
 } finally {service.dispose();}
});
