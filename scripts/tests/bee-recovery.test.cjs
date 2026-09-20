const test=require('node:test'),assert=require('node:assert/strict');
const {recoverLostTargets}=require('../../runtime/combat/lost-target.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const {createSightRecovery}=require('../../runtime/combat/sight-recovery.ts');
const {markerStyle}=require('../../runtime/combat/marker-style.ts');
const {installLootClient}=require('../../runtime/combat/departure-loot.ts');
const fight={id:'bee',mtype:'bee',server:'USII',map:'main',in:'main',x:540,y:780,state:'engaged',fighter:'W',startedAt:1};
function members(now){return ['W','P','M'].map(name=>({name,ctype:'warrior',revision:1,status:{hp:100,x:540,y:780,server:'USII',map:'main',in:'main',seenAt:now,groupedCombat:{protocol:4,observationAt:now,sightings:[],threats:[],evidence:[],candidates:[]}}}));}
test('every member must lose sight; one observer or one stale member prevents retirement',()=>{
 let r=recoverLostTargets([fight],members(1000),{},1000);
 for(const keep of ['sighting','stale','attack']){
  const m=members(10000);
  if(keep==='sighting')m[2].status.groupedCombat.sightings=[fight];
  if(keep==='stale')m[2].status.seenAt=1000;
  if(keep==='attack')m[2].status.groupedCombat.evidence=[{...fight,at:9999,state:'engaged'}];
  assert.equal(recoverLostTargets([fight],m,r.searches,10000).lost.length,0,keep);
 }
 assert.equal(recoverLostTargets([fight],members(10000),r.searches,10000).lost.length,1);
});
test('absence without local coverage stops short of declaring a target lost',()=>{
 const m=members(1000);m.forEach(v=>v.status.x=2000);
 const r=recoverLostTargets([fight],m,{},1000);m.forEach(v=>{v.status.seenAt=10000;v.status.groupedCombat.observationAt=10000;});
 assert.equal(recoverLostTargets([fight],m,r.searches,10000).lost.length,0);
});
test('retirement removes evidence and blocks delayed resurrection while fresh sighting may nominate again',()=>{
 const e={...fight,action:'old',at:1,state:'engaged'};
 let old={fights:[fight],queue:[fight],target:fight,evidence:[e],deaths:[]};
 old={...old,...reconcileQueue(old,members(1000),'W',1000,'k')};
 old={...old,...reconcileQueue(old,members(10000),'W',10000,'k')};
 assert.equal(old.target,null);assert.equal(old.lostTargets.length,1);assert.equal(old.evidence.length,0);
 const m=members(10100);m[0].status.groupedCombat.evidence=[{...e,at:10100,startedAt:1}];
 assert.equal(reconcileQueue(old,m,'W',10100,'k').target,null);
 m[0].status.groupedCombat.candidates=[fight];
 assert.equal(reconcileQueue(old,m,'W',10101,'k').target.id,'bee');
});
test('visible attackers preempt search of an unseen queue head',()=>{
 const m=members(10000);m[1].status.groupedCombat.threats=[{...fight,id:'attacker'}];
 const r=reconcileQueue({fights:[fight],queue:[fight],target:fight,evidence:[],deaths:[]},m,'W',10000,'k');
 assert.equal(r.target.id,'attacker');assert.ok(r.fights.some(f=>f.id==='bee'));
});
test('local recovery is bounded by both elapsed time and destination count',()=>{
 let now=0,calls=0,reason='',self={x:0,y:0,speed:100};
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:()=>true,move:p=>{calls++;Object.assign(self,p);},report:s=>reason=s});
 for(let i=0;i<20;i++){r.tick('bee',{x:100,y:100},null,[]);now+=100;}
 assert.equal(calls,6);assert.match(reason,/bounded search exhausted/);
 r.reset();r.tick('bee',{x:100,y:100},null,[]);const before=calls;now+=8001;r.tick('bee',{x:100,y:100},null,[]);assert.equal(calls,before);
});
test('scatter markers stay red regardless of array index; grouped third stays double yellow',()=>{
 for(let i=0;i<3;i++)assert.deepEqual(markerStyle({role:'current'},i),{color:0xef4444,css:'#ef4444',double:false});
 assert.equal(markerStyle({role:'third'},0).double,true);assert.equal(markerStyle({role:'next'},0).css,'#facc15');
});
test('nonowner departure hold survives completed loot and returning stage but releases on new mission',()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api;
 const mission={cycleId:'c',missionRevision:1,currentIndex:0,target:'bee',stage:'farming',participants:['W','P'],missions:[{target:'bee',owners:['P']}]};
 const {huntLootId}=require('../../runtime/hunt/loot-identity.ts');
 try{api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>null,questFor:()=>({id:'bee',count:1}),cancelled:()=>false,position:()=>({})})});
 api.accept({serverNow:1,monsterHunt:mission});api.finalKill('bee');assert.equal(api.huntPending(),true);
 api.accept({serverNow:2,monsterHunt:{...mission,loot:{id:huntLootId(mission),complete:true}}});assert.equal(api.huntPending(),true);
 api.accept({serverNow:3,monsterHunt:{...mission,stage:'returning'}});assert.equal(api.huntPending(),true);
 api.accept({serverNow:4,monsterHunt:{...mission,missionRevision:2}});assert.equal(api.huntPending(),false);
 }finally{api?.stop();global.setInterval=saved;}
});

test('queue retirement cannot mistake a filtered stale member for unanimous absence',()=>{
 let old={fights:[fight],queue:[fight],target:fight,evidence:[],deaths:[]};
 old={...old,...reconcileQueue(old,members(1000),'W',1000,'k')};
 const m=members(10000);m[2].status.seenAt=1000;
 const r=reconcileQueue(old,m,'W',10000,'k');assert.equal(r.lostTargets.length,0);assert.equal(r.target.id,'bee');
});

test('multiple quest owners continue hunting until all owners are on their final kill',()=>{
 const saved=global.setInterval;global.setInterval=()=>0;let api;
 const mission={cycleId:'c',missionRevision:1,currentIndex:0,target:'bee',stage:'farming',participants:['W','P'],missions:[{target:'bee',owners:['W','P']}]};
 try{api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>({id:'bee',count:0}),questFor:()=>({id:'bee',count:5}),cancelled:()=>false,position:()=>({})})});
 api.accept({serverNow:1,monsterHunt:mission});api.finalKill('bee');assert.equal(api.huntPending(),false);
 }finally{api?.stop();global.setInterval=saved;}
});
