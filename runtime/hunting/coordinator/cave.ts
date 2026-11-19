// The Cave of Many Dreams visit: its roster and phases, the player's
// actions, the travel inside a floor with its repairs, the automatic exploration, the priest's
// revival assignment and each member's control. The members' observations come from
// character/cave.ts in their reports. Dorr's and the merchants' reach is the game's NPC reach less
// drift; a report's age reads movement's readings.
import { caveVisitCurrent } from '../rules.ts';
import { playedIn } from '../../settings/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { caveCommand, caveNote, caveReport, caveStep as recordStep, writeCave } from './record.ts';
import { eventSchedule, occurrenceId } from '../../events/api.ts';
import { tasks } from '../../tasks/api.ts';
import type { Group, Member } from '../../coordinator/targeting/api.ts';
import type { HttpResponse } from '../../lifecycle/api.ts';
import { ARRIVAL_TOLERANCE, RENDEZVOUS_RANGE, createOwnerLadder, type Rung } from '../../protocol/ladder.ts';
import { fresh as freshReport, reachLessDrift } from '../../protocol/reports.ts';
import { GAME_NPC_REACH, caveDestinations, caveDropped, caveFloorMap, caveLabel, caveNextPoint, caveRejoinOpen, voteSettled } from '../rules.ts';
import type { CaveChoice, CaveCommand, CaveObservation, CavePoint, DungeonParty, DungeonState, DungeonView } from '../api.ts';

type Cave = NonNullable<CaveObservation['cave']>;
type Travel = NonNullable<DungeonState['travel']>;

// The party is at most PARTY_LIMIT (the game's). A member stands at a Cave point by movement's
// arrival reading, and walks no more than the protocol's rendezvous range ahead of the slowest
// pending member.
const PARTY_LIMIT = 3;
// The party reaches an event no more than 60 s after its spawn.
const EVENT_ARRIVAL_MS = 60000;

/** A visit that is not idle owns its participants, or the party when no name is given. */
// A `held` visit owns only the members reported inside a run, so escape, death
// recovery and respawn run for a member outside, and the character's runtime stops owning it.
export function caveOwns(party: Pick<DungeonParty, 'dailyDungeons'> & { statuses?: DungeonParty['statuses'] }, name?: string): boolean {
  const d = party.dailyDungeons;
  if (!d || d.phase === 'idle') return false;
  if (name === undefined) return true;
  return d.participants.includes(name) && (d.phase !== 'held' || !!party.statuses?.[name]?.dungeon?.cave);
}

/**
 * The Cave floors a worker gets (read): only the party leader's worker asks the game for full
 * generated floors, so the other workers keep the original wire format.
 */
export function caveFloors(leader: string | null, name: string): { full_cave_floors?: true } {
  return leader === name ? { full_cave_floors: true } : {};
}

// The grouped queue on the Cave floor ----

interface CaveCombatState {
  dailyDungeons?: DungeonState;
  statuses: Record<string, Member['status'] & { ctype?: string; dungeon?: CaveObservation }>;
  groupedCombat?: Group | null;
}
type Evaluate = (previous: Group | null, members: Member[], leader: string, now: number, step: number, paused: boolean) => Group;

/**
 * targeting's grouped queue, scoped to the active run's floor and not the saved farming
 * navigation. Targeting's snapshot hands its own `evaluateGroup`, so this module reads none of
 * targeting's code.
 */
export function caveCombat(state: CaveCombatState, now: number, evaluate: Evaluate): Group | null {
  const d = state.dailyDungeons;
  if (!d || d.phase !== 'active' || !d.run) return null;
  const cave = state.statuses[d.participants[0]!]?.dungeon?.cave;
  if (!cave || cave.run !== d.run) return null;
  const scope = d.run + ':' + cave.floor;
  const previous = state.groupedCombat?.caveScope === scope ? state.groupedCombat : null;
  const members = d.participants.map(name => {
    const s = state.statuses[name], g = s?.groupedCombat;
    const status = s && { ...s, groupedCombat: g && { ...g, lootPending: false, state: g.state?.caveScope === scope ? g.state : null,
      passingEncounters: [], travelCommand: null } };
    return { name, ctype: s?.ctype || '', revision: 0, cancelled: false, status } as Member;
  });
  // The leader's candidates are every fresh member's on the leader's server, map and instance.
  const lead = members[0]?.status;
  if (lead?.groupedCombat)
    lead.groupedCombat.candidates = members.filter(m => m.status && freshReport(m.status.seenAt, now) && m.status.server === lead.server &&
      m.status.map === lead.map && m.status.in === lead.in).flatMap(m => m.status!.groupedCombat?.candidates || []);
  const paused = members.some(m => {
    const other = state.statuses[m.name]?.dungeon?.cave;
    return !other || other.paused || other.run !== d.run || other.floor !== cave.floor;
  });
  const result = evaluate(previous, members, d.participants[0]!, now, 0, paused);
  result.caveScope = scope;
  return result;
}

// ---- The repair ladder ----

// Each kind of Cave repair climbs the owner ladder (02 3.2, "3 Cave travel, assembly and
// destination repairs"): the same strategy, then the other, then a wait for the next report that
// starts over, since a Cave has no safe point to walk to. No count stops travel, and the
// travel's `trying` names the members and the strategy for the card.
const caveRound = (same: string, other: string): Rung[] => [
  { name: 'same', toward: true, attempt: () => ({ trying: same, options: {} }) },
  { name: 'other', toward: true, attempt: () => ({ trying: other, options: {} }) },
  { name: 'wait', toward: true, attempt: () => ({ trying: 'waiting for the next report, then starting over', options: {} }) },
];

interface CavePorts {
  now(): number;
  persist(): void;
  // The character the merchant's job is visiting now (the merchant job owner's
  // `merchantCurrent.target`), if any.
  merchantVisit?(): string | null | undefined;
  cancel(names: string[]): void;
  // The lifecycle owner's answer whether the member's client is offline
  // (lifecycle/roster/roster-projection.ts `offline`): its headless worker's record, or a
  // Steam or browser member's own reports.
  offline(name: string): boolean;
}

