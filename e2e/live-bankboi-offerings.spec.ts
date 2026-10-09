import {test,expect} from './live-fixtures';

const merchant='E2EMerchant',storage='E2EBankBoi';
test.use({liveHeadless:true});
for(const automatic of [false,true]) test(`BankBoi-only offering supplies ${automatic?'required automatic':'manual'} native upgrade`,async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=> (await live.state()).activeSlots.some((slot:any)=>slot.character===merchant),{timeout:90_000}).toBe(false);
  await expect.poll(async()=>{const operation=(await live.state()).steamSwitch;return !operation||operation.phase==='complete';},{timeout:90_000}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
  await live.post('/slots/1/spawn',{character:merchant});
  await expect.poll(async()=>{
    const report=(await live.state()).characters[merchant];
    return report?.runtime==='headless' && Date.now()-report.seenAt<=3000;
  },{timeout:90_000}).toBe(true);
  // The offline storage inventory is a declared account input. All subsequent
  // slot handoffs, bank deposits/withdrawals and upgrade responses stay native.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'offeringp',q:2}${automatic?",{name:'helmet',level:0}":''}];await db.collection('character').replaceOne({_id:c._id},c);
    const p=get_player('${merchant}');${automatic?'':"p.items[20]={name:'helmet',level:0};"}cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  if(!automatic) await expect.poll(async()=> (await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('helmet');
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[{slot:0,item:{name:'offeringp',q:2}},...(automatic?[{slot:1,item:{name:'helmet',level:0}}]:[])]}}}));
  await expect.poll(async()=> (await live.state()).upgradeOfferingStock.offeringp).toBe(2);
  if(automatic){
    await expect.poll(async()=> (await live.state(true)).merchantCatalog?.allItems?.some((entry:any)=>
      entry.id==='helmet' && (entry.upgradeable || entry.meta?.upgradeable)),
    {timeout:120_000,message:'Native upgrade catalog must authorize the offering rule'}).toBe(true);
    await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'helmet',floor:0,ceiling:1,offering:'offeringp',required:true}});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  }
  await live.post('/command',{character:merchant,type:automatic?'auto-upgrade-mark':'upgrade-mark',slot:automatic?-1:20,item:{name:'helmet',level:0},tiers:1,...(!automatic?{offering:'offeringp'}:{})});
  const observations:any[]=[];
  let native:any;
  await expect.poll(async()=>{
    const state=await live.state();
    observations.push({at:Date.now(),transaction:state.bankboiTransaction,withdrawals:state.withdrawals[merchant],upgrades:state.upgrades[merchant],activity:state.merchantActivity.slice(-5)});
    native=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),p=get_player('${merchant}');if(!p)return null;
      const worker=get_player('${storage}'),u=await db.collection('user').findOne({_id:p.owner});
      const all=[...(worker?worker.items:c.info.items||[]),...p.items,...Object.entries(p.user||u.info).filter(([key,value])=>/^items\\d+$/.test(key)&&Array.isArray(value)).flatMap(([,value])=>value)];
      return {remaining:all.filter(i=>i&&i.name==='offeringp').reduce((n,i)=>n+(i.q||1),0),helmets:all.filter(i=>i&&i.name==='helmet'),merchantItems:p.items,storageItems:worker?worker.items:c.info.items};})()`);
    return native?.remaining===1 && native.helmets.length<=1 && !native.helmets.some((item:any)=>(item.level||0)===0);
  },{timeout:270_000}).toBe(true);
  expect(native.helmets.length).toBeLessThanOrEqual(1);
  if(native.helmets.length) expect(native.helmets[0].level).toBe(1);
  await expect.poll(async()=> (await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  await info.attach('native-bankboi-offering-upgrade',{body:JSON.stringify({automatic,native,observations,state:await live.state()}),contentType:'application/json'});
});
