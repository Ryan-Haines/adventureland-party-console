import {expect, type LiveGame} from './live-fixtures';
import type {Request, TestInfo} from '@playwright/test';
import {warrior as W, priest as P, fighters, observed, evidence, point, arrived, party, world, tokens, profile, quests, start, artifact, type Location} from './game/hunt-lifecycle';

// The two walks of play window W11 (test-windows DESIGN.md 2.2): a 450 convoy on Main whose priest
// client drops and reconnects mid-walk (C4), then a goo Hunt whose priest client drops and
// reconnects on the mission walk (H39). Each play keeps its readings in a record, and each
// verdict holds the expects its old test made after the fault. The play's own waits (the priest
// walking before the drop, the Hunt on its mission walk) stay in the play: without them there is
// no fault to observe.

export type ConvoyDrop = {destination?: Location; arrival?: unknown};
export async function convoyDropPlay(live: LiveGame, info: TestInfo, record: ConvoyDrop) {
  await party(live);
  const before = await observed(live), destination = record.destination = await point(live, W, 450);
  await live.post('/travel', destination);
  await expect.poll(async () => Math.hypot((await observed(live))[P].x-before[P].x, (await observed(live))[P].y-before[P].y), { timeout: 40_000 }).toBeGreaterThan(30);
  await evidence(live, info, 'before-native-connection-loss', { destination });
  await live.reconnectClient(P);
  // The arrival is the check's own reading, so a walk that never ends fails C4 and leaves the
  // Hunt walk to run and report.
  record.arrival = await arrived(live, [W, P], destination).then(() => true, error => error);
  expect((await live.clients[P].snapshot()).name).toBe(P);
  await evidence(live, info, 'native-reconnect-arrival', { destination });
}
export function convoyDropVerdict(record: ConvoyDrop) {
  if (record.arrival !== true) throw record.arrival ?? Error('the convoy walk never ran');
}

// Disconnected characters do not receive native party kill credit, so the follower's quest starts
// complete: the Hunt tests ownership recovery and both turn-ins, not credit for kills while offline.
const questCount = 12;
export type HuntDrop = {before?: any; after?: any; previousRuntime?: unknown; beforeReconnect?: any;
  runtimeChanged?: unknown; questDropped?: unknown; rewarded?: unknown; rendezvousReports: {at: number; report: any}[]};
export const huntDropRecord = (): HuntDrop => ({rendezvousReports: []});
export async function huntDropPlay(live: LiveGame, info: TestInfo, record: HuntDrop) {
  await party(live);
  await quests(live, info, { [W]: { count: questCount }, [P]: { count: 0 } });
  const before = record.before = await world(live);
  const context = live.clients[W].page.context();
  const inspectStatus = (request: Request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/party-api/status')) return;
    const body = request.postDataJSON();
    if (body.name === P && body.convoyNavigation?.phase === 'rendezvous') record.rendezvousReports.push({ at: Date.now(), report: body.convoyNavigation });
  };
  context.on('request', inspectStatus);
  try {
    await start(live);
    await expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy();
    const cycle = profile(await live.state()).monsterHunt.cycleId;
    let travelling: unknown;
    await expect.poll(async () => {
      const state = await live.state(), hunt = profile(state).monsterHunt, convoy = profile(state).activeConvoy;
      const member = state.characters[P], report = member?.convoyNavigation;
      const owned = hunt?.cycleId === cycle && hunt.stage === 'mission-travel' && convoy?.id === hunt.convoyId &&
        convoy.phase === 'travel' && member.moving && report?.phase === 'travelling' && report.id === convoy.id &&
        report.epoch === convoy.epoch && report.runtimeId === member.combatSelection?.runtimeId;
      if (owned) travelling = { at: Date.now(), convoy: convoy.id, epoch: convoy.epoch, report };
      return !!owned;
    }, {timeout:120_000,message:'Reconnect must interrupt the follower’s current native Hunt route'}).toBe(true);
    record.beforeReconnect = await world(live);
    record.previousRuntime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
    await live.reconnectClient(P);
    expect((await live.clients[P].snapshot()).name).toBe(P);
    const previous = record.previousRuntime;
    record.runtimeChanged = await expect.poll(async () => {
      const runtime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
      return !!runtime && runtime !== previous;
    }, {timeout:30_000,message:'The coordinator must observe the reconnected follower runtime'}).toBe(true).then(() => true, error => error);
    record.questDropped = await expect.poll(async () => (await world(live))[W].quest?.c, { timeout: 120_000 }).toBeLessThan(questCount).then(() => true, error => error);
    record.rewarded = await expect.poll(async () => {
      const current = await world(live);
      return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
    }, { timeout: 180_000 }).toBe(true).then(() => true, error => error);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    record.after = await world(live);
    await artifact(live, info, 'hunt-native-communication-recovery', { cycle, before, travelling, rendezvousReports: record.rendezvousReports });
  } finally { context.off('request', inspectStatus); }
}
export function huntDropVerdict(record: HuntDrop) {
  const {before, after, beforeReconnect, previousRuntime, rendezvousReports} = record;
  expect(previousRuntime).toBeTruthy();
  expect(beforeReconnect[W].quest?.c, 'Disconnect must interrupt an unfinished native Hunt').toBeGreaterThan(0);
  for (const reading of [record.runtimeChanged, record.questDropped, record.rewarded]) if (reading !== true) throw reading ?? Error('the Hunt walk ended before this reading');
  // A follower still at the group can recover directly without a rendezvous
  // leg. When it does need that leg, its actual reports must identify it.
  expect(rendezvousReports.every((entry: any) => entry.report.routeVersion > 0), 'Rendezvous must publish its issued route version before awaiting native travel').toBe(true);
  for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
}
