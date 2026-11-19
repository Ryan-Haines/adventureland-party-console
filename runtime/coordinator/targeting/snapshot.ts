// The grouped snapshot on the coordinator (party-console-plan docs/specs/04-targeting-design.md
// V1.1 snapshot.ts; TGT-025, TGT-037, TGT-038): the group's members for each fight, the Phoenix
// patrol's nominations, the event boundary's retires and the travel retires. The passing
// column it reads is targeting's own (characters/targeting/passing.ts), which E01-t1 moved here from
// the application's closure.
import { PHOENIX_CANDIDATE_PRIORITY, targetIdentity } from '../../characters/targeting/rules.ts';
import type { DungeonState, CaveObservation } from '../../hunting/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { RecoveryView, Registration } from '../../hooks/registry.ts';
import { caveCombat, huntOwner } from '../../hunting/coordinator/api.ts';
import { classifyTravelDefense, identity as travelIdentity, travelCombatFor, type TravelState } from '../../movement/api/coordinator.ts';
import type { WalkView } from '../../protocol/records.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { eventPresence } from '../../events/api.ts';
import type { RareStatus as Status } from '../../hunting/api.ts';
import type { StoredCombatLogEntry } from '../../status/api.ts';
import { huntAttackers, updateHuntTravel } from './hunt-travel.ts';
import type { HuntTravelConvoy } from './api.ts';
import { passingAllows } from '../../characters/targeting/passing.ts';
import { authorizeSuccessor, evaluateGroup, type HandoffPolicy, type RareRejections } from './queue.ts';
import { passingIdentity } from '../../characters/targeting/api.ts';
import type { Fight, Group, Member, Target } from './api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';

// E04-7: the party's event boundary comes from the groups owner's
// own notices for the party's event attendance, in place of the root-wide combatEventHandoff every
// trip wrote: its start opens the boundary and its end closes it, so `retireEventTargets` retires
// the targets queued before the event once the attendance ended (01 design 7.1, queue A45). The
// realm's registry outlives a coordinator start in the same process, so each start publishes the
// listener over its own state in place of the last start's.
// The boundary's saved shape (characters/targeting/saved-fields.ts `eventBoundary`), the targeting owner's own record.
export interface EventBoundary { startedAt: number; endedAt?: number }
type BoundaryState = { leader?: string | null; eventBoundary?: EventBoundary | null };
export function installEventBoundary(hooks: { publish(r: Registration): unknown }, state: BoundaryState, now: () => number) {
  const attendance = (payload: Record<string, unknown>) =>
    payload.kind === 'event-attendance' && !!state.leader && payload.group === `party:${state.leader}`;
  hooks.publish({ name: 'core:event-boundary', folder: 'core', author: 'adventureland-party-console',
    summary: 'Clears the targets the party queued before an event once the event is over.',
    hooks: {
      'task.started'(payload) { if (attendance(payload) && !payload.resumed) state.eventBoundary = { startedAt: now() }; },
      'task.ended'(payload) { if (attendance(payload) && state.eventBoundary) state.eventBoundary.endedAt ||= now(); },
    } });
}
interface GroupedState {
  dailyDungeons?: DungeonState;
  passiveHunting?: import('../../characters/targeting/api.ts').PassiveTravelSettings;
  targetMode?: string;
  monsterHunt?: import("../../hunting/api.ts").Hunt & {target:string|null} | null;
  // The party's attendance boundary, which this file's task.started and task.ended listener writes.
  eventBoundary?: EventBoundary | null;
  eventReturn?: unknown;
  leader: string | null;
  statuses: Record<string, Member["status"] & { ctype?: string; dungeon?: CaveObservation }>;
  groupedCombat?: Group | null;
  groupedCombatResetAt?: number;
  partyFarmingMode: string;
  activeConvoy?: HuntTravelConvoy & { phase: string } | null;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  followers: Record<string, unknown>;
  merchantCharacter: string | null;
  combatLogs: Record<string, StoredCombatLogEntry[]>;
}
interface GroupedPorts {
  patrolAcquisitionAllowed?: () => boolean;
  now: () => number;
  // The walk key of a group that runs a party death recovery (the tasks owner's T2 `deathRecovery` column), or
  // null for one that runs none.
  recoveryGroup: () => string | null;
  intent: (name: string) => { revision: number; cancelled?: boolean };
  owned: (name: string) => { type?: string } | undefined;
  prepare: (members: Member[]) => Member[];
  evaluate: (
    previous: Group | null,
    members: Member[],
    leader: string,
    now: number,
    resetAt: number,
    paused: boolean,
    huntTarget?: string | null,
    rejections?: RareRejections,
    // The farming scope the group plays in, whose placed add-on values `group.anchor` answers with.
    scope?: unknown,
  ) => Group;
  // The rares 07 rejected, from `farming.focus`, which the queue keeps out.
  rareRejections: () => RareRejections;
  // The lifecycle owner's table D `pulls` row: the console Pause, a deploy lease or the rare hunt's pull
  // block (the hunting owner's) holds the group's pulls.
  pullsHeld: () => boolean;
}

