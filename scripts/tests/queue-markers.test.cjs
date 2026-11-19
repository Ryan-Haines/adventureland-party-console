const {productionFunction, productionFunctions} = require('./helpers/production-functions.cjs');
const {markerStyle}=require('../../runtime/status/character/marker-style.ts');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {installQueueMarkers}=require('../../runtime/status/character/markers.ts');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
const {createRares}=require('../../runtime/hunting/coordinator/rares.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// The coordinator's core answers the queue asks (movement's formation recovery, the events owner's event cycle).
require('./fixtures/coordinator-core.cjs');
// The dashboard's ring block (map-canvas.tsx, from `const targeted =` to `const recentAttack =`)
// with its TypeScript non-null marks dropped, so a row runs it in a plain context.
function canvasBlock(){
 const source=fs.readFileSync('dashboard/features/party/map-canvas.tsx','utf8');
 const start=source.indexOf('            const targeted ='),end=source.indexOf('            const recentAttack =');
 // A renamed marker makes indexOf answer -1, which would slice the wrong text and pass a row that draws nothing.
 assert.ok(start>=0&&end>start,'map-canvas.tsx still holds the targeted and recentAttack markers');
 return source.slice(start,end).replaceAll('!.','.').replaceAll('![','[');
}
// The Steam overlay's game: `host` as `parent` with the lifecycle owner's run scope and PIXI Graphics that record
// their calls, the game's draw frame as `draw` (each call runs the callbacks `draw_trigger` queued,
// as the game's draw loop does), and the globals put back after `run`.
function steamOverlay(host,{character={map:'main',in:'main'},get_entity},run){
 const keys=['parent','character','get_entity'],saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
 const graphics=[],frame=[];
 class Graphics{constructor(){this.calls=[];graphics.push(this);}clear(){this.calls=[];}lineStyle(...a){this.calls.push(['style',...a]);}drawCircle(...a){this.calls.push(['circle',...a]);}destroy(){this.destroyed=true;}}
 host.PIXI={Graphics};host.draw_trigger=fn=>frame.push(fn);
 Object.assign(global,{parent:host,character,get_entity});
 // shared.js creates the lifecycle owner's run scope on the game window before the overlay installs (helpers/run-scope.cjs).
 require('./helpers/run-scope.cjs').processScope();
 let result;
 try{result=run({graphics,Graphics,frame,draw:()=>frame.splice(0).forEach(fn=>fn())});}
 finally{if(!result?.then)Object.assign(global,saved);}
 // An async row keeps the globals until it settles, since its later frames read them.
 return result?.then?result.finally(()=>Object.assign(global,saved)):result;
}

test('snake Hunt to Phoenix cancellation resumes one queue and both marker displays without resetting CODE',()=>{
 let now=10000,convoys=0;
 const snake=id=>({id,mtype:'snake',map:'main',in:'main',server:'USII',x:20,y:0,priority:50});
 const phoenix={...snake('phoenix'),mtype:'phoenix',passiveRare:true,priority:100};
 const party={leader:'W',followers:{P:true},statuses:{},commands:{},targetMode:'hunt',monsterFocus:['snake'],
  passiveHunting:require('../../runtime/hunting/rules.ts').migratePassiveSettings(null,{phoenix:true}),passiveRareHunts:{phoenix:true},location:{map:'main',x:0,y:0},monsterHunt:{cycleId:'hunt',stage:'farming',currentIndex:0,target:'snake',owner:'W',missions:[{target:'snake',owners:['W'],destination:{map:'main',x:0,y:0}}]}};
 const mission=party.monsterHunt.missions[0];
 const members=['W','P'].map(name=>({name,ctype:name==='P'?'priest':'warrior',revision:1,status:party.statuses[name]={name,seenAt:now,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,range:200,
  groupedCombat:{protocol:4,epoch:0,anchorVisible:true,candidates:name==='W'?['A','B','C'].map(snake):[]}}}));
 const update=()=>party.groupedCombat=evaluateGroup(party.groupedCombat||null,members,'W',now);
 // The rare reads the group's queue through the targeting owner's `targeting.groupView`, which the targeting owner
 // answers from this party's grouped fight, as the application installs it.
 const {installCoordinatorTargeting}=require('../../runtime/coordinator/targeting/install.ts'),{partyHooks}=require('../../runtime/hooks/index.ts');
 installCoordinatorTargeting(partyHooks(),{state:()=>party,now:()=>now});
 const rare=createRares(party,{now:()=>now,members:()=>['W','P'],runs:()=>true,taskRefuses:()=>false,monsters:()=>({}),intent:()=>({revision:1}),group:()=>'party:W',
  reconcileHuntArrival(){},routeDistance:async()=>0,ladder:()=>({fail:()=>null,progress(){},rung:()=>null}),persist(){},write:require('./helpers/settings-writer.cjs').settingsWriter(party).write,
  cancelConvoy(){party.activeConvoy=null;},convoy(){convoys++;return true;}});
 update();assert.deepEqual(party.groupedCombat.queue.map(t=>t.id),['A','B','C']);
 members[1].status.groupedCombat.candidates=[phoenix];update();rare.report('W',{...party.statuses.W,rareSightings:[{...phoenix,hp:100,visible:true}]});rare.tick();
 assert.equal(rare.control('W').target.id,'phoenix');
 now++;members.forEach(m=>m.status.seenAt=now);
 party.groupedCombat.claims=[{...phoenix,at:now,external:true}];rare.tick();update();
 assert.equal(rare.encounter(),false);assert.equal(party.monsterHunt.missions[0],mission);assert.equal(party.monsterHunt.currentIndex,0);
 // The rare writes no Hunt field: The tasks owner's rare row suspends the Hunt task and resumes it at its saved stage.
 assert.equal(party.monsterHunt.stage,'farming');assert.equal(convoys,0);assert.equal(party.groupedCombat.resetAt,0);
 // Delayed nomination and an abandoned projectile acknowledgement cannot revive it.
 members[1].status.groupedCombat.evidence=[{...phoenix,at:now,startedAt:now-1,state:'engaged',action:'old'}];
 for(let i=0;i<3;i++){now++;update();rare.tick();}
 assert.equal(rare.encounter(),false);assert.equal(convoys,0);assert.deepEqual(party.groupedCombat.queue.map(t=>t.id),['A','B','C']);
 const c=require('./helpers/client-dependencies.cjs').passingContext({groupedCombat:party.groupedCombat,navigationIntent:{},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',get_entity:id=>({...snake(id),visible:true})},{hunting:{farm:{grouped:()=>true}}});
 require('./helpers/queue-markers.cjs').installQueueMarkers(c);
 const queue=c.queueMarkers();assert.deepEqual(Array.from(queue,t=>[t.id,t.visible]),[['A',true],['B',true],['C',true]]);
 const block=canvasBlock();
 for(const [i,t]of Array.from(queue).entries()){
  let circles=0;const ctx={beginPath(){},moveTo(){},arc(){circles++;},stroke(){}};
  vm.runInNewContext(block,{markerStyle,ctx,p:{scale:1,frame:{map:'main',grouped:true,queue}},entity:snake(t.id),x:20,y:0});
  assert.equal(ctx.strokeStyle,i===0?'#ef4444':'#facc15');assert.equal(circles,i===2?2:1);
 }
});

test('a resumed global reset epoch is acknowledged before fresh nominations, without CODE restart',()=>{
 let resets=0;
 const c=require('./helpers/client-dependencies.cjs').passingContext({character:{name:'W'},root:{__partyCombatResetAt:0,partyRoleRunner:{resetTargeting(){resets++;}}},groupedCombat:null,combatTargetId:null,
  publishCombatSelection(){},cancelFarmApproach(){},cancelGroupRoute(){},farmApproach:{failed:{}}});
 vm.runInContext(productionFunctions(['acceptCombatControl']),c);
 c.acceptCombatControl({groupedCombat:{resetAt:123},combatResetAt:0});assert.equal(c.root.__partyCombatResetAt,123);assert.equal(resets,1);
 c.acceptCombatControl({groupedCombat:{resetAt:122}});assert.equal(c.root.__partyCombatResetAt,123);assert.equal(resets,1);
});
scenarioTable('the Steam overlay draws the queue on its own layer', ()=>steamOverlay, [
 ['it owns four circles, follows live positions, and disposes only its layer', overlay=>{
  const entities={A:{x:10,y:20,visible:true},B:{x:30,y:40,visible:true},C:{x:50,y:60,visible:true}};
  const unrelated={},host={map:{scale:{x:2},addChild(e){e.parent=this;}},drawings:[unrelated]};
  overlay(host,{character:{map:'cave',in:'cave'},get_entity:id=>entities[id]},o=>{
   const api=installQueueMarkers(()=>['A','B','C'].map(id=>({id,map:'cave',in:'cave',radius:18})));
   o.draw();const [layer]=o.graphics;assert.deepEqual(layer.calls.filter(c=>c[0]==='circle').map(c=>c[3]),[18,18,18,21]);
   assert.deepEqual(layer.calls.filter(c=>c[0]==='style').map(c=>c[2]),[0xef4444,0xfacc15,0xfacc15]);
   entities.A.x=15;o.draw();assert.equal(layer.calls.find(c=>c[0]==='circle')[1],15);
   entities.B.visible=false;o.draw();assert.equal(layer.calls.filter(c=>c[0]==='circle').length,3);
   // Each draw frame queues the next; a stopped overlay draws on no later frame.
   assert.equal(o.frame.length,1);
   api.stop();assert.equal(layer.destroyed,true);assert.deepEqual(host.drawings,[unrelated]);
   o.draw();assert.equal(o.frame.length,0);assert.equal(o.graphics.length,1);
  });
 }],
 ['it draws an event target without grouped farming and disposes the ring when event selection ends', overlay=>{
  let markers=[{id:'boss',map:'main',in:'main',state:'event',visible:true}];
  overlay({map:{addChild(e){e.parent=this;}}},{get_entity:()=>({visible:true,x:1,y:2})},o=>{
   const api=installQueueMarkers(()=>markers);
   try{o.draw();assert.equal(o.graphics.at(-1).calls.find(c=>c[0]==='style')[2],0xef4444);
    markers=[];o.draw();assert.equal(o.graphics.at(-1).destroyed,true);}finally{api.stop();}
  });
 }],
 // The game's draw_trigger (functions.js) runs a callback at once while its draw frame is on
 // (in_draw) and queues it for the next frame otherwise; it catches and logs what the callback
 // throws. Each frame's redraw registers the next one from inside that frame.
 ['it draws once per game draw frame when draw_trigger calls back inside the frame', overlay=>{
  let computed=0;const errors=[];
  const host={map:{addChild(e){e.parent=this;}},in_draw:false};
  return overlay(host,{get_entity:()=>({visible:true,x:1,y:2})},async o=>{
   const queued=[];
   host.draw_trigger=fn=>{if(!host.in_draw){queued.push(fn);return;}try{fn();}catch(e){errors.push(e);}};
   const gameFrame=()=>{host.in_draw=true;try{queued.splice(0).forEach(fn=>{try{fn();}catch(e){errors.push(e);}});}finally{host.in_draw=false;}};
   // A task boundary between frames, as the browser's animation frames have.
   const nextTask=()=>new Promise(resolve=>setImmediate(resolve));
   const api=installQueueMarkers(()=>{computed++;return [{id:'A',map:'main',in:'main',role:'current',visible:true}];});
   try{
    for(let frame=1;frame<=3;frame++){gameFrame();assert.deepEqual(errors,[]);assert.equal(computed,frame);await nextTask();}
    api.stop();await nextTask();gameFrame();assert.equal(computed,3);
   }finally{api.stop();}
  });
 }],
 // Headless caracAL clients set
 // no_graphics = "1" (.caracal/html_vars.js), and the game then loads a stub pixi.min.js whose
 // Graphics exists but draws nothing.
 ['a no-graphics client skips marker computation and starts drawing when a renderer appears', overlay=>{
  let computed=0;
  const host={no_graphics:'1',map:{addChild(e){e.parent=this;}},socket:{disconnected:false}};
  overlay(host,{get_entity:()=>({visible:true,x:1,y:2})},o=>{
   const api=installQueueMarkers(()=>{computed++;return [{id:'A',map:'main',in:'main',role:'current',visible:true}];});
   try{
    for(let i=0;i<20;i++)o.draw();
    assert.equal(computed,0);assert.equal(o.graphics.length,0);
    delete host.PIXI;host.no_graphics='';o.draw();assert.equal(computed,0);
    host.PIXI={Graphics:o.Graphics};o.draw();assert.equal(computed,1);assert.equal(o.graphics[0].calls.filter(c=>c[0]==='circle').length,1);
    host.socket.disconnected=true;o.draw();assert.equal(computed,1);assert.equal(o.graphics[0].destroyed,true);
   }finally{api.stop();}
  });
 }],
]);
test('dashboard draws red current, yellow next and double yellow third; no ring for hidden entry',()=>{
 const block=canvasBlock();
 for(const [id,visible,count,color] of [['A',true,1,'#ef4444'],['B',true,1,'#facc15'],['C',true,2,'#facc15'],['B',false,0,undefined]]){
 const calls=[],ctx={beginPath(){},moveTo(){},arc(...a){calls.push(a);},stroke(){}};
 vm.runInNewContext(block,{markerStyle,ctx,p:{scale:2,frame:{grouped:true,map:'cave',queue:['A','B','C'].map(id=>({id,map:'cave',radius:18,visible}))}},entity:{id},x:10,y:20});
 assert.equal(calls.length,count);if(count)assert.equal(ctx.strokeStyle,color);if(count===2)assert.equal(calls[1][2]-calls[0][2],3);
 }
});

test('selected cooperative event boss stays attackable and yields a single red marker outside grouped farming',()=>{
 for(const mtype of ['franky','icegolem','crabxx']){
  const e={id:'boss',mtype,type:'monster',target:'OtherPlayer',visible:true,hp:100,x:10,y:20};
  const c=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,character:{map:'main',in:'main'},eventTargetTypes:[mtype],combatTargetId:'boss',get_entity:()=>e,
   G:{monsters:{[mtype]:{cooperative:true}}},currentPartyList:()=>['W','M','P'],groupedFarming:()=>false,groupedCombat:null,
   navigationIntent:{},root:{},leaderLockAllows:()=>true,isAttackingPartyMember:()=>false,eventAttend:{active:()=>true},
   joinedEvent:mtype,isPartyThreat:()=>false,groupWalk:{travel:false},scatterBreakTarget:null,farmingMode:'default',followLeader:false,monsterFocus:[]});
  vm.runInContext(productionFunctions(['isExternallyClaimedMonster', 'returnDepartureDefense', 'isAllowedTarget']), c);require('./helpers/queue-markers.cjs').installQueueMarkers(c);require('./helpers/walk-reports.cjs').installWalkDefense(c);
  assert.equal(c.isAllowedTarget(e),true);const markers=c.queueMarkers();assert.equal(markers.length,1);assert.equal(markers[0].state,'event');
  const calls=[],ctx={beginPath(){},moveTo(){},arc(...a){calls.push(a);},stroke(){}};
  vm.runInNewContext(canvasBlock(),{markerStyle,ctx,p:{scale:1,frame:{grouped:false,map:'main',queue:markers,target:'boss'}},entity:e,x:10,y:20});
  assert.equal(ctx.strokeStyle,'#ef4444');assert.equal(calls.length,1);
  e.visible=false;assert.equal(c.queueMarkers().length,0);e.visible=true;e.dead=true;assert.equal(c.queueMarkers().length,0);
  e.dead=false;c.combatTargetId=null;assert.equal(c.queueMarkers().length,0);
  c.combatTargetId='boss';c.eventTargetTypes=[];assert.equal(c.queueMarkers().length,0);
 }
});

test('dashboard event with no selected marker does not resurrect the old game target ring',()=>{
 let reads=0;
 const frame={map:'main',eventCombat:true,grouped:false,target:'old',queue:[]};
 vm.runInNewContext(canvasBlock(),{markerStyle,ctx:{arc(){assert.fail('stale event ring');}},p:{scale:1,get frame(){reads++;return frame;}},entity:{id:'old'},x:0,y:0});
 assert.ok(reads>0,'the block read the frame, so the absent ring is a decision it made');
});

test('scatter publishes every fresh visible party target as red and drops stale or wrong-instance reports',()=>{
 const now=10000;
 const entities={A:{id:'A',type:'monster',visible:true,hp:100},B:{id:'B',type:'monster',visible:true,hp:100}};
 const t=id=>({id,map:'main',in:'main',server:'USII'});
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{partyCombatState:{selectedTarget:'A'}},character:{map:'main',in:'main'},
 get_entity:id=>entities[id],reunionRealm:()=> 'USII',navigationIntent:{},
 Date:{now:()=>now},coordinatorClockOffset:0,eventTargetTypes:[]},{hunting:{farm:{grouped:()=>false,mode:()=>'scatter'}}});
 require('./helpers/targeting-module.cjs').drivePositions(c,[{seenAt:now,activeCombatTarget:t('B')},{seenAt:now-5000,activeCombatTarget:t('stale')},{seenAt:now,activeCombatTarget:{...t('wrong'),in:'other'}}]);
 vm.runInContext(productionFunctions(['activeCombatTarget']), c);require('./helpers/queue-markers.cjs').installQueueMarkers(c);
 const markers=Array.from(c.queueMarkers());assert.deepEqual(markers.map(t=>t.id),['A','B']);
 assert.ok(markers.every((t,i)=>markerStyle(t,i).css==='#ef4444'));
});