/** The party's Cave visit. */
export function createCave(party: DungeonParty, ports: CavePorts) {
  const state = (): DungeonState => party.dailyDungeons ||
    writeCave(party, { dailyDungeons: { protectFromEvents: true, participants: [], phase: 'idle', commands: {}, operations: [] } as DungeonState }).dailyDungeons;
  const status = (name: string) => party.statuses[name];
  // Each step of the visit's phase, with its roster and visit at that step, until `phased` tells it:
  // one call can step twice, as an exit's last member out steps exiting to held and held to idle.
  const steps: { from: DungeonState['phase']; to: DungeonState['phase']; party: string[]; visit: string | null }[] = [];
  function caveStep(...args: Parameters<typeof recordStep>): void {
    const [d, to] = args, from = d.phase;
    recordStep(...args);
    if (from !== to) steps.push({ from, to, party: [...d.participants], visit: d.visit ?? null });
  }
  const observation = (name: string) => status(name)?.dungeon;
  // A member's report counts under the `report` age, an age exactly at it stale as before.
  const fresh = (name: string) => !!status(name) && freshReport(status(name)!.seenAt, ports.now(), 'report', 0, true);
  const apart = (point: { x: number; y: number }, s: { x?: number; y?: number } | undefined) =>
    Math.hypot((s?.x ?? Infinity) - point.x, (s?.y ?? Infinity) - point.y);
  // A member stands inside the game's NPC reach on the server when its report puts it inside that
  // reach less drift.
  const npcReach = (name: string) => reachLessDrift(GAME_NPC_REACH, status(name)?.speed, ports.now() - Number(status(name)?.seenAt));
  const receipt = (name: string, command: CaveCommand | undefined, outcome: 'complete' | 'failed') => {
    const r = observation(name)?.action;
    return !!command && r?.id === command.id && r.status === outcome;
  };
  const anyFailed = (d: DungeonState) => d.participants.some(n => receipt(n, d.commands[n], 'failed'));
  const dorr = (name: string) => ({ ...observation(name)!.keeper!, id: 'dorr', label: 'Dorr' });

  function issue(names: string[], action: CaveCommand['action'], operation: string, extra: Partial<CaveCommand> = {}) {
    const d = state();
    for (const name of names) caveCommand(d, name, { ...extra, action, id: operation + ':' + name });
    ports.persist();
  }

  // The roster and the entry checks ----

  // The leader and the followers the roster counts online (the `presence` age), less the merchant.
  function candidates(): string[] {
    const followers = Object.keys(party.followers || {})
      .filter(n => party.followers?.[n] && freshReport(status(n)?.seenAt ?? NaN, ports.now(), 'presence', 0, true));
    return [party.leader, ...followers].filter((n): n is string => !!n && n !== party.merchantCharacter)
      .filter((n, i, all) => all.indexOf(n) === i);
  }
  function validateCandidates(names: string[]) {
    if (!names.length || names.length > PARTY_LIMIT || names[0] !== party.leader) throw Error('Select a leader and at most two combat followers');
  }
  // The entry check's refusal for a member, or null when it may enter; the rejoin skips a refused member.
  function entryProblem(name: string, server?: string): string | null {
    const s = status(name), o = observation(name);
    if (!fresh(name) || !o?.supported || o.protocol !== 1) return name + ': fresh dungeon-compatible runtime required';
    if (s?.rip || s?.server !== server) return name + ': must be alive on the same server';
    const v = o.visit;
    // The answer counts until the game's daily reset it names.
    if (!v || !caveVisitCurrent(v, ports.now())) return name + ': daily eligibility needs refreshing';
    if (!v.available && !v.resume) return name + ': daily visit unavailable';
    if (v.resume && v.resume.server !== s?.server) return name + ': resume on ' + v.resume.server;
    return null;
  }
  function validateEntry(name: string, server?: string) {
    const problem = entryProblem(name, server);
    if (problem) throw Error(problem);
  }
  // The in-game party matches the participants, out of combat and loot; a lone member needs no party.
  function validateParty(d: Pick<DungeonState, 'participants'>) {
    for (const name of d.participants) {
      const o = observation(name);
      if (!o?.ready) throw Error(name + ': wait until combat and loot finish');
      if (d.participants.length === 1 && !o.leader && o.members.length === 0) continue;
      if (o.leader !== d.participants[0]) throw Error(name + ': assemble the selected party out of combat');
      if (o.members.length !== d.participants.length || o.members.some(n => !d.participants.includes(n)))
        throw Error('In-game party must match dungeon participants exactly');
    }
  }
  function begin(id: string) {
    const d = state(), names = candidates();
    if (d.phase !== 'idle' && d.phase !== 'held') throw Error('A dungeon operation already owns the party');
    validateCandidates(names);
    // A visit waits while the merchant's job visits one of its members.
    const visited = ports.merchantVisit?.();
    if (visited && names.includes(visited)) throw Error('Wait for the active merchant visit to finish');
    if (!names.every(n => observation(n)?.visit?.resume)) validateParty({ participants: names });
    const server = status(names[0]!)?.server;
    for (const name of names) validateEntry(name, server);
    if (!observation(names[0]!)?.keeper) throw Error('Dorr location unavailable from the game client');
    caveStep(d, 'gathering', {
      operations: [], participants: names, visit: id, server, error: undefined, run: undefined, pendingEvent: undefined,
      exitDispatched: false, priestRecovery: undefined, recoveryDeaths: undefined, manualRecovery: false, travel: undefined,
      stairContinuation: undefined, progress: { enabled: false, serial: 0, message: 'Choose a destination to begin travelling' },
      resuming: names.every(n => !!observation(n)?.visit?.resume), interruptedPhase: undefined, interruptedCommands: undefined,
    });
    ports.cancel(names);
    issue(names, 'gather', id, { target: dorr(names[0]!) });
  }
  // A member found inside a run while the party is idle starts a visit that reconciles it. Only the
  // members that report inside join it, so a member that reconnects inside exits alone.
  function adopt() {
    const d = state();
    if (d.phase !== 'idle') return;
    const names = candidates().filter(n => fresh(n) && observation(n)?.cave);
    if (!names.length) return;
    caveStep(d, 'entering', { operations: [], participants: names, visit: 'adopted:' + ports.now(), commands: {},
      server: status(names[0]!)?.server, error: 'Reconciling an existing dungeon visit' });
    ports.cancel(names);
    ports.persist();
  }
  // `cave.member` tells each drop, rejoin and refused rejoin. They change the participants
  // without a change of phase, so `cave.phase` does not tell them.
  const memberNotice = (d: DungeonState, member: string, change: 'dropped' | 'rejoined' | 'refused', by: string) =>
    partyHooks().notify('cave.member', { visit: d.visit ?? null, member, change, by });
  // A member the game reports offline leaves the visit (rules.ts `caveDropped`). While a vote
  // pauses the run, an add-on's `false` to the question `drop` keeps the member listed; the first
  // report of the run unpaused drops it.
  function dropOffline(d: DungeonState) {
    const clock = d.participants.map(n => observation(n)?.cave).find(c => !!c && c.run === d.run);
    const kept = (n: string) => !!clock?.paused && !!partyHooks().hunting.dropRefused({ question: 'drop', group: tasks().groupOf(n), member: n,
      run: clock.run, clock: { paused: true, expires: clock.expires }, task: taskOf(n) });
    const gone = caveDropped(d.participants, ports.offline).filter(n => !kept(n));
    if (!gone.length) return;
    caveNote(d, { participants: d.participants.filter(n => !gone.includes(n)) });
    for (const n of gone) caveCommand(d, n, undefined);
    ports.persist();
    for (const n of gone) memberNotice(d, n, 'dropped', 'core:hunting');
  }
  // A member's live task as `cave.rejoin` sees it.
  const taskOf = (n: string) => { const task = tasks().assignment(n); return task && { kind: task.kind, owner: task.owner }; };
  // The run and member of each rejoin an add-on refuses now, so `cave.member` tells a refusal once.
  const refusedRejoins = new Set<string>();
  // The user's rejoin (2026-11-16): a leader or follower the game booted by going offline enters the
  // run again on its own while the run's clock runs (rules.ts `caveRejoinOpen`), by the earlier
  // console's Return missing participants: a `gather` marked `resume` to Dorr, then reconcileReturns'
  // `enter`. A member dropOffline took out joins the participants again unless an add-on refuses it
  // (`cave.rejoin`); a refused member keeps its live work. A member still listed, such as one whose
  // worker restarted, never left, so it keeps its place and the hook is not asked. A member with a
  // rejoin under way gets no second one.
  function rejoin(d: DungeonState) {
    if (d.phase !== 'active') return;
    const inside = d.participants.map(n => observation(n)?.cave);
    const open = candidates().filter(n => fresh(n) && !ports.offline(n) && !observation(n)?.cave && !!observation(n)?.keeper &&
      caveRejoinOpen(observation(n)?.visit?.resume, inside, d.run, ports.now()) && !entryProblem(n, d.server) &&
      !d.commands[n]?.resume && d.commands[n]?.action !== 'enter');
    // caveRejoinOpen passed for each open member, so a member inside reports this run's clock.
    const clock = inside.find(c => c?.run === d.run)!;
    const back = open.filter(n => {
      if (d.participants.includes(n)) return true;
      const key = d.run + ':' + n;
      const refused = partyHooks().hunting.rejoinRefused({ question: 'rejoin', group: tasks().groupOf(n), member: n, run: clock.run,
        clock: { paused: clock.paused, expires: clock.expires }, task: taskOf(n) });
      if (refused && !refusedRejoins.has(key)) memberNotice(d, n, 'refused', refused);
      if (refused) refusedRejoins.add(key);
      else refusedRejoins.delete(key);
      return !refused;
    });
    if (!back.length) return;
    const returning = back.filter(n => !d.participants.includes(n));
    caveNote(d, { participants: [...d.participants, ...returning] });
    if (returning.length) ports.cancel(returning);
    for (const name of back) issue([name], 'gather', 'cave-rejoin:' + d.run + ':' + ports.now(), { resume: true, target: dorr(name) });
    for (const name of returning) memberNotice(d, name, 'rejoined', 'core:hunting');
  }

  // The phases ----

  function reconcile(repairs = true) {
    adopt();
    const d = party.dailyDungeons;
    if (!d || d.phase === 'idle' || !d.participants.length) return;
    dropOffline(d);
    rejoin(d);
    for (const n of d.participants) observeAction(d, n);
    if (!d.participants.every(fresh)) return;
    reconcileGather(d);
    reconcileReturns(d);
    reconcileCaves(d);
    exitForEvent(d);
    reconcileRecovery(d);
    tickProgress(d);
    tickTravel(repairs);
  }
  function observeAction(d: DungeonState, n: string) {
    const report = observation(n)?.action, command = d.commands[n];
    if (!fresh(n) || !report || report.id !== command?.id) return;
    caveReport(d, n, report);
  }
  // A member reached Dorr within the NPC reach less drift and its gather receipt completed.
  function gathered(d: DungeonState, name: string) {
    const s = status(name), keeper = observation(name)?.keeper;
    if (!s || !keeper || s.map !== keeper.map || apart(keeper, s) > npcReach(name)) return false;
    return receipt(name, d.commands[name], 'complete');
  }
  function reconcileGather(d: DungeonState) {
    if (d.phase !== 'gathering' || !d.participants.every(n => gathered(d, n))) return;
    try {
      for (const n of d.participants) validateEntry(n, d.server);
      if (!d.resuming) validateParty(d);
    } catch (error) {
      caveNote(d, { error: String(error) });
      return;
    }
    caveStep(d, 'entering', { error: undefined });
    issue(d.resuming ? d.participants : [d.participants[0]!], 'enter', d.commands[d.participants[0]!]!.id + ':enter');
  }
  // A member gathered at Dorr to rejoin a run enters again.
  function reconcileReturns(d: DungeonState) {
    if (!['entering', 'active'].includes(d.phase)) return;
    for (const name of d.participants) {
      const command = d.commands[name];
      if (command?.action !== 'gather' || !command.resume || !gathered(d, name)) continue;
      if (observation(name)?.cave || !observation(name)?.visit?.resume) continue;
      issue([name], 'enter', command.id + ':resume');
    }
  }
  function reconcileCaves(d: DungeonState) {
    const caves = d.participants.map(n => observation(n)?.cave);
    if (d.phase === 'held' && caves.some(Boolean)) { exit('late-entry:' + ports.now()); return; }
    if (['entering', 'active'].includes(d.phase) && caves.every(c => c && c.run === caves[0]?.run) && d.phase !== 'active') {
      caveStep(d, 'active', { run: caves[0]!.run, commands: {}, error: undefined });
      ports.persist();
    }
    if ((d.phase === 'active' || d.phase === 'exiting') && caves.every(c => c === null)) {
      caveStep(d, 'held', { commands: {}, run: undefined });
      ports.persist();
    }
    // `held` ends once every fresh member reports outside and no action is pending, with "After a
    // run" on go back, or after an exit for an event; staying outside keeps the hold until
    // Release. The members outside are not the visit's meanwhile (`caveOwns`).
    if (d.phase === 'held' && caves.every(c => c === null) && !Object.keys(d.commands).length && (playedIn('dailyDungeons', d, 'afterRun') !== 'stay' || !!d.pendingEvent)) {
      retire(d);
      ports.persist();
    }
  }
  // With "Don't leave for other events" off, the visit exits for the event the events owner asked for between
  // encounters (no open vote, no member fighting), and at the latest at the cut-off, so the party
  // still reaches it in time. It exits from every phase but `held` and `exiting`, as v1.5.0's
  // `eventAllowed` exited a gathering or entering party too.
  function exitForEvent(d: DungeonState) {
    if (d.phase === 'held' || d.phase === 'exiting' || !d.pendingEvent || playedIn('dailyDungeons', d, 'protectFromEvents') !== false) return;
    // A vote is open while the run is paused or a choice is unresolved. A member dead inside is not
    // between encounters either: its death pauses the run for the revival vote, which the game
    // reports after the death itself.
    const between = d.participants.every(n => {
      const o = observation(n), cave = o?.cave;
      return o?.alive !== false && !status(n)?.rip &&!cave?.paused && !(cave?.choice && !cave.choice.resolved) && !status(n)?.target;
    });
    if (between || ports.now() >= eventCutOff(d.pendingEvent)) exit('event:' + ports.now(), d.pendingEvent);
  }
  // The cut-off: the spawn plus 60 s less the party's planned walk, from the events owner's
  // `event.schedule` for the party group's occurrence of the event. With no scheduled occurrence the
  // cut-off is now, so the run exits at once, as v1.5.0's `eventAllowed` exited for a
  // live event.
  function eventCutOff(event: string): number {
    const group = party.leader ? tasks().groupOf(party.leader) : null;
    const scheduled = group ? eventSchedule(occurrenceId(group, event)) : null;
    return scheduled ? scheduled.spawnAt + EVENT_ARRIVAL_MS - (scheduled.walkMs ?? 0) : ports.now();
  }
  function exit(id: string, event?: string) {
    const d = state();
    if (!caveOwns(party)) throw Error('No owned dungeon visit');
    if (d.phase === 'exiting' && event) return;
    caveStep(d, 'exiting', { interruptedPhase: d.phase, interruptedCommands: d.commands, exitDispatched: false, commands: {},
      pendingEvent: event, error: undefined });
    issue(d.participants, 'exit', id, { run: d.run });
  }
  // Whether an event may take `name` (B.2): a member the visit does not own goes; one it owns goes
  // only with "Don't leave for other events" off and no event named. The answer moves no phase: a
  // live event the visit may leave for is noted, and the Cave tick exits for it.
  function eventAllows(name: string, event?: string) {
    if (!caveOwns(party, name)) return true;
    return !event && playedIn('dailyDungeons', state(), 'protectFromEvents') === false;
  }
  function eventAllowed(name: string, event?: string, eligible = false) {
    const d = state();
    if (event && eligible && playedIn('dailyDungeons', d, 'protectFromEvents') === false && caveOwns(party, name) && d.phase !== 'held' && d.phase !== 'exiting' &&
        d.pendingEvent !== event) {
      caveNote(d, { pendingEvent: event });
      ports.persist();
    }
    return eventAllows(name, event);
  }
  // Whether Release would end the visit now, read only.
  function canRelease() {
    const d = state();
    return d.phase === 'idle' || (d.phase === 'held' && d.participants.every(n => fresh(n) && observation(n)?.cave === null));
  }
  // Release ends a held visit whose members are all outside, and returns its refusal while a
  // member is still inside or not freshly observed, so each caller answers the player its own way.
  function release(): Error | null {
    reconcile();
    const d = state();
    if (d.phase === 'idle') return null;
    if (d.phase !== 'held' || !d.participants.every(n => fresh(n) && observation(n)?.cave === null))
      return Error('Exit the dungeon before resuming ordinary travel');
    retire(d);
    ports.persist();
    return null;
  }
  // An idle party keeps no state from the finished visit, so settings() cannot restore an older
  // interrupted phase and its commands.
  function retire(d: DungeonState) {
    caveStep(d, 'idle', { visit: undefined, commands: {}, operations: [], pendingEvent: undefined, interruptedPhase: undefined,
      interruptedCommands: undefined, travel: undefined, stairContinuation: undefined, progress: undefined });
  }
  // Town, a party walk and Escape leave the visit first: a held visit with every member outside
  // releases and the walk goes on; otherwise the run exits and the reply is the visit.
  function exitDungeon(res: HttpResponse, command: number): boolean {
    if (!caveOwns(party)) return false;
    if (!release()) return false;
    exit('manual-exit:' + ports.now() + ':' + command);
    res.json({ ok: true, dailyDungeon: party.dailyDungeons });
    return true;
  }
  // Resume asks the release; a visit still inside refuses with the release's words.
  function releaseDungeon(res: HttpResponse): boolean {
    const refusal = release();
    if (refusal) res.status(409).json({ error: String(refusal) });
    return !refusal;
  }

  // The player's actions ----

  function action(body: Record<string, unknown>) {
    // Retry starts the travel again, which is the attempt a repair due now would make, so its
    // reconcile leaves the repair ladder alone and the Retry issues the one new travel.
    reconcile(body.action !== 'retry');
    const d = state(), id = body.operationId;
    if (typeof id !== 'string' || !id || id.length > 160) throw Error('An operation ID is required');
    if (d.operations.includes(id)) return;
    const handlers: Record<string, () => void> = {
      settings: () => settings(body),
      progress: () => {
        if (d.phase !== 'active' || typeof body.enabled !== 'boolean') throw Error('Active dungeon and enabled flag required');
        setExploration(body.enabled);
      },
      enter: () => begin(id),
      resume: () => begin(id),
      exit: () => exit(id),
      release: () => { const refusal = release(); if (refusal) throw refusal; },
      retry: () => retry(id),
      recover: () => recover(id),
    };
    const handler = Object.hasOwn(handlers, String(body.action)) && handlers[String(body.action)];
    if (handler) handler();
    else perform(body, id);
    // The action log keeps the current visit's operation ids: begin and adopt start it and retire
    // empties it, so a repeated id within the visit is refused and an idle party keeps none.
    if (d.visit) caveNote(d, { operations: [...d.operations, id] });
    ports.persist();
  }
  function settings(body: Record<string, unknown>) {
    const d = state();
    if (body.afterRun !== undefined) {
      if (body.afterRun !== 'go-back' && body.afterRun !== 'stay') throw Error('afterRun must be go-back or stay');
      caveNote(d, { afterRun: body.afterRun });
      if (body.protectFromEvents === undefined) return;
    }
    if (typeof body.protectFromEvents !== 'boolean') throw Error('protectFromEvents must be a boolean');
    caveNote(d, { protectFromEvents: body.protectFromEvents });
    // Turning protection back on undoes only what the event did. An event exit issued and not yet
    // dispatched gives back the interrupted run; an event eventAllowed only noted leaves the run as it is.
    if (!d.protectFromEvents || !d.pendingEvent || d.exitDispatched) return;
    if (d.phase === 'exiting' && d.interruptedPhase) caveStep(d, d.interruptedPhase, { commands: d.interruptedCommands || {} });
    caveNote(d, { pendingEvent: undefined });
  }
  // Retry is one more attempt: a travel starts again, else each confirmed pre-dispatch failure is
  // issued again. The repair ladder keeps no count, so a travel never stops on its
  // failures: each repair replaces the failed command, and a travel in progress is the attempt
  // Retry repeats whether or not a failed receipt stands at that moment.
  function retry(id: string) {
    const d = state();
    if (d.travel) {
      startTravel(d.travel.target);
      return;
    }
    const failed = Object.entries(d.commands).filter(([name, command]) => fresh(name) && receipt(name, command, 'failed'));
    if (!failed.length) throw Error('No confirmed pre-dispatch failure to retry');
    for (const [name, command] of failed) issue([name], command.action, id, { ...command, id: undefined });
    caveNote(d, { error: undefined });
  }
  // A member outside the run with a server-confirmed return walks back to Dorr to rejoin.
  function recover(id: string) {
    const d = state();
    if (!['entering', 'active'].includes(d.phase)) throw Error('No visit to recover');
    const missing = d.participants.filter(n => observation(n)?.cave === null);
    if (!missing.length) throw Error('No missing participants');
    for (const name of missing) {
      validateEntry(name, d.server);
      if (!observation(name)?.visit?.resume || !observation(name)?.keeper) throw Error(name + ': server-confirmed return required');
    }
    for (const name of missing) issue([name], 'gather', id, { resume: true, target: dorr(name) });
  }
  function perform(body: Record<string, unknown>, id: string) {
    const d = state();
    if (d.phase !== 'active' || body.run !== d.run || !d.participants.every(fresh)) throw Error('Fresh matching dungeon run required');
    const cave = observation(d.participants[0]!)?.cave;
    if (!cave) throw Error('Dungeon state unavailable');
    for (const [name, command] of Object.entries(d.commands))
      if (!actionSettled(name, command)) throw Error('Previous dungeon action needs reconciliation; exit remains available');
    if (body.action === 'revival') return revival(id);
    if (body.action === 'move') return move(body, id, cave);
    if (body.action === 'waypoint') return waypoint(body, id, cave.paused);
    return choose(body, id, cave);
  }
  // B.4's one settlement rule, which the actions and the exploration ask: a walk, a gather and a
  // talk block nothing (a talk only opens a dialogue); a vote settles on the member's report of the
  // same run by rules.ts `voteSettled`, even while its receipt catches up; any other action on its
  // complete receipt.
  function actionSettled(name: string, command: CaveCommand): boolean {
    if (['move', 'gather', 'talk'].includes(command.action)) return true;
    const cave = observation(name)?.cave;
    if (command.action === 'vote' && !!cave && cave.run === command.run && voteSettled(cave.choice, command, name)) return true;
    return receipt(name, command, 'complete');
  }
  function waypoint(body: Record<string, unknown>, id: string, paused: boolean) {
    if (paused) throw Error('Answer the current encounter before setting a waypoint.');
    if (typeof body.map !== 'string' || body.map !== status(state().participants[0]!)?.map) throw Error('Waypoint is on a different floor.');
    if (typeof body.x !== 'number' || typeof body.y !== 'number' || !Number.isFinite(body.x) || !Number.isFinite(body.y))
      throw Error('Choose a point on the map.');
    setExploration(false);
    startTravel({ id: 'waypoint:' + id, label: 'Waypoint', map: body.map, x: body.x, y: body.y });
  }
  function revival(id: string) {
    const d = state(), fallen = d.participants.find(n => observation(n)?.alive === false);
    if (!fallen) throw Error('No fallen participant');
    const choice = observation(fallen)?.cave?.choice;
    if (choice && !choice.resolved) throw Error('Resolve the current vote before calling Nera');
    manualRecovery(d);
    issue([fallen], 'revival', id, { run: d.run, choice: choice?.id });
  }
  function move(body: Record<string, unknown>, id: string, cave: Cave) {
    const d = state();
    const target = destination(cave, body.target);
    if (target.exit) return exit(id);
    if (target.map !== status(d.participants[0]!)?.map) throw Error('Waypoint is on a different floor. Use the stairs to reach that floor first.');
    const speaker = merchantRoom(target) && shopHidden(target) && nearestSpeaker(target);
    if (speaker) return talk(speaker, target, id);
    setExploration(false);
    caveNote(d, { progress: { ...d.progress!, target: target.id, message: 'Travelling to ' + target.label }, error: undefined,
      stairContinuation: target.down ? target : undefined });
    startTravel(target);
  }
  // A merchant room is done once its encounter resolves while its one item may still be for sale
  // (game 8fbc84d), so it stays a destination.
  function destination(cave: Cave, id: unknown): CavePoint {
    const target = cave.points.find(p => p.id === id);
    if (!target || target.locked || target.done && !reopenable(target) || cave.paused) throw Error('Destination unavailable');
    return target;
  }
  const merchantRoom = (point: CavePoint) => !!point.room && /^\d+:shop$/.test(point.room);
  const reopenable = (point: CavePoint) => !!point.done && merchantRoom(point);
  const shopHidden = (point: CavePoint) => !participantChoices().some(choice => choice.shop?.room === point.room);
  function participantChoices(): CaveChoice[] {
    return state().participants.flatMap(n => fresh(n) && observation(n)?.cave?.run === state().run ? observation(n)?.cave?.choice || [] : []);
  }
  // The game shows the latest vote to everyone; cave_talk(room) reopens an earlier encounter, such
  // as a merchant, for the one member who talks, within the NPC reach less drift.
  function nearestSpeaker(point: CavePoint): string | undefined {
    return state().participants
      .filter(name => fresh(name) && observation(name)?.alive && status(name)?.map === point.map)
      .map(name => ({ name, gap: apart(point, status(name)) }))
      .filter(({ name, gap }) => gap <= npcReach(name))
      .sort((a, b) => a.gap - b.gap)[0]?.name;
  }
  function talk(name: string, point: CavePoint, id: string) {
    const d = state();
    setExploration(false);
    caveNote(d, { error: undefined });
    issue([name], 'talk', id, { run: d.run, room: point.room });
  }
  function choose(body: Record<string, unknown>, id: string, cave: Cave) {
    const d = state();
    // A talk can show a reopened shop to one member only.
    const choice = body.action !== 'buy' ? cave.choice : [cave.choice, ...participantChoices()].find(c => c?.id === body.choice);
    if (!choice || choice.id !== body.choice) throw Error('Choice is no longer current');
    if (body.action !== 'vote') return buy(body, id, cave, choice);
    const option = choice.options.find(o => o.id === body.option);
    if (choice.resolved || choice.deadline <= ports.now() || !option || option.unavailable) throw Error('Reply unavailable');
    // A paid reply needs the player's confirmation of the cost it was shown.
    if ((option.cost || option.amber) && body.confirmed !== true) throw Error('Confirm the shared currency cost before voting');
    if (Number(body.cost || 0) !== (option.cost || 0) || Number(body.amber || 0) !== (option.amber || 0))
      throw Error('Choice cost changed; review it again');
    issue(d.participants.filter(n => !choice.votes[n]), 'vote', id,
      { run: d.run, choice: choice.id, option: option.id, cost: option.cost || 0, amber: option.amber || 0 });
  }
  function buy(body: Record<string, unknown>, id: string, cave: Cave, choice: CaveChoice) {
    const d = state();
    if (body.action !== 'buy' || body.confirmed !== true || !choice.resolved || !choice.shop || choice.shop.sold || cave.gold < choice.shop.price)
      throw Error('Confirmed available purchase required');
    if (body.cost !== choice.shop.price) throw Error('Purchase price changed; review it again');
    const buyer = d.participants.find(n => observation(n)?.cave?.choice?.id === choice.id && observation(n)?.cave?.choice?.shop?.nearby);
    if (!buyer) throw Error('No participant near the merchant');
    issue([buyer], 'buy', id, { run: d.run, choice: choice.id, room: choice.shop.room, cost: choice.shop.price });
  }

  // Travel inside a floor ----

  // Floor transitions stay native stair actions; the party assembles where the leader stands,
  // then walks together at the slowest member's speed.
  function startTravel(target: CavePoint) {
    const d = party.dailyDungeons!, leader = status(d.participants[0]!);
    if (!leader?.map || target.map !== leader.map) throw Error('Waypoint is on a different floor. Use the stairs to reach that floor first.');
    const serial = (d.travel?.serial || d.progress?.serial || 0) + 1;
    const origin: CavePoint = { id: 'assembly', label: 'Party assembly', map: leader.map, x: leader.x!, y: leader.y! };
    caveNote(d, { ...d.progress ? { progress: { ...d.progress, serial } } : {}, travel: { target, origin, stage: 'assembling', serial },
      ...target.down ? { stairContinuation: target } : {}, error: undefined });
    issue(d.participants, 'gather', 'cave-assemble:' + d.run + ':' + serial, { run: d.run, target: origin });
  }
  const atPoint = (name: string, point: CavePoint) => fresh(name) && status(name)?.map === point.map && apart(point, status(name)) <= ARRIVAL_TOLERANCE;
  const arrivedAll = (d: DungeonState, point: CavePoint) => d.participants.every(n => atPoint(n, point) && receipt(n, d.commands[n], 'complete'));
  function tickTravel(repairs: boolean) {
    const d = party.dailyDungeons!, t = d.travel;
    if (!t || d.phase !== 'active' || d.participants.some(n => observation(n)?.cave?.paused)) return;
    if (repairs ? repairReceipt(d, t) || regroup(d, t) || repairDestination(d, t) : anyFailed(d)) return;
    if (t.stage === 'assembling' && arrivedAll(d, t.origin)) {
      t.stage = 'travelling';
      // The cruise is the slowest member's reported speed; a member with none counts its reported
      // base speed, its class's. With neither from anyone the walk sets no cruise.
      const speeds = d.participants.map(n => Number(status(n)?.speed) > 0 ? Number(status(n)!.speed) : Number(status(n)?.baseSpeed))
        .filter(s => s > 0 && Number.isFinite(s));
      issue(d.participants, 'move', 'cave-travel:' + d.run + ':' + t.serial,
        { run: d.run, target: t.target, cruiseSpeed: speeds.length ? Math.min(...speeds) : undefined });
    }
    if (t.stage === 'travelling' && arrivedAll(d, t.target)) finishTravel(d, t);
  }
  function finishTravel(d: DungeonState, t: Travel) {
    if (t.target.down && !d.participants.every(n => observation(n)?.ready)) return;
    if (t.target.down) {
      issue(d.participants, 'stairs', 'cave-stairs:' + d.run + ':' + t.serial, { run: d.run, target: t.target });
      caveNote(d, { stairContinuation: t.target });
    } else for (const command of Object.values(d.commands)) delete command.cruiseSpeed;
    caveNote(d, { travel: undefined });
    ports.persist();
  }
  // A member ready to regroup: fresh, alive, ready, on the point's floor inside the same unpaused run.
  function regroupReady(name: string, d: DungeonState, point: CavePoint) {
    const o = observation(name);
    if (!fresh(name) || status(name)?.map !== point.map || !o?.alive || !o.ready) return false;
    return !!o.cave && o.cave.run === d.run && !o.cave.paused;
  }
  // A member whose walk to `point` completed without reaching it.
  function displaced(name: string, d: DungeonState, point: CavePoint, action: CaveCommand['action'], sameId: boolean) {
    const c = d.commands[name];
    return c?.action === action && c.run === d.run && (!sameId || c.target?.id === point.id) && c.target?.map === point.map &&
      c.target.x === point.x && c.target.y === point.y && receipt(name, c, 'complete') && !atPoint(name, point);
  }
  // One climb step for a repair kind; undefined while its wait rung waits for a report.
  function climbRepair(t: Travel, kind: string, round: Rung[], names: string[], point: CavePoint): string | undefined {
    const now = ports.now(), ladders = t.ladders ||= {};
    const first = status(names[0]!), at = { map: first?.map ?? point.map, x: first?.x ?? point.x, y: first?.y ?? point.y };
    const remaining = { transitions: 0, walking: Math.max(...names.map(n => apart(point, status(n)))) };
    const saved = ladders[kind];
    const ladder = createOwnerLadder(round, () => now, saved ?? { index: 0, rounds: 0, failures: 0, progressAt: now, nearest: remaining, visited: [at.map] });
    if (t.waitAt !== undefined) {
      if (names.some(n => !((status(n)?.seenAt ?? 0) > t.waitAt!))) return undefined;
      delete t.waitAt;
      ladder.waited();
    } else if (saved) ladder.result({ arrived: false, at, remaining });
    const attempt = ladder.next(at);
    ladders[kind] = ladder.state();
    t.trying = names.join(', ') + ': ' + attempt.trying;
    if (attempt.rung === 'wait') { t.waitAt = now; return undefined; }
    return attempt.rung;
  }
  function moveAlone(names: string[], d: DungeonState, id: string, target: CavePoint, cruise: boolean) {
    for (const name of names) issue([name], 'move', id, { run: d.run, target, ...(cruise ? { cruiseSpeed: d.commands[name]?.cruiseSpeed } : {}), independent: true });
  }
  function regroup(d: DungeonState, t: Travel): boolean {
    if (t.stage !== 'assembling' || !d.participants.every(n => regroupReady(n, d, t.origin))) return false;
    const names = d.participants.filter(n => displaced(n, d, t.origin, 'gather', false));
    if (!names.length) return false;
    const rung = climbRepair(t, 'assembly', caveRound('gathering at the assembly point again', 'walking to the assembly point on its own'), names, t.origin);
    if (rung) {
      const id = `cave-assemble:${d.run}:${t.serial}:regroup:${ports.now()}`;
      if (rung === 'same') issue(names, 'gather', id, { run: d.run, target: t.origin });
      else moveAlone(names, d, id, t.origin, false);
    }
    ports.persist();
    return true;
  }
  function repairDestination(d: DungeonState, t: Travel): boolean {
    if (t.stage !== 'travelling' || !d.participants.every(n => regroupReady(n, d, t.target) && receipt(n, d.commands[n], 'complete'))) return false;
    const names = d.participants.filter(n => displaced(n, d, t.target, 'move', true));
    if (!names.length) return false;
    const rung = climbRepair(t, 'destination', caveRound('walking to the destination on its own', 'starting the travel again from a new assembly'), names, t.target);
    if (rung === 'other') {
      startTravel(t.target);
      caveNote(d, { travel: { ...d.travel!, ladders: t.ladders, trying: t.trying } });
      ports.persist();
      return true;
    }
    if (rung) moveAlone(names, d, `cave-travel:${d.run}:${t.serial}:regroup:${ports.now()}`, t.target, true);
    ports.persist();
    return true;
  }
  function repairReceipt(d: DungeonState, t: Travel): boolean {
    if (!anyFailed(d)) return false;
    if (!d.participants.every(n => observation(n)?.ready)) return true;
    const failing = d.participants.filter(n => receipt(n, d.commands[n], 'failed'));
    const rung = climbRepair(t, 'receipt', caveRound('starting the travel again', 'walking to the destination on its own'), failing.length ? failing : d.participants, t.target);
    if (!rung) { ports.persist(); return true; }
    if (rung === 'same') {
      const { ladders, trying } = t;
      startTravel(t.target);
      caveNote(d, { travel: { ...d.travel!, ladders, trying } });
    } else moveAlone(d.participants, d, `cave-travel:${d.run}:${t.serial}:repair:${ports.now()}`, t.target, true);
    ports.persist();
    return true;
  }

  // Automatic exploration ----

  const available = (d: DungeonState) => d.participants.every(n => fresh(n) && observation(n)?.alive &&
    observation(n)?.cave?.run === d.run && !observation(n)?.cave?.paused);
  const settled = (d: DungeonState) => Object.entries(d.commands).every(([name, command]) => actionSettled(name, command));
  // The next exploration point (rules.ts `caveNextPoint`), with an add-on's pick among the offered
  // points (`cave.destination`).
  function nextPoint(cave: Cave, previous?: string): CavePoint | undefined {
    const offered = caveDestinations(cave), leader = party.dailyDungeons!.participants[0]!;
    const pick = offered.length ? partyHooks().hunting.destination({ group: party.leader ? tasks().groupOf(party.leader) : null, run: cave.run,
      floor: cave.floor, points: offered, previous: previous ?? null }) : undefined;
    return caveNextPoint(offered, previous, status(leader), pick);
  }
  // Every member stands at the walk's target with its receipt complete, for a command to that target.
  const reached = (d: DungeonState, target: CavePoint) => arrivedAll(d, target) && d.participants.every(n => d.commands[n]?.target?.id === target.id);
  // The visit walks: exploration on, a travel target or a move command.
  const travelling = (d: DungeonState) => !!d.progress?.enabled || !!d.travel || Object.values(d.commands).some(c => c.action === 'move');
  function tickProgress(d: DungeonState) {
    if (d.phase !== 'active') return;
    if (!d.progress) caveNote(d, { progress: { enabled: false, serial: 0, message: 'Choose a destination to begin travelling' } });
    if (d.participants.some(n => observation(n)?.cave?.paused)) {
      const stairs = d.stairContinuation;
      if (travelling(d)) setExploration(false);
      caveNote(d, { stairContinuation: stairs, progress: { ...d.progress!, message: 'Answer the cave encounter, then choose your next destination' } });
      return;
    }
    continueStairs(d);
    if (d.travel) {
      caveNote(d, { progress: { ...d.progress!, message: anyFailed(d) ? 'Travel failed; use Retry failed preparation'
        : (d.travel.stage === 'assembling' ? 'Grouping up before ' : 'Travelling together to ') + d.travel.target.label } });
      return;
    }
    if (!d.progress!.enabled) { manualStatus(d); return; }
    explore(d);
  }
  function explore(d: DungeonState) {
    const p = d.progress!;
    if (!available(d)) { p.message = 'Waiting for party, revival, or a cave choice'; return; }
    if (!settled(d)) { p.message = 'Waiting for dungeon action confirmation'; return; }
    const cave = observation(d.participants[0]!)?.cave;
    if (!cave || !d.participants.every(n => observation(n)?.cave?.floor === cave.floor)) return;
    const target = nextPoint(cave, p.target);
    if (!target) {
      p.message = cave.points.some(pt => pt.down) ? 'Waiting for stairs to unlock' : 'Floor complete; no further stairs. Exit remains manual.';
      return;
    }
    p.message = target.down ? 'Moving to stairs down' : 'Unlocking stairs: ' + target.label;
    if (p.target !== target.id || p.floor !== cave.floor) {
      p.target = target.id;
      p.floor = cave.floor;
      startTravel(target);
      return;
    }
    const commands = Object.values(d.commands);
    if (commands.some(c => c.action === 'stairs')) { p.message = 'Waiting for the party to reach the next floor'; return; }
    if (anyFailed(d)) { p.message = 'Travel failed; use Retry failed preparation'; return; }
    if (!commands.length || commands.some(c => c.action !== 'move' && c.action !== 'stairs')) { startTravel(target); return; }
    if (!reached(d, target)) return;
    if (target.down && d.participants.every(n => observation(n)?.ready)) {
      p.serial++;
      issue(d.participants, 'stairs', 'cave-progress:' + d.run + ':' + p.serial, { run: d.run, target });
      ports.persist();
    } else p.message = 'Waiting for ' + target.label + ' to finish';
  }
  // After the stairs, the party on the new floor walks on to the stairs it was heading for.
  function continueStairs(d: DungeonState) {
    const stairs = d.stairContinuation;
    if (!stairs || d.travel) return;
    if (d.participants.every(n => observation(n)?.cave && status(n)?.map !== stairs.map)) {
      caveNote(d, { stairContinuation: undefined, commands: {}, error: undefined });
      ports.persist();
      return;
    }
    if (Object.values(d.commands).some(c => c.action === 'stairs') || !available(d) || !settled(d)) return;
    const target = observation(d.participants[0]!)?.cave?.points.find(p => p.id === d.stairContinuation?.id && p.down && !p.locked);
    if (target) startTravel(target);
    else caveNote(d, { stairContinuation: undefined });
  }
  function manualStatus(d: DungeonState) {
    const p = d.progress!;
    if (d.travel?.stage === 'assembling') { p.message = 'Grouping up before travelling to ' + d.travel.target.label; return; }
    if (Object.values(d.commands).some(c => c.action === 'stairs')) { p.message = 'Descending stairs - waiting for the party on the next floor'; return; }
    const target = Object.values(d.commands).find(c => c.action === 'move')?.target;
    if (!target) { p.message = 'Travel stopped. Choose a destination or start automatic exploration.'; return; }
    if (anyFailed(d)) { p.message = 'Travel failed; use Retry failed preparation'; return; }
    if (reached(d, target)) { p.message = 'Arrived at ' + target.label; return; }
    p.message = available(d) && d.participants.every(n => observation(n)?.ready)
      ? 'Travelling to ' + target.label : 'Travelling to ' + target.label + ' - waiting for nearby combat, loot, or party readiness';
  }
  function setExploration(enabled: boolean) {
    const d = party.dailyDungeons!;
    caveNote(d, { travel: undefined, stairContinuation: undefined, progress: { ...d.progress, serial: d.progress?.serial || 0, enabled,
      target: undefined, message: enabled ? 'Preparing automatic exploration' : 'Travel stopped. Choose a destination.' } });
    if (!enabled) for (const [name, command] of Object.entries(d.commands)) if (command.action === 'move' || command.action === 'gather') caveCommand(d, name, undefined);
    ports.persist();
  }

  // The priest's revival ----

  function observeDeaths(d: DungeonState) {
    const deaths = d.recoveryDeaths || caveNote(d, { recoveryDeaths: {} }).recoveryDeaths!;
    for (const name of d.participants) {
      const dead = observation(name)?.alive === false, old = deaths[name];
      if (old && old.dead === dead) continue;
      deaths[name] = { dead, generation: (old?.generation || 0) + (dead ? 1 : 0) };
      ports.persist();
    }
    if (d.manualRecovery && d.participants.every(n => observation(n)?.alive)) {
      caveNote(d, { manualRecovery: false });
      ports.persist();
    }
  }
  // The live priests with an essence inside the run, on the fallen member's map.
  function priestsFor(d: DungeonState, target: string): string[] {
    return d.participants.filter(name => {
      const o = observation(name);
      return o?.alive && o.recovery?.actor.ctype === 'priest' && o.recovery.essence && o.cave?.run === d.run && status(name)?.map === status(target)?.map;
    }).sort();
  }
  // The next fallen member with a priest to revive it: a fallen priest first, then the leader, then by name.
  function assignPriest(d: DungeonState) {
    const priest = (n: string) => Number(observation(n)?.recovery?.actor.ctype === 'priest');
    const fallen = d.participants.filter(n => observation(n)?.cave?.run === d.run && d.recoveryDeaths?.[n]?.dead && !d.recoveryDeaths[n]!.attempted)
      .sort((a, b) => priest(b) - priest(a) || Number(b === d.participants[0]) - Number(a === d.participants[0]) || a.localeCompare(b))
      .filter(n => priestsFor(d, n).length);
    // `survival.choice`: an add-on may revive another fallen member a priest can reach first.
    const target = fallen[0] && partyHooks().survival.choice({ question: 'revival', member: fallen[0], options: fallen, core: fallen[0] });
    if (!target) return;
    caveNote(d, { priestRecovery: { id: d.run + ':revive:' + target + ':' + d.recoveryDeaths![target]!.generation, run: d.run!, target,
      priest: priestsFor(d, target)[0]!, authorized: false } });
    ports.persist();
  }
  function reconcileRecovery(d: DungeonState) {
    if (d.phase !== 'active') return;
    if (d.priestRecovery && d.priestRecovery.run !== d.run) {
      caveNote(d, { priestRecovery: undefined, recoveryDeaths: undefined, manualRecovery: false });
      ports.persist();
    }
    observeDeaths(d);
    if (d.manualRecovery) return;
    const a = d.priestRecovery;
    if (!a) { assignPriest(d); return; }
    if (observation(a.target)?.alive) {
      caveNote(d, { priestRecovery: undefined });
      ports.persist();
      assignPriest(d);
      return;
    }
    const report = observation(a.priest)?.recovery;
    if (a.authorized) {
      if (report?.id === a.id && ['failed', 'complete'].includes(report.phase)) assignPriest(d);
      return;
    }
    if (!priestsFor(d, a.target).includes(a.priest)) {
      caveNote(d, { priestRecovery: undefined });
      ports.persist();
      assignPriest(d);
      return;
    }
    if (report?.id !== a.id || report.phase !== 'ready' || observation(a.priest)?.cave?.paused) return;
    caveNote(d, { priestRecovery: { ...a, authorized: true },
      recoveryDeaths: { ...d.recoveryDeaths, [a.target]: { ...d.recoveryDeaths![a.target]!, attempted: true } } });
    // The authorization is saved before it is delivered, so one death is never granted twice.
    ports.persist();
  }
  // Nera's vote waits for a priest's revival under way or a member's own revival.
  function manualRecovery(d: DungeonState) {
    const a = d.priestRecovery, report = a && observation(a.priest)?.recovery;
    const unresolved = d.participants.some(n => !!observation(n)?.recovery?.actor.c?.revival) ||
      !!a?.authorized && (report?.id !== a.id || !['failed', 'complete'].includes(report.phase));
    if (unresolved) throw Error('Priest revival is unresolved; wait for recovery or exit the dungeon');
    caveNote(d, { manualRecovery: true, priestRecovery: undefined });
    ports.persist();
  }

  // ---- Each member's control ----

  // A member walks no more than the rendezvous range along the route ahead of the slowest pending member.
  // A displaced member's own repair keeps no formation.
  function formationReady(d: DungeonState, name: string) {
    if (d.commands[name]?.independent) return true;
    if (!d.travel || d.travel.stage === 'assembling') return true;
    if (!status(d.participants[0]!) || !status(name)) return false;
    const pending = d.participants.filter(n => !receipt(n, d.commands[n], 'complete'))
      .map(n => observation(n)?.travel?.id === d.commands[n]?.id && observation(n)?.travel?.prepared ? observation(n)!.travel!.distance : undefined);
    if (pending.some(s => s === undefined)) return false;
    const own = observation(name)?.travel?.distance || 0;
    // Distance along the walked route grows through bends, where the straight distance to the goal can fall back.
    return !pending.length || own <= Math.min(...pending.map(s => s ?? 0)) + RENDEZVOUS_RANGE;
  }
  // A member's reply part reads the visit the report's tick advanced.
  function control(name: string) {
    const d = state(), command = d.commands[name];
    const leader = d.participants[0]!, sample = observation(leader)?.travel;
    const route = d.travel?.stage === 'travelling' && sample && sample.id === d.commands[leader]?.id ? sample.route : undefined;
    const recovery = d.phase === 'active' && !d.manualRecovery && d.priestRecovery?.priest === name ? d.priestRecovery : undefined;
    const ready = (n: string) => fresh(n) && !!observation(n)?.alive && !!observation(n)?.ready && !observation(n)?.cave?.paused;
    return { owned: caveOwns(party, name), command, route, ...(recovery ? { recovery } : {}),
      movementReady: d.participants.every(ready) && formationReady(d, name) };
  }
  // The reply's Cave part (the status owner's table R): a member's control while the party holds a
  // visit record.
  const reply = (name: string) => party.dailyDungeons ? { dailyDungeon: control(name) } : {};
  // The dashboard's read (GET /party-api/daily-dungeons) never advances the visit (B.2).
  // It answers the entry checks begin() runs on the candidates, the travel test the pause reads, the
  // map's readiness and the reopenable points, so the row and the panel copy none of them.
  function snapshot(): DungeonView {
    const d = state(), names = d.phase === 'idle' ? candidates() : d.participants;
    const points = d.participants.flatMap(name => observation(name)?.cave?.run === d.run ? observation(name)?.cave?.points || [] : []);
    return { state: d, members: names.map(name => ({ name, fresh: fresh(name), observation: observation(name) })),
      entryRefusal: entryRefusal(names), travelling: travelling(d), actionsReady: actionsReady(d),
      reopenable: [...new Set(points.filter(reopenable).map(point => point.id))] };
  }
  function entryRefusal(names: string[]): string | null {
    try {
      validateCandidates(names);
      const server = status(names[0]!)?.server;
      for (const name of names) validateEntry(name, server);
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  // Every participant reports fresh and alive on the leader's floor of the run, unpaused.
  function actionsReady(d: DungeonState): boolean {
    const [leader] = d.participants, floor = leader ? observation(leader)?.cave?.floor : undefined;
    return floor !== undefined && d.participants.every(name => {
      const o = observation(name), cave = o?.cave;
      return fresh(name) && !!o?.alive && !!cave && cave.run === d.run && cave.floor === floor && !cave.paused;
    });
  }
  // The Cave task this visit describes (rank 90), for the party's seat at the task owner: a visit
  // holds the party from entry until it is retired.
  function task() {
    const d = party.dailyDungeons;
    if (!d || d.phase === 'idle' || !d.participants.length) return null;
    return { owner: 'cave:' + (d.visit ?? d.server ?? 'visit'), members: [...d.participants], phase: d.phase,
      label: caveLabel(d.phase) };
  }
  // 6 part 2: `cave.phase` once per change of the visit's phase, told after each call that can
  // move it, one notice per step the call made; a phase an awaited action moves is told after the
  // next call.
  let heard = party.dailyDungeons?.phase ?? 'idle';
  function phased<A extends unknown[], R>(act: (...args: A) => R, by: (...args: A) => string) {
    return (...args: A): R => {
      const result = act(...args), d = party.dailyDungeons, phase = d?.phase ?? 'idle', who = by(...args);
      for (const step of steps.splice(0)) {
        if (step.to === heard) continue;
        partyHooks().notify('cave.phase', { party: step.party, visit: step.visit, from: heard, to: step.to, by: who });
        heard = step.to;
      }
      if (phase !== heard) partyHooks().notify('cave.phase', { party: d?.participants ?? [], visit: d?.visit ?? null, from: heard, to: phase, by: who });
      heard = phase;
      return result;
    };
  }
  const core = () => 'core:hunting';
  // The Cave door (`dungeon.enter`): an add-on's entry is the player's enter
  // action for the leader's party, so the entry checks hold and a visit in progress refuses it.
  const addonEnter = phased((addon: string, character: string, id: string) => {
    if (character !== party.leader) throw Error('the Cave enters with the party leader');
    action({ action: 'enter', operationId: `addon:${addon}:${id}` });
  }, addon => 'addon:' + addon);
  Object.assign(globalThis, { __partyCaveEnter: addonEnter });
  return { snapshot, reconcile: phased(reconcile, core), action: phased(action, () => 'player'), eventAllowed,
    eventAllows, canRelease,
    control, reply, release: phased(release, () => 'player'), task, exitDungeon: phased(exitDungeon, () => 'player'),
    releaseDungeon: phased(releaseDungeon, () => 'player') };
}
