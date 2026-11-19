const assert=require('node:assert/strict');
const {createCrabRangeRecovery}=require('../../runtime/characters/targeting/gates.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const sample=()=>({targetId:'crab-1',map:'main',mtype:'crab',at:1000,range:30,
 actor:{x:0,y:0,width:26,height:36},target:{x:70,y:0,width:60,height:64},
 expected:{width:12,height:12},nativeDistance:27,correctedDistance:51});
scenarioTable("crab range correction activates only on qualifying rejections and expires", ()=>sample, [
 ['native behavior is unchanged until a qualifying rejection; correction and backoff agree', sample=>{
 const r=createCrabRangeRecovery(),s=sample();assert.equal(r.blocked(s,1000),false);
 r.reject(s,{reason:'too_far',dist:51},1000);
 assert.equal(r.distance(s,1001),51);assert.equal(r.blocked(s,1500),true);
 s.correctedDistance=28;assert.equal(r.blocked(s,1499),true);assert.equal(r.blocked(s,1500),false);
 assert.deepEqual(r.diagnostic().rejection,{reason:'too_far',dist:51});}],
 ['repeated rejections cannot extend expiry; fixed server returns to native behavior', sample=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);r.reject(s,{},20000);
 assert.equal(r.diagnostic().expiresAt,31000);assert.equal(r.distance(s,31000),null);
 assert.equal(r.blocked(s,31001),false);assert.equal(r.diagnostic().active,false);}],
 ['fixed client geometry immediately retires correction', sample=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);
 s.target.width=12;s.target.height=12;s.nativeDistance=51;
 assert.equal(r.distance(s,1001),null);assert.equal(r.diagnostic().reason,'native geometry agrees');}],
 ['selection and map changes reset recovery but inspecting another monster does not', sample=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);
 assert.equal(r.distance({...s,targetId:'other'},1001),null);assert.equal(r.distance(s,1001),51);
 assert.equal(r.distance(null,1001),null);assert.equal(r.distance(s,1001),51,'inspecting an uncorrected species preserves recovery');
 r.select({...s,targetId:'other'},1002);assert.equal(r.distance(s,1003),null);
 r.reject(s,{},2000);r.select({...s,map:'cave'},2001);assert.equal(r.distance(s,2002),null);
 r.reject(s,{},3000);r.reset();assert.equal(r.distance(s,3001),null);}],
 ...[['another species',s=>{s.mtype='bee';}],['a native distance of 40',s=>{s.nativeDistance=40;}],['a corrected distance of 29',s=>{s.correctedDistance=29;}]].map(([why,mutate])=>['nonqualifying evidence never activates correction: '+why, sample=>{
 const r=createCrabRangeRecovery(),s=sample();mutate(s);r.reject(s,{},1000);assert.equal(r.distance(s,1001),null);
 }]),
]);

// Booking half: a fresh `too_far` reply to the attack's own send rejects the crab range sample and
// shows the diagnostic; a reply older than the pick's window or on a target the selection no longer
// holds changes nothing, and the send's evidence is rejected either way.
const test=require('node:test');
test('the attack bookings hand a fresh too_far reply to the crab range recovery',()=>{
  const {createAttackBookings}=require('../../runtime/characters/targeting/attack-bookings.ts');
  const {pick}=require('../../runtime/characters/targeting/saved-fields.ts');
  const rejected=[],evidence=[],state={},range=sample();
  const recovery={reject:(r,reply,at)=>rejected.push([r,reply,at]),diagnostic:()=>({rejected:rejected.length})};
  const module={queueEvidence:(target,s,action)=>(evidence.push([s,action??null]),'send-1'),noteAttack(){}};
  const bookings=createAttackBookings({recovery,state:()=>state,module});
  let current=true;const context={target:{id:'crab-1'},range,passing:false,current:()=>current};
  bookings.sent({context});
  bookings.settled({context,outcome:'rejected',reason:'too_far',sentAt:Date.now()-pick('crabReplyMs')-1,reply:{}});
  assert.equal(rejected.length,0,'a reply outside the window is not this send');
  bookings.settled({context,outcome:'rejected',reason:'too_far',sentAt:Date.now(),reply:{dist:1}});
  assert.equal(rejected.length,1);assert.equal(rejected[0][0],range);
  assert.deepEqual(state.rangeRecovery,{rejected:1},'the card shows the recovery');
  current=false;bookings.settled({context,outcome:'rejected',reason:'too_far',sentAt:Date.now(),reply:{}});
  assert.equal(rejected.length,1,'a target the selection no longer holds is not corrected');
  assert.deepEqual(evidence,[['pending',null],['rejected','send-1'],['rejected','send-1'],['rejected','send-1']]);
});
