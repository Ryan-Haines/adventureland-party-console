import { test, expect, type LiveGame } from './live-fixtures';
import { party } from './game/hunt-lifecycle';
import { CHARACTER_NOTICES, FIXTURE_KIND, FIXTURE_REASON, characterHeard, merchantHooksSwitches, registerCharacterHalf,
  type Heard } from './fixtures/merchant-hooks-addon';

// The merchant jobs owner's hooks table. One fixture add-on answers the merchant jobs owner's two add-on hooks and hears every 08
// notice; each row is one hook, notice or slot on one shared run of the merchant setup (the default
// party's merchant at its stand on the home realm): the add-on's kind, its three proposed jobs, a
// force stand during its job, the stand return after it, and one fishing attempt, in that order. Each
// step's title is the `fixture` its `HOOKS` or `SLOTS` row names (runtime/hooks/rows/08-merchant.ts).
// The slot, block and refusal rows are unit rows in scripts/tests/hook-registry.test.cjs, and the
// realm and hands notices unit rows in realm-owner.test.cjs and gathering-equipment-restore.test.cjs:
// a realm move needs the two-realm pool and a lease needs a cast's tool swap, which this setup does
// not reach.
const M = 'E2EMerchant';
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-merchant-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const ask = async (live: LiveGame, hook: string, args: unknown[] = []) => (await fixture(live, { op: 'ask', hook, args }) as { answer: any }).answer;
const of = (list: Heard[], hook: string, owner?: string) => list.filter(h => h.hook === hook && (!owner || h.payload.owner === owner));

