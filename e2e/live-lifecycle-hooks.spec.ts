import { test, expect, type LiveGame } from './live-fixtures';
import { party } from './game/hunt-lifecycle';
import { safeReloadRow, toReloadSpot } from './console-reload-rows';
import { CHARACTER_NOTICES, COORDINATOR_NOTICES, HOLD_REASON, LIFECYCLE_HOOKS_ADDON, boundarySource, characterHeard, holdSource,
  lifecycleHooksSwitches, registerCharacterHalf, type Heard } from './fixtures/lifecycle-hooks-addon';

// Lifecycle's hooks table.
// One fixture add-on answers `lifecycle.ready` and hears every 13 notice; the table runs on the safe
// reload row's party (e2e/console-reload-rows.ts `safeReloadRow`), in that row's order: Pause, a deploy
// while paused, a coordinator restart, Play, a clean shutdown and the next start, a CODE reload and the
// safe deploy. The add-on's own hold row runs first, on a lease of its own. Each step's title is the
// `fixture` its `HOOKS` row names (runtime/hooks/rows/13-lifecycle.ts); `roster.changed`,
// `lifecycle.allows` and the coordinator's `lifecycle.drain` answer are unit rows,
// since the live stack has no Steam window. `worker.started` and `worker.exited` need headless workers,
// which run only with E2E_ALLOW_HEADLESS.
const W = 'E2EWarrior';
// safeReloadRow's planted goos outlast a level-zero weapon (live-farm-death-escape.spec.ts runs it on
// the same loadout). On the default god loadout the warrior killed the first goo in about a second,
// so the second goo led the queue as current and never showed as next.
test.use({ loadout: 'combat-range' });
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-lifecycle-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);

