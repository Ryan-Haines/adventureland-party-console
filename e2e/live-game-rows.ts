import { expect } from './live-fixtures';
import type { LiveGame } from './live-fixtures';
import type { Route, TestInfo } from '@playwright/test';
import type { Row } from './scenario-table';
import { seedSmallGoobrawl } from './game/event-scenario';
import { taskSeq, taskTrail, ringFrom, convoyWatch, reportTick } from './task-records';
import { warrior as W, priest as P, quantity, observed, evidence, point, arrived, party, seedQuest, start, hunt } from './game/hunt-lifecycle';

// Rows moved from live-game.spec.ts into the default fixture's table (01 step 8, the test cut):
// the convoy interruption and the Goobrawl variants start from the default fixture, and each
// Goobrawl row seeds its own arena.

export async function convoyInterruptionRow(live: LiveGame, info: TestInfo) {
  await party(live);
  const before = await observed(live), destination = await point(live, W, 450);
  await live.post('/travel', destination);
  await expect.poll(async () => Math.hypot((await observed(live))[W].x-before[W].x, (await observed(live))[W].y-before[W].y), { timeout: 40_000 }).toBeGreaterThan(40);
  // The player's trip is the party's manual task before the restart.
  await expect.poll(async () => (await taskTrail(live, `party:${W}`, 0)).live, { timeout: 30_000, message: 'The trip must be the manual task of the party' }).toBe('manual');
  await evidence(live, info, 'before-convoy-restart', { destination });
  await live.restartCoordinator();
  await arrived(live, [W, P], destination);
  // The saved trip is the manual task again after the restart, and it ends only
  // once its walk arrives; the farming it held then takes the party back.
  await expect.poll(async () => (await taskTrail(live, `party:${W}`, 0)).trail.some(([d, k, c]) => d === 'ended' && k === 'manual' && c === 'arrived'),
    { timeout: 30_000, message: 'The restored trip must end arrived' }).toBe(true);
  const tasks = await taskTrail(live, `party:${W}`, 0);
  expect(tasks.trail.filter(([d, k]) => k === 'manual' && (d === 'granted' || d === 'resumed')).length, 'the trip is granted once after the restart').toBe(1);
  expect(tasks.trail.some(([d, k, c]) => d === 'ended' && k === 'manual' && c !== 'arrived'), 'the trip ends only by arriving').toBe(false);
  await evidence(live, info, 'recovered-convoy-arrival', { destination, tasks });
}

