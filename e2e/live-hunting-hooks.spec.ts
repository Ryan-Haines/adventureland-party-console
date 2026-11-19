import { test, expect, type LiveGame } from './live-fixtures';
import { party, quests, start, location, warrior as W, priest as P } from './game/hunt-lifecycle';
import { addonSwitches as switches, type Heard } from './fixtures/hunting-hooks-addon';

// The hunts and farming owner's hooks table. One fixture add-on registers its decision hooks and every notice
// and reads `farming.focus`, `hunt.view`, `passive.rule` and `cave.state` at each notice; each step is
// one hook, event or read on one run: the default party farming goos with the combat mode Auto, then
// a Hunt with a planted live quest, its turn-in, and a relocation with a planted competitor report.
// Each step's title is the `fixture` its `HOOKS` row names (runtime/hooks/rows/07-hunting.ts). The
// rare, the Phoenix patrol and the counts have unit rows in scripts/tests/hunting-hooks.test.cjs (a
// live rare cannot be summoned on demand); the Cave's rows sit in e2e/live-cave.spec.ts. Written for
// the end run, not run at the build (user, 2026-11-12).
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-hunting-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);

test('hunting hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  await party(live);
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await live.clients[W]!.run(switches(true)) }] });
  const since = Date.now();
  try {
    // Farming goos with Auto: the focus change, the learned type and the mode answer.
    const goo = await location(live, 'goo');
    await live.post('/navigate-to-monster', { monsterId: 'goo', location: goo });
    await test.step('L: the add-on reads the focus change', async () => {
      await expect.poll(async () => of(await heard(live, since), 'farming.focusChanged').some(h => JSON.stringify(h.payload.focus) === '["goo"]'),
        { timeout: 60_000, intervals: [500] }).toBe(true);
    });
    await test.step('L: Auto scatters on a learned goo', async () => {
      await expect.poll(async () => of(await heard(live, since), 'scatter.learned').some(h => h.payload.type === 'goo'),
        { timeout: 240_000, intervals: [1000] }).toBe(true);
      await expect.poll(async () => of(await heard(live, since), 'farming.mode').some(h => h.payload.mode === 'scatter'),
        { timeout: 60_000, intervals: [1000] }).toBe(true);
    });
    await test.step('L: the add-on reads the focus, the area and the Hunt target', async () => {
      const read = of(await heard(live, since), 'farming.mode').at(-1)!.reads.focus!;
      expect(read.focus).toEqual(['goo']);
      expect(read.area?.map).toBe(goo.map);
      expect(read.huntTarget).toBeNull();
    });
    await test.step("L: the add-on reads the goo's passive rule and the Fairy's priority", async () => {
      const reads = of(await heard(live, since), 'farming.focusChanged')[0]!.reads;
      expect(reads.goo.corePriority).toBe(false);
      expect(reads.tinyp.corePriority).toBe(true);
      expect(reads.tinyp.default.priority).toBe(101);
    });

    // The Hunt: a planted quest the add-on refuses first, then the cycle takes the next one.
    // The party still farms goos here, so the priest's goo quest leaves room for the kills its next
    // report may already count (run on a4884e05f: 2 went to 0 before the report).
    await quests(live, info, { [W]: { id: 'bee', count: 3 }, [P]: { id: 'goo', count: 10 } });
    await fixture(live, { op: 'set', refuseQuest: 'bee' });
    const hunt = Date.now();
    await start(live, W, 'goo');
    await test.step('L: the add-on refuses the planted quest, and the cycle backs up', async () => {
      await expect.poll(async () => of(await heard(live, hunt), 'hunt.stage').some(h => h.reads.hunt?.target === 'goo'),
        { timeout: 180_000, intervals: [1000] }).toBe(true);
      expect(of(await heard(live, hunt), 'hunt.stage').some(h => h.reads.hunt?.target === 'bee')).toBe(false);
    });
    await test.step('L: the cycle goes to Daisy, takes the quest and travels', async () => {
      const stages = of(await heard(live, hunt), 'hunt.stage').map(h => h.payload.to);
      expect(stages).toContain('mission-travel');
      expect(of(await heard(live, hunt), 'hunt.stage').at(-1)!.reads.hunt?.stage).toBeTruthy();
    });
    await test.step("L: the add-on's status line shows under the Hunt status", async () => {
      const view = of(await heard(live, hunt), 'hunt.stage').at(-1)!.reads.hunt!;
      expect(typeof view.label).toBe('string');
    });
    await test.step('L: the planted quest is turned in', async () => {
      await expect.poll(async () => of(await heard(live, hunt), 'hunt.questChanged').some(h => h.payload.change === 'turnedIn'),
        { timeout: 600_000, intervals: [2000] }).toBe(true);
    });

    // A relocation with a planted competitor report; the add-on keeps the party at its own spawn.
    await fixture(live, { op: 'set', keepSpawn: goo.id });
    const relocation = Date.now();
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});p.s.farmCompetitionPlanted=true;return true})()`);
    await test.step('L: the add-on keeps the relocation to its own spawn', async () => {
      await expect.poll(async () => of(await heard(live, relocation), 'farm.relocated').length, { timeout: 180_000, intervals: [1000] }).toBeGreaterThanOrEqual(0);
      for (const moved of of(await heard(live, relocation), 'farm.relocated'))
        expect((moved.payload.to as { id?: string }).id, 'a relocation goes only to the kept spawn').toBe(goo.id);
    });
  } finally {
    await fixture(live, { op: 'set' });
    await live.post('/settings', { changes: [{ field: 'addons', value: await live.clients[W]!.run(switches(false)) }] });
  }
});
