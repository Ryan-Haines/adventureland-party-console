import {expect, type LiveGame} from '../live-fixtures';
import type {TestInfo} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {warrior, priest, fighters, world, tokens, profile, hunt, observed, quantity, location, party, quests, start, point, arrived, rejected} from '../game/hunt-lifecycle';
import {bandsRead} from '../call-budget-rows';

// W14 Goo Hunt with player commands and a restart (test-windows DESIGN.md 2.2 W14). One play on
// the Main goo field, three Hunt cycles:
// - The priest saves a Hunt preference with no Hunt and the merchant's Hunt is refused (T23). Both
//   quests are seeded 4 goos; the Hunt starts, the player clears the backup focus, unfollows the
//   priest on the walk to the field and follows it again (T23). The party's kills finish both
//   quests, and the coordinator restarts on the walk to Daisy (C9). Both hand in once (C9, H20,
//   T23); the player switches the combat mode Scatter and Default under the Hunt and then picks
//   the Scatter mode, which ends it (T23).
// - Both quests are seeded 1000; the Hunt kills, the player turns it off and sends the party 250
//   the other way, and the coordinator restarts (C10, H24, with C9 and H20's second reads); the
//   party arrives with no Hunt, the player turns Hunt on and a new cycle kills toward the same
//   quest (H24).
// - Both quests are seeded to expire in 20 s; Hunt goes on, the quest expires and the party takes
//   a fresh quest at Daisy (H19).
// Failure modes: T23, a follower's saved preference starts a Hunt, the merchant Hunts, clearing
// the focus ends the cycle, follow off stops the walk or keeps the priest in it, follow on gives no
// party task, a combat mode ends the Hunt, or Scatter keeps it; CB12, a party call asks a band
// other than job; C9 and H20, a restart pays a reward twice or drops it; C10 and H24, a Hunt turned
// off resumes after the restart, the manual walk does not arrive, or Hunt on loses the quest;
// H19, an expired quest gets no fresh Daisy quest or pays a token.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const W = warrior, P = priest, lifecycleWorld = world;
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};

// T23 before the Hunt (hunt-rows.ts controlsRow): the follower's saved Hunt mode starts nothing
// and the merchant's is refused.
async function preferences(live: LiveGame) {
  const destination = await location(live);
  const backup = { monsterFocus: ['goo'], location: destination };
  await live.post('/farming-mode', { character: P, mode: 'hunt', backup });
  expect(profile(await live.state(), P).monsterHunt).toBeFalsy();
  expect(profile(await live.state(), warrior).monsterHunt).toBeFalsy();
  const merchant = await rejected(live, '/farming-mode', { character: 'E2EMerchant', mode: 'hunt', backup });
  expect(merchant.status).toBe(409);
  reads.T23 = {merchant};
}

// T23 on the walk to the field: follow off for the priest mid-walk applies at once. The walk goes
// on for the warrior, and in the same reply the priest has its own group's task; follow on again
// gives it the party's live task.
async function followToggle(live: LiveGame) {
  await expect.poll(async () => { const c = (await live.state()).activeConvoy; return !!c && [warrior, priest].every(n => c.participants.includes(n)); },
    { timeout: 120_000, message: 'precondition: the Hunt walks both fighters' }).toBe(true);
  const walk = (await live.state()).activeConvoy.id;
  await live.post('/formation', { character: P, follow: false });
  const split = await live.state(), groups = (await live.tasks()).groups;
  expect(split.activeConvoy?.id, 'the walk goes on for the warrior').toBe(walk);
  expect(split.activeConvoy.participants, 'only the priest leaves the walk').toEqual([W]);
  expect(groups.find((g: any) => g.id === `solo:${P}`)?.members, 'the priest has its own group at once').toEqual([P]);
  await live.post('/formation', { character: P, follow: true });
  const joined = (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`);
  expect(joined?.members, 'the priest joins the party at once').toContain(P);
  await expect.poll(async () => {
    const owner = await live.clients[P].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task&&t.task.owner;})()');
    return !!owner && owner === (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`)?.live?.owner;
  }, { timeout: 30_000, message: 'the joined priest is assigned the party live task' }).toBe(true);
  reads.T23 = {...reads.T23, walk};
}