function farmingHuntTarget(state: GroupedState): string | null {
  return state.targetMode === "hunt" && state.monsterHunt?.stage === "farming" ? state.monsterHunt.target : null;
}

function participantNames(state: GroupedState, leader: string): string[] {
  const assigned = new Set([...state.headlessSlots, ...state.steamMembers].filter(Boolean));
  return [
    ...new Set([
      leader,
      ...Object.keys(state.followers).filter((name) => state.followers[name] && assigned.has(name)),
    ]),
  ]
    .filter((name) => name !== state.merchantCharacter)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function changed(previous: Group | null, group: Group): boolean {
  return (
    !previous ||
    previous.phase !== group.phase ||
    previous.selection !== group.selection ||
    previous.blockers.join(";") !== group.blockers.join(";") ||
    JSON.stringify(previous.recovering) !== JSON.stringify(group.recovering)
  );
}

function logFormation(state: GroupedState, leader: string, group: Group, now: () => number): void {
  appendCombatLog(state.combatLogs, leader, {
    at: now(),
    type: "formation",
    message: "Group " + group.phase,
    details: {
      target: group.target?.id || null,
      blockers: group.blockers,
      priest: group.priest,
      targetLeader: group.targetLeader,
      participating: group.participating,
      recovering: group.recovering,
    },
  });
}

function scatterWithoutDefense(state: GroupedState, recovering: boolean): boolean {
  return (
    state.partyFarmingMode === "scatter" &&
    !recovering &&
    state.activeConvoy?.phase !== "defending"
  );
}

// E04-s5: survival's fight rule for the party death recovery (05-survival-design W2.2 `fightRule`),
// applied to the grouped fight's members before the queue reads them. While the recovery runs, no
// member offers candidates and retention pauses; outside `finishing` and `returning-to-farm` the
// members' evidence, threats and saved state go too.
function recoveryMembers(view: RecoveryView | undefined, members: Member[]): Member[] {
  if (!view?.fight.running) return members;
  const keeps = view.fight.keepsObservations;
  return members.map(m => ({ ...m, status: m.status && { ...m.status, groupedCombat: { ...m.status.groupedCombat!, candidates: [], retentionPaused: true,
    ...(keeps ? {} : { evidence: [], threats: [], state: null }) } } }));
}
// The same rule on the group the queue built: it carries the recovery's record, keeps the fight's
// committed target in `finishing`, and outside `finishing` and `returning-to-farm` drops the queue,
// fights, target and selection.
function recoveryGroup(view: RecoveryView | undefined, group: Group): Group {
  if (!view?.fight.running) return group;
  (group as Group & { recovery?: unknown }).recovery = view.record;
  const target = group.target;
  if (view.fight.keepsCommitted && target && group.fights.some(t => targetIdentity(t) === targetIdentity(target))) group.committed = true;
  if (!view.fight.keepsObservations) { group.queue = []; group.fights = []; group.target = null; group.selection = null; group.committed = false; }
  return group;
}

// E04-8: a member at an event (the events owner's `event.presence`, E04-06b) is in no grouped pull.
function inEvent(name: string | null | undefined, status: Member["status"]): boolean {
  return !!name && !!status && !!eventPresence(name);
}

// The targeting owner's coordinator notices, read from the group the snapshot wrote
// against the one before it: a new nomination (`targeting.nominated`), and each fight's change of
// state (`targeting.fightState`). A queued fight is `planned` until a member engages it; one that
// leaves the queue is `retired` when the group saw it die, `lost` when the queue lost it, and
// `reset` otherwise, a dropped group included.
function tellGroup(before: Group | null | undefined, after: Group | null | undefined): void {
  const group = after?.key ?? before?.key;
  if (!group) return;
  const hooks = partyHooks();
  if (after?.target && after.selection && after.selection !== before?.selection)
    hooks.notify('targeting.nominated', { group, target: after.target.id, revision: after.selection, by: after.targetLeader || 'core:targeting' });
  const states = (g: Group | null | undefined) => {
    const out = new Map<string, { target: string; state: 'planned' | 'engaged' }>();
    for (const q of g?.queue ?? []) out.set(targetIdentity(q as Target & { server?: string }), { target: q.id, state: 'planned' });
    for (const f of g?.fights ?? []) out.set(targetIdentity(f as Target & { server?: string }), { target: f.id, state: f.state === 'engaged' ? 'engaged' : 'planned' });
    return out;
  };
  const from = states(before), to = states(after);
  for (const [key, fight] of to) {
    const prior = from.get(key)?.state;
    if (prior !== fight.state) hooks.notify('targeting.fightState', { group, target: fight.target, from: prior ?? null, to: fight.state, reason: prior ? 'engaged' : 'queued' });
  }
  for (const [key, fight] of from) {
    if (to.has(key)) continue;
    const killed = !!after?.deaths?.some(d => targetIdentity(d) === key), lost = !!after?.lostTargets?.some(l => targetIdentity(l as Target & { server?: string }) === key);
    hooks.notify('targeting.fightState', { group, target: fight.target, from: fight.state, to: killed ? 'retired' : lost ? 'lost' : 'reset',
      reason: killed ? 'killed' : lost ? 'lost' : after ? 'dropped from the queue' : 'the group reset' });
  }
}
export function coordinatorGroupedSnapshot(state: GroupedState, ports: GroupedPorts): Group | null {
  const before = state.groupedCombat;
  const group = groupedSnapshot(state, ports);
  tellGroup(before, state.groupedCombat);
  return group;
}
/** Events retain the prior group; cancelled navigation and ordinary scatter clear it. */
function groupedSnapshot(state: GroupedState, ports: GroupedPorts): Group | null {
  if (state.dailyDungeons && state.dailyDungeons.phase !== "idle") {
    state.groupedCombat = caveCombat(state, ports.now(), evaluateGroup);
    return state.groupedCombat;
  }
  // The party death recovery's step runs on the current reports before the snapshot reads its fight
  // rule (05-survival-design CF-S7).
  const key = ports.recoveryGroup(), view = key === null ? undefined : partyHooks().survival.recoveryStep(key);
  const recovering = !!view?.fight.running;
  const leader = state.leader,
    lead = state.statuses[String(leader)];
  if (leader && ports.intent(leader).cancelled) {
    state.groupedCombat = null;
    state.groupedCombatResetAt = ports.now();
    return null;
  }
  if (inEvent(leader, lead)) return null;
  if (!leader || scatterWithoutDefense(state, recovering)) {
    state.groupedCombat = null;
    return null;
  }
  return evaluateParticipants(state, ports, leader, key, view);
}

function evaluateParticipants(
  state: GroupedState,
  ports: GroupedPorts,
  leader: string,
  key: string | null,
  view: RecoveryView | undefined,
): Group | null {
  const recovering = !!view?.fight.running;
  const names = participantNames(state, leader);
  if (!names.length) {
    state.groupedCombat = null;
    return null;
  }
  let members = names.map((name) => ({
    name,
    ctype: (ports.owned(name)?.type || state.statuses[name]?.ctype)!,
    revision: ports.intent(name).revision,
    cancelled: ports.intent(name).cancelled,
    status: state.statuses[name],
  }));
  members = patrolMembers(ports,members) as typeof members;
  // Targeting's own passing column (04-targeting-design 3.9; E01-t1 moved the application's closure here).
  members = huntDefenseMembers(state,members,ports.now(),walk => passingAllows(walk, 'passive')) as typeof members;
  retireEventTargets(state, members, ports.now());
  const travelling = names.some(name => travelCombatFor(state as TravelState, name));
  // Apply travel restrictions here, before death-recovery preparation. A saved
  // Hunt stage alone cannot override the rare encounter that took ownership.
  const previous = travelPrevious(state, members, leader, travelling, ports.now());
  const group = ports.evaluate(
    previous,
    ports.prepare(recoveryMembers(view, travelling ? defensiveMembers(members, ports.now(), !!state.activeConvoy?.huntArrival) : members)),
    leader,
    ports.now(),
    state.groupedCombatResetAt || 0,
    travelling || ports.pullsHeld() || recovering,
    travelling ? null : farmingHuntTarget(state),
    ports.rareRejections(),
    state,
  );
  // A group with a death recovery reads its reset time from its own record.
  if (key !== null) group.resetAt = state.groupedCombatResetAt || 0;
  recoveryGroup(view, group);
  authorizeSuccessor(state,group,members,successorPolicy(state,ports,leader,travelling,recovering),ports.now(),(hook,payload)=>partyHooks().notify(hook,payload));
  state.groupedCombat = group;
  if (changed(previous, group)) logFormation(state, leader, group, ports.now);
  logUnseenRelease(state, leader, previous, group);
  return group;
}
function successorPolicy(state:GroupedState,ports:GroupedPorts,leader:string,travelling:boolean,recovering:boolean):HandoffPolicy {
  const activeHunt=state.targetMode==='hunt' ? state.monsterHunt : null;
  const allowed=successorActivityClear(state,travelling) && !ports.pullsHeld() && !recovering &&
    (state.targetMode!=='hunt' || activeHunt?.stage==='farming');
  if(!activeHunt)return {allowed};
  const owner=huntOwner(activeHunt,leader);
  return {allowed,hunt:successorQuest(owner,state.statuses[owner],ports.now())};
}
function successorQuest(owner:string,status:Member['status'],now:number):NonNullable<HandoffPolicy['hunt']> {
  const quest=status?.monsterHunt;
  return {owner,quest:quest?.id||'',count:quest?.count||0,fresh:successorQuestFresh(status,now)};
}
function successorQuestFresh(status:Member['status'],now:number):boolean {
  return !!status?.monsterHunt && status.monsterHunt.remainingMs>0 && fresh(status.seenAt, now);
}
// G05: whether the anniversary cycle holds the party is the events owner's answer (`event.cycle`, EVT-043).
function successorActivityClear(state:GroupedState,travelling:boolean):boolean {
  return !travelling && !state.activeConvoy && !state.eventReturn && !partyHooks().ask('event.cycle');
}
function huntDefenseMembers(state: GroupedState, members: Member[], now: number, passing: (walk: WalkView) => boolean): Member[] {
  const c=state.activeConvoy;
  if(!c || !passing(c) || members.some(m=>m.cancelled))return members;
  const control=updateHuntTravel(c,members,now,undefined,state.passiveHunting,passing);
  const targets=control?.committed||[];
  return members.map(m=> {
    const s=m.status,g=s?.groupedCombat;
    if(!s || !g)return m;
    const seen=(g.sightings||[]).filter(t=>targets.some(primary=>passingIdentity({...t,server:s.server})===passingIdentity(primary)));
    return {...m,status:{...s,groupedCombat:{...g,huntDefense:!!control?.defending,travelCommitted:targets,threats:seen}}};
  });
}
function travelPrevious(state: GroupedState, members: Member[], leader: string, travelling: boolean, now: number): Group | null {
  if (!travelling || state.activeConvoy?.huntArrival) return state.groupedCombat || null;
  const restored = state.groupedCombat || members.map(m => m.status?.groupedCombat?.state).find(g => g?.leader === leader) || null;
  const previous = retireTravelTargets(restored, members, now);
  if (previous !== restored && previous) logTravelRetirement(state, leader, restored, previous, now);
  return previous;
}

function logUnseenRelease(state: GroupedState, leader: string, previous: Group | null, group: Group): void {
  const released = (group.lostTargets || []).filter(t =>
    t.reason === "unseen primary released after bounded search; visible alternative available" &&
    !(previous?.lostTargets || []).some(old => old.id === t.id && old.retiredAt === t.retiredAt));
  for (const target of released) appendCombatLog(state.combatLogs, leader, {
    at:group.seenAt, type:"formation", message:"Unseen primary released; advancing combat queue",
    details:{target:target.id, mtype:target.mtype, next:group.target?.id, reason:target.reason},
  });
}
// The hunting owner's `farming.focus` answers whether the Phoenix patrol takes its sightings.
function patrolMembers(ports: GroupedPorts, members: Member[]): Member[] {
  return ports.patrolAcquisitionAllowed?.()
    ? phoenixCandidates(members,ports.now()) : members;
}

function defensiveThreats(group: NonNullable<NonNullable<Member['status']>['groupedCombat']>) {
  return group.travelCommitted?.length || group.huntDefense ? [...(group.currentAttackers || []), ...(group.threats || [])] : group.currentAttackers || [];
}
function defensiveMembers(members: Member[], now: number, preserve = false): Member[] {
  return members.map(m => {
    const group = m.status?.groupedCombat;
    if (!m.status || !group) return m;
    const attackers = defensiveThreats(group);
    const active = new Set(attackers.map(t => t.id));
    return { ...m, status: { ...m.status, groupedCombat: { ...group, candidates: [], retentionPaused: true,
      threats: attackers, evidence: preserve ? group.evidence : group.evidence?.filter(e => active.has(e.id)),
      state: preserve ? group.state : group.state ? retireTravelTargets(group.state, members, now) : null } } };
  });
}
function logTravelRetirement(state: GroupedState, leader: string, before: Group | null, after: Group, at: number): void {
  const added = (after.lostTargets || []).slice(before?.lostTargets?.length || 0);
  if (!added.length) return;
  appendCombatLog(state.combatLogs, leader, { at, type: "formation", message: "Released passive targets for travel", details: { targets: added.map(t => t.id) } });
}

function staleEventMember(member: Member, endedAt: number, now: number): boolean {
  return (
    !member.status ||
    member.status.seenAt < endedAt ||
    !fresh(member.status.seenAt, now) ||
    inEvent(member.name, member.status)
  );
}

function priorEventGroup(state: GroupedState, members: Member[]): Group | null | undefined {
  return (
    state.groupedCombat ||
    members.map((m) => m.status?.groupedCombat?.state).find((g) => g?.leader === state.leader)
  );
}

/** Only the completed event boundary may release an unseen unfinished target. */
function retireEventTargets(state: GroupedState, members: Member[], now: number): void {
  const handoff = state.eventBoundary;
  if (
    !handoff?.endedAt ||
    state.eventReturn ||
    members.some((m) => staleEventMember(m, handoff.endedAt!, now))
  )
    return;
  const previous = priorEventGroup(state, members);
  state.eventBoundary = null;
  if (!previous) return;
  const observed = new Set(
    members.flatMap((m) =>
      [
        ...(m.status?.groupedCombat?.sightings || []),
        ...(m.status?.groupedCombat?.threats || []),
      ].map((t) => targetIdentity({ ...t, server: m.status!.server })),
    ),
  );
  const stale = new Set(
    (previous.queue || [])
      .filter((t) => t.startedAt < handoff.startedAt && !observed.has(targetIdentity(t)))
      .map(targetIdentity),
  );
  if (!stale.size) return;
  const keep = (t: { id: string; map: string; in?: string | number; server?: string }) =>
    !stale.has(targetIdentity(t));
  state.groupedCombatResetAt = now;
  state.groupedCombat = {
    ...previous,
    resetAt: now,
    fights: previous.fights.filter(keep),
    queue: previous.queue.filter(keep),
    evidence: previous.evidence.filter(keep),
    threats: previous.threats.filter(keep),
    target: null,
    selection: null,
    committed: false,
  };
  appendCombatLog(state.combatLogs, String(state.leader), {
    at: now,
    type: "formation",
    message: "Event return retired unseen pre-event targets",
    details: { targets: [...stale] },
  });
}

/** Patrol observations are combat nominations, even while client convoy gates are closed. */
export function phoenixCandidates(members: Member[], now: number): Member[] {
  return members.map(member => {
    const status = member.status;
    if (!status) return member;
    const observation = (status as unknown as Status).rareObservation;
    if (!observation || !validObservation(member, observation, now)) return member;
    const group = status.groupedCombat || {};
    const reported = (group.candidates || []).map(candidate => candidate.mtype === 'phoenix'
      ? {...candidate, priority:PHOENIX_CANDIDATE_PRIORITY, passiveRare:true} : candidate);
    const sightings = observation.sightings.filter(s => s.mtype === 'phoenix' && s.visible && s.hp > 0 &&
      Number.isFinite(s.x) && Number.isFinite(s.y)).map(s => ({...s,map:observation.map,in:observation.in,
        server:observation.server,priority:PHOENIX_CANDIDATE_PRIORITY,passiveRare:true}));
    return {...member,status:{...status,groupedCombat:{...group,candidates:[...reported,...sightings]}}};
  });
}
function validObservation(member: Member, o: NonNullable<Status['rareObservation']>, now: number): boolean {
  const s=member.status!;
  return Array.isArray(o.sightings) && fresh(o.at, now, 'report', reportClockError(s)) &&
    o.runtimeId === s.combatSelection?.runtimeId && o.map === s.map && o.in === String(s.in ?? s.map) && o.server === s.server;
}

/** Tombstones stop delayed attack evidence and restored snapshots from reviving abandoned targets. */
export function retireTravelTargets(previous: Group | null, members: Member[], now: number): Group | null {
  if (!previous) return null;
  const commitments=members.flatMap(m=>m.status?.groupedCombat?.travelCommitted||[]);
  const decision = classifyTravelDefense({ groupedCombat: previous, statuses: Object.fromEntries(members.map(m => [m.name, m.status])) }, members.map(m => m.name), now);
  if (decision.waiting.length) return previous;
  const active = new Set([...decision.attackers,...huntAttackers(members,now),...commitments].map(travelIdentity));
  const retired = new Map<string, Fight>();
  for (const target of [...previous.fights, ...previous.queue]) if (!active.has(travelIdentity(target))) retired.set(travelIdentity(target), target);
  if (!retired.size) return previous;
  const keep = (t: Target & { server?: string }) => !retired.has(travelIdentity(t));
  return { ...previous, fights: previous.fights.filter(keep), queue: previous.queue.filter(keep),
    evidence: previous.evidence.filter(keep), threats: previous.threats.filter(keep),
    target: null, selection: null, committed: false,
    lostTargets: [...(previous.lostTargets || []), ...[...retired.values()].map(t => ({ ...t, retiredAt: now, reason: "released for travel; no current attacker" }))] };
}
