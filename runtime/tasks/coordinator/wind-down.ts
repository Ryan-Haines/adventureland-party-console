// The wind-down:
// before an event walk starts, the tasks owner holds a member through movement's
// `member.holder` read while the live trip winds down,
// while the group's fight finishes and for the healer. The fight's verdict is
// survival's (`survival.verdict({group})`). The event facts are the events owner's
// `event.schedule` for the walk's group and event: the spawn, the walk time
// from movement's `walks.estimate` and the event's window.
import type { MemberHold, MemberHoldAsk, WalkTakeover } from '../../hooks/registry.ts';
import { eventSchedule, occurrenceId } from '../../events/api.ts';
import { groupKey } from './groups.ts';

// The party reaches an event no more than 60 s
// after its spawn. It bounds every wait below.
const EVENT_ARRIVAL_MS = 60_000;

// The last moment a wait still lands the party within 60 s of the spawn: the group's occurrence of
// the walk's event, its spawn less its planned walk (none planned yet counts as no walk).
function attendanceCutOff(ask: Pick<MemberHoldAsk, 'group' | 'key'>): { until: number; shortWindow: boolean } | undefined {
  const scheduled = ask.key ? eventSchedule(occurrenceId(groupKey(ask.group), ask.key)) : null;
  return scheduled ? { until: scheduled.spawnAt + EVENT_ARRIVAL_MS - (scheduled.walkMs ?? 0), shortWindow: scheduled.shortWindow } : undefined;
}

// The live trip winds down before the cut-off, unless the event's window is short. It holds the
// trip's members coming (`windDownHolds`), and the tasks owner's `walk:event` answer keeps the trip from an
// event walk's takeover while it does.
export function tripWindsDown(ask: WalkTakeover): boolean {
  const cut = attendanceCutOff(ask);
  return !!cut && ask.at < cut.until && !cut.shortWindow;
}

// What 01 knows of the asked member: whether it walks the group's live trip, whether it is a healer,
// and survival's verdict on the group's fight.
interface WindDownFacts { onTrip: boolean; healer: boolean; verdict(): string | undefined }
// The holds the tasks owner answers for one member of an event walk's start. Before the cut-off the live trip
// (unless the event's window is short) and the group's fight (unless survival says leave) hold the
// member coming. The walk already waits for a healer that has not asked, so 01 holds it only at
// the cut-off, as not coming, and the walk goes without it. At the cut-off the trip and the fight give
// way and the walk takes the member as it stands. Without a scheduled occurrence 01 holds no one, as
// the wind-down let the trip and the fight go at once on b9b5c91e.
export function windDownHolds(ask: MemberHoldAsk, facts: WindDownFacts): MemberHold[] {
  const cut = ask.activity === 'event' ? attendanceCutOff(ask) : undefined;
  if (!cut) return [];
  const before = ask.at < cut.until, holds: MemberHold[] = [];
  const hold = (reason: string, coming: boolean) => holds.push({ owner: '01', reason, coming, endsOn: 'task.ended' });
  if (facts.onTrip && tripWindsDown(ask)) hold('the live trip winds down', true);
  if (before && facts.verdict() !== 'leave') hold("the group's fight finishes", true);
  if (!before && facts.healer) hold('the event walk goes without its healer', false);
  return holds;
}
