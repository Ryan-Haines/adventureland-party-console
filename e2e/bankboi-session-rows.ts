import type {TestInfo} from '@playwright/test';
import {expect, headlessMerchant, type LiveGame} from './live-fixtures';

// W55's one interrupted BankBoi transaction (test-windows DESIGN.md 2.2 W55), the body of
// live-bankboi-offerings.spec.ts (at 21fe30a2b) 'BankBoi-only offering supplies ... native upgrade' for its
// handoff and delivery cases. The offline BankBoi holds the only three offerings. The merchant
// carries two +8 wands: the player marks one for a manual upgrade (A18, A19) and the other for an
// automatic one (A22, A23), so one delivery supplies both and one offering stays. The coordinator
// restarts while the BankBoi transaction is open (A18, A22) and again once an offering reaches the
// merchant's bag (A19, A23), and each restart keeps every upgrade mark.
const merchant='E2EMerchant',storage='E2EBankBoi';

export async function bankboiRestartPlay(live: LiveGame, info: TestInfo) {
  await headlessMerchant(live,merchant);
  await expect.poll(async()=>{
    const report=(await live.state()).characters[merchant];
    return report?.runtime==='headless' && Date.now()-report.seenAt<=3000;
  },{timeout:90_000}).toBe(true);
  // The offline storage inventory is a declared account input. All subsequent
  // slot handoffs, bank deposits/withdrawals and upgrade responses stay native.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'offeringp',q:1},{name:'offeringp',q:1},{name:'offeringp',q:1}];await db.collection('character').replaceOne({_id:c._id},c);
    const p=get_player('${merchant}');p.items[20]={name:'wand',level:8};p.items[21]={name:'wand',level:8};cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=> (await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('wand');
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[0,1,2].map(slot=>({slot,item:{name:'offeringp',q:1}}))}}}));
  await expect.poll(async()=> (await live.state()).upgradeOfferingStock.offeringp).toBe(3);
  await expect.poll(async()=> (await live.state(true)).merchantCatalog?.allItems?.some((entry:any)=>
    entry.id==='wand' && (entry.upgradeable || entry.meta?.upgradeable)),
  {timeout:120_000,message:'Native upgrade catalog must authorize the offering rule'}).toBe(true);
  await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'wand',floor:8,ceiling:9,offering:'offeringp',required:true}});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:20,item:{name:'wand',level:8},tiers:1});
  await live.post('/command',{character:merchant,type:'auto-upgrade-mark',slot:21,item:{name:'wand',level:8},tiers:1});
  const observations:any[]=[];
  let native:any,sawSupplyDependency=false;
  // The two restarts in the order the transaction reaches them.
  const restarts:{handoff:number|null;delivery:number|null}={handoff:null,delivery:null};
  // A throw inside the poll's callback only retries it, and each restart runs once, so the poll
  // collects the marks a restart lost and the check reads them after it (a break that changed every
  // request id at each restart left this window green in liveb-step12-run6.log).
  const lost:any[]=[];
  try {
  await expect.poll(async()=>{
    const state=await live.state();
    sawSupplyDependency ||= !!state.merchantCurrent?.offeringSupply || state.merchantQueue.some((job:any)=>job.offeringSupply);
    if(observations.length>=256) observations.shift();
    observations.push({at:Date.now(),transaction:state.bankboiTransaction,withdrawals:state.withdrawals[merchant],current:state.merchantCurrent,queue:state.merchantQueue,upgrades:state.upgrades[merchant],activity:state.merchantActivity.slice(-5)});
    native=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),p=get_player('${merchant}');if(!p)return null;
      const worker=get_player('${storage}'),u=await db.collection('user').findOne({_id:p.owner});
      const all=[...(worker?worker.items:c.info.items||[]),...p.items,...Object.entries(p.user||u.info).filter(([key,value])=>/^items\\d+$/.test(key)&&Array.isArray(value)).flatMap(([,value])=>value)];
      return {remaining:all.filter(i=>i&&i.name==='offeringp').reduce((n,i)=>n+(i.q||1),0),helmets:all.filter(i=>i&&i.name==='wand'),merchantItems:p.items,storageItems:worker?worker.items:c.info.items};})()`);
    const delivered=(state.characters[merchant]?.items || []).some((entry:any)=>entry?.item?.name==='offeringp');
    const due=restarts.handoff===null ? (state.bankboiTransaction ? 'handoff' : null)
      : restarts.delivery===null && delivered ? 'delivery' : null;
    if(due){
      const targets=(state.upgrades[merchant] || []).map((mark:any)=>({item:mark.item,tiers:mark.tiers,requestId:mark.requestId}));
      await live.restartCoordinator();restarts[due]=Date.now();
      const recovered=(await live.state()).upgrades[merchant] || [];
      for(const target of targets)
        try{expect(recovered.some((mark:any)=>mark.item.name===target.item.name && mark.item.level===target.item.level && mark.tiers===target.tiers && mark.requestId===target.requestId)).toBe(true);}
        catch{lost.push({restart:due,target});}
    }
    return native?.remaining===1 && native.helmets.length<=2 && !native.helmets.some((item:any)=>(item.level||0)===8);
  },{timeout:270_000}).toBe(true);
  expect(lost,'Each restart recovers every upgrade mark with its request id').toEqual([]);
  expect(native.helmets.length).toBeLessThanOrEqual(2);
  if(native.helmets.length) expect(native.helmets[0].level).toBe(9);
  await expect.poll(async()=> (await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  const restarted=restarts.handoff!==null&&restarts.delivery!==null;
  expect(restarted).toBe(true);
  expect(sawSupplyDependency).toBe(true);
  } finally {
  await info.attach('native-bankboi-offering-upgrade',{body:JSON.stringify({restarts,sawSupplyDependency,native,observations,state:await live.state()}),contentType:'application/json'});
  }
}
