import { test, expect } from './live-fixtures';

// Failure inventory: e2e/npc-sale-keep-failures.md (#116). Declared inputs: three stacks
// of 100 Pouch of Poof carried by the merchant and three in its bank. The rule is set in
// the dashboard; withdrawals and NPC sales are native.
const merchant = 'E2EMerchant';
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const count=list=>(list||[]).filter(i=>i&&i.name==='smoke').reduce((n,i)=>n+(i.q||1),0);
  const bank=Object.entries(u).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+count(v),0);
  return {carried:count(p.items),bank,gold:p.gold+(Number(u.gold)||0)};})()`);

for (const stored of [0,200]) test(`an automatic NPC sale keeps the configured amount across bank and ${stored ? 'BankBoi' : 'merchant'} stock`, async ({ live, page }, info) => {
  test.setTimeout(660_000);
  const samples: any[] = [];
  const reserve = 250 + stored;
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(async()=>{const p=get_player('${merchant}');
      for(const slot of [20,21,22]){if(p.items[slot])throw Error('Fixture requires empty cells 20-22');p.items[slot]={name:'smoke',q:100};}
      const seed=info=>{const pack=info.items0||(info.items0=[]);for(let n=0;n<3;n++){const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42)throw Error('Fixture requires 3 free items0 slots');pack[slot<0?pack.length:slot]={name:'smoke',q:100};}};
      if(p.user)seed(p.user);else{const u=await db.collection('user').findOne({_id:p.owner});seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
    expect(seeded).toBe(true);
    if (stored) {
      // A deliberately unavailable offline worker retains native stock without
      // triggering the unrelated headless slot-borrow/unload journey.
      await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'E2EBankBoi'});
        if(!c)throw Error('Owned BankBoi missing');c.info.items=[{name:'smoke',q:100},{name:'smoke',q:100}];
        await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
      await live.restoreHistoricalSettings(()=>({bankbois:{E2EBankBoi:{name:'E2EBankBoi',state:'error',error:'Declared offline storage; inventory retained',items:[0,1].map(slot=>({slot,item:{name:'smoke',q:100}}))}}}));
    }
    const before = await native(live);
    expect(before).toMatchObject({ carried: 300, bank: 300 });
    await info.attach('declared-poofs', { body: JSON.stringify(before), contentType: 'application/json' });
    // The coordinator learns the bank from a bank visit, as after any real trip (the Visit bank action).
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const response = await fetch(live.url + '/party-api/state?catalog=0&dashboard=1&section=bank');
      const packs = (await response.json()).bank?.packs || {};
      return Object.values(packs).flat().filter((entry: any) => entry?.item?.name === 'smoke').reduce((n: number, entry: any) => n + (entry.item.q || 1), 0);
    }, { timeout: 120_000, message: 'The bank visit must report the banked Pouches of Poof' }).toBe(300);

    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: merchant, exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    const dialog = page.getByRole('dialog', { name: 'Automatically sell to NPC?' });
    const openRule = async (label: RegExp) => {
      await expect(async () => {
        if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
        await card.getByLabel('Pouch of Poof', { exact: true }).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: label }).click();
        await expect(dialog).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
    };
    // 1: the dialog takes the amount to keep.
    await openRule(/^Auto sell to NPC/);
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue('0');
    await dialog.getByLabel('Number to keep reserved').fill(String(reserve));
    await info.attach('npc-sale-keep-dialog', { body: await dialog.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Enable auto sale', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (Object.values((await live.state()).autoNpcSales || {}) as any[]).find(rule => rule.item?.name === 'smoke')?.keep).toBe(reserve);
    // 5: the saved amount shows when the rule is reopened. The merchant still carries every copy:
    // its automations stay off until here, so nothing has been sold or banked yet.
    await openRule(/^Update auto sell to NPC/);
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue(String(reserve));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await live.restartCoordinator();
    await expect.poll(async()=>(Object.values((await live.state()).autoNpcSales || {}) as any[]).find(rule=>rule.item?.name==='smoke')?.keep).toBe(reserve);

    // The fixture starts with merchant automations off; this journey needs its sale and withdrawal routines.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true, withdrawals: true } });

    // 2, 3: the merchant sells down to exactly 250 across bag and bank.
    await expect.poll(async () => { const n = await native(live); samples.push({ at: Date.now(), ...n }); return n.carried + n.bank; },
      { timeout: 300_000, intervals: [2000] }).toBe(250);
    // 4: and stops there.
    await new Promise(resolve => setTimeout(resolve, 20_000));
    const settled = await native(live);
    samples.push({ at: Date.now(), ...settled });
    expect(settled.carried + settled.bank).toBe(250);
    expect(settled.gold).toBeGreaterThan(before.gold);
    if (stored) {
      const offline = await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'E2EBankBoi'});
        return c.info.items.filter(i=>i&&i.name==='smoke').reduce((n,i)=>n+(i.q||1),0);})()`);
      expect(offline).toBe(stored);
      expect(settled.carried + settled.bank + offline).toBe(reserve);
    }
    // 6: the kept copies go back to the bank rather than staying in the merchant's bag.
    await expect.poll(async () => { const n = await native(live); samples.push({ at: Date.now(), ...n }); return n; },
      { timeout: 240_000, intervals: [2000], message: 'Kept Pouches of Poof must be banked, not left carried' }).toMatchObject({ carried: 0, bank: 250 });
  } finally {
    await info.attach('npc-sale-keep-samples', { body: JSON.stringify({ samples, activity: (await live.state()).merchantActivity?.slice(-20) }), contentType: 'application/json' });
  }
});
