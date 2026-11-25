// The groups and tasks owner's install on the coordinator: the owner, its holds and
// slots, its core registration (`settings.changed` for the leader, Follow and hand control;
// `addon.off`), the core task sources, the one task tick per status report, and the answers of
// api.ts. application.ts calls it once with the records the sources read.
import type { HookRegistry, MemberHold, MemberHoldAsk, OwnTaskHook, Registration, WalkTakeover } from '../../hooks/registry.ts';
import type { Tier } from '../../protocol/ranks.ts';
import { publishTasks, type TaskAnswers } from '../api.ts';
import { above, busy, deathRecoveryAllows, dueYields, GROUPS, priority, stopsActing, walkAllowed, type ReportPoint, type SavedManual } from '../rules.ts';
import { createTaskOwner, type GroupSpec, type TaskOwner, type TaskRecord, type TaskSnapshotTrigger } from './owner.ts';
import { askSources, type SourceAnswer } from './sources.ts';
import { answerOf, partyFocus, type CaveMemberState, type CaveVisitState } from '../../hunting/api.ts';
import { createHolds, type HoldPorts, type HoldRecord } from './holds.ts';
import { createSlots, slotSource, type ScopePorts, type SlotScope } from './slots.ts';
import { createManualProvider, type ManualGoal, type ManualRecord } from './manual.ts';
import { createEventPresence, eventFirst, eventSource, type LiveEventReport, type PresenceState } from '../../events/coordinator/api.ts';
import type { EventPresence } from '../../events/api.ts';
import { createHuntingSources, huntKind, type HuntScope } from '../../hunting/coordinator/api.ts';
import { addonApart, eventApart, heartbeatTask } from './assignment.ts';
import { addonOf } from './owner.ts';
import { groupId, groupKey, leaderOf } from './groups.ts';
import { playerWalk, type WalkStart } from '../../movement/api/coordinator.ts';
import { tripWindsDown, windDownHolds } from './wind-down.ts';
import { navigational } from '../../status/api.ts';

// A combat group's scope as the task tick reads it.
export interface TaskScope extends HuntScope, SlotScope {
  leader?: string | null;
  statuses: Readonly<Record<string, LiveEventReport & ReportPoint & { ctype?: string } | undefined>>;
  activeConvoy?: { id?: string; requester?: { tier?: Tier }; phase?: string; participants?: readonly string[] } | null;
  monsterHunt?: HuntScope['monsterHunt'] & { convoyId?: string | null; target?: string | null } | null;
  escape?: { stage?: string } | null;
  eventReturn?: { cycleId?: string; event?: string; phase?: string; participants: string[] } | null;
  targetMode?: string; combatMode?: string; monsterFocus?: string[];
}
// The scope's live trip, one that has not failed, with `member` among its walkers when named.
function onTrip(state: TaskScope, member?: string): boolean {
  const trip = state.activeConvoy;
  return !!trip && trip.phase !== 'failed' && (member === undefined ? !!trip.participants?.length : !!trip.participants?.includes(member));
}
/**
 * The tasks owner's `member.holder` answer for one member of `state`'s scope: the wind-down's holds, whether it
 * walks the scope's live trip, whether it is the healer, and survival's verdict on its group's
 * fight. A member whose own report names a task walk's live request as what
 * holds it from the walk (`commandHold` owner 01) is coming once that walk ends, which its next
 * report shows.
 */