test('lifecycle hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  await party(live);
  const page = live.clients[W]!;
  const pageClock = () => page.run('Date.now()') as Promise<number>;
  const pageHeard = async (since: number) => await page.run(characterHeard(since)) as Heard[];
  const register = async () => expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  await register();
  await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(lifecycleHooksSwitches(true)) }] });
  const since = Date.now(), pageSince = await pageClock(), rows: Record<string, unknown> = {};
  try {
    await test.step('report.sent: each report sends report.sent', async () => {
      await expect.poll(async () => of(await pageHeard(pageSince), 'report.sent').length, { timeout: 30_000 }).toBeGreaterThan(1);
      const sequences = of(await pageHeard(pageSince), 'report.sent').map(h => Number(h.payload.sequence));
      expect(sequences, 'one notice per report, in order').toEqual([...sequences].sort((a, b) => a - b));
    });
    await test.step('lifecycle.ready: the add-on holds the drain while its own work runs, and the deploy waits on its reason', async () => {
      await page.run(holdSource(HOLD_REASON));
      const at = await pageClock();
      live.consoleDrainLease('lifecycle-hooks-hold');
      await expect.poll(async () => (await live.state()).characters[W]?.consoleMaintenance?.ready, { timeout: 30_000 }).toBe(false);
      await test.step("lifecycle.readiness: the add-on's hold appears in waiting, then clears", async () => {
        // Each waiting entry names the answer that holds and its reason (registry.ts `Readiness`).
        await expect.poll(async () => of(await pageHeard(at), 'lifecycle.readiness')
          .some(h => (h.payload.waiting as { by: string; reason: string }[] ?? []).some(w => w.by === LIFECYCLE_HOOKS_ADDON && w.reason === HOLD_REASON)),
          { timeout: 30_000 }).toBe(true);
        await page.run(holdSource(null));
        await expect.poll(async () => (await live.state()).characters[W]?.consoleMaintenance?.ready, { timeout: 30_000 }).toBe(true);
        const last = of(await pageHeard(at), 'lifecycle.readiness').at(-1)!;
        rows.readiness = last;
        expect(last.payload.waiting, 'the last readiness notice waits on nothing').toEqual([]);
      });
      // `movement.park` (the movement owner's, asked by the drain's park). The drain parks only once the work it
      // lets finish is done (drain.ts `park`), so the warrior keeps its walk while the add-on holds and
      // stops where it stands after the hold clears.
      await test.step('movement.park: the drain parks the warrior where it stands', async () => {
        // The game leaves `moving` unset on a character that has not walked since login.
        await expect.poll(() => page.run('!!character.moving'), { timeout: 30_000 }).toBe(false);
      });
      await test.step("lifecycle.drain: the add-on reads the drain's targets during the safe deploy", async () => {
        const read = of(await pageHeard(at), 'lifecycle.readiness').at(-1)!.drain as { targets?: unknown; park?: unknown } | null;
        rows.drain = read;
        expect(read && 'targets' in read && 'park' in read, 'the character answer is {targets, park}').toBe(true);
      });
      // Only the merchant's transactions wait at the boundary (character/drain.ts `free`): a
      // fighter's boundary opens at once, so the row opens it on the merchant's page.
      await test.step('lifecycle.boundary: a boundary opened during the deploy settles on drainEnded', async () => {
        const merchant = live.clients['E2EMerchant']!;
        await merchant.run(boundarySource);
        expect(await merchant.run('globalThis.__lifecycleHooksBoundary?.settled ?? 0'), 'the boundary waits while the deploy drains').toBe(0);
        live.consoleDrainLease(null);
        await expect.poll(() => merchant.run('globalThis.__lifecycleHooksBoundary?.settled ?? 0'), { timeout: 30_000 }).toBeGreaterThan(0);
        const ended = of(await heard(live, since), 'lifecycle.drainEnded').find(h => h.payload.lease === 'lifecycle-hooks-hold');
        expect(ended, 'the coordinator sent drainEnded for the lease').toBeTruthy();
      });
      const answers = of(await pageHeard(at), 'lifecycle.ready');
      expect(answers.some(h => h.payload.holding) && answers.some(h => !h.payload.holding), 'the drain asked the add-on while it held and after').toBe(true);
    });

    // The safe reload row: Pause, a deploy while paused, a restart, Play, the clean shutdown and the
    // next start, the CODE reload and the safe deploy. Each later step reads what the add-on heard.
    await toReloadSpot(live);
    await safeReloadRow(live, info);
    await register();
    const all = await heard(live, since), pageAll = await pageHeard(pageSince);
    rows.coordinator = all; rows.character = pageAll;
    await test.step('lifecycle.paused: Pause sends paused by user', async () => {
      expect(of(all, 'lifecycle.paused').map(h => h.payload.by)).toContain('user');
    });
    await test.step('lifecycle.held: the add-on reads held while paused', async () => {
      expect(of(pageAll, 'lifecycle.holdChanged').some(h => h.payload.held === true && h.held === true)).toBe(true);
    });
    await test.step('lifecycle.holdChanged: the paused warrior sends holdChanged held, then released at Play', async () => {
      const changes = of(pageAll, 'lifecycle.holdChanged').filter(h => h.payload.character === W).map(h => [h.payload.held, h.payload.by]);
      expect(changes).toContainEqual([true, 'user']);
      expect(changes.findIndex(([held]) => held === false)).toBeGreaterThan(changes.findIndex(([held]) => held === true));
    });
    await test.step('lifecycle.state: the add-on reads paused true while paused', async () => {
      // The harness reads `lifecycle.state` at each coordinator notice (e2e/live-coordinator.cjs).
      const read = of(all, 'lifecycle.paused')[0]?.state;
      expect(read?.paused).toBe(true);
    });
    await test.step('lifecycle.drainStarted: the safe deploy sends drainStarted', async () => {
      expect(of(all, 'lifecycle.drainStarted').map(h => h.payload.by)).toContain('host');
    });
    await test.step("lifecycle.drainEnded: the safe deploy's release sends drainEnded", async () => {
      expect(of(all, 'lifecycle.drainEnded').length).toBeGreaterThanOrEqual(of(all, 'lifecycle.drainStarted').length);
    });
    await test.step('lifecycle.started: the restart sends started with reason start', async () => {
      expect(of(all, 'lifecycle.started').map(h => h.payload.reason)).toContain('start');
    });
    await test.step('lifecycle.played: Play sends played by user', async () => {
      expect(of(all, 'lifecycle.played').map(h => h.payload.by)).toEqual(expect.arrayContaining(['user', 'auto-resume']));
    });
    await test.step('lifecycle.shutdown: the clean shutdown sends draining then safe', async () => {
      const phases = of(all, 'lifecycle.shutdown').map(h => h.payload.phase);
      expect(phases.indexOf('safe')).toBeGreaterThan(phases.indexOf('draining'));
    });
    await test.step('lifecycle.reloaded: the CODE reload sends reloaded ready', async () => {
      expect(of(all, 'lifecycle.reloaded').map(h => h.payload.outcome)).toContain('ready');
    });
    if (process.env.E2E_ALLOW_HEADLESS === 'true') await test.step("worker.started, worker.exited: the restart's workers send exited then started", async () => {
      const exited = of(all, 'worker.exited')[0], started = of(all, 'worker.started').find(h => h.at > (exited?.at ?? Infinity));
      expect(exited && started, 'an exit, then a start').toBeTruthy();
    });
    const live13 = COORDINATOR_NOTICES.filter(hook => !hook.startsWith('worker.') || process.env.E2E_ALLOW_HEADLESS === 'true');
    expect(live13.filter(hook => of(all, hook).length === 0), 'every coordinator notice was heard').toEqual([]);
    expect(CHARACTER_NOTICES.filter(hook => of(pageAll, hook).length === 0), 'every character notice was heard').toEqual([]);
  } finally {
    await info.attach('lifecycle-hooks', { body: JSON.stringify(rows), contentType: 'application/json' });
    await page.run(holdSource(null)).catch(() => null);
    live.consoleDrainLease(null);
    await fixture(live, { op: 'off' }).catch(() => null);
    await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(lifecycleHooksSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
