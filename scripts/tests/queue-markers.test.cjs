const {markerStyle}=require('../../runtime/combat/marker-style.ts');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {installQueueMarkers}=require('../../runtime/combat/markers.ts');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const {createRareHunting}=require('../rare-hunting.cjs');

test('snake Hunt to Phoenix cancellation resumes one queue and both marker displays without resetting CODE',()=>{
 let now=10000,convoys=0;
 const snake=id=>({id,mtype:'snake',map:'main',in:'main',server:'USII',x:20,y:0,priority:50});
 const phoenix={...snake('phoenix'),mtype:'phoenix',passiveRare:true,priority:100};
 const party={leader:'W',followers:{P:true},statuses:{},commands:{},farmingPolicy:'hunt',monsterFocus:['snake'],
  passiveRareHunts:{phoenix:true},location:{map:'main',x:0,y:0},monsterHunt:{cycleId:'hunt',stage:'farming',currentIndex:0,target:'snake',owner:'W',missions:[{target:'snake',owners:['W'],destination:{map:'main',x:0,y:0}}]}};
 const mission=party.monsterHunt.missions[0];
 const members=['W','P'].map(name=>({name,ctype:name==='P'?'priest':'warrior',revision:1,status:party.statuses[name]={name,seenAt:now,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,range:200,
  groupedCombat:{protocol:4,epoch:0,anchorVisible:true,candidates:name==='W'?['A','B','C'].map(snake):[]}}}));
 const update=()=>party.groupedCombat=evaluateGroup(party.groupedCombat||null,members,'W',now);
 const rare=createRareHunting(party,{now:()=>now,members:()=>['W','P'],intent:()=>({revision:1}),turnIn:()=>false,persist(){},cancelConvoy(){party.activeConvoy=null;},convoy(){convoys++;return true;}});
 update();assert.deepEqual(party.groupedCombat.queue.map(t=>t.id),['A','B','C']);
 members[1].status.groupedCombat.candidates=[phoenix];update();rare.report('W',{...party.statuses.W,rareSightings:[{...phoenix,hp:100,visible:true}]});rare.tick();
 assert.equal(rare.control('W').target.id,'phoenix');
 now++;members.forEach(m=>m.status.seenAt=now);
 party.groupedCombat.claims=[{...phoenix,at:now,external:true}];rare.tick();update();
 assert.equal(rare.encounter(),false);assert.equal(party.monsterHunt.missions[0],mission);assert.equal(party.monsterHunt.currentIndex,0);
 assert.equal(party.monsterHunt.stage,'mission-travel');assert.equal(convoys,0);assert.equal(party.groupedCombat.resetAt,0);
 // Delayed nomination and an abandoned projectile acknowledgement cannot revive it.
 members[1].status.groupedCombat.evidence=[{...phoenix,at:now,startedAt:now-1,state:'engaged',action:'old'}];
 for(let i=0;i<3;i++){now++;update();rare.tick();}
 assert.equal(rare.encounter(),false);assert.equal(convoys,0);assert.deepEqual(party.groupedCombat.queue.map(t=>t.id),['A','B','C']);
 const source=fs.readFileSync('characters/shared.js','utf8');
 const c=require('./helpers/client-dependencies.cjs').passingContext({groupedFarming:()=>true,groupedCombat:party.groupedCombat,navigationIntent:{},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',get_entity:id=>({...snake(id),visible:true})});
 vm.runInContext(source.slice(source.indexOf('  function queueMarkers('),source.indexOf('  function acceptQueue(')),c);
 const queue=c.queueMarkers();assert.deepEqual(Array.from(queue,t=>[t.id,t.visible]),[['A',true],['B',true],['C',true]]);
 const canvas=fs.readFileSync('dashboard/features/party/map-canvas.tsx','utf8');
 const block=canvas.slice(canvas.indexOf('            const targeted ='),canvas.indexOf('            const recentAttack =')).replaceAll('!.','.').replaceAll('![','[');
 for(const [i,t]of Array.from(queue).entries()){
  let circles=0;const ctx={beginPath(){},moveTo(){},arc(){circles++;},stroke(){}};
  vm.runInNewContext(block,{markerStyle,ctx,p:{scale:1,frame:{map:'main',grouped:true,queue}},entity:snake(t.id),x:20,y:0});
  assert.equal(ctx.strokeStyle,i===0?'#ef4444':'#facc15');assert.equal(circles,i===2?2:1);
 }
});

test('a resumed global reset epoch is acknowledged before fresh nominations, without CODE restart',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');let resets=0;
 const c=require('./helpers/client-dependencies.cjs').passingContext({character:{name:'W'},root:{__partyCombatResetAt:0,partyRoleRunner:{resetTargeting(){resets++;}}},groupedCombat:null,combatTargetId:null,
  publishCombatSelection(){},cancelFarmApproach(){},cancelFightRoute(){},cancelGroupRoute(){},farmApproach:{failed:{}}});
 vm.runInContext(source.slice(source.indexOf('  function acceptCombatControl('),source.indexOf('  function combatRecoveryActive(')),c);
 c.acceptCombatControl({groupedCombat:{resetAt:123},combatResetAt:0});assert.equal(c.root.__partyCombatResetAt,123);assert.equal(resets,1);
 c.acceptCombatControl({groupedCombat:{resetAt:122}});assert.equal(c.root.__partyCombatResetAt,123);assert.equal(resets,1);
});
test('Steam overlay owns four circles, follows live positions, and disposes only its layer',()=>{
 const saved={parent:global.parent,character:global.character,get_entity:global.get_entity,setInterval:global.setInterval,clearInterval:global.clearInterval};
 const objects=[],entities={A:{x:10,y:20,visible:true},B:{x:30,y:40,visible:true},C:{x:50,y:60,visible:true}};let draw;
 class Graphics{constructor(){this.calls=[];objects.push(this);}clear(){this.calls=[];}lineStyle(...a){this.calls.push(['style',...a]);}drawCircle(...a){this.calls.push(['circle',...a]);}destroy(){this.destroyed=true;}}
 const unrelated={};const host={PIXI:{Graphics},map:{scale:{x:2},addChild(e){e.parent=this;}},drawings:[unrelated]};
 Object.assign(global,{parent:host,character:{map:'cave',in:'cave'},get_entity:id=>entities[id],setInterval:fn=>{draw=fn;return 1;},clearInterval(){}});
 try{const shared={usesGroupedCombat:()=>true,queueMarkers:()=>['A','B','C'].map(id=>({id,map:'cave',in:'cave',radius:18}))};
 const api=installQueueMarkers({},shared);draw();assert.deepEqual(objects[0].calls.filter(c=>c[0]==='circle').map(c=>c[3]),[18,18,18,21]);
 assert.deepEqual(objects[0].calls.filter(c=>c[0]==='style').map(c=>c[2]),[0xef4444,0xfacc15,0xfacc15]);
 entities.A.x=15;draw();assert.equal(objects[0].calls.find(c=>c[0]==='circle')[1],15);
 entities.B.visible=false;draw();assert.equal(objects[0].calls.filter(c=>c[0]==='circle').length,3);
 api.stop();assert.equal(objects[0].destroyed,true);assert.deepEqual(host.drawings,[unrelated]);
 }finally{Object.assign(global,saved);}
});
test('dashboard draws red current, yellow next and double yellow third; no ring for hidden entry',()=>{
 const s=fs.readFileSync('dashboard/features/party/map-canvas.tsx','utf8');
 const block=s.slice(s.indexOf('            const targeted ='),s.indexOf('            const recentAttack =')).replaceAll('!.','.').replaceAll('![','[');
 for(const [id,visible,count,color] of [['A',true,1,'#ef4444'],['B',true,1,'#facc15'],['C',true,2,'#facc15'],['B',false,0,undefined]]){
 const calls=[],ctx={beginPath(){},moveTo(){},arc(...a){calls.push(a);},stroke(){}};
 vm.runInNewContext(block,{markerStyle,ctx,p:{scale:2,frame:{grouped:true,map:'cave',queue:['A','B','C'].map(id=>({id,map:'cave',radius:18,visible}))}},entity:{id},x:10,y:20});
 assert.equal(calls.length,count);if(count)assert.equal(ctx.strokeStyle,color);if(count===2)assert.equal(calls[1][2]-calls[0][2],3);
 }
});

test('selected cooperative event boss stays attackable and yields a single red marker outside grouped farming',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const fn=(name,next)=>source.slice(source.indexOf('  function '+name+'('),source.indexOf('  function '+next+'('));
 for(const mtype of ['franky','icegolem','crabxx']){
  const e={id:'boss',mtype,type:'monster',target:'OtherPlayer',visible:true,hp:100,x:10,y:20};
  const c=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,character:{map:'main',in:'main'},eventTargetTypes:[mtype],combatTargetId:'boss',get_entity:()=>e,
   G:{monsters:{[mtype]:{cooperative:true}}},currentPartyList:()=>['W','M','P'],groupedFarming:()=>false,groupedCombat:null,
   navigationIntent:{},root:{},leaderLockAllows:()=>true,isAttackingPartyMember:()=>false,activeCombatEvent:()=>true,
   joinedEvent:mtype,isPartyThreat:()=>false,convoyTraveling:false,scatterBreakTarget:null,farmingMode:'default',followLeader:false,monsterFocus:[]});
  vm.runInContext(fn('isExternallyClaimedMonster','groupedFarming')+fn('isAllowedTarget','sameEventTeamMember')+fn('queueMarkers','acceptQueue'),c);
  assert.equal(c.isAllowedTarget(e),true);const markers=c.queueMarkers();assert.equal(markers.length,1);assert.equal(markers[0].state,'event');
  const block=fs.readFileSync('dashboard/features/party/map-canvas.tsx','utf8').split('            const targeted =')[1].split('            const recentAttack =')[0];
  const calls=[],ctx={beginPath(){},moveTo(){},arc(...a){calls.push(a);},stroke(){}};
  vm.runInNewContext(('const targeted ='+block).replaceAll('!.','.').replaceAll('![','['),{markerStyle,ctx,p:{scale:1,frame:{grouped:false,map:'main',queue:markers,target:'boss'}},entity:e,x:10,y:20});
  assert.equal(ctx.strokeStyle,'#ef4444');assert.equal(calls.length,1);
  e.visible=false;assert.equal(c.queueMarkers().length,0);e.visible=true;e.dead=true;assert.equal(c.queueMarkers().length,0);
  e.dead=false;c.combatTargetId=null;assert.equal(c.queueMarkers().length,0);
  c.combatTargetId='boss';c.eventTargetTypes=[];assert.equal(c.queueMarkers().length,0);
 }
});
test('Steam draws event target without grouped farming and disposes the ring when event selection ends',()=>{
 const keys=['parent','character','get_entity','setInterval','clearInterval'],saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
 let draw,graphics,markers=[{id:'boss',map:'main',in:'main',state:'event',visible:true}];
 class Graphics{constructor(){graphics=this;this.calls=[];}clear(){this.calls=[];}lineStyle(...a){this.calls.push(a);}drawCircle(){}destroy(){this.destroyed=true;}}
 Object.assign(global,{parent:{PIXI:{Graphics},map:{addChild(e){e.parent=this;}}},character:{map:'main',in:'main'},get_entity:()=>({visible:true,x:1,y:2}),setInterval:fn=>{draw=fn;return 1;},clearInterval(){}});
 let api;try{api=installQueueMarkers({},{usesGroupedCombat:()=>false,queueMarkers:()=>markers});draw();assert.equal(graphics.calls[0][1],0xef4444);
 markers=[];draw();assert.equal(graphics.destroyed,true);}finally{api?.stop();Object.assign(global,saved);}
});

