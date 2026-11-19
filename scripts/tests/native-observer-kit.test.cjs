// The native observers' kit (e2e/native-observer-kit.ts): an observer whose binding throws
// or whose ring wraps between two reads reports it, so a short buffer never reads as a quiet run.
// Isolated: a live run cannot make a binding throw or a ring wrap on demand.
const test=require('node:test'),assert=require('node:assert/strict');
const {observerRecords,sequenceGaps}=require('../../e2e/native-observer-kit.ts');

test('a throwing binding and an overflowing buffer show as failures and drops',async()=>{
  const records=observerRecords(2,2);
  for(const n of [1,2,3,4,5,6])records.push(n);
  await records.guard('deliver',()=>{throw new Error('binding refused');});
  await records.guard('deliver',()=>Promise.reject(new TypeError('closed')));
  assert.equal(await records.guard('read',()=>7),7,'a read that works answers its value');
  assert.deepEqual(records.report(),{records:[1,2,5,6],dropped:2,
    failures:[{stage:'deliver',error:'Error: binding refused'},{stage:'deliver',error:'TypeError: closed'}]});
});

test('a ring that wraps between two reads counts one gap; a reload does not',()=>{
  const ring=sequenceGaps();
  ring.read('E2EWarrior',[1,2,3]);
  ring.read('E2EWarrior',[3,4,5]);
  assert.equal(ring.gaps('E2EWarrior'),0,'overlapping reads leave no gap');
  ring.read('E2EWarrior',[9,10]);
  assert.equal(ring.gaps('E2EWarrior'),1,'records 6 to 8 went unread');
  ring.read('E2EWarrior',[1,2]);
  assert.equal(ring.gaps('E2EWarrior'),1,'a reload starts the sequence again');
});