test('reconciled queue markers omit dead and absent targets; a hold displays only local defense',()=>{
 const target=id=>({id,map:'main',in:'main',server:'USII',hp:100,visible:true});
 const entities={active:target('active'),next:target('next'),dead:{...target('dead'),dead:true}};
 const c=require('./helpers/shared-context.cjs').createSharedContext({Math,Number,Object,character:{map:'main',in:'main'},navigationIntent:{},root:{},
  groupedCombat:{queue:['active','dead','absent','next'].map(target)},get_entity:id=>entities[id],reunionRealm:()=> 'USII',
  groupWalk:{travel:null},convoyHoldDefenseTarget:()=>entities.active,groupedEntityReport:e=>e},{hunting:{farm:{grouped:()=>true}}});
 assert.deepEqual(Array.from(c.queueMarkers(),t=>[t.id,t.role]),[['active','current'],['next','next']]);
 c.groupWalk.travel={phase:'held',holdRequested:true};
 assert.deepEqual(Array.from(c.queueMarkers(),t=>t.id),['active']);
 c.convoyHoldDefenseTarget=()=>null;assert.equal(c.queueMarkers().length,0);
});


test('locked pair marker roles do not shift when current entity is absent',()=>{
 const t=id=>({id,map:'main',in:'main',server:'USII',visible:true});
 const entities={B:t('B'),C:t('C')};
 const c=require('./helpers/shared-context.cjs').createSharedContext({Math,Number,Object,character:{map:'main',in:'main'},navigationIntent:{},root:{},
  get_entity:id=>entities[id],reunionRealm:()=> 'USII',eventTargetTypes:[],
  groupedCombat:{pairRevision:'pair',queue:['A','B','C'].map(t)}},{hunting:{farm:{grouped:()=>true}}});
 const markers=Array.from(c.queueMarkers());assert.deepEqual(markers.map(t=>[t.id,t.role,t.visible]),[['A','current',false],['B','next',true],['C','third',true]]);
});
