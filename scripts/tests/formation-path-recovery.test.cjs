const test=require('node:test'),assert=require('node:assert/strict');
const {formationRecovery}=require('../../runtime/combat/formation-recovery.ts');
const {createFormationRecoveryClient}=require('../../runtime/combat/formation-recovery-client.ts');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const identity=JSON.stringify(['USII','arena','arena','goo']);
function fixture(){
 let now=10000,previous=null;
 const target={id:'goo',mtype:'cgoo',map:'arena',in:'arena',server:'USII',x:400,y:0,state:'planned',fighter:'W',startedAt:9000};
 const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,map:'arena',in:'arena',server:'USII',x:0,y:0,hp:100,range:180,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,currentAttackersAt:now,currentAttackers:[],anchorVisible:true,evidence:[],candidates:[]}}}));
 members[1].status.groupedCombat.formationRecovery={target:identity,at:now,goals:[{x:240,y:0},{x:250,y:40},{x:250,y:-40}]};
 return {members,target,get r(){return previous?.formationRecovery;},get now(){return now;},
 tick(ms=100){now+=ms;for(const m of members){m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;
  if(m.status.groupedCombat.formationRecovery)m.status.groupedCombat.formationRecovery.at=now;}
 const r=formationRecovery(previous,members,target,'key',now,false,160);previous={formationRecovery:r};return r;},
 ack(){for(const m of members)m.status.groupedCombat.formationRecovery={target:identity,at:now,ack:previous.formationRecovery.id};}};
}
test('priest recovery pauses all members before routing, permits separation, then waits for stable coverage',()=>{
 const f=fixture();assert.equal(f.tick().phase,'pausing');assert.equal(f.tick().phase,'pausing');
 f.ack();assert.equal(f.tick().phase,'routing');
 f.members[1].status.x=300;assert.equal(f.tick().phase,'routing');
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:1,outcome:'arrived'});
 assert.equal(f.tick().phase,'regrouping');assert.equal(f.tick(1000).phase,'regrouping');
 for(const m of f.members)m.status.x=300;
 assert.equal(f.tick().phase,'regrouping');assert.equal(f.tick(500),undefined);
});
test('recovery fails closed on pending attacks, aggro, stale observations, travel, cancellation and changed identity',()=>{
 for(const mutate of [f=>f.members[0].cancelled=true,f=>f.members[0].status.groupedCombat.evidence=[{state:'pending'}],
  f=>f.members[0].status.groupedCombat.currentAttackers=[{id:'other'}],f=>f.members[0].status.groupedCombat.travelCommand={id:1},
  f=>f.members[0].status.rip=true,f=>f.members[0].status.map='main',f=>f.target.state='engaged']){
  const f=fixture();f.tick();f.ack();mutate(f);assert.equal(f.tick(),undefined);
 }
 const f=fixture();f.tick();f.ack();f.members[0].status.seenAt=0;
 assert.equal(formationRecovery({formationRecovery:f.r},f.members,f.target,'key',f.now,false,160),undefined);
});
test('route failure retries are bounded and hold the pause between attempts',()=>{
 const f=fixture();f.tick();f.ack();f.tick();
 for(let i=1;i<=3;i++){
  Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:i,outcome:'failed',reason:'wall'});
  assert.equal(f.tick().phase,i===3?'failed':'retry');
  if(i<3){assert.equal(f.tick().phase,'retry');assert.equal(f.tick(i===1?5000:15000).attempt,i+1);}
 }
 assert.equal(f.r.reason,'wall');
});
test('closer target revocation cancels old formation recovery after acknowledgement',()=>{
 const f=fixture();let g=null,now=10000;
 f.members[0].status.groupedCombat.candidates=[f.target];
 for(let i=0;i<10;i++){
  now+=100;for(const m of f.members){m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;
   m.status.groupedCombat.ack=g?.selection;m.status.groupedCombat.queueAck=g?.queueRevision;
   if(g?.formationRecovery)m.status.groupedCombat.formationRecovery={target:identity,at:now,ack:g.formationRecovery.id};}
  g=evaluateGroup(g,f.members,'W',now,0,false,'cgoo');
 }
 assert.equal(g.formationRecovery.phase,'routing');assert.equal(g.committed,false);
 f.members[0].status.groupedCombat.candidates.push({...f.target,id:'closer',x:20});
 g=evaluateGroup(g,f.members,'W',now+100,0,false,'cgoo');assert.equal(g.target.id,'goo');assert.equal(g.committed,false);
 assert.ok(g.pursuit.revoking);
 for(const m of f.members){m.status.seenAt=now+200;m.status.groupedCombat.pursuitAck=g.pursuit.revoking;}
 g=evaluateGroup(g,f.members,'W',now+200,0,false,'cgoo');
 assert.equal(g.target.id,'closer');assert.equal(g.formationRecovery,undefined);
 assert.equal(g.queue[0].id,'closer','red marker and selected target switch together');
});
function client(extra={}){
 let now=10000,allowed=true,covered=false,starts=0,stops=0,resolve;
 const self={name:'P',map:'arena',x:0,y:0,moving:false};
 const smart={plot:[],found:false,on_done:null},gate={owner:null,original(){const next=smart.plot.shift();if(next){self.x=next.x;self.y=next.y;}else resolve();}};
 const logs=[];let safe=()=>true;
 const api=createFormationRecoveryClient({now:()=>now,self:()=>self,context:()=>({allowed,key:'key',target:identity,covered}),smart:()=>smart,gate:()=>gate,
  safe:p=>safe(p),start(goal){starts++;smart.on_done=()=>{};smart.found=false;return new Promise(r=>resolve=r);},
  plan(){smart.found=true;smart.plot=[{map:'arena',x:-80,y:0},{map:'arena',x:-80,y:150},{map:'arena',x:240,y:0}];},
  stop(){stops++;},hold(){},log:(...v)=>logs.push(v),position(){},debug:()=>false,...extra});
 const control={id:'r',key:'key',target:identity,mover:'P',goals:[{x:240,y:0}],phase:'routing',attempt:1,startedAt:now,phaseAt:now};
 return {api,self,smart,gate,control,logs,get starts(){return starts;},get stops(){return stops;},unsafe(){safe=()=>false;},cancel(){allowed=false;},advance(ms){now+=ms;}};
}
test('native recovery keeps one route across multiple corners and permits movement away from the target',async()=>{
 const c=client();c.api.accept(c.control);assert.equal(c.starts,1);
 c.gate.owner.tick();c.gate.owner.tick();assert.equal(c.self.x,-80);
 for(let i=0;i<10;i++)c.api.tick();assert.equal(c.starts,1);assert.equal(c.api.movement(),true);
 c.gate.owner.tick();c.gate.owner.tick();c.gate.owner.tick();await new Promise(setImmediate);
 assert.equal(c.api.report().outcome,'arrived');assert.equal(c.gate.owner,null);assert.equal(c.starts,1);
});
test('unsafe next segments, map shortcuts and route timeout fail without walking',()=>{
 for(const kind of ['unsafe','map','timeout']){
  const c=client();c.api.accept(c.control);c.gate.owner.tick();
  if(kind==='unsafe')c.unsafe();if(kind==='map')c.smart.plot[0].town=true;if(kind==='timeout')c.advance(30000);
  c.gate.owner.tick();assert.equal(c.api.report().outcome,'failed');assert.equal(c.self.x,0);assert.equal(c.gate.owner,null);
 }
});
test('cancellation preserves a superseding native route and its gate owner',()=>{
 const c=client();c.api.accept(c.control);const newer={tick(){}};c.gate.owner=newer;c.smart.on_done=()=>{};
 c.cancel();c.api.tick();assert.equal(c.stops,0);assert.equal(c.gate.owner,newer);assert.equal(c.api.blocks(),false);
});
test('proposal survives periodic ticks until coordinator authorization',()=>{
 const c=client();c.api.propose(identity,[{x:240,y:0}]);c.api.tick();assert.equal(c.api.report().goals.length,1);assert.equal(c.starts,0);
});