test('dashboard event with no selected marker does not resurrect the old game target ring',()=>{
 const source=fs.readFileSync('dashboard/features/party/map-canvas.tsx','utf8');
 const block=source.slice(source.indexOf('            const targeted ='),source.indexOf('            const recentAttack =')).replaceAll('!.','.').replaceAll('![','[');
 vm.runInNewContext(block,{markerStyle,ctx:{arc(){assert.fail('stale event ring');}},p:{scale:1,frame:{map:'main',eventCombat:true,grouped:false,target:'old',queue:[]}},entity:{id:'old'},x:0,y:0});
});

test('scatter publishes every fresh visible party target as red and drops stale or wrong-instance reports',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),now=Date.now();
 const entities={A:{id:'A',type:'monster',visible:true,hp:100},B:{id:'B',type:'monster',visible:true,hp:100}};
 const t=id=>({id,map:'main',in:'main',server:'USII'});
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{partyCombatState:{selectedTarget:'A'}},character:{map:'main',in:'main'},
 get_entity:id=>entities[id],reunionRealm:()=> 'USII',groupedFarming:()=>false,farmingMode:'scatter',navigationIntent:{},
 coordinatorClockOffset:0,eventTargetTypes:[],partyPositions:[{seenAt:now,activeCombatTarget:t('B')},{seenAt:now-5000,activeCombatTarget:t('stale')},{seenAt:now,activeCombatTarget:{...t('wrong'),in:'other'}}]});
 vm.runInContext(source.slice(source.indexOf('  function activeCombatTarget('),source.indexOf('  function acceptQueue(')),c);
 const markers=Array.from(c.queueMarkers());assert.deepEqual(markers.map(t=>t.id),['A','B']);
 assert.ok(markers.every((t,i)=>markerStyle(t,i).css==='#ef4444'));
});


