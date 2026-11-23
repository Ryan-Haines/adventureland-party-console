import { test, expect } from './live-fixtures';

test.use({ merchantDefault: null });

test('BankBoi provisioning sells only equipped unmodified starter gifts', async ({live}, info) => {
  test.setTimeout(240_000);
  const name = 'E2EMerchant';
  await live.admin(`output=(async()=>{
    const p=get_player('${name}');
    p.slots.mainhand={name:'staff',level:0,gift:1};
    p.slots.helmet={name:'helmet',level:1,gift:1};
    p.slots.shoes={name:'shoes',level:0};
    p.items[12]={name:'staff',level:0,gift:1};
    p.items[13]={name:'offeringp',q:7};
    cache_player_items(p);resend(p,'reopen+cid');return true;
  })()`);
  await expect.poll(async () => (await live.clients[name].snapshot()).items[13]?.q).toBe(7);
  await live.restoreHistoricalSettings(() => ({
    merchantCharacter:null, bankbois:{[name]:{name,state:'provisioning',items:[]}},
    bankboiTransaction:{id:'provision-starter-gear',bankboi:name,mode:'provision',phase:'waiting-for-bankboi',
      slot:2,requestIds:[],retrievals:[],startedAt:Date.now()},
  }));
  await expect.poll(async () => (await live.state()).bankbois.find((worker:any)=>worker.name===name)?.state,
    {timeout:90_000}).toBe('ready');
  const sales=(await live.clients[name].events()).filter(event=>event.event==='game_response' && event.data?.place==='sell' && event.data.success);
  expect(sales.map(event=>event.data.item.name)).toEqual(['staff']);
  const receipt = live.clients[name].page.getByText(/E2EMerchant: Sold 1 × Staff \(staff\) \+0 for 1 gold$/);
  await expect(receipt).toHaveCount(1);
  const stock=await live.admin(`output=(()=>{const p=get_player('${name}');return {helmet:p.slots.helmet,shoes:p.slots.shoes,
    items:[...p.items,...Object.values(p.user).filter(Array.isArray).flat()].filter(Boolean)};})()`);
  expect(stock.helmet).toMatchObject({name:'helmet',level:1,gift:1});
  expect(stock.shoes).toMatchObject({name:'shoes',level:0});
  expect(stock.items.filter((item:any)=>item.name==='staff' && item.gift===1)).toHaveLength(1);
  expect(stock.items.filter((item:any)=>item.name==='offeringp').reduce((q:number,i:any)=>q+i.q,0)).toBe(7);
  await info.attach('provisioning-stock-and-sales',{body:JSON.stringify({stock,sales,receipt:await receipt.textContent()}),contentType:'application/json'});
});

test('BankBoi storage bypasses merchant production admission and combines native stacks', async ({ live }, info) => {
  test.setTimeout(240_000);
  // Failure modes: a storage merchant is rejected by production-owner checks;
  // processing never starts; unload leaves compatible berries/gifts split;
  // merging loses quantity or repeats deposits after restart.
  const name = 'E2EMerchant';
  await live.admin(`output=(async()=>{
    const p=get_player('${name}');
    p.items[20]={name:'slice_nightberry',q:3};p.items[21]={name:'anniversarygift',q:4};
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'slice_nightberry',q:10},'info.items0.1':{name:'anniversarygift',q:20}}});
    cache_player_items(p);resend(p,'reopen+cid');return p.items;
  })()`);
  await expect.poll(async () => (await live.clients[name].snapshot()).items[20]?.q).toBe(3);
  await live.restoreHistoricalSettings(() => ({
    merchantCharacter: null,
    bankbois: { [name]: { name, state: 'idle', items: [] } },
    bankboiTransaction: { id: 'historical-bankboi-store', bankboi: name, mode: 'store', phase: 'waiting-for-bankboi', slot: 2, requestIds: [], retrievals: [], startedAt: Date.now() },
  }));
  expect((await live.state()).merchantCharacter).toBeNull();
  expect((await live.state()).bankboiTransaction?.id).toBe('historical-bankboi-store');
  await expect.poll(async () => (await live.clients[name].snapshot()).map, { timeout: 90_000 }).toBe('bank');
  const bank = () => live.admin(`output=(()=>{const p=get_player('${name}');return Object.values(p.user).filter(Array.isArray).flat().filter(i=>i&&['slice_nightberry','anniversarygift'].includes(i.name));})()`);
  await expect.poll(bank, { timeout: 90_000 }).toEqual(expect.arrayContaining([
    { name: 'slice_nightberry', q: 13 }, { name: 'anniversarygift', q: 24 },
  ]));
  await info.attach('bankboi-native-stack-results', { body: JSON.stringify({ bank: await bank(), client: await live.clients[name].snapshot(), state: await live.state(), events: await live.clients[name].events() }), contentType: 'application/json' });
  await live.restartCoordinator();
  await expect.poll(bank).toEqual(expect.arrayContaining([
    { name: 'slice_nightberry', q: 13 }, { name: 'anniversarygift', q: 24 },
  ]));
});
