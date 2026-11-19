// The artifact manifest's provenance: a run where git cannot read the tree records dirty null
// (unknown) beside revision 'unavailable'; the failed read used to answer a sentinel string whose
// length made dirty read true.
const test=require('node:test'),assert=require('node:assert/strict');
const {gitProvenance}=require('../../e2e/artifact-reporter.cjs');
test('a run with git failing records dirty null',()=>{
  assert.deepEqual(gitProvenance(()=>null),{revision:'unavailable',branch:'unavailable',dirty:null});
});
test('a clean and a changed tree read as such',()=>{
  const read=status=>(...args)=>args[0]==='status'?status:'abc';
  assert.equal(gitProvenance(read('')).dirty,false);
  assert.equal(gitProvenance(read(' M e2e/x.ts')).dirty,true);
});
