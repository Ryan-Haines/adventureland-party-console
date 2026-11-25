// The task owner:
// one per group on the coordinator, deciding which task
// holds the group. A source (sources.ts) describes the task its record names once per task
// tick; this owner requests, keeps, updates and releases on that description, and the table
// (runtime/tasks/rules.ts) decides. It holds only what it decides from: the members, the live
// task, the waiting list, the ladder rung, the holds, the status line and the ring.
import { TIERS, type Tier } from '../../protocol/ranks.ts';
import { createMovementRing, MOVEMENT_RING_SIZE, type RingEntry } from '../../protocol/records.ts';
import type { LadderPort } from '../api.ts';
import type { OwnTaskHook, TaskNoticeName } from '../../hooks/registry.ts';
import { allows as tableAllows, column, judge, nextRung, offers, preemptAsked, reportChanged, RUNGS, taskTier, type EndCode, type FailOptions, type GroupKind,
  type HoldBy, type Interrupted, type TaskAsk, type Question, type ReportPoint, type Reunion, type Rung, type SavedManual, type TaskKind, type WindDown } from '../rules.ts';

// A source's answers to the owner. Each runs inside the owner's call, so a source that throws
// breaks only its own task, which the owner records.
export interface TaskProvider {
  onStart?(handle: TaskHandle): void;
  onSuspend?(handle: TaskHandle, by: string): void;
  onResume?(handle: TaskHandle): void;
  onEnd?(handle: TaskHandle, code: string): void;
}
export interface TaskRequest {
  kind: TaskKind;
  // The identity the source picks and keeps, such as `hunt:<cycleId>` (1.3). Two requests with
  // the same identity are the same task.
  owner: string;
  members?: readonly string[];
  phase?: string; label?: string;
  // A bound the requester sets itself; a source's task is bounded by its source (rule 2.3.3).
  deadline?: number;
  // What a member's assignment points at, such as the event or the farm point.
  goal?: unknown;
  // The source that describes the task; it releases the task on the tick it describes none.
  source?: string;
  // When the player started the task, for a source that asks again for a saved one; a new
  // request starts now.
  since?: number;
  // The source's slot for this task, for a source that describes more than one task per group
  // (the event source's attendance and return).
  slot?: string;
  tier?: Tier; interruptsHunt?: boolean; rare?: string; interrupted?: Interrupted; windDown?: WindDown; visit?: boolean; reunion?: Reunion;
  // The group kinds an add-on's task runs in (rules.ts offers).
  groups?: readonly GroupKind[];
  provider?: TaskProvider;
}
// The handle statuses are movement's names (MovementRequest handles).
export type TaskStatus = 'granted' | 'kept' | 'waiting' | 'refused';
export interface TaskHandle { id: string; group: string; status: TaskStatus; windDown?: WindDown }
export interface Task extends Omit<TaskRequest, 'members' | 'tier'> {
  id: string; tier: Tier; members: string[]; since: number;
  // The walk the task's members are on, once its source names one (step 4).
  walk?: string;
  interrupted: Interrupted; windDown: WindDown;
  // Waiting entries only: when the entry lapses, when the table suspended it, and whether its
  // source yielded it (1.3 `suspend`), so it waits until the source resumes it.
  expires?: number; suspendedAt?: number; yielded?: boolean;
}
export interface GroupSpec { id: string; kind: GroupKind; members: readonly string[] }
// A group ring entry: the shared shape with `part: 'tasks'`. A broken
// invariant of 4.3 is a ring entry with `invariant` and `detail`.
export interface TaskRecord extends RingEntry { part: 'tasks'; members?: string[]; by?: string; invariant?: 1 | 2 | 3 | 4; detail?: string }
export type TaskRecordInput = Omit<TaskRecord, 'seq' | 'at'>;
// The group ring's snapshot triggers (section 6): a member's death, the live task reaching the
// safe point, a task ending `failed:<code>`, a group that loops, and the stuck record.
export type TaskSnapshotTrigger = 'death' | 'safe-point' | 'task-failed' | 'churn' | 'stuck';
export interface TaskOwnerPorts {
  now(): number;
  // Every notice goes through the hook registry to its listeners.
  notify(hook: TaskNoticeName, payload: Record<string, unknown>): void;
  // Movement's snapshot store with the group as the subject (at most 20 per subject, 7 days).
  snapshot(group: string, trigger: TaskSnapshotTrigger, records: TaskRecord[]): void;
  // The player's own trips, the one task with no record of its own.
  saveManual?(entries: SavedManual[]): void;
  // A member's last report as the wait rung compares it.
  report?(name: string): ReportPoint | undefined;
  // True while the walk `id` that a task named (`update({ walk })`) is still the group's walk.
  walkLive?(id: string): boolean;
  // A decision hook of the add-on whose task it is: `task.alternative`, `task.safePoint`,
  // `group.questions` (the registry's `ownTask`).
  ask?(hook: OwnTaskHook, addon: string, view: Record<string, unknown>): unknown;
}
// The add-on whose task `t` is, or null for a core task.
export const addonOf = (t: { kind: string }) => t.kind.startsWith('addon:') ? t.kind.slice('addon:'.length) : null;
// A point an add-on names: a map and two finite coordinates.
export function pointOf(value: unknown): { map: string; x: number; y: number } | null {
  const p = value as { map?: unknown; x?: unknown; y?: unknown } | null;
  return p && typeof p.map === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { map: p.map, x: Number(p.x), y: Number(p.y) } : null;
}
// The player's trips are the one task with no record of their own: the
// owner saves the tasks of the `core:manual` source (manual.ts) as `manualTasks`, and that source
// describes them back on every task tick.
export const MANUAL_SOURCE = 'core:manual';
// `waitAt` is the members' reports as the wait rung began; `code` the last failure's and
// `trying` what the wait rung tries on the next changed report. Every rung past `walk` is due:
// `fail` places the task on it for its source to act at once, and `wait` asks on the next changed
// report.
interface Ladder { rung: Rung; failures: number; code?: string; trying?: string; waitAt?: (ReportPoint | undefined)[] }
// A hold : not a task, no rank. `member` is unset for a hold on the whole group.
// `party` is a Manual character's "While I play this character, the party" choice.
export interface UserHold { by: HoldBy; reason: string; since: number; member?: string; party?: 'follows-me' | 'carries-on' }
// One status line per group (3.2): the top line and why other tasks wait.
export interface StatusReason { kind: string; label: string; since: number; needsAction: boolean }
export interface GroupStatus { group: string; phase: string; label: string; since: number; reasons: StatusReason[] }
interface Group {
  id: string; kind: GroupKind; members: string[];
  live: Task; waiting: Task[]; ladder: Ladder; holds: UserHold[];
  status: GroupStatus; statusKey: string; statusWrites: number;
  ring: ReturnType<typeof createMovementRing<TaskRecordInput>>;
  // Churn: the group's progress count, and the count each identity last took the group at.
  progress: number; took: Map<string, number>;
  // The ended walk the live task still named on the last tick (invariant 4).
  endedWalk?: string;
}
// What a task names in the ring and the notices.
const named = (t: Task) => ({ taskId: t.id, kind: t.kind, owner: t.owner });

