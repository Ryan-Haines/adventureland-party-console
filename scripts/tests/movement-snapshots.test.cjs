// Isolated test for the saved movement snapshots and the diagnostics lease.
// Failure list first.
// The walks scenario saves snapshots in
// play; eight days of virtual time and 25 triggers are run here on an injected clock.
const assert=require('node:assert/strict');
const {SNAPSHOTS_KEPT,SNAPSHOT_AGE_MS}=require('../../runtime/movement/coordinator/records.ts');

const ring=n=>Array.from({length:n},(_,i)=>({seq:i+1,at:i,decision:'started'}));

const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {store}=require('./fixtures/movement-snapshots-scenario.cjs');
scenarioTable('movement snapshots are kept per character and bounded (MOV-204)', ()=>undefined, [
 ['failure 13: records are kept until read, pruned by count and age, and stay with their character', ()=>{
  // Each trigger saves one snapshot that resolves by its id.
  const s=store();
  for(const trigger of ['death','stuck','caught-error','churn','walk-failed']){
    const saved=s.service.save({character:'W',trigger,records:ring(3),incidents:[]});
    assert.deepEqual(s.service.snapshot('W',saved.id).records,ring(3));
    s.advance(1000);
  }
  assert.equal(s.files('W').length,5);
  assert.equal(s.files('P').length,0);
  // A failed walk's post (routes.ts `failed`) saves the member's ring as `walk-failed`; a post with
  // no ring list saves an empty one.
  s.service.walkFailed('P',ring(2),'none');
  const failed=s.service.snapshots('P');
  assert.deepEqual(failed.map(x=>[x.trigger,x.records,x.incidents]),[['walk-failed',2,[]]]);
  // A snapshot id never reaches outside its character.
  assert.equal(s.service.snapshot('W','P/x'),null);
  assert.equal(s.service.snapshot('W','W/../P/x'),null);
  // 25 triggers over 8 days of virtual time, one every 8 hours, keep the newest 20 and none older than 7 days.
  const days=store();
  for(let i=0;i<25;i++){days.service.save({character:'W',trigger:'stuck',records:ring(1),incidents:[]});days.advance(8*3600*1000);}
  const kept=days.service.snapshots('W');
  assert.ok(kept.length<=SNAPSHOTS_KEPT);
  assert.ok(kept.every(x=>days.now-x.at<SNAPSHOT_AGE_MS),'none older than 7 days');
  assert.ok(kept[0].at>kept.at(-1).at,'newest first');
  const burst=store();
  for(let i=0;i<25;i++){burst.service.save({character:'W',trigger:'churn',records:[],incidents:[]});burst.advance(1000);}
  assert.equal(burst.service.snapshots('W').length,SNAPSHOTS_KEPT);
  // Table G's lease (the status owner's runtime/status/coordinator/diagnostics.ts) lasts two of the character's
  // measured report intervals after the last read; without one nothing is posted.
  const {createDiagnostics}=require('../../runtime/status/coordinator/diagnostics.ts');
  let at=1_000_000;const lease=createDiagnostics({now:()=>at,status:()=>({reportIntervalMs:1000}),snapshots:()=>[]});
  assert.equal(lease.post('W','movement',{records:ring(2),incidents:[]}),false);
  assert.equal(lease.read('W',['movement']).until,at+2000);
  assert.deepEqual(lease.rings('W'),['movement']);
  assert.equal(lease.post('W','movement',{records:ring(2),incidents:[]}),true);
  assert.deepEqual(lease.read('W',['movement']).live.movement.records,ring(2));
  at+=1000;assert.deepEqual(lease.rings('W'),['movement']);
  at+=1000;assert.deepEqual(lease.rings('W'),[],'ends two intervals after the last read');
  assert.equal(lease.post('W','movement',{records:ring(2),incidents:[]}),false);
 }],
 // A corrupt snapshot file reads as none for every reader (records.ts readSnapshot), so GET
 // /party-api/movement/snapshot answers 404 for it as for a missing one.
 ['a corrupt snapshot file answers none', ()=>{
  const s=store();
  const saved=s.service.save({character:'W',trigger:'stuck',records:ring(1),incidents:[]});
  s.write('W',saved.id.slice(2)+'.json','{');
  assert.equal(s.service.snapshot('W',saved.id),null);
  assert.deepEqual(s.service.snapshots('W'),[]);
 }],
 // CB18: the character keeps a limitdc copy until the
 // coordinator's answer comes, so a post that landed after the relog cut the answer comes again
 // from the next install under the same id. A live run saved it twice (000007 and 000009).
 ['CB18: a snapshot posted again under its own id is saved once', ()=>{
  const s=store();
  const first=s.service.save({character:'M',trigger:'limitdc',posted:'M:1',records:ring(2),incidents:[]});
  s.advance(1000);
  const again=s.service.save({character:'M',trigger:'limitdc',posted:'M:1',records:ring(2),incidents:[]});
  assert.equal(again.id,first.id,'the second post answers with the saved snapshot');
  assert.equal(s.files('M').length,1);
  // Another id, and the movement owner's own snapshots, which carry none, each save a file.
  s.service.save({character:'M',trigger:'limitdc',posted:'M:2',records:ring(1),incidents:[]});
  s.service.save({character:'M',trigger:'death',records:ring(1),incidents:[]});
  s.advance(1000);
  s.service.save({character:'M',trigger:'death',records:ring(1),incidents:[]});
  assert.equal(s.files('M').length,4);
  // The id belongs to its character: the same id from another character is that character's own.
  s.service.save({character:'W',trigger:'limitdc',posted:'M:1',records:ring(1),incidents:[]});
  assert.equal(s.files('W').length,1);
 }],
]);
