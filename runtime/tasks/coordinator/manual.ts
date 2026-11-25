// The `manual` provider:
// a party trip the player started is the group's manual
// task. A higher task suspends it, and when it is live again its walk starts again from where
// the party stands, to the trip's own destination. The manual task has no record of its own, so
// the owner saves it (1.2 "Saved state", `manualTasks`), and the provider's `core:manual` source
// describes each saved trip on every task tick: the pass keeps it, and after a load asks for it
// again with its saved start.
import type { Registration } from '../../hooks/registry.ts';
import { MANUAL_SOURCE, type TaskOwner } from './owner.ts';
import { savedManual } from '../rules.ts';
import type { SourceAnswer, SourceView } from './sources.ts';

// `kind` is the walk's tier: the player's trip is `manual`, an app key's `app`; `by` names
// the app.
export interface ManualTrip { id: string; location: { map: string; x: number; y: number }; purpose?: string; label?: string; participants: string[];
  kind: 'manual' | 'app'; by?: string }
// An app key's trip names its tier and app, so the trip's task and every walk it asks carry them.
export interface ManualGoal { destination: ManualTrip['location']; purpose?: string; label?: string; kind?: 'app'; by?: string }
// The party's record as the provider reads it: its active walk.
export interface ManualRecord {
  leader?: string | null;
  activeConvoy?: { id: string; requester?: { tier?: string; by?: string }; location?: { map: string; x: unknown; y: unknown; label?: string } | null;
    purpose?: string | null; label?: string; participants: readonly string[] } | null;
  // The saved trips, as the owner writes them.
  manualTasks?: unknown;
}
export interface ManualPorts {
  record(): ManualRecord;
  // Starts the trip's walk again; false when no leader can lead it.
  travel(goal: ManualGoal): boolean;
}
// The party's active walk while it is a trip at the `manual` or `app` tier, else null. 01 reads only
// the walk's tier; the key behind an `app` walk is the status owner's.
function tripOf(r: ManualRecord): ManualTrip | null {
  const c = r.activeConvoy, kind = c?.requester?.tier;
  if (!c || (kind !== 'manual' && kind !== 'app') || !c.location) return null;
  return { id: c.id, location: { map: c.location.map, x: Number(c.location.x), y: Number(c.location.y) }, purpose: c.purpose || undefined,
    label: c.location.label || c.label, participants: [...c.participants], kind, by: c.requester?.by };
}
// The status line names whose trip it is: the player's own, or the app's (00-overview "Apps", every
// change names the app).
const tripLabel = (trip: Pick<ManualTrip, 'kind' | 'by'>, place: string) =>
  `${trip.kind === 'app' ? `${(trip.by || 'app:an app').slice(4)}'s` : 'Your'} trip to ${place}`;

// One identity per destination and purpose, so the saved task and the trip's walk after a load
// are the same task (1.3).
const identity = (goal: ManualGoal) => `manual:${goal.purpose || 'travel'}:${goal.destination.map}:${Math.round(goal.destination.x)}:${Math.round(goal.destination.y)}`;