// The event's tasks against the Hunt. The finished
// variant starts the event before a finished Hunt's hand-in, so the event outranks the hand-in.
export const goobrawlRows: Row[] = (['plain', 'restart', 'finished'] as const).map(variant => {
  const restart = variant === 'restart';
  return [`Goobrawl interrupts Hunt and real event evacuation resumes it${restart ? ' across coordinator restart' : variant === 'finished' ? ' with a finished Hunt at the event start' : ''}`, async (live: LiveGame, info: TestInfo) => {
    const encounter = await seedSmallGoobrawl(live);
    await info.attach('goobrawl-initial-encounter', { body: JSON.stringify(encounter), contentType: 'application/json' });
    await party(live);
    const walks = convoyWatch(live);
    try {
    const group = `party:${W}`, tasksFrom = await taskSeq(live, group);
    await seedQuest(live, 'goo', variant === 'finished' ? 0 : 30);
    const tokensAtStart = quantity((await observed(live))[W].items, 'monstertoken');
    if (variant === 'finished') {
      // The event is live before the hand-in walk starts, so the party goes to the event first.
      await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
      await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    }
    await start(live);
    // Through the staging lead and before the walk no member is at the event, so no
    // attendance task holds the party.
    const before = hunt(await live.state());
    expect((await live.tasks()).presence?.[W] ?? null, 'no presence before the event walk').toBeNull();
    if (variant !== 'finished') {
      await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
      await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    }
    // The walk starts and the attendance task takes the party within one coordinator tick.
    // The poll keeps the first presence a fighter shows for the event: its `since` is the trip's
    // start, when the coordinator admitted the walk (http/hunt-control.ts `depart`).
    let trip: any;
    await expect.poll(async () => { const read = await live.tasks();
      trip ??= [W, P].map(name => read.presence?.[name]).find((p: any) => p?.event === 'goobrawl');
      return read.groups.find((g: any) => g.id === group)?.ring.some((e: any) => e.seq > tasksFrom && e.decision === 'granted' && e.kind === 'event-attendance'); },
      { timeout: 90_000, intervals: [100], message: 'The event walk must start the attendance task' }).toBe(true);
    // The Hunt is suspended no later than one coordinator tick after the event walk shows.
    // The walk starts when the coordinator admits the member's trip (http/hunt-control.ts
    // `depart`), the time its presence names (`since`); Goobrawl's walk is the game's own join,
    // so no convoy marks it. Presence is computed once per full report and the
    // tick reads the previous report's (application.ts `askProviders`), so the walk shows at the
    // member's next report and the owner suspends the Hunt at the tick after: at most two report
    // intervals. Both times are on the coordinator's clock.
    if (variant !== 'finished') {
      await expect.poll(async () => { const read = await live.tasks(); return trip ??= [W, P].map(name => read.presence?.[name]).find((p: any) => p?.event === 'goobrawl'); },
        { timeout: 30_000, intervals: [100], message: 'precondition: a fighter is on its trip to the event' }).toBeDefined();
      const suspended = (await ringFrom(live, group, tasksFrom)).find(e => e.decision === 'suspended' && e.kind === 'hunt-mission' && e.by === 'event-attendance');
      const tick = await reportTick(live);
      await info.attach('f29-event-walk', { body: JSON.stringify({ trip, suspended, tick }), contentType: 'application/json' });
      expect(suspended, 'the event attendance suspends the Hunt').toBeDefined();
      expect(suspended!.at - trip.since, 'the Hunt is suspended within one coordinator tick of the event walk showing').toBeLessThanOrEqual(2 * tick);
    }
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    // The party never hands in a finished Hunt on the way to the event.
    if (variant === 'finished') expect(quantity((await observed(live))[W].items, 'monstertoken'), 'no hand-in before the event').toBe(tokensAtStart);
    let survivors: {id:string;type:string;hp:number}[]=[];
    await expect.poll(async()=>{
      survivors=await live.admin(`output=Object.values(instances.goobrawl.monsters).map(m=>({id:m.id,type:m.type,hp:m.hp}))`);
      return survivors.length;
    },{timeout:30_000,intervals:[100,250],message:'Native arena spawning must provide a real combat encounter after entry'}).toBeGreaterThan(0);
    await evidence(live, info, 'inside-live-goobrawl');
    if (restart) {
      await live.restartCoordinator();
      // A reload keeps the attending members' presence from the live occurrence.
      await expect.poll(async () => (await live.tasks()).presence?.[W]?.phase ?? null, { timeout: 30_000 }).toBe('attending');
      // The tasks and the walk the restarted coordinator rebuilt, for a run that fails after it.
      await info.attach('goobrawl-after-restart', { body: JSON.stringify({ tasks: await taskTrail(live, group, 0), convoy: (await live.state()).activeConvoy ?? null, hunt: hunt(await live.state()) }), contentType: 'application/json' });
    }
    // The party stays at the event until it ends.
    expect((await taskTrail(live, group, restart ? 0 : tasksFrom)).trail.some(([d, k]) => d === 'ended' && k === 'event-attendance'), 'the party left the event early').toBe(false);
    // Each fighter keeps a stale `joinedEvent` after the event: the fixture fails its
    // `/event-ended` notice, and the event poll (character/attend.ts `poll`) keeps the marker to retry
    // the notice.
    const keepMarker = (route: Route) => route.abort();
    if (restart) for (const name of [W, P]) await live.clients[name].page.route('**/event-ended', keepMarker);
    await live.admin(`timers.goobrawl=new Date(0);output=true`);
    // Timer expiry leaves native survivors to kill before the ended-event
    // grace period and real transporter evacuation can begin.
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='main'); }, { timeout: 180_000 }).toBe(true);
    const backOnMain = Date.now();
    const combat = (await Promise.all([W,P].map(name => live.clients[name].events()))).flat();
    expect(combat.some((event: any) => survivors.some((monster: any) => String(monster.id) === String(event.data?.id)) &&
      (event.event === 'death' || event.event === 'hit' && event.data?.kill)), 'Native clients must kill an observed event monster').toBe(true);
    // The Hunt resumes the same mission it left for the event.
    const after = hunt(await live.state());
    if (variant !== 'finished') expect({ index: after.currentIndex, target: after.target }, 'the Hunt mission after the event').toEqual({ index: before.currentIndex, target: before.target });
    await expect.poll(async () => (await taskTrail(live, group, restart ? 0 : tasksFrom)).trail.some(([d, k]) => d === 'ended' && k === 'event-return'),
      { timeout: 60_000, message: 'The event return ends once the party is back' }).toBe(true);
    if (variant === 'finished') {
      // EV13: the finished return hands the party to the Hunt's
      // hand-in with no event marker left on either member, and the hand-in runs.
      await expect.poll(async () => { const s = await live.state(); return [W, P].every(n => !s.characters[n]?.joinedEvent); },
        { timeout: 60_000, message: 'EV13: no stale event marker after the return' }).toBe(true);
      await expect.poll(async () => quantity((await observed(live))[W].items, 'monstertoken'),
        { timeout: 240_000, message: 'EV13: the finished Hunt is handed in after the return' }).toBeGreaterThan(tokensAtStart);
    }
    // The Hunt asks for its mission walk again within one coordinator tick of the return's
    // end: its task is live again at once, and its next walk starts within one status report.
    if (variant !== 'finished') {
      // The return's end: no event-return task is live or waiting any more. The hold that waits
      // for the return's record ends `replaced:event-return` first, so the last end counts.
      await expect.poll(async () => { const g = (await live.tasks()).groups.find((x: any) => x.id === group);
        return g.live.kind !== 'event-return' && !g.waiting.some((t: any) => t.kind === 'event-return'); },
        { timeout: 60_000, intervals: [100], message: 'The event return ends' }).toBe(true);
      const ring = await ringFrom(live, group, restart ? 0 : tasksFrom);
      const ended = ring.filter(e => e.decision === 'ended' && e.kind === 'event-return').at(-1)!;
      const tick = await reportTick(live);
      const resumed = ring.find(e => e.seq > ended.seq && ['resumed', 'granted'].includes(e.decision) && e.kind === 'hunt-mission');
      let walk: any;
      const samples: unknown[] = [];
      await expect.poll(async () => { const st = await live.state(), h = st.monsterHunt;
        samples.push({ h: h && { stage: h.stage, message: h.message, resumeStage: h.resumeStage }, maps: [W, P].map(n => [st.characters[n]?.map, st.characters[n]?.x, st.characters[n]?.y, st.characters[n]?.joinedEvent, st.characters[n]?.huntEventPending]), cmd: [W, P].map(n => st.commands?.[n]?.type ?? null) });
        return (walk = walks.walks().find(w => w.startedAt >= ended.at))?.startedAt; },
        { timeout: 60_000, intervals: [500], message: 'The Hunt asks for its mission walk after the return' }).toBeDefined();
      await info.attach('f13-hunt-after-return', { body: JSON.stringify({ ended, resumed, walk, tick, walks: walks.walks(), samples }), contentType: 'application/json' });
      expect(resumed?.at, 'the Hunt task is live again when the return ends').toBe(ended.at);
      expect(walk.requester?.tier, 'the next walk is the Hunt mission walk').toBe('hunt-mission');
      expect(walk.startedAt - ended.at, 'the mission walk is asked for within one coordinator tick of the return end').toBeLessThanOrEqual(tick);
    }
    if (restart) {
      // A stale `joinedEvent` after a reload does not suspend the Hunt. The event marker is derived
      // (character/attend.ts `joined`): it names the event of the member's attendance assignment
      // from the last heartbeat while the member stands on that event's map. The Hunt has resumed
      // by now, so the row plants an attendance assignment on the warrior while the coordinator is
      // down, as a heartbeat from before the restart would have left it. The warrior stands on the
      // ended event's map. Each reply after the reload would replace that assignment with the
      // Hunt's, so a page timer plants it again: the warrior's reports keep carrying the marker
      // while the coordinator, which has no attendance task, must take no presence and suspend
      // no Hunt from it.
      try {
        const from = await taskSeq(live, group), report = await reportTick(live);
        // The derived marker as the events owner's character facts publish it (api.ts `eventFacts()`).
        const marker = () => live.clients[W].run('globalThis.__partyEventFacts?.joinedEventName() || null');
        // The plant writes through `receiveTask`, the entry each heartbeat reply writes the assignment
        // through (shared.js `partyTasks.assignment`). It runs once inside the evaluate, so a missing
        // entry fails this call instead of throwing unseen on the page timer.
        const plant = "(() => { const set = () => globalThis.partyTasks.assignment.receiveTask({ task: { kind: 'event-attendance', owner: 'stale-row', tier: 'event-attendance', event: 'goobrawl' } }); set(); globalThis.__stalePlant = setInterval(set, 50); })()";
        let back: { map: string; x: number; y: number } | undefined;
        await live.restartCoordinator(async () => {
          back = await live.admin(`output=(()=>{const p=get_player('${W}'),at={map:p.map,x:p.x,y:p.y};transport_player_to(p,'goobrawl');return at;})()`);
          await live.clients[W].run(plant);
          await expect.poll(marker, { timeout: 30_000, message: 'precondition: the warrior marks the event from its map' }).toBe('goobrawl');
        });
        const seen = (await live.state()).characters[W]?.seenAt ?? 0;
        await expect.poll(async () => (await live.state()).characters[W]?.seenAt ?? 0, { timeout: 30_000, message: 'reports arrive after the restart' }).toBeGreaterThan(seen + 3 * report);
        const s = (await live.state()).characters, read = await live.tasks();
        expect(s[W]?.joinedEvent ?? null, 'precondition: the warrior still reports the stale event').toBe('goobrawl');
        expect([W, P].map(n => read.presence?.[n] ?? null), 'no presence from a stale joinedEvent').toEqual([null, null]);
        const trail = (await taskTrail(live, group, from)).trail;
        expect(trail.filter(([d, k, c]) => (d === 'granted' && k === 'event-attendance') || (d === 'suspended' && k.startsWith('hunt') && c.startsWith('event'))),
          'a stale joinedEvent after a reload suspends no Hunt').toEqual([]);
        await live.admin(`output=(()=>{transport_player_to(get_player('${W}'),'${back!.map}',[${back!.x},${back!.y}]);return true;})()`);
      } finally { await live.clients[W].run('clearInterval(globalThis.__stalePlant)'); for (const name of [W, P]) await live.clients[name].page.unroute('**/event-ended', keepMarker); }
      // The notice goes through again at each fighter's next event poll (character/install.ts
      // polls on each report the fighter sends; 10 s stays this row's bound), so the next row
      // starts with no marker from this one.
      const poll = 10_000, report = await reportTick(live);
      await expect.poll(async () => { const s = (await live.state()).characters; return [W, P].map(name => s[name]?.joinedEvent ?? null); },
        { timeout: poll + report, message: 'The stale markers clear once the notice goes through' }).toEqual([null, null]);
    }
    if (variant === 'finished') {
      // This return finishes into the Hunt (returns.ts `createIntoHunt`) and sends no
      // event-return-town, so each fighter's event poll clears its event marker once the event
      // has been missing 10 s (the event poll, character/attend.ts), and the coordinator ends a session 10 s
      // after its last live report (events/observations.ts `ended`). Each clear needs one more
      // report to show. Before ea8fd50a the hand-in skipped the poll, and the stale marker kept
      // a fresh session open past the row.
      // The poll runs on each report (character/install.ts); 10 s stays this row's bound. The missing time starts at
      // the first poll after both stand on Main, one interval at most, and the clear lands on the
      // first poll at least 10 s after that start: the second poll after it, or the third when
      // the start fell part way into its poll. So the bound counts from the arrival on Main.
      // Counted from here, it ended before the second poll in three runs after the restart row
      // (gate leftovers, 2026-11-03).
      const clear = 10_000, poll = 10_000, statuses = (await live.state()).characters;
      const report = Math.max(...[W, P].map(name => Number(statuses[name]?.reportIntervalMs) || 0));
      await expect.poll(async () => { const s = (await live.state()).characters; return [W, P].map(name => s[name]?.joinedEvent ?? null); },
        { timeout: Math.max(report, backOnMain + 2 * poll + clear + report - Date.now()), message: 'Each fighter clears its event marker after the event return' }).toEqual([null, null]);
      await expect.poll(async () => { const s = await live.state();
        return { sessions: Object.keys(s.farmingProfiles?.[W]?.eventSessions ?? {}), eventReturn: s.eventReturn ?? null }; },
        { timeout: clear + report, message: 'No event session or return outlasts the cleared markers' }).toEqual({ sessions: [], eventReturn: null });
    }
    // The hand-in clears the quest before the Hunt takes the next one, and a baseline without a quest
    // never matches the next quest's id, so the finished row waits for the next quest's count.
    if (variant === 'finished') await expect.poll(async () => ((await observed(live))[W].quest?.c ?? 0) > 0,
      { timeout: 60_000, message: 'The Hunt takes its next quest after the hand-in' }).toBe(true);
    const afterExit = (await observed(live))[W];
    await expect.poll(async () => {
      const current = (await observed(live))[W];
      return current.map === 'main' && ((current.quest?.id === afterExit.quest?.id &&
        current.quest?.c < afterExit.quest?.c) ||
        quantity(current.items, 'monstertoken') > quantity(afterExit.items, 'monstertoken'));
    }, { timeout: 150_000, message: 'Hunt must execute real combat or turn-in after leaving the event' }).toBe(true);
    if (variant === 'finished') {
      // A cancelled navigation intent is a user hold, so it is the
      // group line's top reason, marked as needing the player, and every other reason is a
      // waiting row; the card shows that line.
      await live.post('/town-party', {});
      const owned = async () => (await live.tasks()).groups.find((g: any) => g.id === group);
      const hold = 'Hunt movement is paused; select Hunt again to resume';
      await expect.poll(async () => (await owned())?.status?.reasons?.[0], { timeout: 30_000, message: 'The cancelled intent must lead the group line' })
        .toMatchObject({ kind: 'hold:intent', label: hold, needsAction: true });
      const read = await owned();
      expect(read.status.label).toBe(hold + ' - needs your action');
      expect(read.status.reasons.slice(1).map((r: any) => [r.kind, r.needsAction]), 'the other reasons are the waiting rows')
        .toEqual([...new Set(read.waiting.map((t: any) => t.kind))].map(kind => [kind, false]));
      await expect.poll(async () => (await live.state()).characters[W]?.activity?.text, { timeout: 30_000 }).toBe(hold + ' - needs your action');
    }
    await info.attach('goobrawl-tasks', { body: JSON.stringify(await taskTrail(live, group, 0), null, 1), contentType: 'application/json' });
    await evidence(live, info, 'live-event-hunt-handback', { restart, survivors, afterExit });
    } finally { await walks.stop(); }
  }];
});
