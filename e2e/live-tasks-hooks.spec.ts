import { test, expect, type LiveGame } from './live-fixtures';
import { party, profile, quests } from './game/hunt-lifecycle';
import { COMBAT_ENTRY, TARGET_ENTRY, TASK_KIND, TASKS_HOOKS_ADDON, type Answers, type Heard } from './fixtures/tasks-hooks-addon';

// The groups and tasks owner's hooks table. One
// fixture add-on registers every 01 hook an add-on answers and hears every 01 notice; each row is one
// hook, notice or slot on one shared run of the default party (warrior leader, priest following, the
// merchant): a farming task, the add-on's own task, a Goobrawl event that takes the group, a Follow
// change, a Manual toggle and a Hunt switch, in that order. Each step's title is the `fixture` its
// `HOOKS` or `SLOTS` row names (runtime/hooks/rows/01-tasks.ts, rows/11-settings.ts `target.settings`).
// The two unit rows (`U:`) sit in scripts/tests/hook-registry.test.cjs: a live rare cannot be summoned
// on demand, and an invariant break needs a bug the live game cannot plant.
const W = 'E2EWarrior', P = 'E2EPriest', GROUP = `party:${W}`;
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-tasks-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const answer = async (live: LiveGame, answers: { [K in keyof Answers]: Answers[K] | null }) => await fixture(live, { op: 'answers', answers });
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
const group = async (live: LiveGame) => ((await live.tasks()).groups as { id: string; live?: { id?: string; kind?: string; owner?: string } }[]).find(g => g.id === GROUP);
const liveKind = async (live: LiveGame) => (await group(live))?.live?.kind;
// The owner's calls take a task handle, its id and its group (owner.ts `fail`, `progress`); the
// diagnostics read lists the live task's id.
const liveHandle = async (live: LiveGame) => ({ id: (await group(live))?.live?.id, group: GROUP });

