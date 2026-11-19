// The `event-return` row on the character:
// the event exit as one climb of movement's ladder over the `exit` rungs, the
// Town in Main, and the return's arrival report. Moved from characters/shared.js:
// the `event-return-town` command's body, `applyEventReturnOwner`, `exitEventMapForRecovery`,
// `exitGoobrawlForRecovery`, `persistEventExitAttempt`, `afterEventCombat`).
// No rung has a count or a deadline: the ladder's progress rule decides when a
// rung failed, the Town waits for the game's channel, and a leave or transport waits for the map
// change or for two reports with no 2-unit move.
import { partyHooks } from '../../hooks/index.ts';
import { eventExit } from '../rules.ts';
import type { ExitRung } from '../rules.ts';
import { PROGRESS_DISTANCE } from '../../protocol/ladder.ts';
import type { OwnerLadder, Rung } from '../../protocol/ladder.ts';

interface Point { map: string; in?: string | number; x: number; y: number }
interface Request { kind: string; owner: string; tier?: string }
// The `event-return-town` command the return's Town row sends (coordinator/returns.ts).
export interface ExitCommand { id: number; cycleId: string; event?: string; checkpoint?: unknown; deferred?: boolean }
// The character's report of its return, which the status owner's status and the tasks owner's farm reunion read.
export interface ExitState { phase: string; cycleId: string | null; event: string | null; checkpoint: unknown; attemptAt: number; lastError: string | null }
interface Game {
  maps?: Record<string, { event?: unknown; npcs?: { id?: string; position?: unknown[] }[] } | undefined>;
  npcs?: { transporter?: { places?: Record<string, unknown> } };
}

export interface EventExitPorts {
  now(): number;
  game(): Game;
  character(): { name: string; map: string; in?: string | number; x: number; y: number; rip?: boolean };
  // This runtime is the console's current one, survival's escape, and the navigation revision.
  current(): boolean;
  escaping(): boolean;
  revision(): number;
  // The event may still be live: the clock's feed lists it live, or the feed is not current
  // (character/clock.ts), for the reconnect rung (1.5 row 4b).
  feedLive(event: string): boolean;
  // The walk's runtime id, which every report carries (movement's `walkState.runtimeId`).
  runtimeId(): string;
  // The Town skill is off its cooldown (the client's `next_skill`).
  townCastReady(): boolean;
  // Resolves on the character's next completed report, or once the reports fall silent past the
  // report-freshness bound (movement's `reportOrSilence`), so no exit wait outlives a stalled report
  // loop or a lost connection.
  nextReport(): Promise<unknown>;
  // The return's saved progress for its kind (walk-client.ts `returnPhaseRecord`).
  progress(command: { cycleId: string }, kind: 'event' | 'town'): { revision: number; phase?: string; exitMap?: string; exitReconnectAttempted?: boolean };
  keepProgress(record: unknown): void;
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<{ progress?: unknown; stale?: boolean } | undefined>;
  // Movement's service for the exit's requests (runtime/movement/character/owner.ts).
  movement: {
    climb(owner: string, round: readonly Rung[], activity: string): OwnerLadder; endClimb(owner: string): void; release(owner: string): void;
    claim(request: Request): void; holdIdle(request: Request): void; returnRequest(cycleId: string): Request; attendRequest(event: string): Request;
    leave(request: Request): Promise<unknown>; transport(request: Request, map: string, spawn: number): Promise<unknown>; town(request: Request): Promise<unknown>;
    approach(point: Point, request: Request): Promise<unknown>;
    prepare(command: ExitCommand, current: () => boolean): Promise<unknown>;
    walk(point: Point, command: ExitCommand, current: () => boolean): Promise<unknown>;
    landed(point: Point): boolean;
  };
  // A boss event's exit leaves at once: the movement owner's departure flag holds while the exit departs, and the targeting owner's
  // target and the attendance's event types clear (`eventTargets`, attend.ts `targets`). Any other
  // exit waits for the merchant's fight to end (`merchantRunner.afterCombat`).
  walkBoss(event: string | undefined): boolean;
  departing(on: boolean): void;
  clearTarget(): void;
  eventTargets(types: string[]): void;
  fightEnds(action: () => Promise<void>): Promise<void>;
  log(message: string, color: string): void;
}

const MAIN: Point = { map: 'main', x: 0, y: 0 };
const reason = (error: unknown) => String((error as { reason?: unknown })?.reason || (error as Error)?.message || error);

