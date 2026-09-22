const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const {targetIdentity}=require('../../runtime/combat/lost-target.ts');
function fixture(){
 const primary={id:'225',mtype:'tinyp',server:'USII',map:'halloween',in:'halloween',x:1000,y:1000,state:'engaged',fighter:'W',startedAt:1};
 const ghost={...primary,id:'ghost',mtype:'ghost',x:20,y:0,state:'planned'};
 const members=['W','P','M'].map(name=>({name,ctype:name==='P'?'priest':'warrior',revision:1,status:{hp:100,x:0,y:0,server:'USII',map:'halloween',in:'halloween',seenAt:0,
  groupedCombat:{observationAt:0,sightings:[ghost],threats:[],evidence:[],candidates:name==='W'?[ghost]:[]}}}));
 let old={fights:[primary],queue:[primary,ghost],target:primary,evidence:[{...primary,action:'old',at:1,state:'engaged',startedAt:1}],deaths:[]};
 return {primary,ghost,members,get group(){return old;},step(now,change=()=>{},paused=false){for(const m of members){m.status.seenAt=now;m.status.groupedCombat.observationAt=now;}change(members);old={...old,...reconcileQueue(old,members,'W',now,'k',0,paused)};return old;},restart(){old=JSON.parse(JSON.stringify(old));}};
}
test('invisible engaged Tiny P yields to visible Ghost after bounded fresh absence, outside last-position coverage',()=>{
 const f=fixture();for(let t=10000;t<18000;t+=1000)assert.equal(f.step(t).target.id,'225');
 const g=f.step(18000);assert.equal(g.target.id,'ghost');assert.equal(g.deaths.length,0);
 assert.match(g.lostTargets[0].reason,/visible alternative/);assert.equal(g.evidence.length,0);
 assert.equal(g.queue[0].id,'ghost');assert.equal(g.searches[targetIdentity(f.primary)],undefined);
});
for(const blocker of ['sighting','attacker','attack','stale','observations','cancelled','event','travel','paused','no-alternative'])test('unseen primary release respects '+blocker,()=>{
 const f=fixture();for(let t=10000;t<=22000;t+=1000)f.step(t,m=>{
  if(blocker==='sighting')m[1].status.groupedCombat.sightings.push(f.primary);
  if(blocker==='attacker')m[1].status.groupedCombat.currentAttackers=[f.primary];
  if(blocker==='attack')m[1].status.groupedCombat.evidence=[{...f.primary,at:t,state:'engaged',action:'fresh',startedAt:t}];
  if(blocker==='stale')m[1].status.seenAt=0;
  if(blocker==='observations')m[1].status.groupedCombat.observationAt=0;
  if(blocker==='cancelled')m[1].cancelled=true;
  if(blocker==='event')m[1].status.activeEvent='abtesting';
  if(blocker==='travel')m[1].status.groupedCombat.travelCommand={id:1,revision:1};
  if(blocker==='no-alternative')m[0].status.groupedCombat.candidates=[];
 },blocker==='paused');
 assert.equal(f.group.target.id,'225');assert.equal(f.group.lostTargets.length,0);
});
test('stale intervals and restart gaps do not advance the eight-second absence clock',()=>{
 const f=fixture();for(let t=10000;t<=13000;t+=1000)f.step(t);f.restart();
 f.step(50000);for(let t=51000;t<55000;t+=1000)assert.equal(f.step(t).target.id,'225');
 assert.equal(f.step(55000).target.id,'ghost');
});
test('delayed evidence cannot resurrect released primary, but a living newly seen monster can return',()=>{
 const f=fixture();for(let t=10000;t<=18000;t+=1000)f.step(t);
 assert.equal(f.step(19000,m=>{m[0].status.groupedCombat.evidence=[{...f.primary,action:'late',at:19000,startedAt:1}];}).target.id,'ghost');
 const g=f.step(20000,m=>{m[0].status.groupedCombat.sightings.push(f.primary);m[0].status.groupedCombat.candidates.push({...f.primary,priority:200});});
 assert.ok(g.queue.some(t=>t.id==='225'));assert.equal(g.deaths.length,0);
});