test('tasks hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  await party(live);
  expect(await fixture(live, { op: 'register' }), 'the fixture add-on registers').toEqual({ ok: true });
  await live.post('/addons', { name: TASKS_HOOKS_ADDON, enabled: true });
  const since = Date.now(), rows: Record<string, unknown> = {};
  try {
    await live.post('/farming-mode', { character: W, combatMode: 'auto', targetMode: 'farming' });
    await expect.poll(() => liveKind(live), { timeout: 60_000, intervals: [500] }).toBe('farming');

    await test.step("L: the add-on's task takes the farming group, and ranks below the event", async () => {
      await answer(live, { task: { group: GROUP, members: [W, P] } });
      await expect.poll(() => liveKind(live), { timeout: 30_000, intervals: [250] }).toBe(TASK_KIND);
      expect(of(await heard(live, since), 'task.request').some(h => h.payload.group === GROUP)).toBe(true);
    });
    await test.step('L: the add-on holds its group, and the hold ends with its task', async () => {
      await answer(live, { hold: GROUP });
      await expect.poll(async () => of(await heard(live, since), 'group.hold').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
      await answer(live, { hold: null });
    });
    await test.step("L: a member left out of the add-on's walk waits at the point it names", async () => {
      const at = Date.now();
      await answer(live, { apart: { map: 'main', x: 40, y: 40 }, task: { group: GROUP, members: [W] } });
      await expect.poll(async () => of(await heard(live, at), 'member.apart').map(h => h.payload.member), { timeout: 30_000, intervals: [250] }).toContainEqual(P);
      await answer(live, { apart: null, task: { group: GROUP, members: [W, P] } });
    });
    await test.step("L: the add-on's task fails once and walks to its named alternative", async () => {
      const at = Date.now(), handle = await liveHandle(live);
      await answer(live, { alternative: { map: 'main', x: 20, y: 20 } });
      await live.taskOps([{ op: 'fail', args: [handle, 'no-path'] }]);
      await expect.poll(async () => of(await heard(live, at), 'task.alternative').length, { timeout: 30_000, intervals: [250] }).toBe(1);
      expect(of(await heard(live, at), 'task.ladder').map(h => h.payload.rung)).toContainEqual('alternative');
    });
    await test.step("L: the add-on's task reaches the safe-point rung at its own point", async () => {
      const at = Date.now(), handle = await liveHandle(live);
      await answer(live, { safePoint: { map: 'main', x: 0, y: 0 } });
      for (const code of ['no-path', 'no-path']) await live.taskOps([{ op: 'fail', args: [handle, code] }]);
      await expect.poll(async () => of(await heard(live, at), 'task.ladder').map(h => h.payload.rung), { timeout: 30_000, intervals: [250] }).toContainEqual('safe-point');
      expect(of(await heard(live, at), 'task.safePoint').length).toBeGreaterThan(0);
      await live.taskOps([{ op: 'progress', args: [handle] }]);
    });
    await test.step("L: a merchant visit to a member under the add-on's task is refused by its answer", async () => {
      await answer(live, { refuseVisit: true });
      const [allowed] = await live.taskOps([{ op: 'allows', args: ['merchant-visit', P] }]);
      expect(allowed, "the add-on's answer refuses the visit").toBe(false);
      expect(of(await heard(live, since), 'group.questions').some(h => h.payload.question === 'merchant-visit')).toBe(true);
      await answer(live, { refuseVisit: null });
    });

    // The Goobrawl event takes the group from the add-on's task.
    const event = Date.now();
    await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
    await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    await test.step('L: the event takes the group: one started, one suspended', async () => {
      await expect.poll(async () => of(await heard(live, event), 'task.started').filter(h => h.payload.kind === 'event-attendance').length,
        { timeout: 120_000, intervals: [500] }).toBe(1);
      expect(of(await heard(live, event), 'task.suspended').filter(h => h.payload.kind === TASK_KIND).length).toBe(1);
      expect(of(await heard(live, event), 'member.presence').length).toBeGreaterThan(0);
    });
    await test.step("L: the add-on's task waits behind the event", async () => {
      await expect.poll(async () => of(await heard(live, event), 'task.waiting').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
    });
    await test.step("L: the event task's walk phase changes", async () => {
      await expect.poll(async () => of(await heard(live, event), 'task.phase').length, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
    });
    // The server ends Goobrawl when its timer runs out, clearing its feed entry and sending the
    // fighters home; clearing the flag alone leaves the event live (live-fixtures.ts `huntRowsReset`).
    await live.admin(`if(events.goobrawl)timers.goobrawl=new Date(0);output=true`);
    await test.step('L: the event ends and farming resumes', async () => {
      await expect.poll(async () => of(await heard(live, event), 'task.ended').filter(h => h.payload.kind === 'event-attendance').length,
        { timeout: 300_000, intervals: [1000] }).toBe(1);
      await expect.poll(async () => of(await heard(live, event), 'task.resumed').length, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      await answer(live, { task: null, alternative: null, safePoint: null });
    });

    await test.step('L: a Follow change moves the priest', async () => {
      const at = Date.now();
      await live.post('/formation', { character: P, follow: false });
      await expect.poll(async () => of(await heard(live, at), 'group.changed').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
      expect(of(await heard(live, at), 'member.assigned').map(h => h.payload.member)).toContainEqual(P);
      await live.post('/formation', { character: P, follow: true });
    });
    await test.step('L: Manual on the priest, then off', async () => {
      const at = Date.now();
      await live.post('/formation', { character: P, handControl: { on: true } });
      await expect.poll(async () => of(await heard(live, at), 'group.held').map(h => h.payload.member), { timeout: 30_000, intervals: [250] }).toContainEqual(P);
      await live.post('/formation', { character: P, handControl: { on: false } });
      await expect.poll(async () => of(await heard(live, at), 'group.released').map(h => h.payload.member), { timeout: 30_000, intervals: [250] }).toContainEqual(P);
      expect(of(await heard(live, at), 'status.changed').length).toBeGreaterThan(0);
    });
    await test.step('L: an add-on combat mode reaches the members on the next reply', async () => {
      const at = Date.now();
      await answer(live, { combat: 'scatter' });
      await live.post('/farming-mode', { character: W, combatMode: COMBAT_ENTRY });
      await expect.poll(async () => of(await heard(live, at), 'combat.mode').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
      await live.post('/farming-mode', { character: W, combatMode: 'auto' });
    });
    await test.step("L: the entry's settings route writes its scope store", async () => {
      const reply = await live.post('/addon-farming', { character: W, name: TASKS_HOOKS_ADDON, value: 5 }) as { tasksFixtureValue?: unknown };
      expect(reply.tasksFixtureValue).toBe(5);
    });
    await test.step('L: the Achievements-like entry farms its target, and lets go once on a Hunt switch', async () => {
      const at = Date.now();
      await live.post('/farming-mode', { character: W, targetMode: TARGET_ENTRY });
      await expect.poll(async () => of(await heard(live, at), 'target.mode').filter(h => h.payload.targetMode === TARGET_ENTRY).length,
        { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
      // The entry's selection reaches the scope: its focus becomes the goo it selected through the
      // destination port (F-02514).
      await expect.poll(async () => profile(await live.state(), W).monsterFocus, { timeout: 30_000, intervals: [250] }).toEqual(['goo']);
      await live.post('/farming-mode', { character: W, targetMode: 'hunt' });
      await expect.poll(async () => of(await heard(live, at), 'slot.changed').filter(h => h.payload.slot === 'target-mode').length,
        { timeout: 30_000, intervals: [250] }).toBe(2);
    });
    await test.step('L: the event becomes due during a Hunt hand-in', async () => {
      const at = Date.now();
      // A completed quest on both fighters puts the Hunt at its hand-in, which an event that comes
      // due takes over (tasks/coordinator/install.ts `yields`).
      await quests(live, info, { [W]: { count: 0 }, [P]: { count: 0 } });
      await expect.poll(async () => { const hunt = (await live.state()).monsterHunt as { stage?: string; turnIn?: unknown } | null;
        return !!hunt && (!!hunt.turnIn || ['returning', 'at-daisy'].includes(String(hunt.stage))); },
      { timeout: 180_000, intervals: [1000], message: 'The Hunt reaches its hand-in' }).toBe(true);
      await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
      await expect.poll(async () => of(await heard(live, at), 'task.due').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
      await live.admin(`if(events.goobrawl)timers.goobrawl=new Date(0);output=true`);
    });
    // Every notice of the run names its subject and its by (01 contract part 2).
    const notices = (await heard(live, since)).filter(h => !['target.mode', 'target.settings', 'combat.mode', 'task.request', 'task.alternative',
      'task.safePoint', 'group.questions', 'group.hold', 'member.apart'].includes(h.hook));
    expect(notices.filter(h => !h.payload.by).map(h => h.hook), 'every notice names its by').toEqual([]);
  } finally {
    await info.attach('tasks-hooks', { body: JSON.stringify({ rows, heard: await heard(live, since).catch(() => []) }), contentType: 'application/json' });
    await answer(live, { task: null, hold: null, apart: null, alternative: null, safePoint: null, refuseVisit: null, combat: null }).catch(() => {});
    await live.post('/addons', { name: TASKS_HOOKS_ADDON, enabled: false }).catch(() => {});
  }
});