export function createManualProvider(owner: TaskOwner, ports: ManualPorts) {
  // The walk each trip last had, and whether its task was live on the last tick. `starting`
  // holds the trips `begin` let through whose walk its caller is starting, and `arrived` the trip
  // walks movement's `walk.ended` named `arrived`.
  const walks = new Map<string, string>(), wasLive = new Map<string, boolean>(), starting = new Set<string>(), arrived = new Set<string>();
  function forget(id: string) { arrived.delete(walks.get(id) ?? ''); walks.delete(id); wasLive.delete(id); starting.delete(id); }
  // A load restores the player's own trips; an app's trip ends with the coordinator run that held it
  //, so a start keeps only the `manual` entries.
  const record = ports.record();
  if (record.manualTasks !== undefined) record.manualTasks = savedManual(record.manualTasks).filter(trip => trip.kind !== 'app');
  return {
    // `manual`: each saved trip of the group, one slot per identity. A trip this provider ended
    // leaves `manualTasks` with its end, so the pass finds nothing left to release.
    source: {
      name: MANUAL_SOURCE, folder: 'core', author: 'adventureland-party-console',
      summary: 'Asks again for the trips you started, so a trip a higher task held, or a restart cut, walks on.',
      hooks: { 'task.request': (view): SourceAnswer[] => savedManual(ports.record().manualTasks).filter(trip => trip.group === (view as SourceView).group)
        .map(trip => ({ slot: trip.owner, end: 'released', ask: { kind: trip.kind === 'app' ? 'app' : 'manual', owner: trip.owner, members: trip.members,
          goal: trip.destination, label: trip.label ?? 'Your trip', since: trip.since } })) },
    } satisfies Registration,
    // Movement's `walk.ended` for a group walk (install.ts): a trip's walk that ended `arrived`
    // ends its trip on the next tick.
    walkEnded(walk: string, code: string) {
      if (code === 'arrived' && [...walks.values()].includes(walk)) arrived.add(walk);
    },
    // A trip asks before its walk starts, so the walk takes
    // its tier from the live manual task. A newer trip replaces the older one. A trip
    // the table would make wait is refused here, as its walk was before, so the player sees the
    // refusal at once.
    begin(group: string, goal: ManualGoal, members: readonly string[]): 'granted' | 'kept' | 'refused' {
      const id = identity(goal), held = owner.manualOf(group);
      if (held && held.owner !== id) { owner.release(held.handle, 'replaced:manual'); forget(held.owner); }
      const trip = { kind: goal.kind ?? 'manual', by: goal.by } as const;
      const handle = held?.owner === id ? held.handle : owner.request(group, { kind: trip.kind, owner: id, members, goal,
        label: tripLabel(trip, goal.label || goal.destination.map), source: MANUAL_SOURCE, slot: id });
      if (handle.status === 'waiting') { owner.release(handle, 'refused:not-live'); forget(id); return 'refused'; }
      if (handle.status === 'refused') return 'refused';
      // The caller starts the walk next, and that start ticks the providers: the tick leaves the
      // walk to it.
      starting.add(id);
      return handle.status;
    },
    // A player's command to a member is a newer trip than the group's own: the
    // held trip ends, so it does not walk the member away once a higher task it waited under ends.
    replace(group: string) {
      const held = owner.manualOf(group);
      if (held) { owner.release(held.handle, 'replaced:manual'); forget(held.owner); }
    },
    // Once per task tick, after every other provider has asked, so a takeover in this tick has
    // already suspended the trip before its walk is read.
    tick(group: string | null) {
      if (!group) return;
      const trip = tripOf(ports.record()), held = owner.manualOf(group);
      if (trip) {
        const goal: ManualGoal = { destination: trip.location, purpose: trip.purpose, label: trip.label,
          ...(trip.kind === 'app' ? { kind: 'app' as const, by: trip.by } : {}) }, id = identity(goal);
        // A newer trip replaces the older one (rule 2.3.3).
        if (held && held.owner !== id) { owner.release(held.handle, 'replaced:manual'); forget(held.owner); }
        const handle = held?.owner === id ? held.handle : owner.request(group, { kind: trip.kind, owner: id, members: trip.participants, goal,
          label: tripLabel(trip, trip.label || trip.location.map), source: MANUAL_SOURCE, slot: id });
        if (handle.status === 'refused') return;
        owner.update(handle, { walk: trip.id });
        starting.delete(id); walks.set(id, trip.id); wasLive.set(id, owner.manualOf(group)?.live ?? false);
        return;
      }
      // A manual task with no destination is not a trip this provider started (an app's or a
      // test's own task), so it leaves it to its caller.
      if (!held || !(held.goal as ManualGoal | undefined)?.destination) return;
      // A trip `begin` let through has its first walk from begin's caller, so this tick starts no
      // second one; a start that failed leaves the trip to the next tick.
      if (starting.delete(held.owner)) return;
      const walk = walks.get(held.owner), before = wasLive.get(held.owner);
      if (walk && arrived.has(walk)) { owner.release(held.handle, 'arrived'); forget(held.owner); return; }
      wasLive.set(held.owner, held.live);
      if (!held.live) return;
      // Live with no walk: the player cancelled it while it was live, or a higher task ended and
      // the trip resumes, or a load restored it.
      if (before === true && walk) { owner.release(held.handle, 'cancelled'); forget(held.owner); return; }
      const goal = held.goal as ManualGoal;
      if (!ports.travel(goal)) { owner.release(held.handle, 'failed:no-leader'); forget(held.owner); return; }
      // This tick started the walk, so the task names it now: a walk that ends before the next
      // tick reads it still reaches the trip, which ends, and the task never names the walk that
      // ended while it was suspended (4.3 invariant 4). `begin`'s mark from this start goes too.
      const started = tripOf(ports.record());
      starting.delete(held.owner);
      if (started) walks.set(held.owner, started.id);
      if (started) owner.update(held.handle, { walk: started.id });
    },
  };
}