// T23 after the hand-in: the combat modes keep the Hunt and the Scatter mode ends it.
async function combatModes(live: LiveGame, before: any) {
  await expect.poll(async () => tokens((await lifecycleWorld(live))[W]), { timeout: 180_000 }).toBe(tokens(before[W]) + 1);
  // The game pays the token before the coordinator's Daisy step sees the claim done and ends the
  // hand-in task. A live rerun ended the hand-in half a second after the Scatter post.
  const huntTask = async () => (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`);
  await expect.poll(async () => profile(await live.state()).monsterHunt?.turnIn?.phase === 'complete' && !/:hunt-turn-in$/.test(String((await huntTask())?.live?.owner)),
    { timeout: 60_000, message: 'precondition: the hand-in task has ended' }).toBe(true);
  // With the Hunt task live, Scatter and then Default reach every member's client and the reply's
  // party mode, and the Hunt cycle keeps the group. The Hunt's task kind follows its stage
  // (`hunt:<cycle>:<kind>`), so the owner may move between the cycle's own kinds; any other end of
  // the cycle's task fails.
  const huntOwner = String((await huntTask())?.live?.owner);
  expect(huntOwner, 'precondition: the Hunt task is live').toMatch(/^hunt:[^:]+:/);
  const huntCycle = huntOwner.slice(0, huntOwner.lastIndexOf(':') + 1);
  // The mission and the hand-in end each other with `hunt-ended` as the Hunt moves between its
  // kinds, so only ends after this point can come from the combat mode changes.
  const seenSeq = Math.max(0, ...((await huntTask())?.ring ?? []).map((e: any) => Number(e.seq) || 0));
  for (const combatMode of ['scatter', 'default']) {
    await live.post('/farming-mode', { character: W, combatMode });
    for (const name of [W, P]) await expect.poll(() => live.clients[name].run('globalThis.partyHunting.farm.mode()'),
      { timeout: 15_000, message: `${combatMode} reaches ${name} under Hunt` }).toBe(combatMode);
    await expect.poll(async () => profile(await live.state()).partyFarmingMode, { timeout: 15_000, message: `the reply's party mode is ${combatMode}` }).toBe(combatMode);
    const task = await huntTask();
    expect(String(task?.live?.owner).startsWith(huntCycle), `the Hunt cycle keeps the group under ${combatMode}: ${task?.live?.owner}`).toBe(true);
    expect(task?.ring.filter((e: any) => e.seq > seenSeq && e.decision === 'ended' && String(e.owner).startsWith(huntCycle) &&
      !['replaced:hunt-mission', 'replaced:hunt-turn-in', 'replaced:farming'].includes(e.code)), 'the Hunt task did not end').toEqual([]);
  }
  // A target mode change ends the old entry's task `replaced:<kind>`. The single `mode` Scatter is
  // the combat mode Scatter with target Farming, so it ends the Hunt; ending on Default keeps the
  // Scatter poll below a real change.
  await live.post('/farming-mode', { character: W, mode: 'scatter' });
  await expect.poll(() => live.clients[P].run('globalThis.partyHunting.farm.mode()'), { timeout: 15_000, message: 'the combat mode reaches the priest' }).toBe('scatter');
  await expect.poll(async () => (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`)?.ring.some((e: any) =>
    e.decision === 'ended' && String(e.owner).startsWith('hunt:') && e.code === 'replaced:farming'), { timeout: 120_000, message: 'the Hunt task ends replaced by Farming' }).toBe(true);
  // CB12: every party call of the game party's members asks the job band, counted on each socket
  // since its record began.
  const bands = Object.fromEntries(await Promise.all([W, P, 'E2EMerchant'].map(async (n) => [n, (await bandsRead(live, n)).view?.answers ?? null])));
  reads.CB12 = Object.fromEntries(Object.entries(bands).map(([n, a]: [string, any]) => [n, { survival: a?.survival?.party ?? null, job: a?.job?.party ?? null, background: a?.background?.party ?? null }]));
  for (const [n, a] of Object.entries(bands) as [string, any][]) {
    expect(a, `CB12: ${n}'s budget answers`).toBeTruthy();
    expect([a.survival.party ?? null, a.background.party ?? null], `CB12: ${n}'s party calls ask no band but job`).toEqual([null, null]);
  }
  expect(Object.values(bands).reduce((sum: number, a: any) => sum + (a?.job?.party?.send ?? 0), 0), 'CB12: party calls ask the job band').toBeGreaterThan(0);
}

// C9 (live-game.spec.ts): one token across the restart on the walk to Daisy.
async function onceAcrossRestart(live: LiveGame, before: any) {
  const tokens = quantity(before[W].items, 'monstertoken');
  await expect.poll(async () => quantity((await observed(live))[W].items, 'monstertoken'), { timeout: 120_000 }).toBe(tokens+1);
}
// C9's second read, after the Hunt is off and the coordinator restarted again.
async function stillOnce(live: LiveGame, before: any) {
  const tokens = quantity(before[W].items, 'monstertoken');
  expect(quantity((await observed(live))[W].items, 'monstertoken')).toBe(tokens+1);
}

async function commandsPlay(live: LiveGame, info: TestInfo) {
  await party(live);
  await step('T23', () => preferences(live));
  // The first cycle: T23's 4 goos each, which the field's kills finish for both owners.
  await quests(live, info, { [W]: { count: 4 }, [P]: { count: 4 } });
  const before = await lifecycleWorld(live), observedBefore = await observed(live);
  await start(live);
  const cycle = profile(await live.state()).monsterHunt.cycleId;
  await step('T23', async () => {
    await live.post('/focus', { character: W, monsterFocus: [] });
    expect(profile(await live.state()).monsterHunt.cycleId).toBe(cycle);
  });
  await step('T23', () => followToggle(live));
  // C9's restart comes once both quests are done, while the party heads to Daisy. The bound is
  // T23's 180 s token poll (hunt-rows.ts:47), which this wait is the first part of.
  await expect.poll(async () => { const current = await lifecycleWorld(live); return fighters.every(n => current[n].quest?.c === 0); },
    { timeout: 180_000, message: 'the field kills finish both quests' }).toBe(true);
  await live.restartCoordinator();
  await step('C9', () => onceAcrossRestart(live, observedBefore));
  await step('H20', () => expect.poll(async () => { const current = await world(live); return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1); }, { timeout: 180_000 }).toBe(true));
  await step('T23', () => combatModes(live, before));
  // The second cycle: H24's 1000 goos each. The Scatter mode left the combat mode on Scatter, so
  // the player sets it back to Default first.
  await live.post('/farming-mode', { character: W, combatMode: 'default' });
  await quests(live, info, { [W]: { count: 1000 }, [P]: { count: 1000 } });
  await start(live);
  await step('H24', () => expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(1000));
  const firstCycle = profile(await live.state()).monsterHunt?.cycleId;
  await step('C10', () => expect.poll(async () => !!hunt(await live.state())).toBe(true));
  await live.post('/farming-mode', { character: W, mode: 'default' });
  const destination = await point(live, W, 250, -1);
  await live.post('/travel', destination);
  await live.restartCoordinator();
  await step('C10', async () => {
    await arrived(live, [W, P], destination);
    expect(hunt(await live.state())).toBeFalsy();
  });
  await step('H24', async () => expect(profile(await live.state()).monsterHunt).toBeFalsy());
  await step('C9', () => stillOnce(live, observedBefore));
  await step('H20', async () => {
    const after = await world(live);
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
  });
  const remaining = (await world(live))[W].quest.c;
  await start(live);
  await step('H24', async () => {
    await expect.poll(async () => { const cycle = profile(await live.state()).monsterHunt?.cycleId; return !!cycle && cycle !== firstCycle; }).toBe(true);
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 90_000 }).toBeLessThan(remaining);
    expect((await world(live))[W].quest.id).toBe('goo');
  });
  reads.H24 = {firstCycle, remaining};
  await live.post('/farming-mode', { character: W, mode: 'default' });
  await expiry(live, info);
}

