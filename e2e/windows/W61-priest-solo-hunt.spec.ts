import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {warrior as W, priest as P, world, tokens, profile, quests, start, artifact} from '../game/hunt-lifecycle';

// W61 Priest-alone goo Hunt (test-windows DESIGN.md 2.2 W61, 2.3: the priest Hunts alone, and
// every other Hunt window has both fighters in it). Play: the warrior leads with no follower, the
// priest walks to Main (-32, 719), takes a one-goo quest, Hunts it alone and turns in at Daisy
// while the warrior stays out of the Hunt.
// The old test's per-owner deathThreshold reads (live-hunt-lifecycle.spec.ts:208-212) move to a
// unit row (DESIGN.md 4.3 H23), so the play writes no Hunt setting.
// Failure modes: the priest's Hunt starts the warrior's controller, gets no group of its own, or
// ends with no kill or token; the warrior gains a Hunt, a quest or a token.
// The check's assertions are the play's own steps: a failed step ends the play and the runner
// marks H23 not observed, with that step's message.
// Every old spec this window cites is at 21fe30a2b.
async function priestSoloPlay({live, info}: LiveWorld) {
  await live.post('/formation', { leader: W });
  // CI reached the spawn without a travel kill and then had no authorized
  // target. Native setup walking makes that boundary repeatable locally.
  await live.clients[P].run("smart_move({map:'main',x:-32,y:719})");
  await quests(live, info, { [P]: { count: 1 } });
  const before = await world(live);
  await start(live, P);
  await expect.poll(async () => (await live.clients[P].run('globalThis.__partyGroupedCombat'))?.members,
    { timeout: 25_000, message: 'The independent priest must receive its own singleton combat group' }).toEqual([P]);
  await expect.poll(async () => tokens((await world(live))[P]), { timeout: 210_000 }).toBe(tokens(before[P]) + 1);
  expect((await live.clients[P].events()).some(event => event.event === 'hit' && event.data?.kill)).toBe(true);
  expect(profile(await live.state(), W).monsterHunt).toBeFalsy();
  expect((await world(live))[W].quest).toBeNull();
  expect(tokens((await world(live))[W])).toBe(tokens(before[W]));
  await artifact(live, info, 'independent-solo-controller', { before });
}

liveWindow({
  id: 'W61', name: 'Priest-alone goo Hunt',
  // The old test's bound: 300 s (live-hunt-lifecycle.spec.ts:8).
  timeoutMs: 300_000,
  play: priestSoloPlay,
  observers: [{id: 'H23', owner: 'hunting', behaviours: [], start() {}, verdict() {}}],
});
