const test=require('node:test'),assert=require('node:assert/strict');
const {createRareRetryEvidence}=require('../../runtime/coordinator/navigation/rare-retry-evidence.ts');
test('rejection receipts project heartbeat positions and migrate bloated saved receipts without reopening pursuit',()=>{
 const sight={id:'phoenix',mtype:'phoenix',map:'main',x:10,y:0,hp:100,seenAt:1000,realm:':USII',in:'main',reporter:'P'};
 const heartbeat={map:'main',x:0,y:0,items:[{meta:'x'.repeat(1000000)}],combatTrace:[],groupedCombat:{}};
 const saved={legacy:{sight:{...sight,extra:heartbeat},origin:heartbeat}};
 const service=createRareRetryEvidence(saved);
 assert.deepEqual(saved.legacy.origin,{map:'main',x:0,y:0});
 assert.ok(JSON.stringify(saved).length<1000);
 assert.equal(service.eligible('legacy',{...sight,seenAt:2000},heartbeat),false);
 service.reject('new',sight,heartbeat);
 heartbeat.x=99;sight.hp=1;
 assert.equal(saved.new.origin.x,0);assert.equal(saved.new.sight.hp,100);
 assert.ok(JSON.stringify(saved).length<2000);
 assert.equal(service.eligible('legacy',{...sight,seenAt:2000},heartbeat),true);
});
test('unchanged rejected rare evidence cannot repeatedly cancel return; material changes admit it again',()=>{
 const r=createRareRetryEvidence(),s={id:'hen',map:'main',x:10,y:0,hp:100,target:null,seenAt:1000},origin={map:'main',x:0,y:0};
 r.reject('hen',s,origin);
 assert.equal(r.eligible('hen',{...s,seenAt:99999},origin),false);
 assert.equal(r.eligible('new-hen',s,origin),true);
 assert.equal(r.eligible('hen',{...s,hp:99,seenAt:2000},origin),true);
 r.reject('hen',s,origin);assert.equal(r.eligible('hen',{...s,seenAt:2000},{...origin,x:60}),false);
});

test('ambient wandering and restarts preserve rejection; usable range or new combat clears it',()=>{
 const saved={},s={id:'fairy',map:'main',x:100,y:0,hp:5600,seenAt:1000},origin={map:'main',x:0,y:0};
 createRareRetryEvidence(saved).reject('fairy',s,origin);
 const restored=createRareRetryEvidence(JSON.parse(JSON.stringify(saved)));
 assert.equal(restored.eligible('fairy',{...s,x:500,seenAt:2000},{...origin,x:100}),false);
 assert.equal(restored.eligible('fairy',{...s,hp:1},origin),false,'stale damage cannot reopen pursuit');
 assert.equal(restored.eligible('fairy',{...s,seenAt:3000},origin,true),true);
});

test('old engagement and already-known reachability cannot repeatedly reopen a rejection',()=>{
 const r=createRareRetryEvidence(),s={id:'fairy',map:'main',x:0,y:0,hp:5600,seenAt:1000,partyEngaged:true,reachable:true},origin={map:'main',x:0,y:0};
 r.reject('fairy',s,origin);assert.equal(r.eligible('fairy',{...s,seenAt:2000},origin,true),false);
 assert.equal(r.eligible('fairy',{...s,hp:5500,seenAt:3000},origin,true),true);
});