// The third cycle: H19's quests expire in 20 s. The expiry count and the blacklist are unit rows
// (DESIGN.md 4.3 H19); the play only waits for the expiry the game records.
async function expiry(live: LiveGame, info: TestInfo) {
  await quests(live, info, { [W]: { count: 10000, ms: 20000 }, [P]: { count: 10000, ms: 20000 } });
  const before = await world(live);
  await start(live);
  // The bound is H19's own expiry poll (live-hunt-lifecycle.spec.ts:164).
  await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.expirations || 0,
    { timeout: 90_000, message: 'the seeded goo quest expires' }).toBeGreaterThan(0);
  await step('H19', async () => {
    await expect.poll(async () => (await world(live))[W].quest?.ms || 0, { timeout: 150_000 }).toBeGreaterThan(120000);
    expect(tokens((await world(live))[W])).toBe(tokens(before[W]));
    reads.H19 = (await world(live))[W].quest;
  });
}

const own = (id: string, behaviours: string[]) => ({
  owner: 'hunting', behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null, ...(id === 'T23' ? {CB12: reads.CB12 ?? null} : {})}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W14', name: 'Goo Hunt with player commands and a restart',
  // The old tests' bounds summed: 300 s each for H19, H20 and H24 (live-hunt-lifecycle.spec.ts:8),
  // 240 s each for C9 and C10 (live-game.spec.ts:119), and T23's polls 120 + 30 + 180 + 60 + 4 x 15
  // + 15 + 120 = 585 s (hunt-rows.ts:32-79) = 2,265 s.
  timeoutMs: 2_265_000,
  async play({live, info}: LiveWorld) { await commandsPlay(live, info); },
  observers: [
    {id: 'T23', ...own('T23', ['GRP-001', 'GRP-003', 'GRP-004', 'GRP-006', 'GRP-007', 'GRP-008', 'GRP-035', 'GRP-044', 'GRP-045', 'GRP-046', 'TRN-032', 'EVT-062', 'HNT-001', 'HNT-039', 'HNT-041', 'HNT-136', 'HNT-143', 'SET-025', 'ADD-008', 'ADD-017'])},
    {id: 'C9', ...own('C9', ['HNT-111', 'HNT-137'])}, {id: 'C10', ...own('C10', ['GRP-025', 'HNT-111'])},
    {id: 'H19', ...own('H19', ['HNT-014'])}, {id: 'H20', ...own('H20', ['HNT-012'])}, {id: 'H24', ...own('H24', ['HNT-001', 'HNT-010'])},
  ],
});