export function memberHolds(ask: MemberHoldAsk, state: TaskScope, verdict: Parameters<typeof windDownHolds>[1]['verdict']): MemberHold[] {
  const holds = windDownHolds(ask, { onTrip: onTrip(state, ask.member), healer: state.statuses[ask.member]?.ctype === 'priest', verdict });
  const named = (state.statuses[ask.member] as { commandHold?: { owner: string; reason: string } | null } | undefined)?.commandHold;
  return named?.owner === '01' && !holds.some(hold => hold.owner === '01')
    ? [...holds, { owner: '01', reason: named.reason, coming: true, endsOn: 'report' } satisfies MemberHold] : holds;
}
// One combat group's composed services that the task tick drives (one entry per combat group, 1.2).
export interface CombatGroup {
  id: string | null; state: TaskScope;
}
// The coordinator's party record as 01 reads it: the facts its holders, sources and trips keep there.
export interface PartyRecord extends HoldRecord, ManualRecord {
  leader: string | null;
  followers: Record<string, boolean>;
  merchantCharacter?: string | null;
  manualTasks?: SavedManual[] | null;
  // The id the next party command carries (the travel routes, the Cave exit, the call budget owner's go-home command).
  nextCommandId: number;
  statuses: Record<string, (LiveEventReport & ReportPoint & { presence?: EventPresence | null }) | undefined>;
  passiveHunting?: { rules: Record<string, { interruptsHunt?: boolean } | undefined> } | null;
  deferredEventReturns?: Record<string, { cycleId?: string; event?: string | null; phase?: string } | undefined>;
  eventAttendance?: PresenceState['eventAttendance'];
}
// The combat groups the coordinator composes (groups.ts `createCombatGroups`).
export interface ComposedGroups {
  list(): GroupSpec[];
  combat(): CombatGroup[];
  scopeOf(name: string): TaskScope;
  solo(name: string): unknown;
  scopePortsOf(state: TaskScope): ScopePorts;
  walkGroup(key: string): { state: TaskScope } | undefined;
}
// A party walk start (movement's party convoys `start`), whose arguments the task owner passes on.
export type StartWalk = WalkStart;
export interface TaskPorts extends Pick<HoldPorts, 'lockoutMs' | 'paused'> {
  // The settings save, for the task records the owner keeps on the party record.
  persist(): void;
  // The realm's hook registry, which every source, notice and setting read goes through.
  hooks: HookRegistry;
  now(): number;
  record(): PartyRecord;
  // Movement's snapshot store beside the metrics journal, which takes the group ring's snapshots.
  records: { save(snapshot: { character: string; trigger: TaskSnapshotTrigger; records: TaskRecord[]; incidents: never[] }): unknown };
  groups: ComposedGroups;
  // The members of the scope `name` leads (`createFarmingScopes` `members`).
  members(name: string): string[];
  activeNames(): string[];
  // The events owner's event admission, without the visit: the member's event switch and its instance limits.
  eventEnabled(name: string, event: string): boolean;
  instanceAllowed(name: string, event: string): boolean;
  // Whether the member still attends `event`: its own or its leader's selection (`presence`).
  attends(name: string, event: string): boolean;
  // The game's monster table (movement's planner data) for the alone verdict.
  monsters(): Readonly<Record<string, object | undefined>> | null;
  // The party's own walk start, and its farming navigation's roster and authorization.
  startConvoy: StartWalk;
  navigation(): { members(): string[]; authorize(names: string[], location: ManualGoal['destination'], force: boolean): unknown };
  visit: Parameters<typeof createHuntingSources>[0]['visit'];
  rare: Parameters<typeof createHuntingSources>[0]['rare'];
  reconcileVisit(): void;
  // A player's travel command releases the Cave visit's hold first (the hunting owner's Cave service), which
  // returns its refusal while a member is still inside.
  releaseVisit(): Error | null;
  // The member holds move with a leader or Follow change: each changed member leaves its old
  // scope and joins its new one.
  reconcile(previous: { leader: string | null; followers: Record<string, boolean> }): void;
}

