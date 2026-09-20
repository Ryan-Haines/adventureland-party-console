const test=require('node:test'),assert=require('node:assert/strict');
const {createRareRetryEvidence}=require('../../runtime/coordinator/navigation/rare-retry-evidence.ts');
test('unchanged rejected rare evidence cannot repeatedly cancel return; material changes admit it again',()=>{
 const r=createRareRetryEvidence(),s={id:'hen',map:'main',x:10,y:0,hp:100,target:null,seenAt:1000},origin={map:'main',x:0,y:0};
 r.reject('hen',s,origin);
 assert.equal(r.eligible('hen',{...s,seenAt:99999},origin),false);
 assert.equal(r.eligible('new-hen',s,origin),true);
 assert.equal(r.eligible('hen',{...s,hp:99},origin),true);
 r.reject('hen',s,origin);assert.equal(r.eligible('hen',s,{...origin,x:60}),true);
});