test('reconciled queue markers omit dead and absent targets; a hold displays only local defense',()=>{
 const {namedFunction}=require('./helpers/named-function.cjs');const source=fs.readFileSync('characters/shared.js','utf8');
 const target=id=>({id,map:'main',in:'main',server:'USII',hp:100,visible:true});
 const entities={active:target('active'),next:target('next'),dead:{...target('dead'),dead:true}};
 const c=vm.createContext({Math,Number,Object,character:{map:'main',in:'main'},navigationIntent:{},root:{},
  groupedFarming:()=>true,groupedCombat:{queue:['active','dead','absent','next'].map(target)},get_entity:id=>entities[id],reunionRealm:()=> 'USII',
  convoyTraveling:null,convoyHoldDefenseTarget:()=>entities.active,groupedEntityReport:e=>e});
 vm.runInContext(namedFunction(source,'queueMarkers'),c);
 assert.deepEqual(Array.from(c.queueMarkers(),t=>[t.id,t.role]),[['active','current'],['next','next']]);
 c.convoyTraveling={phase:'held',holdRequested:true};
 assert.deepEqual(Array.from(c.queueMarkers(),t=>t.id),['active']);
 c.convoyHoldDefenseTarget=()=>null;assert.equal(c.queueMarkers().length,0);
});


test('locked pair marker roles do not shift when current entity is absent',()=>{
 const {namedFunction}=require('./helpers/named-function.cjs');const source=fs.readFileSync('characters/shared.js','utf8');
 const t=id=>({id,map:'main',in:'main',server:'USII',visible:true});
 const entities={B:t('B'),C:t('C')};
 const c=vm.createContext({Math,Number,Object,character:{map:'main',in:'main'},navigationIntent:{},root:{},
  groupedFarming:()=>true,get_entity:id=>entities[id],reunionRealm:()=> 'USII',eventTargetTypes:[],
  groupedCombat:{pairRevision:'pair',queue:['A','B','C'].map(t)}});
 vm.runInContext(namedFunction(source,'queueMarkers'),c);
 const markers=Array.from(c.queueMarkers());assert.deepEqual(markers.map(t=>[t.id,t.role,t.visible]),[['A','current',false],['B','next',true],['C','third',true]]);
});
