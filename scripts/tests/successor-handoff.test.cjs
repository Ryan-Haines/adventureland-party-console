const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const {authorizeSuccessor}=require('../../runtime/combat/successor-grant.ts');
const {createSuccessorClient}=require('../../runtime/combat/successor-client.ts');
const {fightSelection}=require('../../runtime/combat/locked-pair.ts');
const monster=(id,x=80)=>({id,mtype:'stoneworm',map:'cave',in:'cave',x,y:0,priority:50});
function fixture(count) {
 let now=1000,group=null;const scope={};
 const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
 combatSelection:{runtimeId:name,id:null,revision:1,map:'cave'},groupedCombat:{protocol:4,anchorVisible:true,candidates:i?[]:['A','B','C','D'].map((n,i)=>monster(n,80+i*20)),threats:[],evidence:[],deaths:[],handoff:{capability:1,pairAck:null}}}}));
 const policy={allowed:true,...(count===undefined?{}:{hunt:{owner:'W',quest:'stoneworm',count,fresh:true}})};
 function tick(ack=true) {now+=100;for(const m of members){m.status.seenAt=now;if(ack){m.status.groupedCombat.ack=group?.selection;if(m.status.groupedCombat.handoff)m.status.groupedCombat.handoff.pairAck=group?.pairRevision;}}
 group=evaluateGroup(group,members,'W',now,0,false,'stoneworm');authorizeSuccessor(scope,group,members,policy,now);return group;}
 for(let i=0;i<9;i++)tick();
 return {members,policy,tick,scope,get group(){return group;},get now(){return now;},death(id){members[0].status.groupedCombat.deaths.push({...monster(id),server:'USII',at:now});},advance(ms){now+=ms;}};
}
test('locked red/yellow survive distance changes while third is optimized and acknowledgements survive',()=>{
 const f=fixture();const pair=f.group.pairRevision;f.members[0].status.groupedCombat.candidates=[monster('D',1),monster('C',2),monster('B',500),monster('A',400)];
 const g=f.tick();assert.deepEqual(g.queue.map(t=>t.id),['A','B','D']);assert.equal(g.pairRevision,pair);assert.equal(g.successorGrant.revoking,undefined);assert.equal(g.committed,true);
 f.death('A');assert.deepEqual(f.tick().queue.map(t=>t.id),['B','D','C']);
});
for(const count of [0,1,2,3])test('Hunt remaining count reserves current kill: '+count,()=>{
 const f=fixture(count);assert.equal(!!f.group.successorGrant,count>=2);
});
test('count two permits one successor and stale count cannot permit another after death',()=>{
 const f=fixture(2);assert.ok(f.group.successorGrant);f.death('A');f.tick();f.tick();assert.equal(f.group.target.id,'B');assert.equal(f.group.successorGrant,undefined);
 f.policy.hunt.count=1;f.tick();assert.equal(f.group.successorGrant,undefined);
});
test('count decrement and death in one report do not double-count kill',()=>{
 const f=fixture(3);f.death('A');f.policy.hunt.count=2;f.tick();f.tick();assert.equal(f.group.successorGrant.successor.id,'C');
});
for(const reason of ['activity','quest-expired','quest-type','missing-capability'])test('grant blocked or revoked for '+reason,()=>{
 const f=fixture(3),id=f.group.successorGrant.id;
 if(reason==='activity')f.policy.allowed=false;
 if(reason==='quest-expired')f.policy.hunt.fresh=false;
 if(reason==='quest-type')f.policy.hunt.quest='bee';
 if(reason==='missing-capability')delete f.members[0].status.groupedCombat.handoff;
 const g=f.tick();assert.equal(g.successorGrant.id,id);assert.equal(g.successorGrant.revoking,true);
});
test('partial acknowledgements never create a grant',()=>{
 const f=fixture();f.advance(3100);f.policy.allowed=false;f.tick();f.policy.allowed=true;
 f.members[0].status.groupedCombat.handoff.pairAck=null;f.tick(false);assert.equal(f.group.successorGrant,undefined);
});
test('revocation waits for every recipient or expiry before an incompatible grant',()=>{
 const f=fixture(),id=f.group.successorGrant.id;f.policy.allowed=false;f.tick();
 f.members[0].status.groupedCombat.handoff.revokedAck=id;f.policy.allowed=true;assert.equal(f.tick().successorGrant.revoking,true);
 for(const m of f.members)m.status.groupedCombat.handoff.revokedAck=id;
 assert.notEqual(f.tick().successorGrant?.id,id);
});
function clientFixture(f) {
 let wall=f.now,mono=100,allowed=true,live=true;const trace=[];
 const c=createSuccessorClient({now:()=>wall,monotonic:()=>mono,serverNow:()=>wall,allowed:()=>allowed,live:()=>live,trace:(stage,data)=>trace.push({stage,...data})});
 c.accept(structuredClone(f.group));return {c,trace,expire(){mono+=3100;},block(){allowed=false;},hide(){live=false;},wall(value){wall=value;}};
}
test('three clients promote without a coordinator response and report the identical selection',()=>{
 const f=fixture(2),clients=f.members.map(()=>clientFixture(f));
 for(const {c} of clients){const g=c.death('A');assert.equal(g.target.id,'B');assert.equal(g.committed,true);assert.equal(g.selection,fightSelection(f.group.key,f.group.queue[1]));assert.equal(c.death('A'),null);}
 assert.equal(new Set(clients.map(x=>x.c.report().consumed)).size,1);
 f.death('A');const g=f.tick();for(const {c} of clients){assert.equal(c.accept(g).target.id,'B');assert.equal(c.effective().selection,g.selection);}
});
for(const gate of ['expire','block','hide'])test('client refuses promotion on '+gate,()=>{
 const r=clientFixture(fixture());r[gate]();assert.equal(r.c.death('A'),null);
});
test('only matching confirmed predecessor death consumes permission',()=>{
 const {c}=clientFixture(fixture());assert.equal(c.death('missing'),null);assert.equal(c.report().consumed,null);assert.ok(c.death('A'));
});
test('delayed predecessor snapshot cannot roll back local promotion',()=>{
 const f=fixture(),{c}=clientFixture(f);const old=structuredClone(f.group);c.death('A');assert.equal(c.accept(old).target.id,'B');
});
test('stale receipt cannot extend monotonic expiry and wall clock rollback cannot resurrect permission',()=>{
 const f=fixture(),r=clientFixture(f);r.expire();r.wall(0);r.c.accept(structuredClone(f.group));assert.equal(r.c.death('A'),null);
});
test('revocation and scope replacement immediately remove a local promotion',()=>{
 const f=fixture(),r=clientFixture(f);r.c.death('A');const g=structuredClone(f.group);g.seenAt++;g.successorGrant.revoking=true;
 assert.equal(r.c.accept(g).target.id,'A');assert.equal(r.c.report().revokedAck,g.successorGrant.id);assert.equal(r.c.death('A'),null);
});
test('client reset discards every permission and acknowledgement',()=>{
 const r=clientFixture(fixture());r.c.reset();assert.equal(r.c.death('A'),null);assert.equal(r.c.report().pairAck,null);
});