export function createTaskOwner(ports: TaskOwnerPorts) {
  const groups = new Map<string, Group>(), groupOf = new Map<string, string>();
  let seq = 0;
  const standing = new Set<string>();
  const idle = (g: Pick<Group, 'id' | 'members'>): Task => ({ id: `${g.id}#idle`, kind: 'idle', owner: 'idle', tier: 'idle', members: [...g.members],
    since: ports.now(), interrupted: 'cancel', windDown: 'none' });
  const handleOf = (g: Group, t: Task, status: TaskStatus): TaskHandle => ({ id: t.id, group: g.id, status, ...(status === 'granted' ? { windDown: t.windDown } : {}) });
  // A source's own error never stops the owner's decision.
  function call(g: Group, t: Task, run: (provider: TaskProvider) => void) { if (t.provider) try { run(t.provider); } catch (error) { record(g, 'provider-error', t, { code: String(error) }); } }
  // Decisions only: a label change is not one (section 6).
  function record(g: Group, decision: string, t?: Task, extra: Partial<Pick<TaskRecord, 'code' | 'by' | 'ladderStep' | 'invariant' | 'detail'>> = {}) {
    g.ring.push({ part: 'tasks', decision, ...(t ? { kind: t.kind, owner: t.owner, tier: t.tier, members: [...t.members] } : {}),
      ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) });
  }
  function notice(hook: TaskNoticeName, g: Group, payload: Record<string, unknown>) { ports.notify(hook, { group: g.id, ...payload }); }
  // A break is one ring entry while it stands (4.3) and one `task.invariant` notice.
  function broke(g: Group, invariant: 1 | 2 | 3 | 4, detail: string, now: Set<string>) {
    const key = `${g.id}|${invariant}|${detail}`;
    now.add(key);
    if (standing.has(key)) return;
    standing.add(key);
    record(g, 'invariant', g.live, { invariant, detail, code: `invariant-${invariant}: ${detail}` });
    notice('task.invariant', g, { invariant, detail, by: g.live.owner });
  }
  const manualTrip = (t: Task) => t.source === MANUAL_SOURCE;
  function persistManual() {
    ports.saveManual?.([...groups.values()].flatMap(g => [g.live, ...g.waiting].filter(manualTrip)
      .map(t => ({ group: g.id, owner: t.owner, members: [...t.members], ...(t.goal === undefined ? {} : { destination: t.goal }), since: t.since,
        kind: t.kind === 'app' ? 'app' as const : 'manual' as const, ...(t.label === undefined ? {} : { label: t.label }) }))));
  }
  function save(g: Group, trigger: TaskSnapshotTrigger) {
    try { ports.snapshot(g.id, trigger, g.ring.entries()); } catch (error) { record(g, 'snapshot-error', undefined, { code: String(error) }); }
  }
  // The line is derived state: `changed` rewrites it only when the top line or the reason set
  // changes. A hold that needs the player's action comes first, then the live task; the
  // reasons are every hold and one line per waiting row.
  function changed(g: Group, by: string) {
    const holds = g.holds.map(h => ({ kind: `hold:${h.by}`, label: h.member ? `${h.member}: ${h.reason}` : h.reason, since: h.since, needsAction: true }));
    const rows = new Set<string>(), waiting: StatusReason[] = [];
    for (const t of g.waiting) if (!rows.has(t.kind)) { rows.add(t.kind); waiting.push({ kind: t.kind, label: t.label ?? t.kind, since: t.since, needsAction: false }); }
    const live = g.live, top = holds[0], stuck = g.ladder.rung === 'wait';
    // The wait rung names what it tries next, in movement's notice words.
    const status: GroupStatus = top
      ? { group: g.id, phase: top.kind, label: `${top.label} - needs your action`, since: top.since, reasons: [...holds, ...waiting] }
      : { group: g.id, phase: `${live.kind}:${stuck ? 'stuck' : live.phase ?? 'start'}`, label: stuck ? `Stuck - trying ${g.ladder.trying ?? 'again on the next report'}` : live.label ?? live.kind,
        since: live.since, reasons: waiting };
    const key = JSON.stringify(status);
    if (key === g.statusKey) return;
    g.status = status; g.statusKey = key; g.statusWrites++;
    notice('status.changed', g, { status: structuredClone(status), by });
  }

  // Waiting entries highest tier first; at an equal tier the older one finishes first.
  function enqueue(g: Group, t: Task) {
    g.waiting.push(t);
    g.waiting.sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank || a.since - b.since);
  }
  function start(g: Group, t: Task, resumed: boolean, by: string) {
    g.live = t; g.ladder = { rung: 'walk', failures: 0 };
    for (const name of g.members) notice('member.assigned', g, { member: name, assignment: api.assignment(name), by: t.owner });
    // Idle is no task: it gets no notices and no source.
    if (t.kind === 'idle') { record(g, 'idle', t); changed(g, by); return; }
    // An identity granted the group again with no progress since it last held it loops. A resume
    // is no loop: the task that suspended it caused it, and that task's own second grant trips
    // this check.
    if (!resumed && g.took.get(t.owner) === g.progress) save(g, 'churn');
    g.took.set(t.owner, g.progress);
    const handle = handleOf(g, t, 'granted');
    if (resumed) { record(g, 'resumed', t); call(g, t, p => p.onResume?.(handle)); notice('task.resumed', g, { ...named(t), by }); }
    else { record(g, 'granted', t); call(g, t, p => p.onStart?.(handle)); }
    notice('task.started', g, { ...named(t), rank: TIERS[t.tier].rank, members: [...t.members], resumed, by });
    changed(g, by);
  }
  // The highest waiting entry that has not lapsed and was not yielded becomes live, or idle.
  function promote(g: Group, by: string) {
    const now = ports.now(), next = g.waiting.find(t => !t.yielded && (t.expires === undefined || t.expires > now));
    if (!next) { start(g, idle(g), false, by); return; }
    g.waiting.splice(g.waiting.indexOf(next), 1);
    const resumed = next.suspendedAt !== undefined;
    delete next.suspendedAt;
    start(g, next, resumed, by);
  }
  // Every end names the task that became live next (invariant 4): promote always starts one, idle
  // at worst, and the `task.ended` notice carries its kind.
  function end(g: Group, t: Task, code: string) {
    record(g, 'ended', t, { code });
    if (code.startsWith('failed:')) save(g, 'task-failed');
    if (g.live === t) promote(g, t.owner);
    else { g.waiting.splice(g.waiting.indexOf(t), 1); changed(g, t.owner); }
    call(g, t, p => p.onEnd?.(handleOf(g, t, 'refused'), code));
    notice('task.ended', g, { ...named(t), code, next: g.live.kind, by: t.owner });
    if (manualTrip(t)) persistManual();
  }
  function suspendLive(g: Group, by: string, yielded: boolean) {
    const t = g.live;
    // A suspended task waits under its live bound, so its entry lapses with it (rule 2.3.3).
    t.suspendedAt = ports.now(); t.yielded = yielded; t.expires = t.deadline;
    enqueue(g, t);
    record(g, 'suspended', t, { by });
    call(g, t, p => p.onSuspend?.(handleOf(g, t, 'waiting'), by));
    notice('task.suspended', g, { ...named(t), by });
  }
  // A higher task takes the group: takeOver suspends or cancels the live one by its row (2.2).
  function takeOver(g: Group, t: Task, interrupted: Interrupted | undefined, resumed: boolean) {
    const old = g.live, code = `replaced:${t.kind}`, suspended = old.kind !== 'idle' && interrupted === 'suspend';
    if (suspended) suspendLive(g, t.kind, false);
    else if (old.kind !== 'idle') {
      record(g, 'ended', old, { code });
      call(g, old, p => p.onEnd?.(handleOf(g, old, 'refused'), code));
      notice('task.ended', g, { ...named(old), code, next: t.kind, by: t.owner });
    }
    start(g, t, resumed, t.owner);
    // The suspended task now waits behind the task that took the group.
    if (suspended) notice('task.waiting', g, { taskId: old.id, by: t.owner });
  }
  function find(handle: Pick<TaskHandle, 'id' | 'group'>): { g: Group; t: Task } | null {
    const g = groups.get(handle.group);
    const t = g && (g.live.id === handle.id ? g.live : g.waiting.find(w => w.id === handle.id));
    return g && t ? { g, t } : null;
  }
  const liveOf = (handle: Pick<TaskHandle, 'id' | 'group'>) => { const found = find(handle); return found && found.t === found.g.live && found.t.kind !== 'idle' ? found : null; };
  const reports = (g: Group) => g.members.map(name => ports.report?.(name));
  function climbed(g: Group, t: Task, code: string) {
    record(g, 'ladder', t, { ladderStep: RUNGS.indexOf(g.ladder.rung), code });
    notice('task.ladder', g, { taskId: t.id, rung: g.ladder.rung, by: code });
  }
  // The add-on whose task holds the group refuses a rare by its answer to the question `rare`
  // (`group.questions`, rules.ts rareRefused). It refuses a core task in the preempt band by its
  // answer to `preempt` (rules.ts preemptAsked). A core task asks no add-on.
  const addonRefuses = (g: Group, ask: TaskAsk) => {
    const addon = addonOf(g.live);
    if (!addon) return false;
    if (ask.kind === 'rare') return ports.ask?.('group.questions', addon, { question: 'rare', group: g.id, kind: g.live.kind, rare: ask.rare ?? null }) === false;
    return preemptAsked(g.live, ask) &&
      ports.ask?.('group.questions', addon, { question: 'preempt', group: g.id, kind: ask.kind, tier: taskTier(ask) }) === false;
  };
  const groupFor = (target: string) => groups.get(target) ?? groups.get(groupOf.get(target) ?? '');

  const api = {
    // The groups as Follow and the leader make them (1.2), once per task tick. A new group starts
    // idle; a group that is gone ends its tasks with `member-left`.
    sync(specs: readonly GroupSpec[]) {
      const seen = new Set<string>(), before = new Map(groupOf);
      for (const spec of specs) {
        seen.add(spec.id);
        let g = groups.get(spec.id);
        if (!g) {
          g = { id: spec.id, kind: spec.kind, members: [...spec.members], live: idle({ id: spec.id, members: [...spec.members] }), waiting: [],
            ladder: { rung: 'walk', failures: 0 }, holds: [], status: { group: spec.id, phase: 'idle:start', label: 'idle', since: ports.now(), reasons: [] }, statusKey: '', statusWrites: 0,
            ring: createMovementRing<TaskRecordInput>(ports.now, MOVEMENT_RING_SIZE), progress: 0, took: new Map() };
          groups.set(spec.id, g); changed(g, 'sync');
        }
        if (g.members.join() !== spec.members.join()) {
          for (const name of g.members) if (!spec.members.includes(name)) record(g, 'member-left', undefined, { by: name });
          for (const name of spec.members) if (!g.members.includes(name)) record(g, 'member-joined', undefined, { by: name });
          g.members = [...spec.members];
          g.holds = g.holds.filter(h => !h.member || g!.members.includes(h.member));
          if (g.live.kind === 'idle') g.live.members = [...g.members];
          notice('group.changed', g, { members: [...g.members], leader: g.members[0] ?? null, by: 'settings' });
          changed(g, 'sync');
        }
        for (const name of spec.members) groupOf.set(name, spec.id);
      }
      // A gone group's last notice names no members, so a reader keyed by the group (the events owner's
      // occurrences) ends what it holds for it.
      for (const [id, g] of groups) if (!seen.has(id)) {
        for (const t of [...g.waiting]) end(g, t, 'member-left');
        if (g.live.kind !== 'idle') end(g, g.live, 'member-left');
        groups.delete(id);
        for (const [name, owner] of groupOf) if (owner === id) groupOf.delete(name);
        notice('group.changed', g, { members: [], leader: null, by: 'settings' });
      }
      // A member that moved to another group has a new assignment, its new group's live task.
      for (const spec of specs) for (const name of spec.members) {
        const was = before.get(name), g = groups.get(spec.id)!;
        if (was !== undefined && was !== spec.id) notice('member.assigned', g, { member: name, assignment: api.assignment(name), by: g.live.owner });
      }
    },
    // Rule 2.3.1. A request ranks against the live task; the table answers grant, keep, wait or
    // refuse, and a granted takeover tells the source which wind-down the row runs first.
    request(group: string, req: TaskRequest): TaskHandle {
      const g = groups.get(group);
      if (!g) return { id: '', group, status: 'refused' };
      let tier: Tier;
      try { tier = taskTier(req); } catch (error) { record(g, 'refused', undefined, { code: String((error as Error).message) }); return { id: '', group, status: 'refused' }; }
      if (!offers(g.kind, req.kind, req.groups)) { record(g, 'refused', undefined, { code: `no-row:${req.kind}` }); return { id: '', group, status: 'refused' }; }
      const same = g.live.owner === req.owner ? g.live : g.waiting.find(w => w.owner === req.owner);
      if (same) {
        const status: TaskStatus = same === g.live ? 'kept' : 'waiting';
        record(g, status, same);
        return handleOf(g, same, status);
      }
      const { members, ...rest } = req;
      const t: Task = { ...rest, id: `${g.id}#${++seq}`, tier, members: [...(members ?? g.members)], since: req.since ?? ports.now(),
        interrupted: column(req, 'interrupted'), windDown: column(req, 'windDown') };
      const verdict = judge(g.live, req, addonRefuses(g, req));
      if (verdict.decision === 'granted') { takeOver(g, t, verdict.interrupted, false); if (manualTrip(t)) persistManual(); return handleOf(g, t, 'granted'); }
      if (verdict.decision === 'refused') { record(g, 'refused', t); notice('task.refused', g, { kind: t.kind, row: t.tier, by: g.live.owner }); return { id: '', group, status: 'refused' }; }
      // A newer manual command replaces a waiting older one (rule 2.3.3).
      if (t.kind === 'manual') for (const w of g.waiting.filter(w => w.kind === 'manual')) end(g, w, 'replaced:manual');
      t.expires = req.deadline;
      enqueue(g, t);
      record(g, 'waiting', t);
      notice('task.waiting', g, { taskId: t.id, by: g.live.owner });
      changed(g, t.owner);
      if (manualTrip(t)) persistManual();
      return handleOf(g, t, 'waiting');
    },
    // The only way task text reaches the status line (3.2). A label change is not a decision; a
    // phase change of the live task is progress for the churn rule.
    update(handle: Pick<TaskHandle, 'id' | 'group'>, patch: Partial<Pick<Task, 'phase' | 'label' | 'deadline' | 'goal' | 'walk'>>) {
      const found = find(handle);
      if (!found) return false;
      const { g, t } = found, phased = 'phase' in patch && patch.phase !== t.phase, labelled = 'label' in patch && patch.label !== t.label;
      Object.assign(t, patch);
      if (t !== g.live && 'deadline' in patch) t.expires = patch.deadline;
      if (phased && t === g.live) g.progress++;
      if (phased || labelled) notice('task.phase', g, { taskId: t.id, phase: t.phase, label: t.label, by: t.owner });
      changed(g, t.owner);
      return true;
    },
    // The holder ends its task; the highest waiting task becomes live. A handle that is no longer
    // live or waiting is a no-op.
    release(handle: Pick<TaskHandle, 'id' | 'group'>, code: EndCode = 'released') {
      const found = find(handle);
      if (!found) return false;
      end(found.g, found.t, code);
      return true;
    },
    // A source yields its own live task (1.3), such as Hunt waiting at Daisy for an expiry. The
    // task waits until its source resumes it.
    suspend(handle: Pick<TaskHandle, 'id' | 'group'>, reason: string) {
      const found = liveOf(handle);
      if (!found) return false;
      suspendLive(found.g, reason, true);
      promote(found.g, reason);
      return true;
    },
    // A yielded task asks for the group again. It takes over only where the table says it may,
    // so a source cannot resume itself above a live higher task.
    resume(handle: Pick<TaskHandle, 'id' | 'group'>): TaskStatus {
      const found = find(handle);
      if (!found) return 'refused';
      const { g, t } = found;
      if (t === g.live) return 'kept';
      t.yielded = false;
      const verdict = judge(g.live, t);
      if (verdict.decision !== 'granted') { changed(g, t.owner); return 'waiting'; }
      g.waiting.splice(g.waiting.indexOf(t), 1);
      delete t.suspendedAt;
      takeOver(g, t, verdict.interrupted, true);
      return 'granted';
    },
    // True when the table would refuse `ask` against the group's live task, for a source that asks
    // before it starts (the rare).
    refuses(group: string, ask: TaskAsk): boolean {
      const g = groups.get(group);
      return !!g && judge(g.live, ask, addonRefuses(g, ask)).decision === 'refused';
    },
    // What holds the group (hook `task.live`).
    live(group: string) {
      const g = groups.get(group);
      if (!g) return null;
      const t = g.live;
      return { kind: t.kind, owner: t.owner, tier: t.tier, members: [...t.members], since: t.since, source: t.source, handle: handleOf(g, t, 'granted') };
    },
    // The group's manual task, live or waiting, for its source (manual.ts): the owner saves it and
    // restores it after a load, so the source reads it back here.
    manualOf(group: string): { handle: TaskHandle; owner: string; goal?: unknown; live: boolean } | null {
      const g = groups.get(group);
      // The group's one trip: the player's (`manual`) or an app key's (`app`).
      const t = g && [g.live, ...g.waiting].find(w => w.kind === 'manual' || w.kind === 'app');
      return g && t ? { handle: handleOf(g, t, t === g.live ? 'granted' : 'waiting'), owner: t.owner, goal: t.goal, live: t === g.live } : null;
    },
    // The tasks the sources hold in a group, live or waiting (sources.ts keeps no map of its own).
    held(group: string): { handle: TaskHandle; owner: string; source: string; slot?: string }[] {
      const g = groups.get(group);
      return g ? [g.live, ...g.waiting].filter(t => t.source).map(t => ({ handle: handleOf(g, t, t === g.live ? 'granted' : 'waiting'), owner: t.owner,
        source: t.source!, slot: t.slot })) : [];
    },
    // Rule 2.3.2: every member's assignment is its group's live task, whether or not the task can
    // use it, so a respawned member is never left without one (UP-3). The heartbeat carries it,
    // with the row's reunion column, which the character reads.
    assignment(name: string): { kind: TaskKind; owner: string; tier: Tier; goal?: unknown; phase?: string; reunion: Reunion } | null {
      const g = groups.get(groupOf.get(name) ?? '');
      if (!g) return null;
      const t = g.live;
      return { kind: t.kind, owner: t.owner, tier: t.tier, ...(t.goal === undefined ? {} : { goal: t.goal }), ...(t.phase === undefined ? {} : { phase: t.phase }),
        reunion: column(t, 'reunion') };
    },
    groupOf: (name: string) => groupOf.get(name) ?? null,
    // A cross-group question from the table's columns (2.2). A member under a hold refuses a
    // merchant visit, as Carries on treats it as absent (13.5). Under Follows me the merchant
    // delivers where the character stands: the delivery moves only the merchant.
    allows(question: Question, name: string): boolean {
      const g = groups.get(groupOf.get(name) ?? '');
      if (!g) return false;
      if (question === 'merchant-visit' && g.holds.some(h => h.member === name && h.party !== 'follows-me')) return false;
      if (!tableAllows(question, g.live)) return false;
      // An add-on's own task may refuse a question for its members, never allow one (`group.questions`).
      const addon = addonOf(g.live);
      return !addon || ports.ask?.('group.questions', addon, { question, group: g.id, kind: g.live.kind }) !== false;
    },
    // The group's line, or the line of a member's group, which every member's card shows (3.2).
    status(target: string): GroupStatus | null {
      const g = groupFor(target);
      return g ? structuredClone(g.status) : null;
    },
    // The task tick, after every source asked: lapsed waiting entries end `expired`, and tick
    // checks the four invariants of 4.3. A task its source describes is bounded by that source
    // (rule 2.3.3), and idle is due at the next tick, when every source asks again.
    tick() {
      const now = ports.now(), seen = new Set<string>();
      for (const g of groups.values()) {
        for (const t of g.waiting.filter(t => t.expires !== undefined && t.expires <= now)) end(g, t, 'expired');
        const live = g.live;
        // 4.3 invariant 1: a live task with no source, deadline, walk or due rung is a break; broke
        // records it, and fail makes the task's next rung due at once.
        if (live.kind !== 'idle' && !live.source && live.deadline === undefined && !live.walk && g.ladder.rung === 'walk') {
          broke(g, 1, `${live.kind} has no deadline, walk or due ladder step`, seen);
          api.fail(handleOf(g, live, 'granted'), 'no-bound');
        }
        // The wait rung asks again on the first report that shows a change, with no timer.
        if (g.ladder.rung === 'wait' && g.ladder.waitAt && reports(g).some((after, i) => reportChanged(g.ladder.waitAt![i], after))) {
          g.ladder = { rung: 'walk', failures: g.ladder.failures, code: g.ladder.code };
          climbed(g, live, 'waited');
          changed(g, 'report');
        }
        for (const name of g.members) if (groupOf.get(name) !== g.id || !api.assignment(name)) broke(g, 2, `${name} has no assignment from ${g.id}`, seen);
        // 4.3 invariant 4, the walk half: a walk's end reaches the task that asked for it, which
        // answers on the next tick with an end or a new walk (manual.ts). A live task that still
        // names the same ended walk one tick later never heard of the end.
        const ended = live.walk && ports.walkLive && !ports.walkLive(live.walk) ? live.walk : undefined;
        if (ended && g.endedWalk === ended) broke(g, 4, `${live.kind} ${live.owner} still names its ended walk ${ended}`, seen);
        g.endedWalk = ended;
        for (const t of g.waiting) if (!t.source && !Number.isFinite(t.expires)) broke(g, 3, `waiting ${t.kind} ${t.owner} has no expiry`, seen);
      }
      // A break that no longer stands leaves `standing`, so its next occurrence records again.
      for (const key of [...standing]) if (!seen.has(key)) standing.delete(key);
    },
    // The diagnostics read: every group's state and ring, and the breaks the
    // rings hold.
    diagnostics() {
      const read = [...groups.values()].map(g => ({ id: g.id, kind: g.kind, members: [...g.members],
        live: { ...g.live, provider: undefined }, waiting: g.waiting.map(t => ({ ...t, provider: undefined })),
        ladder: { ...g.ladder }, holds: g.holds.map(h => ({ ...h })), status: structuredClone(g.status), statusWrites: g.statusWrites,
        ring: g.ring.entries() }));
      return { groups: read, breaks: read.flatMap(g => g.ring.filter(r => r.invariant).map(r => ({ at: r.at, group: g.id, invariant: r.invariant!, detail: r.detail! }))) };
    },
    // The death the heartbeat reports (shared.js `rip`), once per death: section 6 trigger 1.
    died(name: string) {
      const g = groups.get(groupOf.get(name) ?? '');
      if (!g) return;
      record(g, 'died', undefined, { by: name });
      save(g, 'death');
    },
    // One failure of the live task: `alternative` the task's own, `regroup`, the safe point,
    // `fall-back` ends the task `failed:<code>`, and `wait` waits for a changed report for a task
    // whose row waits in place. Each rung is due at once; the source acts on the rung it gets.
    fail(handle: Pick<TaskHandle, 'id' | 'group'>, code: string, options: FailOptions = {}): { rung: Rung } | null {
      const found = liveOf(handle);
      if (!found) return null;
      const { g, t } = found, addon = addonOf(t);
      // An add-on's own task names its next alternative before `regroup` (`task.alternative`).
      const alternative = addon && g.ladder.rung === 'walk' ? ports.ask?.('task.alternative', addon, { group: g.id, taskId: t.id, code }) ?? undefined : undefined;
      const rung = nextRung(g.ladder.rung, t.kind, alternative === undefined ? options : { ...options, alternative: true });
      g.ladder = { ...g.ladder, rung, failures: g.ladder.failures + 1, code, ...(options.trying ? { trying: options.trying } : {}) };
      if (rung === 'alternative' && alternative !== undefined) t.goal = alternative;
      // ... and the point it restarts from on the safe-point rung (`task.safePoint`).
      const point = addon && rung === 'safe-point' ? pointOf(ports.ask?.('task.safePoint', addon, { group: g.id, taskId: t.id })) : null;
      if (point) t.goal = point;
      climbed(g, t, code);
      if (rung === 'safe-point') save(g, 'safe-point');
      if (rung === 'fall-back') { end(g, t, `failed:${code}`); return { rung }; }
      if (rung === 'wait') {
        // The stuck record names the rung and its lead-up is the ring.
        g.ladder.waitAt = reports(g);
        record(g, 'stuck', t, { ladderStep: RUNGS.indexOf(rung), code: `${code}; trying ${g.ladder.trying ?? 'again on the next report'}` });
        save(g, 'stuck');
      }
      changed(g, code);
      return { rung };
    },
    // Progress toward the live task's goal returns it to `walk` and counts for churn.
    // Progress on `walk` writes nothing.
    progress(handle: Pick<TaskHandle, 'id' | 'group'>) {
      const found = liveOf(handle);
      if (!found) return false;
      const { g, t } = found;
      g.progress++;
      if (g.ladder.rung === 'walk' && !g.ladder.code) return false;
      g.ladder = { rung: 'walk', failures: 0 };
      climbed(g, t, 'progress');
      changed(g, 'progress');
      return true;
    },
    rung(handle: Pick<TaskHandle, 'id' | 'group'>): Rung | null {
      return liveOf(handle)?.g.ladder.rung ?? null;
    },
    // The ring is read on demand: copies, never the heartbeat or the
    // dashboard state.
    ring(group: string): TaskRecord[] {
      return groups.get(group)?.ring.entries() ?? [];
    },
    // Start a hold on a group or one member, or end it with `null`. A hold has no deadline,
    // because its holder chose it, and the status line shows it until it ends.
    hold(target: string, by: HoldBy, hold: { reason: string; party?: UserHold['party'] } | null): boolean {
      const g = groupFor(target);
      if (!g) return false;
      const member = groups.has(target) ? undefined : target, at = g.holds.findIndex(h => h.by === by && h.member === member);
      if (hold && at >= 0) {
        if (g.holds[at]!.party === hold.party) return true;
        g.holds[at]!.party = hold.party;
      } else if (hold) g.holds.push({ by, reason: hold.reason, since: ports.now(), ...(member ? { member } : {}), ...(hold.party ? { party: hold.party } : {}) });
      else if (at >= 0) g.holds.splice(at, 1);
      else return false;
      record(g, hold ? 'hold' : 'unhold', undefined, { by, code: member });
      notice(hold ? 'group.held' : 'group.released', g, { ...(member ? { member } : {}), hold: by, by });
      changed(g, by);
      return true;
    },
    // The holds on a group (`target` a group id) or on one member, oldest first.
    holds(target: string): UserHold[] {
      const g = groupFor(target), member = groups.has(target) ? undefined : target;
      return g?.holds.filter(h => h.member === member).map(h => ({ ...h })) ?? [];
    },
    // Every task of `kind`, live or waiting, in every group ends with `code` (section 5: an add-on
    // switched off ends its tasks `cancelled:addon-off`).
    endKind(kind: TaskKind, code: EndCode) {
      for (const g of groups.values()) for (const t of [...g.waiting, g.live].filter(t => t.kind === kind)) end(g, t, code);
    },
  };
  return api;
}
export type TaskOwner = ReturnType<typeof createTaskOwner>;
// A source's ladder port (api.ts `LadderPort`) on its group's live task of `kinds`.
export function ladderPort(owner: TaskOwner, group: () => string | null, kinds: readonly TaskKind[]): LadderPort {
  const handle = () => {
    const id = group(), live = id ? owner.live(id) : null;
    return live && kinds.includes(live.kind) ? live.handle : null;
  };
  return {
    fail(code, options) { const h = handle(); return h ? owner.fail(h, code, options) : null; },
    progress() { const h = handle(); if (h) owner.progress(h); },
    rung() { const h = handle(); return h ? owner.rung(h) : null; },
  };
}