export function installEventExit(ports: EventExitPorts) {
  // The return cycle the last reply named (`eventReturnCycleId`), in the replies'
  // send order, and the exit that runs for it. An exit runs only while its cycle is that one.
  let cycle: string | null | undefined, cycleAt = 0, running: { commandId: number; cycleId: string; cancelled: boolean } | null = null, pending = false;
  const idle = (): ExitState => ({ phase: 'idle', cycleId: null, event: null, checkpoint: null, attemptAt: 0, lastError: null });
  let recovery = idle();
  const here = (): Point => { const c = ports.character(); return { map: c.map, in: c.in, x: c.x, y: c.y }; };
  const mapEvent = (map: string) => ports.game().maps?.[map]?.event;

  // The reply's cycle (shared.js `applyEventReturnOwner`). A reply sent before the one this runtime
  // last took names an older cycle and changes nothing. A new cycle retires the exit of the old
  // one, with the journeys and holds it named; whatever took the character since is not the exit's.
  function observe(reply: { eventReturnCycleId?: string | null; serverNow?: number; transportTiming?: { sentAt?: number } }): void {
    if (!ports.current() || !Object.prototype.hasOwnProperty.call(reply, 'eventReturnCycleId')) return;
    const at = Number(reply.transportTiming?.sentAt || reply.serverNow);
    if (Number.isFinite(at)) { if (at < cycleAt) return; cycleAt = at; }
    cycle = reply.eventReturnCycleId;
    if (!running || running.cycleId === cycle) return;
    retire(running);
  }
  function retire(exit: NonNullable<typeof running>): void {
    exit.cancelled = true;
    if (running === exit) { running = null; pending = false; }
    recovery = idle();
    ports.movement.release('event-exit:' + exit.commandId); ports.movement.release('event-return:' + exit.cycleId);
  }
  // The command intake's fence: a Town command of another cycle than the reply's is not taken.
  const accepts = (command: ExitCommand) => cycle === undefined || command.cycleId === cycle;
  // A newer command ends the running exit, unless it is the exit's own walk home (`shared-walk-return`
  // under the exit's command). A Monster Hunt command ends the return's report too (the lifecycle owner's intake asks
  // this for every accepted command, table I `eventAccepted`).
  function supersede(command: { id: number; purpose?: string }, walk: { activity?: string; parentCommandId?: number } | null): void {
    const own = command.purpose === 'shared-walk-return' && walk?.activity === 'event-return' && walk.parentCommandId === running?.commandId;
    if (running && command.id !== running.commandId && !own) { running.cancelled = true; pending = false; }
    if (command.purpose === 'monster-hunt') recovery = idle();
  }
  // The return's convoy (an `event-return` walk command, movement's monster walk) reports its phase.
  function convoyReturn(command: { phase?: string; convoyId?: string; location?: unknown }): void {
    recovery = { phase: command.phase === 'assemble' ? 'convoy-assembling' : 'convoy-returning', cycleId: command.convoyId || null,
      event: recovery.event, checkpoint: command.location, attemptAt: ports.now(), lastError: null };
  }
  // The return's phase for its kind: a phase already saved is not sent again, and the
  // coordinator's answer is kept only while this runtime and the navigation revision still hold.
  // With no `current` from a running exit (movement's Town return, shared.js `saveTownPhase`), the
  // write holds while the runtime and the record's navigation revision hold.
  async function saveReturnPhase(command: { cycleId: string }, kind: 'event' | 'town', phase: string, current?: () => boolean): Promise<void> {
    const saved = ports.progress(command, kind);
    if (saved.phase !== phase) await persist(command, kind, current ?? (() => ports.current() && ports.revision() === saved.revision), { phase });
  }

  // The round over the `exit` rungs for the event map the climb starts on, then the next report
  // (the ladder's `wait` rung). Each rung has nothing to try where it does not apply, so the
  // ladder moves past it: the map's own exits only on that map, `town` while the Town is ready or
  // the character stands off Main, and `reconnect` once per return cycle. On an event map the
  // Town recovers a blocked position while each cast moves the member off its place; a
  // cast that leaves it in place (`blocked.stuck`) climbs on to the next rung.
  function round(start: string, rungs: readonly ExitRung[], command: ExitCommand | null, blocked: { stuck: boolean }): Rung[] {
    const on = (at: { map: string }) => at.map === start;
    const applies: Record<ExitRung, (at: { map: string }) => boolean> = {
      transporter: on, leave: on, transport: on,
      town: at => mapEvent(at.map) ? ports.townCastReady() && !blocked.stuck : ports.townCastReady() || at.map !== MAIN.map,
      // 1.5 row 4b: only on a current feed that does not list the event live, once per return cycle.
      reconnect: at => on(at) && !!command && !ports.feedLive(String(mapEvent(start))) && !ports.progress(command, 'event').exitReconnectAttempted,
    };
    return [...rungs.map((name): Rung => ({ name, toward: name !== 'town',
      attempt: at => applies[name](at) ? { trying: name === 'town' ? 'returning to Main town' : 'leaving ' + start + ' by ' + name, options: {} } : undefined })),
    { name: 'wait', toward: true, attempt: (_at, { rounds }) => ({ trying: `waiting for the next report, then starting over (round ${rounds + 1})`, options: {} }) }];
  }

  // The progress test for a leave or a transport: the character changed maps, or two reports in
  // a row show it standing within 2 units of where it stood (the walking try's test in
  // runtime/movement/character/executor.ts `reported`).
  async function settles(map: string, current: () => boolean): Promise<void> {
    let last: Point | null = null;
    for (;;) {
      await ports.nextReport();
      const now = here();
      if (!current() || now.map !== map) return;
      if (last && Math.hypot(now.x - last.x, now.y - last.y) < 2) return;
      last = now;
    }
  }
  async function attempt(rung: string, start: string, request: Request, command: ExitCommand | null, current: () => boolean, blocked: { stuck: boolean }): Promise<void> {
    const state = recovery, map = ports.character().map;
    if (rung === 'leave' || rung === 'transport') {
      state.phase = 'leaving-' + map;
      if (command) await persist(command, 'event', current, { exitMap: map });
      if (!current()) return;
      await (rung === 'leave' ? ports.movement.leave(request) : ports.movement.transport(request, MAIN.map, 0));
      return settles(map, current);
    }
    if (rung === 'transporter') {
      // The instance has no exit door: the Transporter sends the character to its Main spawn.
      const npc = ports.game().maps?.[map]?.npcs?.find(entry => entry.id === 'transporter'), spawn = ports.game().npcs?.transporter?.places?.main;
      if (!npc || !Array.isArray(npc.position)) throw Error(map + ' Transporter location is missing');
      if (!Number.isInteger(spawn)) throw Error(map + " Transporter's Main destination is missing");
      state.phase = 'approaching-' + map + '-transporter';
      const walk = ports.movement.attendRequest(String(mapEvent(start)));
      // The approach ends only its own walk handle (1.5 row 36 (b)): a walk another task took over,
      // such as the merchant jobs owner's job walk, keeps going.
      try { await ports.movement.approach({ map, x: Number(npc.position[0]), y: Number(npc.position[1]) }, walk); }
      finally { if (current()) ports.movement.release(walk.owner); }
      if (!current() || ports.character().map !== map) return;
      state.phase = 'transporting-from-' + map;
      await ports.movement.transport(request, MAIN.map, spawn as number);
      return settles(map, current);
    }
    if (rung === 'reconnect') {
      // The mark goes on the return's progress before the login, so the reload the reconnect
      // causes resumes past this rung (routes.ts asks the call budget owner's `realm.reconnect`).
      state.phase = 'reconnecting-from-' + map;
      await persist(command!, 'event', current, { exitMap: map, exitReconnectAttempted: true });
      return settles(map, current);
    }
    // `town`: on Main or an event map the Town, which waits for its channel; elsewhere the walk to
    // Main, with the return's one local Town toward the map's exit first.
    if (map !== MAIN.map && !mapEvent(map)) {
      state.phase = 'returning-to-main';
      await ports.movement.prepare(command!, current);
      if (current() && ports.character().map !== MAIN.map) await ports.movement.walk(MAIN, command!, current);
      return;
    }
    state.phase = map === MAIN.map ? 'returning-to-main' : 'recovering-' + map + '-position';
    if (map === MAIN.map && command) await saveReturnPhase(command, 'event', 'main-town', current);
    if (map !== MAIN.map && command) await persist(command, 'event', current, { exitMap: map });
    if (!current()) return;
    const from = here();
    await ports.movement.town(request);
    if (map === MAIN.map || !current()) return;
    // The cast's progress: on its next report the member stands off the place it cast from.
    await ports.nextReport();
    const at = here();
    blocked.stuck = at.map === from.map && Math.hypot(at.x - from.x, at.y - from.y) < PROGRESS_DISTANCE;
  }

  // One climb from the event map to `goal`: off every event map, or landed in Main's Town. A dead
  // character asks survival's published respawn (`survival.respawn`) and waits on its
  // reports until it lives; survival answers `not-now` while another ask's respawn is in flight.
  async function climb(request: Request, current: () => boolean, goal: 'off' | 'main', command: ExitCommand | null): Promise<boolean> {
    const start = ports.character().map, event = mapEvent(start), rungs = event ? eventExit(event) : ['town' as const];
    if (!rungs) throw Error('No verified event exit mechanism for ' + start);
    const done = () => goal === 'main' ? ports.movement.landed(MAIN) : !mapEvent(ports.character().map);
    if (done()) return true;
    const blocked = { stuck: false };
    const ladder = ports.movement.climb(request.owner, round(start, rungs, command, blocked), 'Leaving ' + start);
    try {
      while (current() && !done()) {
        if (ports.character().rip) {
          try { const answer = partyHooks().survival.respawn({ by: 'event-exit' }); if (answer.answer === 'refused') recovery.lastError = answer.reason; }
          catch (error) { recovery.lastError = reason(error); }
          // The exit's claim lasts two report gaps and a respawn takes longer, so the exit claims
          // again before each report it waits dead; otherwise the climb stands with no hold.
          while (ports.character().rip && current()) { if (command) ports.movement.claim(request); await ports.nextReport(); }
          continue;
        }
        const step = ladder.next(here());
        if (step.rung === 'wait') { await ports.nextReport(); ladder.waited(); continue; }
        try { await attempt(step.rung, start, request, command, current, blocked); }
        catch (error) { recovery.lastError = reason(error); }
        if (!current()) break;
        ladder.result({ arrived: done(), at: here() });
      }
      return current() && done();
    } finally { ports.movement.endClimb(request.owner); }
  }
  // The return's fields on its progress record of its kind (routes.ts `ReturnProgress`): the
  // one write of the phase and the exit fields, kept while `current` holds.
  async function persist(command: { cycleId: string }, kind: 'event' | 'town', current: () => boolean, detail: Record<string, unknown>): Promise<void> {
    if (!current()) return;
    const progress = ports.progress(command, kind);
    const response = await ports.request('/return-progress', { method: 'POST', body: { character: ports.character().name, kind,
      cycleId: command.cycleId, navigationRevision: progress.revision, phase: progress.phase, ...detail } });
    if (current()) ports.keepProgress(response?.progress || { ...progress, ...detail });
  }

  // The return's Town row on the character: every member leaves the event, lands in Main's Town and tells
  // the coordinator, which then walks the leader back to the checkpoint.
  async function run(command: ExitCommand): Promise<void> {
    const exit = running = { commandId: command.id, cycleId: command.cycleId, cancelled: false }, revision = ports.revision();
    const current = () => ports.current() && !ports.escaping() && ports.revision() === revision && running === exit && !exit.cancelled && accepts(command);
    pending = true;
    recovery = { phase: 'returning', cycleId: command.cycleId, event: command.event || null, checkpoint: command.checkpoint || null, attemptAt: ports.now(), lastError: null };
    try {
      const leave = async () => {
        if (!current()) return;
        const request = { kind: 'town', owner: 'event-exit:' + command.id };
        ports.movement.claim(request);
        recovery.phase = 'leaving-event';
        if (!await climb(request, current, 'main', command)) return;
        // Landed: the exit holds the member while it reports its arrival.
        ports.movement.holdIdle(ports.movement.returnRequest(command.cycleId));
        recovery.phase = 'town-ready';
        await saveReturnPhase(command, 'event', 'complete', current);
        ports.log('Event ended; returned to Town', '#c084fc');
      };
      if (ports.walkBoss(command.event)) {
        ports.departing(true);
        ports.clearTarget();
        ports.eventTargets([]);
        try { await leave(); } finally { ports.departing(false); }
      } else await ports.fightEnds(leave);
      if (!current() || !ports.movement.landed(MAIN)) return;
      const c = ports.character();
      // The arrival carries the walk's runtime id, which the coordinator's exit check compares with the
      // reported one (routes.ts `currentExit`, b9b5c91e shared.js:10838); a stale answer leaves the
      // phase where it stands.
      const answer = await ports.request('/event-return-complete', { method: 'POST', body: { character: c.name, cycleId: command.cycleId, commandId: command.id,
        runtimeId: ports.runtimeId(), navigationRevision: revision, map: c.map, mapEvent: mapEvent(c.map) || null, x: Number(c.x), y: Number(c.y) } });
      if (current() && !answer?.stale) recovery.phase = command.deferred ? 'deferred-town-ready' : 'town-ready';
    } finally { if (running === exit) { pending = false; running = null; } }
  }
  // Survival's escape and a player command cross out of an event instance the same way (S-06s7):
  // the climb's goal is any map that is not an event's.
  function leaveEventMap(current: () => boolean, request: Request): Promise<boolean> { return climb(request, current, 'off', null); }

  // Whether a Town command's exit runs, and the return cycle the last reply named.
  const exiting = () => pending && !!running;
  const returning = () => typeof cycle === 'string' && !!cycle;
  // What the live E2E rows read of the exit (e2e/live-event-runtime-recovery.spec.ts): whether a
  // reply named a cycle, that cycle, and the running exit.
  const report = () => ({ selected: cycle !== undefined, cycleId: cycle ?? null, exit: running && { ...running } });
  return { observe, accepts, supersede, convoyReturn, saveReturnPhase, run, leaveEventMap, pending: () => pending, exiting, returning, report,
    // The return's report, and its arrival (movement's walk home, `eventReturnComplete`).
    recovery: (): ExitState => recovery, complete(): void { recovery.phase = 'complete'; } };
}
Object.assign(globalThis, { installEventExit });
