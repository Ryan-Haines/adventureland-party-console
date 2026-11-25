import {expect, type LiveGame} from '../live-fixtures';
import type {Route} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {warrior as W, priest as P, world, profile, party, quests, start, hunt, observed, quantity} from '../game/hunt-lifecycle';
import {killNativeCharacter} from '../hunt-interruption-helpers';
import {oneCall, chargesHold} from '../call-budget-rows';

// W19 Hunt death and respawn (test-windows DESIGN.md 2.2 W19). One play with death threshold 2:
// the warrior holds a goo quest of 10000 and the priest a planted armadillo quest of 2; the party
// Hunts goo; a planted Rime Djinn kills the warrior; the coordinator restarts while it is dead;
// it respawns and the goo Hunt goes on in the same cycle; the warrior dies again, which crosses
// the threshold; the coordinator restarts with the warrior's catalog reports dropped; the goo is
// blacklisted and the Hunt hands the mission to the priest's armadillo quest; the player takes
// goo off the blacklist; the priest turns in at Daisy and the next cycle farms goo again.
// The priest's armadillo quest is H4's plant (live-hunt-combat.spec.ts:55). The first death leaves
// it unused, since threshold 2 keeps the leader's goo mission (H28's same-cycle read); the second
// death blacklists goo, which is the failed leader quest H4 hands over. The goo comes off the
// blacklist once the handoff shows, so the cycle after the priest's turn-in farms goo for H28's
// last read.
// Failure modes: H27, a death is not counted once, travel starts while a member is dead, or a
// restart loses the count; H28, the second death does not reach the blacklist, the restart keeps
// a catalog the client never sent, or goo does not farm again once it leaves the blacklist; H4,
// the failed leader quest does not yield to the follower's quest or the follower is not rewarded.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};
const deathThreshold: number = 2;
const t41: {respawn?: any} = {};