// The tasks owner's core registration: a switched-off add-on's tasks end `cancelled:addon-off`; a
// leader or Follow change moves members at once, in the request that saved it, from the
// formation route or the settings route alike. The settings owner applies
// a whole batch before it sends one notice per changed field, so the batch's first notice moves
// every member and a later one finds nothing left to move. A Manual or Pause toggle is a user
// command, which acts at once (the `manual` row).
// A group's running walk is the one movement's walk notices name, so no task rule
// reads the walk state itself.
// The wind-down is the tasks owner's case of movement's `member.holder` read (wind-down.ts `windDownHolds`).
export function tasksRegistration(owner: Pick<TaskOwner, 'endKind'>, on: { moved(): void; hands(): void; walk(notice: Record<string, unknown>, ended: boolean): void;
  holder(ask: MemberHoldAsk): MemberHold[] }): Registration {
  return { name: 'core:tasks', folder: 'core', author: 'adventureland-party-console', holder: '01',
    summary: "Ends the tasks of an add-on whose switch turns off, moves members when the leader or Follow changes, holds a member when its Manual or Pause switch changes, and holds an event walk's member while the live trip or the group's fight winds down.",
    hooks: {
      'addon.off'(notice) { owner.endKind(`addon:${String(notice.name)}`, 'cancelled:addon-off'); },
      'settings.changed'(notice) {
        if (notice.field === 'leader' || notice.field === 'followers') on.moved();
        if (notice.field === 'handControlByCharacter') on.hands();
      },
      'walk.formed'(notice) { on.walk(notice, false); },
      'walk.phase'(notice) { on.walk(notice, false); },
      'walk.ended'(notice) { on.walk(notice, true); },
      'member.holder'(ask) { return on.holder(ask); },
    } };
}
export function installTasks(ports: TaskPorts) {
  const partyHooks = () => ports.hooks;
  const party = () => groupId('party', ports.record().leader);
  const scopeOf = (name: string) => ports.groups.scopeOf(name);
  const reportOf = (name: string) => { const s = scopeOf(name).statuses[name]; return s && { map: s.map, x: s.x, y: s.y, rip: s.rip }; };
  const ask = (hook: OwnTaskHook, addon: string, view: Record<string, unknown>) => partyHooks().ownTask(hook, addon, view);
  // The group ring's snapshots go to movement's store with the group as the subject; the saved trips
  // are the party record's `manualTasks`; a task's walk is the party's walk while it is the active convoy.
  const owner: TaskOwner = createTaskOwner({ now: ports.now, notify: (hook, payload) => partyHooks().notify(hook, payload),
    snapshot: (group, trigger, records) => { ports.records.save({ character: group, trigger, records, incidents: [] }); },
    saveManual: entries => { ports.record().manualTasks = entries; ports.persist(); },
    report: reportOf, walkLive: id => ports.record().activeConvoy?.id === id, ask });
  const holds = createHolds(owner, { now: ports.now, party, record: ports.record, lockoutMs: ports.lockoutMs, paused: ports.paused, write: batch => partyHooks().write(batch), ask });
  // `busy` for a scope's target mode entry, over its group's walk from movement's notices.
  const slots = createSlots({ hooks: ports.hooks, now: ports.now, scopePorts: state => ports.groups.scopePortsOf(state as TaskScope), busy: (state: SlotScope) => {
    const id = state.leader === ports.record().leader ? party() : groupId('solo', state.leader);
    return busy(runs(id, 'mode'), id ? walks.get(id) : undefined);
  } });
  // A party walk (the party's convoys): a character on Manual or Pause is in no walk but its own
  // escape's, since Escape is the player's command; a player's trip asks the owner before
  // its walk starts, and a refused trip starts no walk.
  function walkersOf(names: string[] | undefined, purpose: string | null | undefined): string[] | undefined {
    const r = ports.record(), held = (name: string) => holds.held(name);
    return purpose === 'escape-recovery' || !Object.keys(r.handControlByCharacter ?? {}).some(held) ? names
      : (names ?? ports.activeNames()).filter(name => !held(name));
  }
  function startWalk(...[location, label, names, purpose, ...rest]: Parameters<StartWalk>): boolean {
    const r = ports.record(), walkers = walkersOf(names, purpose), [, tier, by] = rest;
    // An app key's trip is an `app` task that names the app.
    const caller = tier === 'app' ? { kind: 'app' as const, ...(by ? { by } : {}) } : {};
    if (r.leader && playerWalk(purpose) &&
        manual.begin(`party:${r.leader}`, { destination: { map: location.map, x: Number(location.x), y: Number(location.y) }, purpose: purpose ?? undefined, label, ...caller },
          walkers ?? ports.activeNames()) === 'refused') return false;
    return ports.startConvoy(location, label, walkers, purpose, ...rest);
  }
  // A held trip walks again from where the party stands: the party's active members, with every
  // member of the navigation authorized for the trip's destination. The trip is the manual task's own
  // walk, which it asks of movement's `walks.request` at the trip's tier, `manual` or an app's `app`.
  const manual = createManualProvider(owner, { record: ports.record, travel: goal => {
    const nav = ports.navigation(), active = ports.activeNames(), purpose = goal.purpose ?? 'party-travel';
    nav.authorize(nav.members(), goal.destination, true);
    return partyHooks().walks.request(groupKey(party()), { kind: purpose, destination: goal.destination, tier: goal.kind ?? 'manual', ...(goal.by ? { by: goal.by } : {}), label: goal.label || 'party location',
      members: walkersOf(nav.members().filter(name => active.includes(name)), purpose) });
  } });
  // The visit reads ask the hunting owner's `cave.state`: a visit holds the party, or owns this
  // member (a held visit owns only the members inside).
  const visit = (name?: string) => name === undefined ? (partyHooks().ask('cave.state') as CaveVisitState).phase !== 'idle'
    : (partyHooks().ask('cave.state', name) as CaveMemberState).owned;
  // Each member's presence is the events owner's `event.presence`, from its own scope's records.
  const presence = createEventPresence({ record: () => ports.record() as unknown as ReturnType<Parameters<typeof createEventPresence>[0]['record']>,
    scope: scopeOf, visit, attends: ports.attends });
  // Today's event admission: the member's event switch and its instance limits (06), and no Cave visit.
  const enrolled = (name: string, event: string) => ports.eventEnabled(name, event) && ports.instanceAllowed(name, event);
  const admitted = (name: string, event: string) => enrolled(name, event) && !visit(name);
  // `dueYields`: a member of the scope has a live event it is admitted to, by `eventFirst`
  // over reports fresh by the one freshness rule (runtime/protocol/reports.ts).
  const due = (state: TaskScope) => !!state.leader && !!eventFirst(state.statuses, state.monsterHunt?.participants ?? [state.leader], admitted, ports.now());
  const yields = (state: TaskScope) => priority(state.monsterHunt) && dueYields('hunt-turn-in') && due(state);
  const leaderScope = (g: { group: string; members: string[]; groupKind: string }) => {
    if (g.groupKind === 'merchant') return null;
    const state = scopeOf(g.members[0]!);
    return state.leader ? state : null;
  };
  const registration = tasksRegistration(owner, {
    // groups.move (1.4): each changed member leaves its old scope and joins its new one, and the
    // owner rebuilds the groups at once.
    moved() {
      const previous = applied;
      applied = membership();
      ports.reconcile(previous);
      owner.sync(ports.groups.list());
    },
    hands: () => holds.members(),
    holder: ask => memberHolds(ask, scopeOf(ask.member), () => partyHooks().survival.verdict({ group: groupKey(ask.group) })),
    walk(notice, ended) {
      const group = String(notice.group ?? '');
      if (ended) {
        if (walks.get(group)?.walk === notice.walk) walks.delete(group);
        manual.walkEnded(String(notice.walk), String(notice.code));
        // A walk ended for a member that left its group was the Hunt's walk too.
        const hunt = notice.code === 'membership' ? ports.groups.walkGroup(group)?.state.monsterHunt : null;
        if (hunt && hunt.convoyId === notice.walk) hunt.convoyId = null;
        return;
      }
      const was = walks.get(group)?.walk === notice.walk ? walks.get(group) : undefined;
      walks.set(group, { walk: String(notice.walk), purpose: (notice.purpose as string | null | undefined) ?? was?.purpose ?? null,
        phase: (notice.phase as string | undefined) ?? was?.phase ?? 'formed' });
    },
  });
  // Each group's running walk, from movement's notices.
  const walks = new Map<string, { walk: string; purpose: string | null; phase: string }>();
  const membership = () => { const r = ports.record(); return structuredClone({ leader: r.leader, followers: r.followers }); };
  let applied = membership();
  const hooks = partyHooks();
  // The tasks owner's own sources and the ones its install builds: the player's trips, Follows me, the hunting owner's
  // Cave, rare and Hunt with its suspend listener, the events owner's events and the target mode slot.
  // Survival and the merchant publish theirs from their own modules, and the registry
  // asks every core source in the declared order (rules.ts SOURCE_ORDER).
  const hunting = createHuntingSources({ visit: ports.visit, rare: ports.rare, scope: leaderScope, due: state => yields(state as TaskScope) });
  for (const r of [registration, manual.source, holds.source, hunting.cave, eventSource({ presence: presence.presenceOf, eventReturn: name => scopeOf(name).eventReturn,
    merchantReturn: name => ports.record().deferredEventReturns?.[name],
    commandHold: name => (ports.record().statuses[name] as { commandHold?: { owner?: string; reason?: string } | null } | undefined)?.commandHold }),
    hunting.rare,
    slotSource({ hooks: ports.hooks, scope: leaderScope, huntKind: state => huntKind(state, yields(state as TaskScope)), release: slots.release }),
    hunting.hunt, hunting.suspended]) {
    // The realm's registry outlives a coordinator start in the same process (a reload), so the
    // registry's `publish` registers each at the first start and puts each later start's answers in it.
    const result = hooks.publish(r);
    if (!result.ok) throw Error(`The groups and tasks owner's ${r.name} did not load: ${result.message}`);
  }
  const dueBy = new Map<string, boolean>(), dead = new Set<string>(), slotBy = new Map<string, Record<string, unknown>>();
  // The task tick: once per status report, and again right before a walk starts (`live`), so the
  // walk's task is live and the walk takes its tier. A start from inside a source's own
  // tick reads the tick's answers, which are current.
  let asking = false;
  function tick() {
    const groups = ports.groups.list();
    // The task tick runs before a report's event stage (table I, runtime/status/rules.ts), so presence is the
    // previous report's. After a coordinator restart each member's presence comes from the saved
    // attendance and trips first, so an attendance that was live asks again on the first tick.
    for (const g of groups) for (const name of g.members) if (!presence.observed(name)) presence.observe(name);
    owner.sync(groups);
    holds.tick(groups);
    askSources(owner, groups, ports.now(), view => partyHooks().taskRequests(view) as { name: string; answers: SourceAnswer[] }[]);
    manual.tick(party());
    owner.tick();
    for (const group of ports.groups.combat()) {
      const live = group.id ? owner.live(group.id) : null, walk = group.state.activeConvoy, now = yields(group.state);
      if (group.id && dueBy.get(group.id) !== now) { dueBy.set(group.id, now); partyHooks().notify('task.due', { group: group.id, due: now, by: 'core:event' }); }
      // `slot.changed`: the group's target or combat mode entry changed, by the settings write.
      if (group.id) {
        const entries: Record<string, unknown> = { 'target-mode': group.state.targetMode, 'combat-mode': group.state.combatMode }, before = slotBy.get(group.id);
        slotBy.set(group.id, entries);
        for (const slot of Object.keys(entries)) if (before && before[slot] !== entries[slot])
          partyHooks().notify('slot.changed', { group: group.id, slot, entry: entries[slot], by: 'core:settings' });
      }
      // A group walk that ranks below the task that now holds the group belongs to a
      // suspended or ended task, so the takeover asks movement's `walks.end` once, `replaced:<kind>`.
      if (live && walk?.requester?.tier && walk.requester.tier !== live.tier && above(live.tier, walk.requester.tier))
        partyHooks().walks.end(groupKey(group.id), `replaced:${live.kind}`);
    }
  }
  function live(group: string | null) {
    if (!group) return null;
    if (!asking) {
      asking = true;
      try { for (const name of owner.live(group)?.members ?? []) presence.observe(name); tick(); } finally { asking = false; }
    }
    const l = owner.live(group);
    return l ? { kind: l.kind, tier: l.tier, owner: l.owner } : null;
  }
  // `runs`: a source's acting tick may act. The Hunt and the slot act while their task is live
  // and no hold stops it; the rare, anniversary and event-return ticks while no Cave visit holds
  // the party, the event return also while no task above attendance holds it.
  // 2.4 gaps 1 and 2: no farm-area move starts while a task above farming holds the group, a Cave
  // visit for a member that went solo mid-visit included. Without a leader the party has no group,
  // and only the visit holds it.
  function runs(group: string | null, source: 'mode' | 'rare' | 'anniversary' | 'event-return' | 'farm-area'): boolean {
    if (source === 'rare' || source === 'anniversary') return !visit();
    const id = group ?? party(), l = id ? owner.live(id) : null;
    if (source === 'event-return') return !visit() && !(l && above(l.tier, 'event-attendance'));
    if (source === 'farm-area') return id ? !(l && above(l.tier, 'farming')) : !visit();
    return !!l && (l.source === 'core:hunt' || l.source === 'core:slot') && !owner.holds(id!).some(h => stopsActing(h.by));
  }
  // A group's Hunt hand-in yields to a due event while no hold stops the group acting.
  const huntYields = (group: string, state: TaskScope) => !owner.holds(group).some(h => stopsActing(h.by)) && yields(state);
  // Whether the member "can win those fights alone", for an add-on's farm answer: survival's walk verdict (`survival.verdict({walk})`)
  // for the member alone against one of the saved spot's monsters.
  function aloneWinnable(name: string): boolean {
    const state = scopeOf(name), monsters = ports.monsters();
    const mtype = partyFocus(state)[0];
    if (!mtype || !monsters?.[mtype]) return false;
    return partyHooks().survival.verdict({ walk: true, members: [name], attackers: [{ mtype, hp: Number((monsters[mtype] as { hp?: number }).hp ?? 0), target: name }] }) === 'fight';
  }
  // `turn-in` for a scope's own ports: `heartbeat` with the yield to a due event, `travel`
  // without.
  const turnIn = (state: TaskScope, reader: 'heartbeat' | 'travel') => priority(state.monsterHunt) && (reader === 'travel' || !yields(state));
  const answers: TaskAnswers = {
    live: group => { const l = owner.live(group); return l && { kind: l.kind, owner: l.owner, tier: l.tier, members: l.members, since: l.since }; },
    groupOf: owner.groupOf, assignment: owner.assignment, status: owner.status,
    allows: (question, name) => question === 'death-recovery' ? deathRecoveryAllows(presence.presenceOf(name)) : owner.allows(question, name),
    turnInHolds: (group, reader) => turnIn(scopeOf(leaderOf(group)), reader),
    held: holds.held, runs,
    huntYields: group => huntYields(group, scopeOf(leaderOf(group))),
  };
  publishTasks(answers);
  // The E2E fixture reads and drives the owner in this process (e2e/live-coordinator.cjs).
  (globalThis as { __partyTasks?: TaskOwner }).__partyTasks = owner;
  return {
    owner, holds, slots, manual, answers, live, runs, observe: presence.observe, presences: presence.presences, yields, visit,
    // `rare`: the table refuses a rare against the party's live task, with the rare type's
    // "May interrupt Hunt" switch when the type is known.
    rareRefused(mtype?: string | null) {
      const group = party();
      // The rare's own live task never refuses its own encounter. Judged as a second rare it would read as refused,
      // and the encounter would end `interrupted` on every tick that is not in a fight.
      if (group && owner.live(group)?.kind === 'rare') return false;
      const interruptsHunt = mtype ? ports.record().passiveHunting?.rules[mtype]?.interruptsHunt !== false : undefined;
      return !!group && owner.refuses(group, { kind: 'rare', owner: 'rare:ask', ...(mtype ? { rare: mtype } : {}), ...(interruptsHunt === undefined ? {} : { interruptsHunt }) });
    },
    turnIn,
    // `walk:<activity>` for a scope's shared walk. A kind whose `groups` column runs the escape
    // walks only once its escape has released. An event walk that would take over the scope's live
    // trip hands its event facts, and waits while the trip winds down.
    walkAllowed: (state: TaskScope, activity: string, kind: 'party' | 'solo', takeover?: WalkTakeover) =>
      (!GROUPS[kind].escape || !state.escape || state.escape.stage === 'released') &&
      walkAllowed(activity, priority(state.monsterHunt), yields(state), !!takeover && onTrip(state) && tripWindsDown(takeover)),
    // A member under a user hold is in no grouped pull (13.5): the console never moves it, so its
    // attack-range readiness never comes, and a pull that waited on it would never commit.
    unheld: <M extends { name: string }>(list: M[], kind: 'party' | 'solo') => GROUPS[kind].holds ? list.filter(m => !holds.held(m.name)) : list,
    // A member in no group (offline or unowned) has no task to refuse the merchant's visit.
    visitAllowed: (name: string) => !owner.assignment(name) || owner.allows('merchant-visit', name),
    // A source's acting tick runs while `runs` lets it.
    tickIf(group: string | null, source: Parameters<typeof runs>[1], act: () => void) { if (runs(group, source)) act(); },
    // The Hunt's intent hold on its group (13.5): a cancelled member's navigation pauses the Hunt.
    intentHold(group: string | null, reason: string | null) { if (group) owner.hold(group, 'intent', reason ? { reason } : null); },
    farmingLive: (group: string | null) => !!group && owner.live(group)?.kind === 'farming',
    // The member holds on the character, and an add-on combat mode entry, which reaches the
    // character as the way it fights: its answer for the scope's members, grouped as Default or
    // scatter as Scatter.
    handResponse(name: string) {
      const scope = scopeOf(name), fights = partyHooks().combatMode(String(scope.combatMode), ports.members(scope.leader ?? name));
      return { ...holds.response(name, anchor => ports.record().statuses[anchor] as { map: string; x: number; y: number } | undefined),
        ...(fights ? { partyFarmingMode: answerOf(fights) } : {}) };
    },
    // The heartbeat `task`: the member's assignment from its group's owner, with
    // the wait in Main for a member the group's event cannot use. A member an add-on's own walk left out
    // goes where the add-on names (`member.apart`).
    memberTask(name: string) {
      const owned = owner.assignment(name), group = owner.groupOf(name), live = group ? owner.live(group) : null, addon = live && addonOf(live);
      return heartbeatTask(owned, addon ? addonApart({ ask: view => ask('member.apart', addon, view), winnable: aloneWinnable }, group!, name, live) : eventApart({
        admitted: enrolled, present: member => !!presence.presenceOf(member) }, name, owned));
    },
    startWalk,
    nextCommand: () => ports.record().nextCommandId++,
    // A player's travel command: a command that walks a combat character releases the Cave
    // visit's hold, and a travel command for one character replaces its group's held trip.
    // The hunting owner's visit release returns its refusal while a member is still inside (cave.ts `release`), and
    // the player gets that refusal as 409.
    travelCommand<R>(body: Record<string, unknown>, handle: (body: Record<string, unknown>) => R): R | { status: number; body: { error: string } } {
      const type = String(body.type), merchant = ports.record().merchantCharacter;
      const refusal = navigational({ type }) && body.character !== merchant
        ? ports.releaseVisit() : null;
      if (refusal) return { status: 409, body: { error: String(refusal) } };
      if (['character-travel', 'travel', 'force-travel'].includes(type) && typeof body.character === 'string' && body.character !== merchant)
        manual.replace(groupKey(ports.groups.solo(body.character) ? groupId('solo', body.character) : party()));
      return handle(body);
    },
    // The task tick and the selected target mode entry act once per status report, the entry while
    // its task may act (`runs`); the death edge runs once per death. The hunting owner's
    // per-report tick (hunting/coordinator/install.ts `reportTick`) steps the Hunt, the farm spot
    // and the rare after it.
    taskTick(changedName?: string) {
      asking = true;
      try {
        tick();
        // The fast combat report (runtime/status/coordinator/channel.ts) can set `rip` before the full report
        // that runs this tick, so the owner keeps its own edge.
        if (changedName) {
          if (!scopeOf(changedName).statuses[changedName]?.rip) dead.delete(changedName);
          else if (!dead.has(changedName)) { dead.add(changedName); owner.died(changedName); }
        }
        ports.reconcileVisit();
        for (const group of ports.groups.combat().filter(g => g.id && g.state.leader)) {
          if (huntYields(group.id!, group.state) || !runs(group.id, 'mode')) continue;
          slots.tick(group.state, group.state.leader!);
        }
      } finally { asking = false; }
    },
  };
}
