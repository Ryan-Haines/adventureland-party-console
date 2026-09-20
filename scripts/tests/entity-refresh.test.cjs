const test=require('node:test'),assert=require('node:assert/strict');
const {createEntityRefresh}=require('../../runtime/combat/entity-refresh.ts');
const {recoverLostTargets,targetIdentity}=require('../../runtime/combat/lost-target.ts');
function fixture(){
 let now=0,connected=true,requests=0;const reports=[];
 const refresh=createEntityRefresh({now:()=>now,request:()=>{if(!connected)return false;requests++;return true;},report:d=>reports.push(d)});
 const sample={enabled:true,context:'USII/cave/cave',target:'bat',accepted:0};
 return {sample,reports,get requests(){return requests;},connected(v){connected=v;},tick(at,change={}){now=at;Object.assign(sample,change);refresh.tick(sample);}};
}
test('stalled combat requests a server refresh after five seconds and rate limits retries',()=>{
 const f=fixture();f.tick(0);f.tick(4999);assert.equal(f.requests,0);
 f.tick(5000);assert.equal(f.requests,1);f.tick(14999);assert.equal(f.requests,1);
 f.tick(15000);assert.equal(f.requests,2);assert.equal(f.reports.at(-1).target,'bat');
});
test('red target churn and movement cannot postpone phantom reconciliation indefinitely',()=>{
 const f=fixture();f.tick(0);for(let i=1;i<=5;i++)f.tick(i*1000,{target:'bat'+i});
 assert.equal(f.requests,1);
});
test('successful basic attacks restart the grace period',()=>{
 const f=fixture();f.tick(0);f.tick(4000,{accepted:1});f.tick(8000,{accepted:2});
 assert.equal(f.requests,0);f.tick(13000);assert.equal(f.requests,1);
});
test('death, activity pause, idle and map changes start a fresh observation period',()=>{
 for(const change of [{enabled:false},{target:null},{context:'USII/main/main'}]){
  const f=fixture();f.tick(0);f.tick(4000,change);f.tick(5000,{enabled:true,target:'bat'});
  assert.equal(f.requests,0);f.tick(10000);assert.equal(f.requests,1);
 }
});
test('disconnected refresh attempts are bounded and do not claim a request succeeded',()=>{
 const f=fixture();f.connected(false);f.tick(0);f.tick(5000);
 assert.equal(f.requests,0);assert.deepEqual(f.reports,[]);
 f.connected(true);f.tick(14999);assert.equal(f.requests,0);f.tick(15000);assert.equal(f.requests,1);
});
test('a refresh does not retire a living target; fresh subsequent absence permits bounded recovery',()=>{
 const fight={id:'bat',mtype:'bat',map:'cave',in:'cave',server:'USII',x:10,y:0,state:'engaged',fighter:'W',startedAt:0};
 const members=['W','P'].map(name=>({name,ctype:name==='W'?'warrior':'priest',status:{seenAt:1000,hp:100,map:'cave',in:'cave',server:'USII',x:0,y:0,
  groupedCombat:{observationAt:1000,sightings:[fight]}}}));
 let result=recoverLostTargets([fight],members,{},1000);assert.deepEqual(result.lost,[]);
 for(const m of members){m.status.groupedCombat.sightings=[];m.status.seenAt=2000;m.status.groupedCombat.observationAt=2000;}
 result=recoverLostTargets([fight],members,result.searches,2000);assert.deepEqual(result.lost,[]);
 assert.ok(result.searches[targetIdentity(fight)]);
 for(const m of members){m.status.seenAt=10000;m.status.groupedCombat.observationAt=10000;}
 result=recoverLostTargets([fight],members,result.searches,10000);
 assert.equal(result.lost[0].id,'bat');assert.match(result.lost[0].reason,/absence/);
});