test('coordinator activity ownership blocks grants during anniversary return and Hunt turn-in',()=>{
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/navigation/grouped-snapshot.ts');
 for(const activity of ['ordinary','anniversary','convoy','turn-in']) {
  const f=fixture(3);for(const m of f.members)m.status.monsterHunt={id:'stoneworm',count:3,remainingMs:60000};
  const state={leader:'W',followers:{P:true,M:true},headlessSlots:['W','P','M'],steamMembers:[],merchantCharacter:null,
   statuses:Object.fromEntries(f.members.map(m=>[m.name,m.status])),partyFarmingMode:'default',farmingPolicy:'hunt',
   monsterHunt:{stage:activity==='turn-in'?'returning':'farming',target:'stoneworm',participants:['W','P','M'],owner:'W',selectionLeader:'W'},
   combatLogs:{},groupedCombat:f.group};
  if(activity==='anniversary')state.anniversary={eventCycle:{}};
  if(activity==='convoy')state.eventReturn={};
  const ports={now:()=>f.now,tickDisengagement(){},disengagementActive:()=>false,intent:()=>({revision:1}),
   owned:()=>({type:'warrior'}),prepare:m=>m,evaluate:()=>({...f.group}),finalize:g=>g,blocksPulls:()=>false};
  let group=coordinatorGroupedSnapshot(state,ports);
  for(const m of f.members)m.status.groupedCombat.handoff.pairAck=group.pairRevision;
  group=coordinatorGroupedSnapshot(state,ports);
  assert.equal(!!group.successorGrant,activity==='ordinary',activity);
 }
});
test('changed navigation/runtime scope cannot reuse a grant',()=>{
 const f=fixture(),r=clientFixture(f);const g=structuredClone(f.group);g.key='new';g.seenAt++;delete g.successorGrant;
 r.c.accept(g);assert.equal(r.c.death('A'),null);
});


test('new coordinator scope requires fresh pair acknowledgements instead of restoring grants',()=>{
 const f=fixture(),g=structuredClone(f.group),before=g.pairRevision;
 authorizeSuccessor({},g,f.members,f.policy,f.now);assert.notEqual(g.pairRevision,before);assert.equal(g.successorGrant,undefined);
});
test('removed grant recipient cannot be acknowledged by a replacement runtime',()=>{
 const f=fixture(),id=f.group.successorGrant.id;f.policy.allowed=false;f.tick();
 for(const m of f.members)m.status.groupedCombat.handoff.revokedAck=id;
 f.members[0].status.combatSelection.runtimeId='new';
 assert.equal(f.tick().successorGrant.revoking,true);
 f.advance(3100);assert.equal(f.tick().successorGrant,undefined);
});
