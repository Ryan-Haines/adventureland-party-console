import {test,expect} from './live-fixtures';

const merchant='E2EMerchant';
for(const protectedRewards of [false,true])test(`exchange capacity ${protectedRewards?'preserves protected rewards and resumes after space changes':'banks rewards mid-order and resumes across restart'}`,async({live},info)=>{
  // Failure inventory: split into a full bag; rewards banked only at order end;
  // duplicate/lost consumption after restart; banked protected gear; dropped
  // manual intent or an immediate retry loop when no safe deposit exists.
  test.setTimeout(480_000);
  const checkpoints:any[]=[];
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':false,'auto upgrade':false,'inventory cleanout':false}});
  if(protectedRewards)await live.restoreHistoricalSettings(()=>({autoUpgradeMarks:{[merchant]:{'jacko@+0':{tiers:1,quantity:-1}}}}));
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((entry:any)=>entry.id==='candy0'),{timeout:120_000}).toBe(true);
  const seeded=await live.admin(`output=(()=>{const p=get_player('${merchant}');
    if(p.isize!==42)throw Error('Scenario requires the reported 42-slot inventory');
    globalThis.__capacityCandyDrops=D.drops.candy0;D.drops.candy0=[[1,'jacko',1]];
    p.items=Array(42).fill(null);for(let i=0;i<39;i++)p.items[i]={name:'helmet',level:0,l:'l'};
    p.items[0]={name:'stand0',l:'l'};p.items[1]={name:'hpot1',q:9999,l:'l'};p.items[2]={name:'mpot1',q:9999,l:'l'};
    p.items[39]={name:'candy0',q:6};cache_player_items(p);resend(p,'reopen+cid');
    return {items:p.items,exchanges:p.p.stats.exchanges.candy0||0,table:D.drops.candy0};})()`);
  const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
    const bank=Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v);
    const count=(list,name)=>list.filter(i=>i?.name===name).reduce((n,i)=>n+(i.q||1),0);
    return {candy:count(p.items,'candy0'),jacko:count(p.items,'jacko'),bankJacko:count(bank,'jacko'),
      locked:p.items.filter(i=>i?.l).length,exchanges:p.p.stats.exchanges.candy0||0,map:p.map,free:p.items.filter(i=>!i).length};})()`);
  const before=await native();
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.filter((entry:any)=>entry?.item).length).toBe(40);
  await live.clients[merchant].page.context().route('**/party-api/merchant/exchange-progress',async route=>{
    const body=route.request().postDataJSON(),response=await route.fetch();
    checkpoints.push({at:Date.now(),body,status:response.status()});
    await route.fulfill({response});
  });
  let order:any;
  try{
    order=await live.post('/merchant/exchange-order',{exchanges:[{id:'candy0',level:0,quantity:6}]});
    if(protectedRewards){
      await expect.poll(async()=>{
        const s=await live.state();
        if(s.merchantActivity.some((a:any)=>a.message==='Exchange paused until inventory or bank contents change'))return 'blocked';
        return s.merchantActivity.some((a:any)=>a.message==='Exchange failed')?'failed':'waiting';
      },{timeout:180_000,message:'A full protected bag must preserve the unfinished exchange behind a capacity block'}).toBe('blocked');
      const blocked=await live.state(),physical=await native();
      const pending=blocked.merchantQueue.filter((job:any)=>job.reason==='exchange');
      expect(pending).toHaveLength(1);expect(pending[0].exchanges).toEqual([{id:'candy0',level:0,quantity:4}]);
      expect(typeof pending[0].exchangeCapacitySignature).toBe('string');
      expect(physical).toMatchObject({candy:4,jacko:2,bankJacko:before.bankJacko,exchanges:before.exchanges+2,locked:39});
      await live.restartCoordinator();
      await expect.poll(async()=>{
        const s=await live.state(),job=s.merchantQueue.find((entry:any)=>entry.reason==='exchange');
        return s.merchantCurrent?.reason!=='exchange'&&job?.exchangeCapacitySignature===pending[0].exchangeCapacitySignature;
      },{timeout:30_000,message:'The capacity fence must remain on the same unfinished order after restart'}).toBe(true);
      const unchanged=await native();expect(unchanged.exchanges).toBe(physical.exchanges);
      await info.attach('protected-exchange-capacity-block',{body:JSON.stringify({blocked,physical,unchanged}),contentType:'application/json'});
      await live.admin(`output=(()=>{const p=get_player('${merchant}');for(let i=3;i<7;i++){if(p.items[i]?.name!=='helmet'||!p.items[i].l)throw Error('Owned fixture filler changed');p.items[i]=null;}cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    }else{
      await expect.poll(()=>checkpoints.filter(c=>c.body.remaining?.[0]?.quantity===4).length,{timeout:180_000,message:'Capacity banking must checkpoint the same four remaining candies before leaving the NPC'}).toBeGreaterThanOrEqual(2);
      await live.restartCoordinator();
    }
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      if(s.merchantActivity.some((a:any)=>a.message==='Exchange failed'))return 'failed';
      return n.candy===0&&![s.merchantCurrent,...s.merchantQueue].some((job:any)=>job?.reason==='exchange')?'completed':'waiting';
    },{timeout:300_000,message:'The original six native exchanges must finish without another order or toggle'}).toBe('completed');
    const after=await native();
    expect(after.exchanges-before.exchanges).toBe(6);
    expect(after.jacko+after.bankJacko-before.jacko-before.bankJacko).toBe(6);
    expect(after.locked).toBe(protectedRewards?35:39);
    if(protectedRewards){expect(after.jacko).toBe(6);expect(after.bankJacko).toBe(before.bankJacko);}
    else{expect(after.jacko).toBe(0);expect(after.bankJacko-before.bankJacko).toBe(6);}
  }finally{
    await live.clients[merchant].page.context().unrouteAll({behavior:'ignoreErrors'});
    await info.attach('native-exchange-capacity-ledger',{body:JSON.stringify({seeded,before,order,checkpoints,after:await native(),state:await live.state()}),contentType:'application/json'});
    await live.admin('D.drops.candy0=globalThis.__capacityCandyDrops;delete globalThis.__capacityCandyDrops;output=true');
  }
});
