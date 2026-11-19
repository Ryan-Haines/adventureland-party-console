import { test, expect, type LiveGame } from './live-fixtures';
import { announceSpawn } from './game/event-spawn';
import { farm, party } from './game/hunt-lifecycle';
import { ADDON_EVENT, addonSwitches, EVENTS_HOOKS_ADDON, kindHere, readTargets, registerCharacterHalf, type Heard } from './fixtures/events-hooks-addon';

// The events owner's hooks table. One fixture add-on registers the events owner's decision hooks (`event.kind` on both realms) and every coordinator notice and reads
// `event.presence` and `event.schedule` at each notice; each row is one hook, event or read on one
// run: the default party farming, a seeded Mr. Green (staged walk kind, `due` from the walk
// estimate), then a seeded Goobrawl (join kind), their ends and returns. Each step's title is the
// `fixture` its `HOOKS` row names (runtime/hooks/rows/06-events.ts). The unit rows (`U:`) sit in
// coordinator-event-observation.test.cjs (event.limit), anniversary-kiss.test.cjs (anniversary.phase),
// coordinator-abtesting-update.test.cjs (abtesting.strategy) and october-runtime.test.cjs
// (cipher.plan), each with the reason the live table cannot reach it.
const W = 'E2EWarrior', P = 'E2EPriest';
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-events-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);

