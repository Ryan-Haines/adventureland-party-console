import { test, expect, plantVitals } from './live-fixtures';
import { farm, party } from './game/hunt-lifecycle';
import { addonSwitches, registerTurnsChargeAddon, TURNS_CHARGE_ADDON, TURNS_NOTICES, turnsHeardSince, type HeardTurns } from './fixtures/turns-hooks-addon';

// The turns owner's hooks table. One fixture add-on answers both decision hooks, hears every event
// and reads the published reads; each row is one hook or event on one shared setup: the default
// fixture (warrior, priest, merchant, native clients) on the goo field. Each step's title is the `fixture`
// its `HOOKS` row names (runtime/hooks/registry.ts). The unit rows (`U:`) sit in
// scripts/tests/turns-executor.test.cjs and role-loop-order.test.cjs.
const W = 'E2EWarrior', P = 'E2EPriest';

test('turns hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(420_000);
  const pages: Record<string, NonNullable<(typeof live.clients)[string]>> = { [W]: live.clients[W]!, [P]: live.clients[P]! };
  const clock = (name: string) => pages[name]!.run('Date.now()') as Promise<number>;
  const heard = async (name: string, from: number) => (await pages[name]!.run(turnsHeardSince(from))) as HeardTurns[];
  const of = (list: HeardTurns[], event: string) => list.filter(n => n.event === event);
  await party(live);
  await farm(live);
  for (const page of Object.values(pages)) expect(await page.run(registerTurnsChargeAddon), 'the fixture add-on registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(true)) }] });
  for (const page of Object.values(pages))
    await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify(TURNS_CHARGE_ADDON)})`), { timeout: 30_000 }).toBe(true);
  const from = { [W]: await clock(W), [P]: await clock(P) }, rows: Record<string, unknown> = {};
  try {
    await test.step('skills.request: the add-on asks Charge at task when its target is out of range', async () => {
      await expect.poll(async () => of(await heard(W, from[W]!), 'skills.sent').filter(n => n.payload.skill === 'charge').map(n => [n.payload.by, n.payload.rank]),
        { timeout: 120_000, intervals: [500] }).toContainEqual([TURNS_CHARGE_ADDON + '/charge', 'task']);
    });
    await test.step('skills.sent: every accepted attack of the window has one sent notice', async () => {
      const at = await clock(P);
      await expect.poll(async () => of(await heard(P, at), 'skills.settled').filter(n => n.payload.family === 'attack' && n.payload.outcome === 'accepted').length,
        { timeout: 60_000, intervals: [500] }).toBeGreaterThanOrEqual(3);
      const list = await heard(P, at), accepted = of(list, 'skills.settled').filter(n => n.payload.family === 'attack' && n.payload.outcome === 'accepted');
      const sent = of(list, 'skills.sent').filter(n => n.payload.family === 'attack');
      rows.sent = { accepted: accepted.length, sent: sent.length };
      expect(sent.length, 'one sent notice per accepted attack').toBeGreaterThanOrEqual(accepted.length);
    });
    // The plants put the warrior at 40% of its HP, under the 50% HP potion line (survival/lines.ts
    // POTION_DEFAULTS); `hp` is a share of max_hp, so 1 is full HP.
    await test.step('skills.readied: the potion family readies after its 2000 ms', async () => {
      await plantVitals(live, W, { hp: 0.4 });
      await expect.poll(async () => of(await heard(W, from[W]!), 'skills.readied').filter(n => n.payload.family === 'potion').length,
        { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
    });
    await test.step("skills.ready: the add-on reads the potion family's readiness and cost", async () => {
      const read = of(await heard(W, from[W]!), 'skills.passed').at(-1)?.reads.potion as { ready?: unknown; cost?: unknown; margin?: unknown } | undefined;
      expect(read && typeof read.ready === 'boolean' && typeof read.cost === 'number' && typeof read.margin === 'number', JSON.stringify(read)).toBe(true);
    });
    await test.step("skills.dropped: at the plant the priest's attack is dropped, outranked by the heal", async () => {
      const at = await clock(P);
      // The heal shares the attack family (game data `heal.share: "attack"`), so a pass that asks
      // both ranks them, and the executor drops the attack "outranked by core:survival/heal"
      // (runtime/characters/turns/executor.ts `pass`). The executor sends that notice once per reason
      // and clears it only when the attack wins a pass. The warrior's 40% plant above starts a heal
      // streak that outlasts this step: on the failed run the priest sent only heals after the step
      // began and heard no attack drop at all. The row first fills every HP until an attack goes out,
      // then plants the priest low, so the drop it hears is a new one.
      // The attack gate (runtime/characters/turns/rules.ts priestAttacks) withholds the attack while the priest's
      // MP is under partyheal's cost plus `mp_cost`, and the attack source asks only in range of its
      // selection: each plant fills the priest's MP and moves it onto a selection out of range.
      const selection = `(()=>{const t=get_targeted_monster();return t&&!is_in_range(t)?[character.map,Math.round(t.x),Math.round(t.y)]:null})()`;
      const plant = async (hp: number) => {
        const transport = (await pages[P]!.run(selection)) as [string, number, number] | null;
        await plantVitals(live, P, { hp, mp: 1, ...(transport ? { transport } : {}) });
      };
      let won = 0;
      try {
        await expect.poll(async () => {
          await plantVitals(live, W, { hp: 1 });
          await plant(1);
          won = of(await heard(P, at), 'skills.sent').find(n => n.payload.family === 'attack' && n.payload.by === 'core:turns/attack')?.at ?? 0;
          return won > 0;
        }, { timeout: 30_000, intervals: [250] }).toBe(true);
        await expect.poll(async () => {
          await plant(0.4);
          return of(await heard(P, won), 'skills.dropped').some(n => n.payload.family === 'attack' && /^outranked by core:survival\/heal$/.test(String(n.payload.reason)));
        }, { timeout: 30_000, intervals: [250] }).toBe(true);
      } finally {
        const list = await heard(P, at).catch(() => [] as HeardTurns[]);
        rows.dropped = { dropped: of(list, 'skills.dropped').slice(-10).map(n => n.payload), sent: of(list, 'skills.sent').slice(-10).map(n => [n.payload.skill, n.payload.rank, n.payload.by]) };
        await plantVitals(live, P, { hp: 1 }).catch(() => null);
      }
    });
    await test.step("skills.refuses: the add-on refuses the warrior's damage casts while it holds a pull", async () => {
      const at = await clock(W);
      await pages[W]!.run('globalThis.__e2eHoldPull=true');
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.dropped').some(n => /turns-charge-fixture: holding a pull/.test(String(n.payload.reason))),
          { timeout: 30_000, intervals: [250] }).toBe(true);
        expect(of(await heard(W, at), 'skills.sent').filter(n => n.at > at + 1000 && n.payload.family === 'attack').length, 'no attack while it holds').toBe(0);
      } finally { await pages[W]!.run('globalThis.__e2eHoldPull=false'); }
    });
    await test.step('skills.allows: on Manual with Combat off the add-on reads the H4 row', async () => {
      const at = await clock(W);
      // Manual's switches as the card sets them (e2e/user-holds-rows.ts).
      await live.post('/formation', { character: W, handControl: { on: true, combat: false } });
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.passed').some(n => (n.reads.allows as { row?: string } | undefined)?.row === 'H4'),
          { timeout: 30_000, intervals: [250] }).toBe(true);
        await test.step("skills.released: Manual's Combat off holds every family but the potion, then releases", async () => {
          expect(of(await heard(W, at), 'skills.sent').filter(n => n.at > at + 1000 && n.payload.family !== 'potion').length, 'only potions while held').toBe(0);
        });
      } finally { await live.post('/formation', { character: W, handControl: { on: false, combat: true } }).catch(() => null); }
    });
    await test.step('skills.shot: each own hit the server records is shot and lands once', async () => {
      await test.step('skills.landed: each own hit the server records lands once', async () => {
        // The server's own `hit` emits for the priest against the tracker's landings.
        const at = await clock(P);
        await live.admin(`output=(()=>{const p=get_player('${P}'),s=p.socket,emit=s.emit;globalThis.__e2eHits=0;
          s.emit=function(event,data){if(event==='hit'&&data&&data.hid==='${P}'&&data.pid)globalThis.__e2eHits++;return emit.apply(this,arguments);};globalThis.__e2eHitsOff=()=>{s.emit=emit;};return true;})()`);
        await expect.poll(async () => of(await heard(P, at), 'skills.landed').length, { timeout: 60_000, intervals: [500] }).toBeGreaterThanOrEqual(3);
        const server = Number(await live.admin('output=(globalThis.__e2eHitsOff(),globalThis.__e2eHits)'));
        const landed = of(await heard(P, at), 'skills.landed'), shot = of(await heard(P, at), 'skills.shot');
        rows.tc43 = { server, landed: landed.length, shot: shot.length };
        expect(new Set(landed.map(n => n.payload.projectile)).size, 'each projectile lands once').toBe(landed.length);
        expect(landed.length, 'the tracker hears every hit the server sent').toBeGreaterThanOrEqual(server - 1);
      });
    });
    await test.step("skills.incoming: the add-on reads the priest's own damage in flight on its target", async () => {
      const reads = of(await heard(P, from[P]!), 'skills.shot').map(n => n.reads.incoming);
      expect(reads.some(r => Number(r) > 0), `the incoming reads: ${reads.slice(-5)}`).toBe(true);
    });
    await test.step("skills.passed: the fixture add-on's listener runs once per role loop pass", async () => {
      const passed = of(await heard(W, from[W]!), 'skills.passed');
      expect(passed.length).toBeGreaterThan(0);
      expect(passed.every(n => n.payload.by === 'core:turns')).toBe(true);
    });
    await test.step('skills.waiting: an attack waits on the planted call figure, then goes', async () => {
      const at = await clock(W);
      await live.plantCallCost(W, 199);
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.waiting').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
      } finally { await live.plantCallCost(W, 0); }
      await expect.poll(async () => of(await heard(W, at), 'skills.sent').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
    });
    await test.step('skills.settled: the dropped reply settles lost after its cooldown and the margin', async () => {
      const at = await clock(P);
      // The server drops one accepted `attack` reply of the priest (the lost-reply fault).
      await live.admin(`output=(()=>{const p=get_player('${P}'),s=p.socket,emit=s.emit;globalThis.__e2eDropped=null;
        s.emit=function(event,data){if(event==='game_response'&&data&&data.place==='attack'&&!data.failed&&!globalThis.__e2eDropped){globalThis.__e2eDropped=String(data.target);s.emit=emit;return true;}return emit.apply(this,arguments);};return true;})()`);
      await expect.poll(async () => of(await heard(P, at), 'skills.settled').some(n => n.payload.outcome === 'lost'), { timeout: 60_000, intervals: [250] }).toBe(true);
    });
    // The role loop runs a pass on each event.
    await test.step('targeting.changed: a new target runs a pass before the next report', async () => {
      const list = await heard(W, from[W]!), passes = of(list, 'skills.passed').map(n => n.at);
      const changes = of(list, 'targeting.changed').filter(n => n.payload.character === W && n.payload.to);
      expect(changes.length, 'the warrior changed targets').toBeGreaterThan(0);
      const late = changes.filter(c => !passes.some(at => at >= c.at && at - c.at < 1000));
      expect(late.map(c => c.at), 'a pass within one report interval of each selection').toEqual([]);
    });
    await test.step("report.sent: with the plant's player emit dropped, a pass runs within one report interval", async () => {
      const list = await heard(W, from[W]!), passes = of(list, 'skills.passed').map(n => n.at);
      const reports = of(list, 'report.sent').filter(n => n.payload.character === W);
      expect(reports.length).toBeGreaterThan(0);
      expect(reports.filter(r => !passes.some(at => at >= r.at && at - r.at < 250)).map(r => r.at), 'a pass on each report').toEqual([]);
    });
    // Every event of the table came, and each names its `by`.
    const all = [...await heard(W, from[W]!), ...await heard(P, from[P]!)];
    expect(TURNS_NOTICES.filter(event => event !== 'skills.held' && of(all, event).length === 0), 'every live notice was heard').toEqual([]);
    expect(all.filter(n => !n.payload.by && n.event !== 'targeting.changed').map(n => n.event), 'every notice names its by').toEqual([]);
  } finally {
    await info.attach('turns-hooks', { body: JSON.stringify({ rows }), contentType: 'application/json' });
    await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
