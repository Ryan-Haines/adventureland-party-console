const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantClusterRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
function fixture(reason){
 const state={merchantCharacter:'M',merchantCurrent:{id:'job',target:'L',reason,expandLeaderCluster:true,radius:200},merchantQueue:[],marked:{F:[{}]},merchantMarked:{},
  statuses:Object.fromEntries(['L','F','P','M','Far','Dead'].map((name,i)=>[name,{seenAt:100000,map:'main',server:'USII',x:i*20,y:0,ctype:name==='M'?'merchant':'priest',rip:name==='Dead'}]))};
 state.statuses.Far.x=500;const calls=[];let next=1;
 const routes=createMerchantClusterRoutes(state,{now:()=>100000,nextCommand:()=>next++,active:()=>Object.keys(state.statuses),stamp:job=>({...job,stamped:true}),log(){},persist:()=>calls.push('persist')});
 function send(route){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body:{jobId:'job'}},res);return res;}
 return {state,calls,send};
}
test('nearby marked collection accepts one marked slot and replaces a duplicate trip with same-batch work',()=>{
 const t=fixture('marked items');t.state.merchantQueue=[{id:'old',target:'F',reason:'marked items'},{id:'other',target:'Far',reason:'marked items'}];
 assert.deepEqual(t.send('marked').body.queued,['F']);assert.equal(t.state.merchantQueue[0].batchId,'marked-job');assert.equal(t.state.merchantQueue[1].id,'other');
 const count=t.state.merchantQueue.length;t.send('marked');assert.equal(t.state.merchantQueue.length,count);assert.equal(t.calls.length,1);
});
test('leader collection expands by distance without duplicating an already queued recipient',()=>{
 const t=fixture('party collection');t.state.merchantQueue=[{target:'P',reason:'party collection'}];
 assert.deepEqual(t.send('leader').body.queued,['F','P','Dead']);assert.equal(t.state.merchantQueue.filter(x=>x.target==='P').length,1);
 assert.equal(t.state.merchantQueue[0].target,'F');assert.equal(t.state.merchantQueue.some(x=>x.target==='Far'),false);
});
test('Luck cluster excludes merchants, dead members and other realms while preserving recipient order',()=>{
 const t=fixture('merchant luck');t.state.statuses.P.server='EUI';assert.deepEqual(t.send('luck').body.recipients,['L','F']);
 assert.equal(t.state.merchantQueue[0].castMerchantLuck,true);assert.equal(t.state.merchantQueue[0].expandLuckCluster,false);assert.equal(t.state.merchantQueue[0].batchId,'job');
});
test('MJ14: the luck cast leaves strong and fresh luck alone, asks the job band, casts when the server cooldown ends, and reports a cooldown that never ends',async()=>{
 const {createMerchantLuck}=require('../../runtime/merchant-jobs/character/luck.ts');
 const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
 const clearBounds=()=>boundsSent(boundsPending().length);
 const calls=[],answers=['wait','send','send'],previous=globalThis.__partyHooks,realSkill=globalThis.use_skill;let cooling=false,readyAt=0;
 // The run scope's timers, fired by hand: `wake` is the cooldown end the wait reads, `bound` READY_WAIT_MS.
 const timers=[];const act={on(){},off(){},setTimeout:(cb,ms)=>timers.push({cb,ms}),clearTimeout:id=>{if(id)timers[id-1].cb=null}};
 const fire=async ms=>{await new Promise(r=>setImmediate(r));const t=timers.find(t=>t.cb&&t.ms===ms);assert.ok(t,'a timer of '+ms+' ms waits');const cb=t.cb;t.cb=null;cb()};
 globalThis.__partyHooks={calls:{band:ask=>{calls.push('band '+ask.method);return answers.shift()},window:()=>0},notify(){}};
 globalThis.use_skill=async(skill,player)=>calls.push(skill+' '+player.name);clearBounds();
 const luck=createMerchantLuck({character:()=>({name:'M',x:0,y:0}),onCooldown:()=>cooling,canUse:()=>true,nextSkill:()=>readyAt,act,sleep:async()=>{},log(){}});
 const player=(name,x,mluck)=>({name,x,y:0,ctype:'priest',s:mluck?{mluck}:{}});
 try{
  assert.equal(await luck.castMerchantLuck(player('Strong',10,{f:'Other',strong:true,ms:1})),false);
  assert.equal(await luck.castMerchantLuck(player('Fresh',10,{f:'M',ms:Infinity})),false);
  assert.equal(await luck.castMerchantLuck(player('Far',250)),false);
  assert.equal(await luck.castMerchantLuck(player('Near',10,{f:'M',ms:1000})),true);
  // The cooldown ends at `next_skill.mluck`: the cast goes out at that time, with no poll.
  cooling=true;readyAt=Date.now()+40_000;const soon=luck.castMerchantLuck(player('Soon',10));
  await new Promise(r=>setImmediate(r));const wake=timers.find(t=>t.cb&&t.ms!==5000);assert.ok(wake&&wake.ms>35_000,'the wait wakes at the cooldown end');
  cooling=false;const cb=wake.cb;wake.cb=null;cb();assert.equal(await soon,true);
  // A cooldown the game never ends runs out READY_WAIT_MS and reports it.
  cooling=true;readyAt=0;const late=luck.castMerchantLuck(player('Late',10));await fire(5000);assert.equal(await late,false);
  assert.deepEqual(calls,['band mluck','band mluck','mluck Near','band mluck','mluck Soon']);
  assert.deepEqual(boundsPending().map(f=>[f.bound,f.owner,f.state.player]),[['READY_WAIT_MS','08','Late']]);
 }finally{globalThis.__partyHooks=previous;globalThis.use_skill=realSkill;clearBounds();}
});
