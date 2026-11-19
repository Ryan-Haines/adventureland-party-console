// The events owner's reply state on the character (`turn-in`,
// `events`, `event-hints` and `slenderman` rows, runtime/status/rules.ts `TABLE_A`): the event
// selection and its revision, the event limits, the Cipher picks, the admission, the rejoin mark,
// the schedule's leads, the merchant's reserved event recovery, the events disabled since the last reply, the
// group task's event hint, the Hunt's event trip, the party's Slenderman sighting and the Hunt
// turn-in hold. Moved from characters/shared.js, which kept each in its own variable. The disables,
// the trip, the sighting and the merchant's reservation stay on the realm across a reload, as
// shared.js kept them. The other 06 parts read the state through the reads below.
import type { EventAdmission } from '../api.ts';
import { farmWalkHeld, type Requester } from '../../movement/api/character.ts';

interface Trip { event: string; startedAt: number; endedAt?: unknown }
interface Sighting { mtype?: string; id?: unknown; map?: string; in?: unknown; x?: number; y?: number; observedAt?: number; server?: string }
type Reply = Record<string, any>;
const realm = globalThis as { __partyPendingEventDisables?: string[]; __partyHuntEventTrip?: Trip | null;
  __partySlendermanSighting?: Sighting | null; __merchantCoordinatorEventRecovery?: boolean };

export interface EventReplyPorts {
  // The attendance (attend.ts): the selection rule, the joined and travelling event, its leave and poll.
  attend(): { selected(name: string): boolean; joined(): string | null; traveling(): unknown; leave(): void; poll(): Promise<void>;
    targets(types: string[]): void };
  // The anniversary row (anniversary.ts): its disable, the round the reply carries and the kiss.
  anniversary(): { disabled(): Promise<unknown>; receive(round: unknown): void; kiss(): unknown };
  // The A/B Testing strategy (combat.ts `receiveStrategy`).
  strategy(next: unknown): void;
  // The tasks owner's Hunt turn-in priority (assignment.ts `huntTurnInPriority`).
  turnIn(): boolean;
  // Movement's live request (`movement.live()`) and this character's lone event walk request: a live
  // request other than the event's own walk that the farm walk does not take over (movement's
  // `farmWalkHeld`) is left running by the disable, as b9b5c91e left the convoy, forced and Town walks.
  live(): Requester | null;
  eventWalk(): Requester;
  // The tasks owner's event return hold and farm reunion, which the disable's stop also leaves running.
  returnHolds(): boolean;
  reunion(): boolean;
  // Movement's stop of this character's lone event walk.
  stop(kind?: string): Promise<unknown>;
  name(): string;
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<unknown>;
  // One action after the running code yields, on the game client's timer.
  later(action: () => void): void;
}

export function installEventReply(ports: EventReplyPorts) {
  let list: string[] | null = null, enabled = false, limits: Record<string, any> = {};
  let cipher: { merchant: unknown; gathering: unknown } = { merchant: null, gathering: null };
  let admission: EventAdmission | null = null, admittedBefore: EventAdmission | null = null;
  let rejoin: string | null = null, leads: unknown = null, revision = 0, hint: string | null = null, turnInHeld = false;
  let pending: string[] = realm.__partyPendingEventDisables || [];
  let trip: Trip | null = realm.__partyHuntEventTrip || null;
  const disable = (events: string[]) => { pending = realm.__partyPendingEventDisables = Array.from(new Set(pending.concat(events))); };

  // Table A's `turn-in` row: the poll and the kiss wait while the tasks owner's Hunt turn-in holds the party, and
  // run once on the next turn of the game client's timer after the reply that releases it.
  function turnInReply(): void {
    const held = ports.turnIn(), released = turnInHeld && !held;
    turnInHeld = held;
    if (released) ports.later(() => { void ports.attend().poll(); ports.anniversary().kiss(); });
  }
  // Table A's `events` row: the selection and the event fields, then each event the player turned
  // off. A disabled event this character attends, travels to or holds its trip for ends here: its
  // lone walk stops unless another owner holds the walk, the coordinator hears of it, and the event
  // targets clear. A reply with no earlier selection disables the open trip's event when the
  // selection leaves it out.
  async function selectionsReply(state: Reply): Promise<void> {
    const previous = list, attend = ports.attend();
    list = Array.isArray(state.eventSelections) ? state.eventSelections : null;
    limits = state.eventSettings || {}; cipher = { merchant: state.cipherMerchant || null, gathering: state.cipherGathering || null };
    enabled = !!state.eventsEnabled;
    admittedBefore = admission;
    admission = state.eventAdmission || null;
    rejoin = state.eventRejoin || null;
    leads = state.eventLeads || null;
    realm.__merchantCoordinatorEventRecovery = !!state.merchantEventRecoveryReserved;
    if (previous && list && previous.join(',') !== list.join(',')) {
      revision++;
      disable(previous.filter(id => !attend.selected(id)));
    }
    if (!previous && state.eventTrip && !state.eventTrip.endedAt && !attend.selected(state.eventTrip.event)) disable([state.eventTrip.event]);
    for (const event of pending.slice()) {
      if (attend.selected(event)) { pending.splice(pending.indexOf(event), 1); continue; }
      if (event === 'anniversary') {
        await ports.anniversary().disabled();
      } else if (event === attend.joined() || event === hint || event === attend.traveling() ||
          state.eventTrip && !state.eventTrip.endedAt && state.eventTrip.event === event) {
        if (!farmWalkHeld(ports.live(), String(ports.eventWalk().owner)) && !ports.returnHolds() && !ports.reunion()) {
          try { await ports.stop('smart'); await ports.stop(); } catch { /* The disable goes on. */ }
        }
        await ports.request('/event-disabled', { method: 'POST', body: { character: ports.name(), event } });
        attend.targets([]); attend.leave();
      }
      pending.splice(pending.indexOf(event), 1);
    }
  }
  // Table A's `event-hints` row: the group task's hint, a newer Hunt event trip, the A/B Testing
  // strategy and the anniversary round. A newly admitted event moves the poll on this reply.
  function hintsReply(state: Reply): void {
    hint = state.partyEventHint || null;
    if (state.eventTrip && (!trip || state.eventTrip.startedAt >= trip.startedAt)) trip = realm.__partyHuntEventTrip = state.eventTrip;
    ports.strategy(state.abtestingStrategy || null);
    ports.anniversary().receive(state.anniversary);
    if (admission && admission.allowed && !(admittedBefore && admittedBefore.allowed && admittedBefore.event === admission.event))
      void ports.attend().poll();
  }
  // Table A's `slenderman` row: the party's Slenderman sighting.
  function sightingReply(state: Reply): void { realm.__partySlendermanSighting = state.partySlendermanSighting || null; }

  return {
    turnInReply, selectionsReply, hintsReply, sightingReply,
    // The selection: the priority list, null before a client sends one, and the older flag.
    selection: () => ({ list, enabled }),
    enabled: () => enabled,
    limits: () => limits,
    cipher: () => cipher,
    admission: () => admission,
    rejoin: () => rejoin,
    leads: () => leads,
    selectionRevision: () => revision,
    hint: () => hint,
    trip: () => trip,
    sighting: () => realm.__partySlendermanSighting || null,
    merchantRecovery: () => !!realm.__merchantCoordinatorEventRecovery,
  };
}
Object.assign(globalThis, { installEventReply });