test('recovery planner and follower route around the same blocked segment without native failed-path retries',async()=>{
 const clear=(a,b)=>!((a.x<100&&b.x>=100||b.x<100&&a.x>=100) && a.y+(b.y-a.y)*(100-a.x)/(b.x-a.x)<60);
 let c;c=client({segmentClear:clear,safe:p=>clear(c.self,p),stepSize:12,plan(){throw Error('terrain-only planner used');}});
 c.api.accept(c.control);
 for(let i=0;i<150&&c.gate.owner;i++){
  const previous={...c.self};c.gate.owner.tick();assert.ok(clear(previous,c.self));await Promise.resolve();
 }
 assert.equal(c.api.report().outcome,'arrived');assert.equal(c.starts,1);
 c.self.x=0;c.self.y=0;
 let highest=0;
 for(let i=0;i<30&&c.self.x<240;i++){
  const point=c.api.followPoint({x:240,y:0});assert.ok(point);assert.ok(clear(c.self,point));
  c.self.x=point.x;c.self.y=point.y;highest=Math.max(highest,point.y);
 }
 assert.ok(highest>=60,'follower takes the opening instead of waiting at the wall');assert.equal(c.self.x,240);
});

test('safe approach handoff requires fresh matching readiness for 500ms, not visibility alone',()=>{
 const f=fixture();f.tick();f.ack();f.tick();
 for(const m of f.members)Object.assign(m.status.groupedCombat.formationRecovery,{attempt:1,approachReady:true});
 assert.equal(f.tick().phase,'routing');
 f.members[0].status.groupedCombat.formationRecovery.approachReady=false;
 assert.equal(f.tick(600).phase,'routing');
 f.members[0].status.groupedCombat.formationRecovery.approachReady=true;
 assert.equal(f.tick().phase,'routing');assert.equal(f.tick(500),undefined);
 assert.equal(f.tick(),undefined,'old acknowledged reports cannot restart the recovery');
});
test('late failure from a different recovery id cannot settle the current route',()=>{
 const f=fixture();f.tick();f.ack();f.tick();
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{ack:'old',attempt:1,outcome:'failed'});
 assert.equal(f.tick().phase,'routing');
});
test('failed destinations are not repeated and refreshed alternatives are used',()=>{
 const f=fixture();f.tick();f.ack();f.tick();const original=f.r.goal;
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:1,outcome:'failed',reason:'path_not_found'});
 f.tick();Object.assign(f.members[1].status.groupedCombat.formationRecovery,{goals:[original,{x:400,y:80}]});
 f.tick(5000);assert.deepEqual(f.r.goal,{x:400,y:80});
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:2,outcome:'failed',goals:[original,{x:400,y:80}]});
 f.tick();assert.equal(f.tick(15000).phase,'failed');assert.match(f.r.reason,/untried/);
});
test('route release clears owned movement and ignores its delayed failure',async()=>{
 let reject,releases=0;const c=client({start:()=>new Promise((_,r)=>reject=r),release:()=>releases++});
 c.api.accept(c.control);c.api.accept(undefined);reject({reason:'path_not_found'});await new Promise(setImmediate);
 assert.equal(releases,1);assert.equal(c.api.blocks(),false);assert.equal(c.api.report(),undefined);assert.equal(c.gate.owner,null);
});
test('structured path errors remain readable and cannot poison the next attempt',async()=>{
 const c=client({start:()=>Promise.reject({reason:'path_not_found'})});c.api.accept(c.control);await new Promise(setImmediate);
 assert.equal(c.api.report().reason,'path_not_found');
 c.api.accept({...c.control,phase:'retry',attempt:2});assert.equal(c.api.report().outcome,undefined);
});
test('recovery followers move while attacks remain paused; route segments wait for coverage',()=>{
 let follows=0,covered=false;const c=client({stepSize:12,coveredStep:()=>covered,follow:()=>follows++});
 c.api.accept(c.control);c.gate.owner.tick();c.gate.owner.tick();assert.equal(c.self.x,0);
 covered=true;c.gate.owner.tick();assert.equal(c.self.x,-12,'long native segment is split before movement');
 c.api.accept({...c.control,mover:'W'});assert.equal(c.api.movement(),true);assert.equal(follows,1);assert.equal(c.api.blocks(),true);
});
