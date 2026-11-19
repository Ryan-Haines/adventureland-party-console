import { test, expect, type LiveGame } from './live-fixtures';
import { farm, party } from './game/hunt-lifecycle';
import { killNativeCharacter } from './hunt-interruption-helpers';
import { addonSwitches, characterHeard, registerCharacterHalf, SURVIVAL_HOOKS_ADDON, type Heard } from './fixtures/survival-hooks-addon';

// The survival owner's hooks table. One fixture add-on registers every survival hook and event on both realms and
// reads each published read at each notice; each row is one hook, event or read on one shared run of
// UP-2's setup on the default fixture: the warrior dies at the farm, the party recovers, escapes,
// walks home and regroups. Each step's title is the `fixture` its `HOOKS` row names
// (runtime/hooks/registry.ts). The unit rows (`U:`) sit in scripts/tests/combat-disengagement.test.cjs,
// party-escape.test.cjs, survival-needs.test.cjs and cave-priest-recovery.test.cjs, each with the
// reason the live table cannot reach it.
const W = 'E2EWarrior', P = 'E2EPriest';
const coordinator = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-survival-hooks', body);
const heardC = async (live: LiveGame, since: number) => await coordinator(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
// The escape's state read, which carries the button the player's press names.
const escapeRead = async (live: LiveGame) => await (await fetch(live.url + '/party-api/escape')).json() as { button?: unknown };

test('survival hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(600_000);
  const pages: Record<string, NonNullable<(typeof live.clients)[string]>> = { [W]: live.clients[W]!, [P]: live.clients[P]! };
  const heardW = async (name: string, since: number) => await pages[name]!.run(characterHeard(since)) as Heard[];
  await party(live);
  // The bee field lies away from Main's respawn point, so the living priest has a convoy home to
  // walk after the warrior's death; on the goo field beside the respawn the party is home at once
  // and the escape releases from recovering.
  await farm(live, 'bee');
  expect(await coordinator(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  for (const page of Object.values(pages)) expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(true)) }] });
  for (const page of Object.values(pages))
    await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify(SURVIVAL_HOOKS_ADDON)})`), { timeout: 30_000 }).toBe(true);
  const since = Date.now(), from: Record<string, number> = { [W]: await pages[W]!.run('Date.now()') as number, [P]: await pages[P]!.run('Date.now()') as number };
  const rows: Record<string, unknown> = {};
  try {
    // UP-2's death: the warrior dies at the farm, by a native skill the server resolves.
    await killNativeCharacter(live, W);
    await test.step('L: the death is noticed once', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.died').filter(h => h.payload.name === W).length,
        { timeout: 30_000, intervals: [500] }).toBe(1);
      expect(of(await heardC(live, since), 'survival.died').every(h => h.payload.by === 'core:survival'), 'the notice names its by').toBe(true);
    });
    await test.step('L: the recovery starts on the death', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.recoveryStarted').map(h => (h.payload.deaths as string[]).join()),
        { timeout: 30_000, intervals: [250] }).toContainEqual(W);
    });
    await test.step("L: the verdict's first judgement is noticed", async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.judged').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
    });
    await test.step('L: the recovery goes finishing to escaping', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.recoveryPhase').map(h => `${h.payload.from}>${h.payload.to}`),
        { timeout: 60_000, intervals: [250] }).toContainEqual('finishing>escaping');
    });
    await test.step("L: the escape's cause is noticed", async () => {
      // A cause rides only on an escape the verdict decided over a fight with foes.
      const escaped = of(await heardC(live, since), 'survival.escaped');
      rows.escaped = escaped.map(h => h.payload);
      for (const h of escaped) expect(['bad luck', 'too hard']).toContain(h.payload.cause);
    });
    await test.step('L: the escape starts', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.escapeStarted').map(h => (h.payload.participants as string[]).sort().join()),
        { timeout: 30_000, intervals: [250] }).toContainEqual([P, W].sort().join());
    });
    await test.step("L: the add-on reads the recovery's phase", async () => {
      const phases = of(await heardC(live, since), 'survival.recoveryPhase');
      expect(phases.some(h => (h.reads.recovery as { phase?: string } | null)?.phase === h.payload.to), 'the read names the phase the notice moved to').toBe(true);
    });
    await test.step("L: the dead member's respawn is sent and accepted", async () => {
      await expect.poll(async () => of(await heardW(W, from[W]!), 'survival.respawning').map(h => h.payload.outcome),
        { timeout: 60_000, intervals: [500] }).toEqual(expect.arrayContaining(['sent', 'accepted']));
    });
    await test.step("L: the respawned member's recovery completes", async () => {
      await expect.poll(async () => of(await heardW(W, from[W]!), 'survival.memberRecovery').map(h => h.payload.stage),
        { timeout: 120_000, intervals: [500] }).toContainEqual('recovery-complete');
    });
    await test.step('L: the escape goes recovering to recovery-convoy to home', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.escapeStage').map(h => `${h.payload.from}>${h.payload.to}`),
        { timeout: 180_000, intervals: [500] }).toEqual(expect.arrayContaining(['recovering>recovery-convoy', 'recovery-convoy>home']));
    });
    await test.step("L: the add-on reads the escape's stage", async () => {
      const stages = of(await heardC(live, since), 'survival.escapeStage').filter(h => h.payload.to !== 'released');
      expect(stages.some(h => (h.reads.escaping as { stage?: string } | null)?.stage === h.payload.to), 'the read names the stage the notice moved to').toBe(true);
    });
    await test.step('L: each member joins and leaves the escape', async () => {
      for (const name of [W, P]) {
        const changes = of(await heardW(name, from[name]!), 'survival.escapeMember').map(h => h.payload.change);
        expect(changes, `${name}'s escape record`).toEqual(expect.arrayContaining(['joined', 'left']));
      }
    });
    await test.step('L: the recovery ends complete', async () => {
      await expect.poll(async () => of(await heardC(live, since), 'survival.recovered').map(h => h.payload.code),
        { timeout: 180_000, intervals: [500] }).toEqual(expect.arrayContaining([expect.stringMatching(/^(complete|arrived-at-farm)$/)]));
    });
    await test.step("L: the add-on asks its own fight's verdict", async () => {
      // The character half reads its own fight's verdict and the fight fact at each notice it hears.
      const reads = (await heardW(P, from[P]!)).map(h => h.reads);
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every(r => typeof r.fighting === 'boolean'), 'the fight fact answers').toBe(true);
    });
    await test.step("L: the player's release ends the escape", async () => {
      // The player's Escape press starts a party escape and Resume releases it.
      const at = Date.now();
      const state = await escapeRead(live);
      await live.post('/escape', { shown: state.button });
      await expect.poll(async () => of(await heardC(live, at), 'survival.escapeStarted').map(h => h.payload.by), { timeout: 30_000, intervals: [250] }).toContainEqual('player');
      const held = await escapeRead(live);
      await live.post('/escape/resume', { shown: held.button });
      await expect.poll(async () => of(await heardC(live, at), 'survival.escapeEnded').map(h => [h.payload.stage, h.payload.by]),
        { timeout: 60_000, intervals: [250] }).toContainEqual(['released', 'player']);
    });
    // Every coordinator notice of the run names its by.
    const all = await heardC(live, since);
    expect(all.filter(h => !h.payload.by).map(h => h.hook), 'every notice names its by').toEqual([]);
  } finally {
    await info.attach('survival-hooks', { body: JSON.stringify({ rows, coordinator: await heardC(live, since).catch(() => []) }), contentType: 'application/json' });
    await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