async function huntDeathPlay({live, info}: LiveWorld) {
  await party(live);
  await live.post('/hunt-settings', { character: W, deathThreshold });
  await quests(live, info, { [W]: { count: 10000 } });
  // H4's follower quest: the priest's armadillo quest the failed leader quest yields to.
  await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});p.s.monsterhunt={sn:region+' '+server_name,id:'armadillo',c:2,ms:1800000};resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[P]?.monsterHunt?.id,{timeout:30000}).toBe('armadillo');
  const setup = {before: await observed(live)};
  await start(live);
  await expect.poll(async () => profile(await live.state()).monsterHunt?.stage, { timeout: 240_000 }).toBe('farming');
  await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 60_000 }).toBeLessThan(10000);
  const cycle = profile(await live.state()).monsterHunt.cycleId;
  reads.cycle = cycle;
  let restored: any;

  // The first death, the restart while dead, and the respawn (H27).
  await step('H27', async () => {
    // Inject the failure, never the recovery: the real server death function emits
    // its normal events; maintained character code must respawn and resume combat.
    const death = await killNativeCharacter(live, W);
    reads.death = death;
    expect(death.rip).toBeTruthy();
    await expect.poll(async()=>(await observed(live))[W].rip,{timeout:15000}).toBe(true);
    await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.deaths || 0, { timeout: 30_000 }).toBe(1);
    const deadState = await live.state();
    expect((await world(live))[W].rip, 'Verify the movement guard while the native character is still dead').toBe(true);
    expect(deadState.activeConvoy, 'No travel may be dispatched while a Hunt participant is dead').toBeFalsy();
    reads.recordedDeath = { hunt: profile(deadState).monsterHunt, failures: profile(deadState).huntFailures, blacklist: profile(deadState).huntBlacklist };
    await live.restartCoordinator();
    await expect.poll(async () => !(await world(live))[W].rip, { timeout: 120_000 }).toBe(true);
    await expect.poll(async()=>{const p=(await observed(live))[W];return !p.rip&&p.hp>0;},{timeout:120000}).toBe(true);
    restored = profile(await live.state());
    reads.restored = restored;
    expect(restored.huntFailures.goo.deaths).toBe(1);
    expect(!!restored.huntBlacklist?.goo).toBe(deathThreshold === 1);
  });
  // Under threshold 2 the first death keeps the cycle, and goo farms again (H28).
  await step('H28', async () => {
    expect(restored.monsterHunt.cycleId).toBe(cycle);
    const remaining = (await world(live))[W].quest.c;
    reads.remaining = remaining;
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(remaining);
    expect((await world(live))[W].quest.id).toBe('goo');
    expect(profile(await live.state()).huntFailures.goo.deaths).toBe(1);
  });

  // The second death crosses the threshold; the restart runs with the warrior's catalog reports
  // dropped, so the restored coordinator holds no catalog until the client sends one again.
  const context = live.clients[W].page.context();
  let droppedCatalogs = 0;
  const dropCatalog = async (route: Route) => {
    if (route.request().postDataJSON()?.monsterChoices) { droppedCatalogs++; await route.abort('connectionreset'); }
    else await route.fallback();
  };
  try {
    await step('H28', async () => {
      const secondDeath = await killNativeCharacter(live, W);
      expect(secondDeath.rip).toBeTruthy();
      // T41's CB4 respawn reading (call-budget-rows.ts row B, SV46): the dead warrior sends nothing
      // until its respawn, so its socket is quiet, and the one respawn goes through survival's hook,
      // which the death recovery also asks. The budget books it at its price and the server charges
      // the same. The threshold count below reads the coordinator's record, which the respawn keeps.
      await step('T41', async () => { t41.respawn = await oneCall(live, W, 'respawn (survival)', 'respawn',
        `globalThis.__partySurvival.death.respawnWhenAllowed('w19').then(()=>true,()=>false)`, '!character.rip'); });
      await expect.poll(async () => profile(await live.state()).huntFailures?.goo?.deaths || 0, { timeout: 30_000 }).toBe(2);
      await context.route('**/party-api/status', dropCatalog);
      await live.restartCoordinator();
      await expect.poll(async () => !(await world(live))[W].rip, { timeout: 120_000 }).toBe(true);
      const crossed = profile(await live.state());
      expect(crossed.huntFailures.goo.deaths).toBe(2);
      expect(crossed.huntBlacklist.goo.deaths).toBe(2);
      reads.thresholdCrossing = { secondDeath, failures: crossed.huntFailures, blacklist: crossed.huntBlacklist };
      await expect.poll(()=>droppedCatalogs,{timeout:15_000}).toBeGreaterThan(0);
      expect((await live.state(true)).monsterChoices||[]).toHaveLength(0);
    });
  } finally {
    await context.unroute('**/party-api/status', dropCatalog);
  }

  // The blacklisted goo is the failed leader quest, so the mission goes to the priest's
  // armadillo quest (H4). The player then takes goo off the blacklist.
  await step('H4', async () => {
    await expect.poll(async()=>{const h=hunt(await live.state());return h?.owner===P&&h.target==='armadillo';},{timeout:150000,message:'Failed leader quest must yield to the eligible follower quest'}).toBe(true);
  });
  await live.post('/hunt-blacklist', { character: W, action: 'remove', monsterId: 'goo' });
  await step('H28', async () => { expect(profile(await live.state()).huntBlacklist?.goo).toBeFalsy(); });
  const afterSecondRespawn = (await world(live))[W].quest.c;
  reads.afterSecondRespawn = afterSecondRespawn;
  await step('H4', async () => {
    await expect.poll(async()=>quantity((await observed(live))[P].items,'monstertoken'),{timeout:240000}).toBe(quantity(setup.before[P].items,'monstertoken')+1);
  });
  // After the priest's turn-in the next cycle takes the leader's goo quest again. The old bound
  // of 120 s covered a walk from the town respawn to the goo field and a kill; Daisy stands in
  // the same town, so it covers the walk from the turn-in.
  await step('H28', async () => {
    await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 120_000 }).toBeLessThan(afterSecondRespawn);
  });
  await live.post('/farming-mode', {character: W, mode: 'default'});
}

const own = (id: string) => ({
  owner: 'hunting', behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W19', name: 'Hunt death and respawn',
  // The old tests' bounds: H28 480 s (live-hunt-lifecycle.spec.ts:327) plus H4's handoff and
  // token waits, 150 s and 240 s (live-hunt-combat.spec.ts:65-66).
  timeoutMs: 870_000,
  play: huntDeathPlay,
  observers: [{id: 'H4', ...own('H4')}, {id: 'H27', ...own('H27')}, {id: 'H28', ...own('H28')},
    {id: 'T41', owner: 'calls', behaviours: [], start() {}, reads: () => ({failed: failed.T41 ?? null, respawn: t41.respawn ?? null}), verdict() {
      expect(failed.T41, 'T41: every step of the play passes').toBeUndefined();
      expect(t41.respawn?.server, 'CB4: the respawn reached the server').toBeGreaterThan(0);
      chargesHold([t41.respawn]);
    }}],
});