// The gathering row casts once, so the fishing cooldown starts ready, declared before login as the
// equipment rows declare it (live-fixtures.ts `initialGatheringReady`).
test.use({ initialGatheringReady: true });
test('merchant hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(600_000);
  await party(live);
  const page = live.clients[M]!;
  // The reset merchant carries 1000 HP potions, past the restock's maximum of 20, and 10M gold, so the
  // fixture's restock ended in the tick it started and the force stand had no running job to pause.
  // Ten potions, above the minimum of 5 that queues the core restock, and no gold send the fixture's
  // job to the bank for the 200 gold first. The stand and fishing rows need a stand0 and a rod, which
  // the reset merchant does not carry.
  expect(await live.admin(`output=(async()=>{const m=get_player('${M}'),free=()=>m.items.findIndex((v,i)=>!v&&i<m.isize);
    const potion=m.items.findIndex(v=>v&&v.name==='hpot1');if(potion<0)throw Error('No HP potion stack');m.items[potion].q=10;
    for(const name of ['stand0','rod'])if(!m.items.some(v=>v&&v.name===name)){const slot=free();if(slot<0)throw Error('No free slot for '+name);m.items[slot]={name};}
    m.gold=0;if(m.user)m.user.gold=Math.max(Number(m.user.gold)||0,100000);
    else await db.collection('user').updateOne({_id:m.owner,'info.gold':{$lt:100000}},{$set:{'info.gold':100000}});
    cache_player_items(m);resend(m,'reopen+cid');return true;})()`)).toBe(true);
  await expect.poll(async () => (await page.snapshot()).items.filter((i: any) => i && ['stand0', 'rod'].includes(i.name)).length).toBe(2);
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(merchantHooksSwitches(true)) }] });
  const since = Date.now(), pageSince = await page.run('Date.now()') as number, rows: Record<string, unknown> = {};
  const pageHeard = async () => await page.run(characterHeard(pageSince)) as Heard[];
  // The dashboard state names the realm in realmControl; it has no top-level activeRealm.
  const home = (await live.state()).realmControl.activeRealm as string;
  let owner = '';
  try {
    await test.step("merchant.jobKind: the fixture's kind at priority 90 runs at 74, with a ring entry", async () => {
      await expect.poll(async () => of(await heard(live, since), 'merchant.jobKind').length, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
      const kind = await ask(live, 'merchant.kind', [FIXTURE_REASON]);
      rows.kind = kind;
      expect([kind.priority, kind.asked, kind.command, kind.realm]).toEqual([74, 90, 'merchant-self-restock', 'listing']);
    });
    await test.step("merchant-routines: the fixture's kind is a row of the routine priorities", async () => {
      expect((await ask(live, 'merchant.kind', [FIXTURE_REASON])).label, "the slot entry's label").toBe('Fixture restock');
    });
    await test.step("merchant.kind: answers a core kind and the fixture's clamped kind", async () => {
      expect((await ask(live, 'merchant.kind', ['restock'])).command).toBe('merchant-self-restock');
    });
    await test.step("merchant.job: the fixture's job is queued and runs; its PVP and blacklisted listings are refused", async () => {
      await live.post('/settings', { changes: [{ field: 'merchantRealmBlacklist', value: ['SR_EUI'] }] });
      // The restock finishes in under a second, so the row holds the merchant's completion and the
      // job stays current until the force stand row pauses it.
      live.holdMerchantStatus(true, { completionOnly: true });
      await fixture(live, { op: 'jobs', jobs: [{ kind: FIXTURE_KIND, target: M, realm: 'USPVP' }, { kind: FIXTURE_KIND, target: M, realm: 'SR_EUI' },
        { kind: FIXTURE_KIND, target: M, realm: home }] });
      await expect.poll(async () => of(await heard(live, since), 'merchant.job.started').filter(h => h.payload.kind === FIXTURE_REASON).length,
        { timeout: 120_000, intervals: [500] }).toBe(1);
      const queued = of(await heard(live, since), 'merchant.job.queued').filter(h => h.payload.kind === FIXTURE_REASON);
      rows.queued = queued;
      expect(queued.length, 'the PVP and blacklisted listings queue nothing').toBe(1);
      owner = String(queued[0]!.payload.owner);
    });
    await test.step("jobs.current: names the fixture's job while it runs", async () => {
      await expect.poll(async () => (await ask(live, 'jobs.current'))?.reason, { timeout: 30_000, intervals: [250] }).toBe(FIXTURE_REASON);
    });
    await test.step("merchant.holder.changed: the runner's holder goes to the fixture's job and back to none", async () => {
      await expect.poll(async () => of(await pageHeard(), 'merchant.holder.changed').some(h => h.payload.to === 'job'),
        { timeout: 60_000, intervals: [250] }).toBe(true);
    });
    await test.step("merchant.job.paused, .resumed: force stand pauses the fixture's job, which resumes after it", async () => {
      await live.post('/merchant/force-stand', { enabled: true });
      await expect.poll(async () => of(await heard(live, since), 'merchant.job.paused', owner).length, { timeout: 60_000, intervals: [250] }).toBe(1);
      live.holdMerchantStatus(false, { completionOnly: true });
      await live.post('/merchant/force-stand', { enabled: false });
      await expect.poll(async () => of(await heard(live, since), 'merchant.job.resumed', owner).length, { timeout: 120_000, intervals: [500] }).toBe(1);
    });
    await test.step("merchant.job.queued, .started, .ended: one each for the fixture's job", async () => {
      await expect.poll(async () => of(await heard(live, since), 'merchant.job.ended', owner).length, { timeout: 180_000, intervals: [500] }).toBe(1);
      const all = await heard(live, since);
      expect(['merchant.job.queued', 'merchant.job.ended'].map(n => of(all, n, owner).length)).toEqual([1, 1]);
      expect(of(all, 'merchant.job.started', owner).length, 'started once, and once more on its resume').toBe(2);
      expect(of(await pageHeard(), 'merchant.holder.changed').some(h => h.payload.from === 'job'), 'the job holder let go').toBe(true);
    });
    await test.step("merchant.stand.opened, .closed: the stand return opens the stand and the fixture's job closes it", async () => {
      // A stand the return opens after the row starts, so the fixture's job meets an open stand.
      const at = await page.run('Date.now()') as number;
      await expect.poll(async () => of(await pageHeard(), 'merchant.stand.opened').filter(h => h.at >= at).length, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
      await fixture(live, { op: 'jobs', jobs: [{ kind: FIXTURE_KIND, target: M, realm: home }] });
      await expect.poll(async () => of(await pageHeard(), 'merchant.stand.closed').some(h => h.payload.by === 'job'),
        { timeout: 120_000, intervals: [500] }).toBe(true);
    });
    await test.step('merchant.gathering.phase, .cast: one fishing attempt walks, casts and reports its catch or miss', async () => {
      await live.post('/merchant/gather', { mode: 'fishing', enabled: true });
      await expect.poll(async () => of(await pageHeard(), 'merchant.gathering.cast').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
      const phases = of(await pageHeard(), 'merchant.gathering.phase').map(h => h.payload.phase);
      rows.phases = phases;
      // Every attempt's holder opens at 'travel', and an attempt that ends before its cast (a tool
      // order, a movement retry, a bank trip) leaves its own 'travel' ahead of the casting one.
      const cast = phases.indexOf('cast');
      expect(phases[0]).toBe('travel');
      expect(cast, 'a cast phase was told').toBeGreaterThan(0);
      expect(phases[cast - 1]).toBe('travel');
      expect(['catch', 'miss']).toContain(of(await pageHeard(), 'merchant.gathering.cast')[0]!.payload.outcome);
    });
    // MJ22: every character notice of the table was heard.
    const all = await pageHeard();
    expect(CHARACTER_NOTICES.filter(n => !of(all, n).length), 'every character notice was heard').toEqual([]);
  } finally {
    await info.attach('merchant-hooks', { body: JSON.stringify({ rows, heard: await heard(live, since).catch(() => null),
      page: await pageHeard().catch(() => null) }), contentType: 'application/json' });
    live.holdMerchantStatus(false, { completionOnly: true });
    await fixture(live, { op: 'jobs', jobs: [] }).catch(() => {});
    await live.post('/merchant/gather', { mode: 'fishing', enabled: false }).catch(() => {});
    await live.post('/settings', { changes: [{ field: 'merchantRealmBlacklist', value: [] }] }).catch(() => {});
    await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(merchantHooksSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
