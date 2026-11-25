const { targetingContext } = require('./helpers/targeting-module.cjs');
const {productionFunctions} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {retainNominations}=require('../../runtime/coordinator/targeting/queue.ts');
const {reconcileQueue}=require('../../runtime/coordinator/targeting/queue.ts');
// Targeting's stand-ins for the sliced contexts.
test('client retains a visible admitted fringe target when an inside-zone monster appears',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const entity={id:'A',mtype:'wolfie',x:450,y:0,visible:true},area={map:'winterland',x:0,y:0};
 // The target scope is the tasks owner's hold, and the wolfie focus, an area that holds no target and the
 // 400-wide radius are the hunting owner's farm.
 const c=targetingContext({root:{__partyEntitiesObservedAt:1000,__partyNomination:{}},character:{map:'winterland',in:'winterland'},
  groupedCombat:{queue:[{...target}]},get_entity:()=>entity,isExternallyClaimedMonster:()=>false,partyLocation:area,
  groupedEntityReport:e=>({...e,map:'winterland',in:'winterland'})},undefined,
 {tasks:{holds:{targetScope:()=>area}},walks:{reunionRealm:()=>'USII'},
  hunting:{facts:{focus:{focus:['wolfie'],contains:()=>false}},farm:{radius:()=>400}}});
 vm.runInContext(productionFunctions(['queueRetentions', 'targetingUnreachableReport']),c);
 assert.equal(c.queueRetentions()[0].eligible,true);entity.x=551;
 assert.equal(c.queueRetentions()[0].reason,'retention boundary');entity.visible=false;
 assert.equal(c.queueRetentions()[0].reason,'not visible');
});
const target={id:'A',mtype:'wolfie',map:'winterland',in:'winterland',server:'USII',x:10,y:0,state:'planned',fighter:'W',startedAt:100};
function members(){return ['W','P','M'].map(name=>({name,ctype:'warrior',revision:1,status:{server:'USII',map:'winterland',in:'winterland',seenAt:1000,hp:100,x:0,y:0,
 groupedCombat:{epoch:0,retentions:[{...target,at:1000,eligible:false,reason:'not visible'}],candidates:[]}}}));}
test('one party observer preserves an admitted target and primary identity despite new inside-zone candidates',()=>{
 const m=members();m[1].status.groupedCombat.retentions[0].eligible=true;
 m[0].status.groupedCombat.candidates=[{...target,id:'B',x:0}];
 const g=reconcileQueue({queue:[target],target,fights:[]},m,'W',1000,'key');
 assert.equal(g.target.id,'A');assert.deepEqual(g.queue.map(t=>t.id),['A','B']);
});

test('retained nominations wait safely while the leader has no heartbeat after restart',()=>{
 const m=members();delete m[0].status;
 m[1].status.groupedCombat.retentions[0].eligible=true;
 const g=reconcileQueue({queue:[target],target,fights:[]},m,'W',1000,'key');
 assert.equal(g.target,null);assert.deepEqual(g.queue,[]);
});
test('neutral visibility retirement requires every party member; stale observer prevents removal',()=>{
 const m=members();m[2].status.seenAt=0;
 assert.equal(retainNominations([target],m,4000).length,1);
 for(const member of m){member.status.seenAt=4000;member.status.groupedCombat.retentions[0].at=4000;}
 assert.equal(retainNominations([target],m,4000).length,0);
});
test('explicit retention rejection removes the neutral; positive sighting wins over another missing observer',()=>{
 for(const reason of ['retention boundary','failed approach','focus changed','external claim','confirmed death']){
  const m=members();m[0].status.groupedCombat.retentions[0].reason=reason;
  assert.equal(retainNominations([target],m,1000).length,0,reason);
  // The selected neutral is invalidated by the same reasons while it is unseen.
  const result=reconcileQueue({queue:[target],target,fights:[]},m,'W',1000,'key');assert.equal(result.target,null,reason);
 }
 const m=members();m[0].status.groupedCombat.retentions[0].eligible=true;
 assert.equal(retainNominations([target],m,1000).length,1);
 m[1].status.groupedCombat.retentionPaused=true;assert.equal(retainNominations([target],m,1000).length,0);
});

test('selected neutral keeps its last position while unseen en route, then retires only after local absence',()=>{
 const m=members();for(const v of m){v.status.x=-500;v.status.groupedCombat.observationAt=1000;}
 let old={queue:[target],target,fights:[]};
 function tick(at,x){for(const v of m){v.status.seenAt=at;v.status.x=x;v.status.groupedCombat.observationAt=at;v.status.groupedCombat.retentions[0].at=at;}
  const result=reconcileQueue(old,m,'W',at,'key');old={...result};return result;}
 assert.equal(tick(1000,-500).target?.id,'A');
 assert.equal(tick(10000,-500).target?.id,'A','elapsed travel alone cannot prove disappearance');
 assert.equal(tick(11000,10).target?.id,'A','first observation near the last position is not enough');
 const result=tick(12000,10);assert.equal(result.target,null);assert.equal(result.lostTargets[0].id,'A');
});
test('selected neutral reacquisition resets absence without granting an attack',()=>{
 const m=members();let old={queue:[target],target,fights:[]};
 let result=reconcileQueue(old,m,'W',1000,'key');assert.equal(result.target?.id,'A');
 m[1].status.groupedCombat.retentions[0].eligible=true;
 m[1].status.groupedCombat.sightings=[target];
 result=reconcileQueue(result,m,'W',1100,'key');
 assert.equal(result.target.id,'A');assert.deepEqual(result.searches,{});assert.equal(result.target.state,'planned');
});