test('events hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  const pages: Record<string, NonNullable<(typeof live.clients)[string]>> = { [W]: live.clients[W]!, [P]: live.clients[P]! };
  await party(live);
  // The admission captures the farm spot as the event's checkpoint (returns.ts
  // `coordinatorEventCheckpoint`), so the party farms before the events start.
  await farm(live);
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  for (const page of Object.values(pages)) expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(true)) }] });
  for (const page of Object.values(pages))
    await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify(EVENTS_HOOKS_ADDON)})`), { timeout: 30_000 }).toBe(true);
  const since = Date.now();
  try {
    // Mr. Green, the staged walk kind: its spawn is scheduled ahead of the walk estimate's lead.
    await live.post('/formation', { character: W, eventSelections: ['mrgreen', 'goobrawl'] });
    // The seed holds the Halloween season, so the schedule is announced at the server_info boundary.
    await announceSpawn(live, 'mrgreen', 240_000);
    await test.step('L: the Mr. Green spawn is scheduled', async () => {
      await expect.poll(async () => of(await heard(live, since), 'event.scheduled').filter(h => h.payload.event === 'mrgreen').length,
        { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
    });
    await test.step('L: Mr. Green becomes due at the walk estimate', async () => {
      await expect.poll(async () => of(await heard(live, since), 'event.due').filter(h => h.payload.event === 'mrgreen').length,
        { timeout: 300_000, intervals: [500] }).toBe(1);
      const due = of(await heard(live, since), 'event.due').find(h => h.payload.event === 'mrgreen')!;
      const scheduled = due.reads.schedule!;
      expect(scheduled.walkMs, 'the lead is the planned walk').toBeGreaterThan(0);
      expect(due.at, 'due at the spawn less the lead').toBeGreaterThanOrEqual(scheduled.spawnAt - scheduled.leadMs - 1000);
    });
    await test.step('L: the add-on reads the schedule when due', async () => {
      const due = of(await heard(live, since), 'event.due').find(h => h.payload.event === 'mrgreen')!;
      expect(due.reads.schedule?.phase).toBe('due');
    });

    // Goobrawl, the join kind, with the priest's admission refused by the add-on.
    const goobrawl = Date.now();
    await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
    await fixture(live, { op: 'refuse', refuse: P });
    await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    await test.step('L: Goobrawl goes live', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.started').filter(h => h.payload.event === 'goobrawl').length,
        { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
    });
    await test.step("L: an add-on refuses the priest's admission", async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.refused').filter(h => h.payload.member === P && h.payload.hook).length,
        { timeout: 60_000, intervals: [500] }).toBe(1);
      expect(of(await heard(live, goobrawl), 'event.admitted').some(h => h.payload.member === P && h.payload.event === 'goobrawl'), 'the refused priest is never admitted').toBe(false);
    });
    await test.step('L: the warrior is admitted to Goobrawl', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.admitted').filter(h => h.payload.member === W && h.payload.event === 'goobrawl').length,
        { timeout: 60_000, intervals: [500] }).toBe(1);
      expect(of(await heard(live, goobrawl), 'event.admitted').find(h => h.payload.member === W)!.payload.checkpoint, 'the checkpoint rides the notice').toBeTruthy();
    });
    await test.step("L: the warrior's presence goes walking then attending", async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'member.presence').filter(h => h.payload.member === W)
        .map(h => (h.payload.presence as { phase?: string } | null)?.phase).filter(Boolean),
      { timeout: 180_000, intervals: [500] }).toEqual(expect.arrayContaining(['walking', 'attending']));
    });
    await test.step('L: the warrior joins Goobrawl', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.joined').filter(h => h.payload.member === W).length,
        { timeout: 180_000, intervals: [500] }).toBe(1);
    });
    // The presence read is the one the task tick last derived (source.ts `presenceOf`), which may
    // trail the join notice by a tick, so the add-on asks it while the warrior attends.
    await test.step('L: the add-on reads presence while attending', async () => {
      await expect.poll(async () => ((await fixture(live, { op: 'ask', hook: 'event.presence', args: [W] })).answer as { event?: string; phase?: string } | null)?.event ?? null,
        { timeout: 30_000, intervals: [500] }).toBe('goobrawl');
    });
    await test.step('L: the add-on reads the event targets while attending', async () => {
      const targets = await pages[W]!.run(readTargets) as { types: string[]; area: string | null };
      expect(targets.types, "Goo Brawl's goos lead its targets").toEqual(expect.arrayContaining(['rgoo', 'bgoo', 'goo']));
      expect(targets.area, 'the warrior stands in the Goo Brawl area').toBe('goobrawl');
    });
    await fixture(live, { op: 'refuse', refuse: null });
    // The server ends Goobrawl when its timer runs out, clearing its feed entry and sending the
    // fighters home; clearing the flag alone leaves the event live (live-fixtures.ts `huntRowsReset`).
    await live.admin(`if(events.goobrawl)timers.goobrawl=new Date(0);output=true`);
    await test.step('L: Goobrawl ends', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.ended').filter(h => h.payload.event === 'goobrawl').map(h => h.payload.reason),
        { timeout: 120_000, intervals: [500] }).toContainEqual('ended');
    });
    await test.step('L: the Goobrawl return starts', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.returning').filter(h => h.payload.event === 'goobrawl').length,
        { timeout: 120_000, intervals: [500] }).toBe(1);
      // The refused priest still walks the Mr. Green trip the formation dropped, so its Mr. Green
      // return (row 'town': rules.ts gives Mr. Green no return row) can come first.
      expect(of(await heard(live, goobrawl), 'event.returning').find(h => h.payload.event === 'goobrawl')!.payload.row).toBe('goobrawl-wait');
    });
    await test.step('L: the return completes into farming', async () => {
      await expect.poll(async () => of(await heard(live, goobrawl), 'event.returned').filter(h => h.payload.event === 'goobrawl').length,
        { timeout: 300_000, intervals: [1000] }).toBe(1);
    });
    await test.step('L: a manual move off the map leaves', async () => {
      const at = Date.now();
      await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
      await expect.poll(async () => of(await heard(live, at), 'event.joined').filter(h => h.payload.member === W).length,
        { timeout: 240_000, intervals: [500] }).toBe(1);
      // The player's move is a character travel command (movement/coordinator/arrivals.ts `travel`).
      await live.post('/command', { character: W, type: 'character-travel', location: { map: 'main', x: 0, y: 0 } });
      await expect.poll(async () => of(await heard(live, at), 'event.left').filter(h => h.payload.member === W).length,
        { timeout: 60_000, intervals: [500] }).toBe(1);
      await live.admin(`if(events.goobrawl)timers.goobrawl=new Date(0);output=true`);
    });
    // The add-on's own kind on both realms: selected like a core event, attended through the tasks owner's event
    // source at `event-attendance`, and returned from by the plain return (its row names no return).
    await test.step('L: an add-on event kind is attended and returned from', async () => {
      for (const page of Object.values(pages)) expect(await page.run(kindHere), 'the character reads the add-on row').toMatchObject({ name: ADDON_EVENT, kind: 'walk' });
      const at = Date.now();
      await live.post('/formation', { character: W, eventSelections: [ADDON_EVENT] });
      // No server handler runs Dreams, so the row puts it in the server_info feed itself (E), as the
      // game's own handlers put a live event there, and takes it out at the end.
      await live.admin(`E[${JSON.stringify(ADDON_EVENT)}]={live:true};broadcast_e();output=true`);
      await expect.poll(async () => of(await heard(live, at), 'event.joined').filter(h => h.payload.member === W && h.payload.event === ADDON_EVENT).length,
        { timeout: 240_000, intervals: [500] }).toBe(1);
      await live.admin(`delete E[${JSON.stringify(ADDON_EVENT)}];broadcast_e();output=true`);
      await expect.poll(async () => of(await heard(live, at), 'event.returned').filter(h => h.payload.event === ADDON_EVENT).length,
        { timeout: 300_000, intervals: [1000] }).toBe(1);
    });
  } finally {
    await info.attach('events-hooks', { body: JSON.stringify({ heard: await heard(live, since).catch(() => []) }), contentType: 'application/json' });
    await fixture(live, { op: 'refuse', refuse: null });
    await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
